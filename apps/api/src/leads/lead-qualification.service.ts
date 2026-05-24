import { Inject, Injectable } from "@nestjs/common";
import { inferCountryFromText, normalizeCountryName, resolveCountry } from "@leadhunt/agent";
import { Prisma } from "@prisma/client";
import type { BraveSearchResult } from "../search/brave-search.client.js";
import { PrismaService } from "../prisma/prisma.service.js";

export type LeadNormalizationOptions = {
  taskId: string;
  defaultCountry?: string;
};

export type IcpScoringCriteria = {
  targetRegions: string[];
  productKeywords: string[];
  customerTypeKeywords: string[];
  disqualifiers?: string[];
  ownDomains?: string[];
  brandTerms?: string[];
  // 2026-05 P1+: domains of the seller's own reference customers. These
  // companies are NOT new buyer leads — they are evidence the seller
  // gave us as look-alike anchors. They must be hard-rejected from the
  // candidate table so a Lane D query like
  // `site:spectrummea.com ("partners" OR ...)` does not turn the
  // reference customer back into a "qualified" lead.
  referenceCustomerDomains?: string[];
  // 2026-05 P0: fuzzy company-name match for reference customers.
  // Domain match alone misses cases where the seller's reference URL
  // (e.g. https://highcloud.ae/) maps to a different actual company
  // domain (e.g. hctgroup.ae). When the candidate's company name
  // contains a reference customer's name, hard-reject regardless of
  // domain. Only multi-word names with non-generic content qualify
  // (see refNameQualifiesForFuzzyMatch).
  referenceCustomerNames?: string[];
};

export type NormalizedLeadCandidate = {
  taskId: string;
  companyName: string;
  website: string | null;
  country: string | null;
  queryCountry?: string | null;
  inferredCountry?: string | null;
  countryEvidence?: CountryEvidence[];
  countryConfidence?: CountryConfidence;
  countryConflict?: boolean;
  countryConflictCountries?: string[];
  sourceUrl: string;
  summary: string | null;
  contacts: Array<{
    type: "email" | "phone" | "social";
    value: string;
    sourceUrl: string;
  }>;
};

export type IcpScoreDraft = {
  score: number;
  grade: "high" | "medium" | "low";
  reasons: string[];
  risks: string[];
  leadType?: EvidenceLeadType;
  intelligenceType?: IntelligenceType;
  reviewLabels?: string[];
  extractableCompanies?: string[];
  pageType?: PageType;
  status:
    // 2026-05 simplified state machine. New code only emits these four:
    | "qualified"
    | "review"
    | "intelligence"
    | "rejected"
    // Legacy values are still part of the union so historical DB rows
    // and old test fixtures continue to type-check. New scoring should
    // not produce any of these.
    | "needs_country_review"
    | "country_conflict_review"
    | "intelligence_review"
    | "evidence_review";
};

type CountryConfidence = "high" | "medium" | "low" | "unknown";

type CountryEvidence = {
  type: "phone" | "email_domain" | "website_domain" | "official_text" | "service_area";
  country: string;
  value: string;
  sourceUrl?: string;
  confidence: Exclude<CountryConfidence, "unknown">;
};

export type CandidateBuyerEvaluation = {
  companyName: string;
  websiteUrl: string;
  resultType:
    | "target_buyer"
    | "possible_buyer"
    | "procurement_intelligence"
    | "supplier_or_competitor"
    | "directory"
    | "content_article"
    | "job_page"
    | "market_report"
    | "irrelevant"
    | "unknown";
  buyerType: string;
  fitScore: number;
  confidence: number;
  decision: "qualified" | "review" | "reject";
  matchedSignals: string[];
  risks: string[];
};

export type CandidateAiEvaluator = (
  candidate: NormalizedLeadCandidate
) => Promise<CandidateBuyerEvaluation | null>;

type ExistingLead = {
  id: string;
  companyName: string;
  website: string | null;
  contacts: Array<{ type: string; value: string; sourceUrl?: string | null }>;
};

type PageQualityAssessment = {
  skip: boolean;
  scoreAdjustment: number;
  reasons: string[];
  risks: string[];
};

type PageType =
  | "official_company_site"
  | "own_site"
  | "procurement_document"
  | "non_procurement_document"
  | "third_party_profile"
  | "brand_oem_site"
  | "supplier_or_storefront"
  | "content_or_directory"
  | "unknown";

type EvidenceLeadType =
  | "customer"
  | "content_evidence"
  | "government_information"
  | "intelligence";

type IntelligenceType =
  | "government_tender"
  | "rfq_notice"
  | "exhibition_pdf"
  | "project_news"
  | "company_directory"
  | "decision_maker_profile"
  | "buyer_directory"
  | "operator_vendor_registration";

type EvidenceLeadClassification = {
  leadType: Exclude<EvidenceLeadType, "customer">;
  intelligenceType?: IntelligenceType;
  reviewLabels: string[];
  extractableCompanies: string[];
  status: Extract<IcpScoreDraft["status"], "intelligence_review" | "evidence_review">;
  scoreCap: number;
  reason: string;
  risk: string;
};

// Contact probing balances recall with task runtime: keep the timeout tight,
// but visit enough high-value direct and linked pages for multilingual sites.
const contactProbeTimeoutMs = 8000;
const contactProbePageLimit = 16;
const contactLinkedProbePageLimit = 8;
const maxAiCandidateEvaluationsPerBatch = 15;

@Injectable()
export class LeadQualificationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  normalizeSearchResults(
    results: BraveSearchResult[],
    options: LeadNormalizationOptions
  ): NormalizedLeadCandidate[] {
    const candidates = results.map((result) => normalizeResult(result, options));
    return dedupeCandidates(candidates);
  }

  scoreCandidate(candidate: NormalizedLeadCandidate, criteria: IcpScoringCriteria): IcpScoreDraft {
    const text = [
      candidate.companyName,
      candidate.website,
      candidate.country,
      candidate.summary,
      candidate.contacts.map((contact) => contact.value).join(" ")
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const reasons: string[] = [];
    const risks: string[] = [];
    let score = 0;
    let forcedStatus: IcpScoreDraft["status"] | null = null;
    // 2026-05 Stage 2 follow-up: when set, the candidate is a
    // verified-off-target hard reject; the final score is capped
    // BELOW the main-pool threshold AFTER any later +score steps
    // (contactScore, buyer-role floor) so the row can't be rescued
    // back into review/qualified.
    let verifiedOffTargetCountryReject = false;
    // 2026-05 Stage 2 follow-up: same hard-reject mechanism for
    // off-industry candidates. detectOffIndustryBucket scans for
    // medical / SaaS / finance / consumer-retail / etc. signals and
    // returns the bucket name when (a) the candidate trips ≥2 hits
    // in one bucket, (b) target product/customer keywords are NOT
    // members of that bucket (so a SaaS-target user looking for
    // MongoDB stays in the running), and (c) the candidate has no
    // specific product term and no target customer-type term to
    // override the off-industry signal.
    let offIndustryBucketReject: string | null = null;
    const pageType = classifyCandidatePage(candidate, criteria);
    const pageQuality = assessPageQuality(candidate, criteria, pageType);
    const evidenceClassification = classifyEvidenceLead(candidate, criteria, pageType);
    const countryValidation = validatedCountry(candidate);
    const hasSearchContextSignal = hasSearchContext(text, criteria);
    const hasIndustryContextSignal =
      hasSearchContextSignal ||
      hasAny(text, criteria.productKeywords) ||
      hasAny(text, criteria.customerTypeKeywords) ||
      hasAny(text, buyerRoleTerms) ||
      hasAny(text, buyerUseCaseTerms) ||
      hasAny(text, infrastructureCustomerTerms) ||
      hasAny(text, genericBuyerIntentTerms);
    const hasProductKeywordSignal = hasAny(text, criteria.productKeywords);
    const hasSpecificProductSignal =
      hasAny(text, specificTelecomProductTerms) ||
      hasAny(text, criteria.productKeywords.filter(isSpecificProductTerm));
    const hasTargetCustomerType = hasAny(text, criteria.customerTypeKeywords);
    const hasUseCaseCustomerSignal = hasAny(text, buyerUseCaseTerms);
    const hasInfrastructureCustomerSignal = hasAny(text, infrastructureCustomerTerms);
    const hasGenericBuyerIntentSignal = hasAny(text, genericBuyerIntentTerms);
    const hasBuyerRoleSignal =
      hasAny(text, buyerRoleTerms) ||
      hasUseCaseCustomerSignal ||
      hasTargetCustomerType ||
      hasInfrastructureCustomerSignal ||
      hasGenericBuyerIntentSignal;
    const hasDirectContact = candidate.contacts.some(
      (contact) => contact.type === "email" || contact.type === "phone"
    );
    const buyerServicePage = looksLikeBuyerSideCompanyPage(candidate);
    const hasGenericServiceBuyerSignal = hasAny(text, genericServiceBuyerGateTerms);
    const hasCompanyNameQualityIssue =
      isForbiddenCompanyName(candidate.companyName) ||
      looksLikePseudoCompanyName(candidate.companyName) ||
      looksLikeSiteBuilderCredit(candidate.companyName);

    score += pageQuality.scoreAdjustment;
    reasons.push(...pageQuality.reasons);
    risks.push(...pageQuality.risks);

    if (hasIndustryContextSignal) {
      score += 20;
      reasons.push("Matches relevant product, industry, or buyer context");
    }

    // 2026-05 Stage 2 follow-up: off-industry hard reject. If the
    // candidate's text trips ≥2 hits inside an off-industry bucket
    // (medical/SaaS/etc.), AND the target's own product/customer
    // keywords aren't members of that bucket (self-guard for
    // SaaS-target users actually looking for MongoDB), AND there is
    // no specific product term + no target customer-type term in
    // the candidate text to override, force-reject below.
    offIndustryBucketReject = detectOffIndustryBucket(text, {
      productKeywords: criteria.productKeywords,
      customerTypeKeywords: criteria.customerTypeKeywords,
      hasSpecificProductSignal,
      hasTargetCustomerType
    });
    if (offIndustryBucketReject) {
      forcedStatus = "rejected";
      risks.push(
        `Off-industry signal: candidate looks like ${offIndustryBucketReject} content unrelated to the target product/customer`
      );
    }

    if (hasSpecificProductSignal) {
      score += 20;
      reasons.push("Mentions relevant product or category keywords");
    } else if (hasProductKeywordSignal) {
      score += 10;
      risks.push("Only generic product wording found; no explicit product category");
    }

    if (hasTargetCustomerType) {
      score += 20;
      reasons.push("Matches target customer type");
    }

    if (hasUseCaseCustomerSignal) {
      score += 12;
      reasons.push(
        "Matches maintenance, operator, tower, power, ISP, or field-service buyer scenario"
      );
    }

    if (hasInfrastructureCustomerSignal && hasIndustryContextSignal) {
      score += 18;
      reasons.push(
        "Matches operator, infrastructure, engineering, maintenance, or service customer profile"
      );
    }

    const hasTargetMarketConstraint = hasTargetRegionConstraint(criteria.targetRegions);
    const targetCountryMismatch = Boolean(
      countryValidation.inferredCountry &&
      hasTargetMarketConstraint &&
      !matchesTargetRegion(countryValidation.inferredCountry, criteria.targetRegions)
    );
    const targetCountryVerified =
      Boolean(countryValidation.inferredCountry) &&
      (countryValidation.countryConfidence === "high" ||
        countryValidation.countryConfidence === "medium") &&
      !countryValidation.countryConflict;
    const targetCountryUnverified =
      hasTargetMarketConstraint &&
      (!countryValidation.inferredCountry ||
        countryValidation.countryConfidence === "low" ||
        countryValidation.countryConfidence === "unknown");
    const sourceQueryCountryMismatch = Boolean(
      countryValidation.inferredCountry &&
        candidate.queryCountry &&
        !matchesTargetRegion(countryValidation.inferredCountry, [candidate.queryCountry])
    );
    const countryConflictOnlyOffTarget = countryConflictHasOnlyOffTargetEvidence(
      countryValidation,
      criteria.targetRegions
    );

    if (
      targetCountryVerified &&
      matchesTargetRegion(countryValidation.inferredCountry!, criteria.targetRegions)
    ) {
      score += 15;
      reasons.push(
        `Target country verified from official evidence: ${countryValidation.inferredCountry}`
      );
      if (sourceQueryCountryMismatch) {
        reasons.push(
          `Source query country differs from verified country; using official evidence: ${countryValidation.inferredCountry}`
        );
      }
    } else if (targetCountryMismatch) {
      // 2026-05 Stage 2 follow-up: hard reject when the candidate's
      // country is verified (high/medium confidence, no conflict) AND
      // proven to be outside the selected target markets. Earlier
      // versions kept these as "new-market exploration" leads with
      // only -20 score penalty, but the buyer-role floor below would
      // routinely rescue US/UK/FR sellers (HCT, MongoDB, Cisco, etc.)
      // back into the main pool of a Germany-targeted task. Verified
      // off-target = settled fact, not a soft hint, so we drain the
      // score AND force the status, ensuring buyer-role floor cannot
      // override (it explicitly skips when forcedStatus === "rejected").
      //
      // Lower-confidence cases (low / unknown / countryConflict) still
      // fall through to the soft-signal branches below, so candidates
      // with truly missing / ambiguous country evidence keep their
      // chance to surface for human review.
      const verifiedOffTargetCountry =
        targetCountryVerified &&
        !countryValidation.countryConflict;
      if (verifiedOffTargetCountry) {
        verifiedOffTargetCountryReject = true;
        forcedStatus = "rejected";
        risks.push(
          "Verified candidate country is outside the selected target markets"
        );
      } else {
        // Unverified / conflicting country mismatches stay soft so a
        // candidate with weak country evidence can still pass through
        // on strong product+role signals.
        score -= 20;
        risks.push("Official country evidence does not match the selected target markets");
      }
    } else if (!hasTargetMarketConstraint && hasAny(text, criteria.targetRegions)) {
      score += 10;
      reasons.push("Mentions target market");
    } else if (targetCountryUnverified) {
      risks.push("Target country is not verified from official website evidence");
    }

    if (countryValidation.countryConflict) {
      if (countryConflictOnlyOffTarget) {
        verifiedOffTargetCountryReject = true;
        forcedStatus = "rejected";
        risks.push(
          "Country evidence conflicts, but none of the verified country signals match the selected target markets"
        );
      }
      // Country conflicts (e.g. evidence points to two different
      // countries) used to force a separate review state. Per the
      // 2026-05 country-validation rework, we no longer split country
      // outcomes into their own statuses. We let the candidate flow
      // through the normal qualified/review/rejected path; the country
      // field will hold the most-likely country and the UI will tag it
      // as "country unconfirmed" if confidence is low.
      risks.push(
        `Country evidence conflicts${
          countryValidation.countryConflictCountries.length
            ? `: ${countryValidation.countryConflictCountries.join(", ")}`
            : ""
        }`
      );
    } else if (targetCountryMismatch) {
      // Verified country outside target markets remains a soft signal,
      // not a hard reject. The user explicitly asked: "validation fails
      // → just let it through, more customers is fine, treat it as
      // exploring a new market." So we record the mismatch in risks but
      // do not force-reject; downstream scoring still decides the bin.
      risks.push("Official country evidence is outside the selected target markets");
    } else if (targetCountryUnverified) {
      // No usable country signal yet. Used to bounce to
      // needs_country_review; that status is removed. Just note it.
      risks.push("Country not verified from address or phone; passing through unconfirmed");
    }

    const contactScore = contactCompletenessScore(candidate.contacts);
    if (contactScore > 0) {
      score += contactScore;
      reasons.push("Has usable contact signals");
    }

    const riskyTerms = [...defaultRiskTerms, ...(criteria.disqualifiers ?? [])].filter(Boolean);
    // 2026-05 Stage 2 follow-up (P2): negation-context aware match.
    // Plain text.includes(term) used to fire on phrases like
    //   "We do not sell consumer mobile phones"
    //   "no jobs page"
    //   "this site has no marketplace listings"
    // — pushing the candidate into a -20 penalty even though the
    // negative term was being explicitly rejected by the candidate's
    // own copy. containsOutsideNegationContext walks every match and
    // skips the ones that are governed by an immediately preceding
    // negation cue ("do not", "don't", "no ", "without", "except",
    // "exclude", "never", "instead of", etc.). True off-target text
    // ("Job openings: Senior Sales") still trips the penalty.
    const matchedRisks = riskyTerms.filter((term) =>
      containsOutsideNegationContext(text, term)
    );
    if (matchedRisks.length > 0) {
      score -= 20;
      risks.push(`Contains disqualifying terms: ${matchedRisks.slice(0, 4).join(", ")}`);
    }

    if (!candidate.website) {
      score -= 10;
      risks.push("Missing official website URL");
    }

    if (
      !hasSpecificProductSignal &&
      hasAny(text, genericItServiceTerms) &&
      !hasInfrastructureCustomerSignal
    ) {
      score = Math.min(score, 74);
      risks.push("Only generic IT/service signal; no explicit product or buyer context");
    }

    if (!hasSpecificProductSignal && !(hasBuyerRoleSignal && hasIndustryContextSignal)) {
      score = Math.min(score, 64);
      risks.push("No clear buyer, operator, integrator, procurement, or maintenance signal");
    }

    if (
      hasInfrastructureCustomerSignal &&
      !hasSpecificProductSignal &&
      !hasProcurementIntent(text)
    ) {
      score = Math.min(score, 74);
      risks.push("Infrastructure or service customer fit is kept for outreach validation");
    }

    const riskyDiscoveryPage =
      pageType !== "procurement_document" && isRiskyDiscoveryPage(candidate) && !buyerServicePage;
    if (!hasDirectContact) {
      score = Math.min(score, 74);
      risks.push("No usable email or phone found yet");
    }

    if (riskyDiscoveryPage) {
      const evidenceCap =
        hasDirectContact && hasSpecificProductSignal && hasUseCaseCustomerSignal ? 58 : 44;
      score = Math.min(score, evidenceCap);
      risks.push(
        "Third-party, directory, or content page is kept as evidence but needs manual validation"
      );
      if (!hasDirectContact) {
        risks.push("Discovery/content page without direct contact stays low-confidence");
      }
    } else if (buyerServicePage && pageType === "official_company_site") {
      score = Math.max(score, hasDirectContact ? 58 : 52);
      reasons.push(
        "Official service or infrastructure page is kept for ICP review even without explicit spare-parts demand"
      );
    }

    const hasMainReadyServiceEvidence =
      pageType === "official_company_site" && hasSearchContextSignal && hasDirectContact;
    if (buyerServicePage && hasGenericServiceBuyerSignal && !hasMainReadyServiceEvidence) {
      // Used to require verified country before allowing entry to the
      // main customer list. Per 2026-05 policy, country may be
      // unconfirmed; a real company page with buyer-role signals plus a
      // contact is enough to enter review. We still keep the score cap
      // for completely empty official-text pages so they do not jump to
      // qualified by accident.
      score = Math.min(score, 49);
      risks.push(
        "Generic service / maintenance page needs official-site context and a direct contact before entering the main customer list"
      );
    }

    // 2026-05 Stage 2 follow-up: removed the legacy duplicate
    // "Verified candidate country differs from selected target markets;
    // treated as new-market exploration" risk push. The country mismatch
    // branch above already emits the right risk for both paths:
    //   - hard reject: "Verified candidate country is outside the selected target markets"
    //   - soft mismatch: "Official country evidence does not match the selected target markets"
    // Re-pushing here would either duplicate the soft message or
    // contradict the hard-reject decision (claiming the row is "kept
    // as new-market exploration" while status === "rejected").

    // targetCountryUnverified no longer reduces the score. The 2026-05
    // policy is "country unconfirmed → still go to review". Old code
    // capped the score at 49 here, which silently sent every .com lead
    // without phone evidence to the rejected bin.

    if (pageType === "procurement_document") {
      score = Math.min(score, 49);
      forcedStatus = "intelligence";
      risks.push(
        "Procurement/RFQ result is intelligence only; it is kept out of the main customer list and outreach flow"
      );
    }

    if (evidenceClassification) {
      score = Math.min(score, evidenceClassification.scoreCap);
      // Map old multi-status evidence classifications onto the new
      // simplified status set. intelligence_review collapses into
      // "intelligence"; evidence_review now folds into "rejected" since
      // the simplified state machine no longer carries an evidence-only
      // bucket. Real buyer companies should never reach this branch
      // because of the buyer-role floor below; this branch is reserved
      // for genuinely non-customer evidence pages.
      forcedStatus =
        evidenceClassification.status === "intelligence_review" ? "intelligence" : "rejected";
      reasons.push(evidenceClassification.reason);
      risks.push(evidenceClassification.risk);
    } else if (pageType === "unknown" && !isOfficialMainCustomerPage(candidate, pageType)) {
      // Used to set evidence_review here. We now keep the score cap
      // (which already pushes the candidate below the qualified
      // threshold) but do not force-reject; the buyer-role floor below
      // can still rescue genuine company pages whose pageType could not
      // be confidently classified.
      score = Math.min(score, 49);
      risks.push(
        "Candidate is not backed by an official company homepage, about, contact, services, solutions, telecom, project, or location page"
      );
    }

    if (hasCompanyNameQualityIssue) {
      // Same simplification: cap the score, drop the dedicated
      // evidence_review state. Bad-looking company names tend to be
      // page titles or site-builder credits, which the buyer-role floor
      // does NOT rescue.
      score = Math.min(score, 49);
      risks.push("Company name looks like a page title, template label, or site-builder credit");
    }

    if (pageType === "brand_oem_site") {
      score = Math.min(score, 44);
      risks.push(
        "Brand or OEM official site is usually supplier/competitor evidence, not a buyer lead"
      );
    }

    if (pageType === "supplier_or_storefront") {
      score = Math.min(score, 44);
      risks.push("Seller storefront or product catalog is not a buyer lead");
    }

    if (pageType === "third_party_profile" || pageType === "non_procurement_document") {
      score = Math.min(score, 44);
      risks.push(
        "Third-party profile or non-procurement document is evidence only, not a direct buyer lead"
      );
    }

    // ---- Customer-role floor (2026-05 product policy) ----
    //
    // If the candidate looks like one of the seven buyer roles the user
    // explicitly wants to keep visible — engineering company,
    // maintenance company, installation company, system integrator,
    // distributor, stockist, or spare-parts supplier — and it has not
    // been pushed into a forced state (intelligence / hard reject /
    // company-name issue), and it is not on a non-buyer page type, lift
    // the score to at least 55. This guarantees the candidate enters
    // "review" instead of being silently rejected by sub-50 scoring,
    // even when the country is unconfirmed.
    const buyerRoleFloorEligible =
      forcedStatus !== "intelligence" &&
      forcedStatus !== "rejected" &&
      !hasCompanyNameQualityIssue &&
      pageType !== "brand_oem_site" &&
      pageType !== "supplier_or_storefront" &&
      pageType !== "third_party_profile" &&
      pageType !== "non_procurement_document" &&
      pageType !== "own_site" &&
      !riskyDiscoveryPage &&
      (hasBuyerRoleSignal || hasTargetCustomerType || hasUseCaseCustomerSignal);
    if (buyerRoleFloorEligible) {
      const floor = hasDirectContact ? 60 : 55;
      if (score < floor) {
        score = floor;
        reasons.push(
          "Buyer-role floor applied: candidate looks like an engineering / maintenance / installation / system-integrator / distributor / stockist / spare-parts buyer profile"
        );
      }
    }
    // ---- end customer-role floor ----

    // 2026-05 Stage 2 follow-up: verified-off-target candidates must
    // never come back above the main-pool threshold even after
    // contactScore + buyer-role floor have run. Cap right before
    // finalScore so it survives every later additive bump.
    if (verifiedOffTargetCountryReject) {
      score = Math.min(score, 39);
    }
    // 2026-05 Stage 2 follow-up: same final cap for off-industry
    // hard reject. forcedStatus blocks buyer-role floor; the cap
    // here defends against contactScore + any later positive bumps
    // that ran before this point.
    if (offIndustryBucketReject) {
      score = Math.min(score, 39);
    }

    const finalScore = clamp(Math.round(score), 0, 100);
    const grade = finalScore >= 75 ? "high" : finalScore >= 50 ? "medium" : "low";
    const hardRejectedPage =
      riskyDiscoveryPage ||
      pageType === "brand_oem_site" ||
      pageType === "supplier_or_storefront" ||
      pageType === "third_party_profile" ||
      pageType === "non_procurement_document";
    // Simplified 4-state machine (2026-05). Old states map as follows:
    //   needs_country_review / country_conflict_review → review
    //   evidence_review                                → rejected
    //   intelligence_review                            → intelligence
    //
    // Note: when forcedStatus is "intelligence" (e.g. exhibition PDFs,
    // government tenders, project news on whitelisted intelligence
    // domains), it WINS over hardRejectedPage. The hard-reject page
    // shape only matters when there is no intelligence classification
    // — at that point a low score plus a hard-reject page type means
    // we drop the candidate entirely.
    let status: IcpScoreDraft["status"];
    if (forcedStatus === "intelligence") {
      status = "intelligence";
    } else if (forcedStatus === "rejected" || hardRejectedPage) {
      status = "rejected";
    } else if (finalScore >= 75) {
      status = "qualified";
    } else if (finalScore >= 50) {
      status = "review";
    } else {
      status = "rejected";
    }

    return {
      score: finalScore,
      grade,
      reasons: reasons.length ? reasons : ["Insufficient explicit ICP signals"],
      risks,
      leadType: evidenceClassification?.leadType,
      intelligenceType: evidenceClassification?.intelligenceType,
      reviewLabels: evidenceClassification?.reviewLabels,
      extractableCompanies: evidenceClassification?.extractableCompanies,
      pageType,
      status
    };
  }

  async saveCandidates(
    taskId: string,
    results: BraveSearchResult[],
    criteria: IcpScoringCriteria,
    defaultCountry?: string,
    aiEvaluator?: CandidateAiEvaluator
  ) {
    const allCandidates = results.map((result) =>
      normalizeResult(result, { taskId, defaultCountry })
    );
    const normalized = dedupeCandidates(allCandidates);
    const existing = await this.prisma.leadCandidate.findMany({
      where: { taskId },
      include: { contacts: true }
    });
    const existingLeadByKey = buildExistingLeadKeyMap(existing);
    const existingKeys = new Set(existingLeadByKey.keys());
    const created = [];
    let skipped = allCandidates.length - normalized.length;
    let aiEvaluationsUsed = 0;

    for (const candidate of normalized) {
      if (shouldHardRejectCandidate(candidate, criteria)) {
        skipped += 1;
        continue;
      }

      const canProbeContact = shouldProbeContactPages(candidate);
      const enrichedCandidate = inferMissingCandidateCountry(
        canProbeContact ? await enrichCandidateContacts(candidate) : candidate
      );
      if (shouldHardRejectCandidate(enrichedCandidate, criteria)) {
        skipped += 1;
        continue;
      }

      const key = candidateKey(enrichedCandidate);
      const emailKeys = enrichedCandidate.contacts
        .filter((contact) => contact.type === "email")
        .map((contact) => `email:${contact.value.toLowerCase()}`);
      const existingLead =
        existingLeadByKey.get(key) ??
        emailKeys.map((emailKey) => existingLeadByKey.get(emailKey)).find(Boolean);
      if (existingLead) {
        const missingContacts = missingExistingContacts(
          existingLead.contacts,
          enrichedCandidate.contacts
        );
        if (missingContacts.length) {
          await this.prisma.leadContact.createMany({
            data: missingContacts.map((contact) => ({
              leadId: existingLead.id,
              type: contact.type,
              value: contact.value,
              sourceUrl: contact.sourceUrl
            }))
          });
          existingLead.contacts.push(...missingContacts);
          for (const contact of missingContacts) {
            existingKeys.add(contactKey(contact));
            existingLeadByKey.set(contactKey(contact), existingLead);
          }
        }
        skipped += 1;
        continue;
      }

      const ruleIcp = this.scoreCandidate(enrichedCandidate, criteria);
      const shouldUseAi =
        Boolean(aiEvaluator) &&
        aiEvaluationsUsed < maxAiCandidateEvaluationsPerBatch &&
        shouldEvaluateCandidateWithAi(ruleIcp, enrichedCandidate, criteria);
      const aiEvaluation = shouldUseAi
        ? await safelyEvaluateCandidate(aiEvaluator!, enrichedCandidate)
        : null;
      if (shouldUseAi) {
        aiEvaluationsUsed += 1;
      }
      const icp = aiEvaluation ? mergeAiEvaluationWithRuleScore(ruleIcp, aiEvaluation) : ruleIcp;

      const record = await this.prisma.leadCandidate.create({
        data: {
          taskId,
          companyName: enrichedCandidate.companyName,
          website: enrichedCandidate.website,
          // 2026-05 (Q1=A): when country is verified we use the verified
          // value; when it is unconfirmed we fall back to the queryCountry
          // (the country the search was scoped to). This keeps CRM and
          // outreach UX from showing a blank country and matches the
          // user's "treat it as opening a new market" stance.
          country:
            enrichedCandidate.inferredCountry ??
            enrichedCandidate.country ??
            enrichedCandidate.queryCountry ??
            null,
          queryCountry: enrichedCandidate.queryCountry ?? null,
          inferredCountry: enrichedCandidate.inferredCountry ?? enrichedCandidate.country,
          countryEvidence: toJsonInput(enrichedCandidate.countryEvidence ?? []),
          countryConfidence: enrichedCandidate.countryConfidence ?? "unknown",
          countryConflict: enrichedCandidate.countryConflict ?? false,
          sourceUrl: enrichedCandidate.sourceUrl,
          status: icp.status,
          contacts: {
            create: enrichedCandidate.contacts.map((contact) => ({
              type: contact.type,
              value: contact.value,
              sourceUrl: contact.sourceUrl
            }))
          },
          icpScore: {
            create: {
              score: icp.score,
              grade: icp.grade,
              reasons: toJsonInput({
                reasons: icp.reasons,
                risks: icp.risks,
                summary: enrichedCandidate.summary,
                countryValidation: {
                  queryCountry: enrichedCandidate.queryCountry ?? null,
                  inferredCountry: enrichedCandidate.inferredCountry ?? enrichedCandidate.country,
                  countryConfidence: enrichedCandidate.countryConfidence ?? "unknown",
                  countryConflict: enrichedCandidate.countryConflict ?? false,
                  countryConflictCountries: enrichedCandidate.countryConflictCountries ?? [],
                  countryEvidence: enrichedCandidate.countryEvidence ?? []
                },
                aiEvaluation,
                ruleScore: ruleIcp.score,
                leadType: icp.leadType ?? null,
                intelligenceType: icp.intelligenceType ?? null,
                reviewLabels: icp.reviewLabels ?? [],
                extractableCompanies: icp.extractableCompanies ?? [],
                pageType: icp.pageType ?? ruleIcp.pageType ?? null
              })
            }
          }
        },
        include: {
          contacts: true,
          icpScore: true
        }
      });

      created.push(record);
      existingKeys.add(key);
      existingLeadByKey.set(key, record);
      for (const emailKey of emailKeys) {
        existingKeys.add(emailKey);
        existingLeadByKey.set(emailKey, record);
      }
    }

    return {
      createdCount: created.length,
      skippedCount: skipped,
      candidates: created
    };
  }
}

function shouldEvaluateCandidateWithAi(
  ruleIcp: IcpScoreDraft,
  candidate: NormalizedLeadCandidate,
  criteria: IcpScoringCriteria
) {
  if (ruleIcp.status === "intelligence") {
    return false;
  }

  // 2026-05: country gating no longer blocks AI evaluation. Per the
  // user's policy, country-unconfirmed candidates still flow through to
  // review and we want GPT to weigh in on whether they look like real
  // buyers. We only short-circuit AI eval when the candidate has a
  // VERIFIED country that is outside the target markets — at that point
  // we already know the company is in a different region and we don't
  // want to spend GPT budget classifying it.
  const countryValidation = validatedCountry(candidate);
  if (countryConflictHasOnlyOffTargetEvidence(countryValidation, criteria.targetRegions)) {
    return false;
  }

  if (
    hasTargetRegionConstraint(criteria.targetRegions) &&
    countryValidation.inferredCountry &&
    (countryValidation.countryConfidence === "high" ||
      countryValidation.countryConfidence === "medium") &&
    !countryValidation.countryConflict &&
    !matchesTargetRegion(countryValidation.inferredCountry, criteria.targetRegions)
  ) {
    return false;
  }

  if (
    candidate.country &&
    hasTargetRegionConstraint(criteria.targetRegions) &&
    !matchesTargetRegion(candidate.country, criteria.targetRegions)
  ) {
    return false;
  }

  const buyerServicePage = looksLikeBuyerSideCompanyPage(candidate);
  if (ruleIcp.score >= 50) {
    return true;
  }

  if (
    (ruleIcp.score < 35 && !buyerServicePage) ||
    (isRiskyDiscoveryPage(candidate) && !buyerServicePage)
  ) {
    return false;
  }

  const text = [
    candidate.companyName,
    candidate.website,
    candidate.country,
    candidate.sourceUrl,
    candidate.summary,
    candidate.contacts.map((contact) => contact.value).join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const hasDirectContact = candidate.contacts.some(
    (contact) => contact.type === "email" || contact.type === "phone"
  );
  const hasBuyerOrProductSignal =
    hasAny(text, buyerRoleTerms) ||
    hasAny(text, buyerUseCaseTerms) ||
    hasAny(text, genericBuyerIntentTerms) ||
    hasAny(text, criteria.customerTypeKeywords) ||
    hasAny(text, specificTelecomProductTerms) ||
    hasAny(text, criteria.productKeywords.filter(isSpecificProductTerm)) ||
    hasAny(text, criteria.productKeywords);

  return hasDirectContact || hasBuyerOrProductSignal || buyerServicePage;
}

async function safelyEvaluateCandidate(
  aiEvaluator: CandidateAiEvaluator,
  candidate: NormalizedLeadCandidate
) {
  try {
    return await aiEvaluator(candidate);
  } catch {
    return null;
  }
}

function mergeAiEvaluationWithRuleScore(
  ruleIcp: IcpScoreDraft,
  ai: CandidateBuyerEvaluation
): IcpScoreDraft {
  const weightedScore = Math.round(clamp(ai.fitScore, 0, 100) * 0.6 + ruleIcp.score * 0.4);
  let score = weightedScore;
  const aiCompanyNameRisk = hasAiCompanyNameQualityRisk(ai);
  const rejectTypes = new Set([
    "directory",
    "content_article",
    "job_page",
    "market_report",
    "irrelevant",
    "supplier_or_competitor",
    "procurement_intelligence"
  ]);

  if (rejectTypes.has(ai.resultType)) {
    score = Math.min(score, 44);
  } else if (ai.decision === "reject") {
    score = Math.min(score, 49);
  } else if (
    ai.resultType === "target_buyer" &&
    ai.decision === "qualified" &&
    ai.confidence >= 0.72
  ) {
    score = Math.max(score, 75);
  }

  if (ruleIcp.status === "intelligence" || ai.resultType === "procurement_intelligence") {
    score = Math.min(score, 49);
  }

  if (aiCompanyNameRisk) {
    score = Math.min(score, 49);
  }

  const finalScore = clamp(score, 0, 100);
  // Simplified 4-state machine. Old states fold the same way as in the
  // rule-only scoring path: needs_country_review / country_conflict_review
  // → review (or rejected), evidence_review → rejected, intelligence_review
  // → intelligence. AI-flagged company-name risks now also push to
  // rejected instead of evidence_review.
  let status: IcpScoreDraft["status"];
  if (ruleIcp.status === "intelligence" || ai.resultType === "procurement_intelligence") {
    status = "intelligence";
  } else if (aiCompanyNameRisk) {
    status = "rejected";
  } else if (finalScore >= 75) {
    status = "qualified";
  } else if (finalScore >= 50) {
    status = "review";
  } else {
    status = "rejected";
  }
  const grade = finalScore >= 75 ? "high" : finalScore >= 50 ? "medium" : "low";
  const reasons = uniqueStrings([
    ...ruleIcp.reasons,
    `GPT buyer judgment: ${ai.resultType}${ai.buyerType ? ` / ${ai.buyerType}` : ""}`,
    ...ai.matchedSignals.map((signal) => `AI matched signal: ${signal}`)
  ]);
  const risks = uniqueStrings([
    ...ruleIcp.risks,
    ...ai.risks,
    ...(ai.confidence < 0.55 ? ["AI buyer judgment confidence is low"] : []),
    ...(ai.resultType === "supplier_or_competitor"
      ? ["AI marked this result as supplier or competitor; not a buyer lead"]
      : []),
    ...(aiCompanyNameRisk ? ["AI flagged the company name as unreliable"] : [])
  ]);

  return {
    score: finalScore,
    grade,
    reasons,
    risks,
    leadType:
      ruleIcp.leadType ??
      (ai.resultType === "procurement_intelligence" ? "intelligence" : undefined),
    intelligenceType:
      ruleIcp.intelligenceType ??
      (ai.resultType === "procurement_intelligence" ? "rfq_notice" : undefined),
    reviewLabels:
      ruleIcp.reviewLabels ??
      (ai.resultType === "procurement_intelligence" ? ["procurement_intelligence"] : undefined),
    extractableCompanies: ruleIcp.extractableCompanies,
    pageType: ruleIcp.pageType,
    status
  };
}

function hasAiCompanyNameQualityRisk(ai: CandidateBuyerEvaluation) {
  const text = [...(ai.risks ?? []), ...(ai.matchedSignals ?? [])].join(" ").toLowerCase();
  return /company\s+name|wrong\s+name|looks\s+wrong|site[-\s]?builder|created\s+by|designed\s+by|powered\s+by|template\s+label|page\s+title/.test(
    text
  );
}

function normalizeResult(
  result: BraveSearchResult,
  options: LeadNormalizationOptions
): NormalizedLeadCandidate {
  const website = normalizeWebsite(result.url);
  const sourceUrl = result.url;
  const fullText = [result.title, result.snippet, result.url].filter(Boolean).join("\n");
  const contacts = extractContacts(fullText, sourceUrl);
  const queryCountry = normalizeQueryCountry(options.defaultCountry);

  return applyCountryValidation({
    taskId: options.taskId,
    companyName: extractCompanyName(result.title, result.url),
    website,
    country: null,
    queryCountry,
    sourceUrl,
    summary: result.snippet || null,
    contacts
  });
}

function dedupeCandidates(candidates: NormalizedLeadCandidate[]) {
  const seen = new Set<string>();
  const output: NormalizedLeadCandidate[] = [];

  for (const candidate of candidates) {
    const keys = [
      candidateKey(candidate),
      ...candidate.contacts
        .filter((contact) => contact.type === "email")
        .map((contact) => `email:${contact.value.toLowerCase()}`)
    ];

    if (keys.some((key) => seen.has(key))) {
      continue;
    }

    keys.forEach((key) => seen.add(key));
    output.push(candidate);
  }

  return output;
}

function candidateKey(candidate: Pick<NormalizedLeadCandidate, "companyName" | "website">) {
  const domain = candidate.website ? domainFromUrl(candidate.website) : null;
  if (domain) {
    return `domain:${domain}`;
  }

  return `company:${normalizeCompanyKey(candidate.companyName)}`;
}

function buildExistingLeadKeyMap(existing: ExistingLead[]) {
  const keys = new Map<string, ExistingLead>();

  for (const lead of existing) {
    keys.set(candidateKey(lead), lead);
    for (const contact of lead.contacts) {
      if (contact.type === "email") {
        keys.set(contactKey(contact), lead);
      }
    }
  }

  return keys;
}

function contactKey(contact: { type: string; value: string }) {
  return `${contact.type}:${contact.value.toLowerCase()}`;
}

function missingExistingContacts(
  existingContacts: ExistingLead["contacts"],
  candidateContacts: NormalizedLeadCandidate["contacts"]
) {
  const existingContactKeys = new Set(existingContacts.map(contactKey));
  return dedupeContacts(candidateContacts).filter(
    (contact) => !existingContactKeys.has(contactKey(contact))
  );
}

function extractCompanyName(title: string, url: string) {
  const attributedCompany = extractAttributedCompanyName(title);
  if (attributedCompany) {
    return attributedCompany;
  }

  const profileCompany = companyFromProfileUrl(url);
  if (profileCompany) {
    return profileCompany;
  }

  const domainCompany = companyFromDomain(url);
  if (looksLikeSiteBuilderCredit(title)) {
    return domainCompany || "Unknown Company";
  }

  // 2026-05 V1-MVP+: prefer the domain when the page title is a generic
  // OEM-partner / channel-program label that does not name the actual
  // operator. Brave often returns titles like "Huawei Partners",
  // "Authorized Distributor", "ZTE Solutions" for buyer-side companies
  // whose real brand only shows up in the domain. Without this branch
  // the lead row reads "Huawei Partners → neodatatechnologies.com"
  // which is confusing in the candidate table.
  if (looksLikeOemPartnerTitle(title) && domainCompany) {
    return domainCompany;
  }

  if (
    domainCompany &&
    looksLikeBrandOnlyTitle(title) &&
    normalizeCompanyKey(domainCompany) !== normalizeCompanyKey(title)
  ) {
    return domainCompany;
  }

  const parts = title
    .split(/\s(?:[-–—|:»]\s)+|\s[|]\s/)
    .map((part) => cleanupCompanyName(part))
    .filter(Boolean);
  const selected =
    parts.find((part) => isLikelyCompanyName(part, domainCompany)) ??
    parts.find((part) => !isGenericTitle(part));

  return selected || domainCompany || "Unknown Company";
}

// 2026-05 V1-MVP+: detect titles that describe a partner/channel program
// rather than the company itself. These titles must never override the
// domain-derived company name (e.g. "Huawei Partners" should not become
// the operator's name when the operator is actually NeoData).
function looksLikeOemPartnerTitle(value: string) {
  const lower = cleanupCompanyName(value).toLowerCase();
  return (
    /^(?:huawei|zte|ericsson|nokia|alcatel-lucent|cisco|samsung|fortinet|hpe|juniper|dell|lenovo|microsoft|aws|google|sap|oracle|ibm|sophos|ruckus|aruba|extreme)\s+(?:partners?|partnership|partner program|authorized\s+(?:partner|distributor|reseller|dealer)|elite\s+partner|gold\s+partner|silver\s+partner|certified\s+partner|solutions?(?:\s+partner)?|technology\s+partner|alliance|ecosystem)$/i.test(
      lower
    ) ||
    /^(?:authorized|official|certified)\s+(?:distributor|reseller|dealer|partner)$/i.test(lower) ||
    /^(?:partners?|partnership|partner program|alliance|ecosystem)$/i.test(lower)
  );
}

function looksLikeBrandOnlyTitle(value: string) {
  const lower = cleanupCompanyName(value).toLowerCase();
  return /^(?:huawei|zte|ericsson|nokia|alcatel-lucent|cisco|samsung|fortinet|hpe|juniper|dell|lenovo|microsoft|aws|google|sap|oracle|ibm|sophos|ruckus|aruba|extreme)$/.test(
    lower
  );
}

function cleanupCompanyName(value: string) {
  return value
    .replace(/\b(home|official site|website|about us|contact us|logo)\b/gi, "")
    .replace(/^\s*(?:welcome to|official)\s+/i, "")
    // 2026-05 V1-MVP+: strip "by " prefix that leaks from attribution
    // patterns in page titles (e.g. "by Qatar Multitech Trading...").
    .replace(/^\s*by\s+/i, "")
    .replace(siteBuilderCreditPrefixPattern, "")
    .replace(/\s+\b(?:homepage|home page)\b$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[|:：/\\\-\s]+|[|:：/\\\-\s]+$/g, "")
    .trim();
}

function extractAttributedCompanyName(value: string) {
  const match = value.match(/\bfrom\s+([A-Z0-9][^|:：]{2,80})$/i);
  if (!match?.[1]) {
    return null;
  }

  const name = cleanupCompanyName(match[1]);
  return isLikelyCompanyName(name, null) ? name : null;
}

function isGenericTitle(value: string) {
  const lower = value.toLowerCase();
  return (
    isForbiddenCompanyName(value) ||
    looksLikePseudoCompanyName(value) ||
    genericExactTitleTerms.some((term) => lower === term) ||
    genericTitleTerms.some((term) => lower === term || lower.includes(term)) ||
    looksLikeProductTitle(value)
  );
}

function isForbiddenCompanyName(value: string) {
  const normalized = cleanupCompanyName(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return (
    !normalized ||
    forbiddenCompanyNameTerms.has(normalized) ||
    // 2026-05 V1-MVP+: "by <company>" prefix. The original regex
    // only allowed [a-z0-9 .'-] which missed & and other punctuation
    // common in company names (e.g. "by Qatar Multitech Trading &
    // Contracting W.L.L."). Broadened to allow any printable chars.
    /^by\s+.{2,80}$/i.test(value.trim()) ||
    looksLikeSiteBuilderCredit(value) ||
    /\b(?:tagline|awesome image|blog category|article author|pdf)\b/i.test(value) ||
    // 2026-05 V1-MVP+: article/listicle titles that got extracted as
    // company names. These patterns are never real company names:
    //   - "Which One is the Best 2026"
    //   - "Top 10 Telecom Companies in Qatar"
    //   - "How to Choose a Telecom Provider"
    //   - "What is 5G Technology"
    /\b(?:which\s+(?:one|is)|how\s+to|what\s+is|top\s+\d+|best\s+\d+|vs\.?\s|versus)\b/i.test(value) ||
    // Long names with colons are almost always page titles, not
    // company names (e.g. "Telecom services: project management and
    // certification"). Real company names with colons are extremely
    // rare and never > 40 chars.
    (value.includes(":") && value.length > 40) ||
    // Copyright / year patterns that leak from footer extraction
    /\b(?:copyright|©)\s*\d{4}/i.test(value) ||
    /^\d{4}\s/.test(value.trim()) ||
    // Image alt text / placeholder patterns
    /^(?:image|img|photo|banner|logo|icon)\s*\d*/i.test(value.trim())
  );
}

function isLikelyCompanyName(value: string, domainCompany: string | null) {
  const name = cleanupCompanyName(value);
  const lower = name.toLowerCase();
  if (!name || name.length > 72 || isGenericTitle(name) || isForbiddenCompanyName(name)) {
    return false;
  }

  if (
    domainCompany &&
    looksLikeBrandOnlyTitle(name) &&
    normalizeCompanyKey(name) !== normalizeCompanyKey(domainCompany)
  ) {
    return false;
  }

  if (domainCompany && normalizeCompanyKey(name) === normalizeCompanyKey(domainCompany)) {
    return true;
  }

  if (generalCompanyEntityTerms.some((term) => lower.includes(term))) {
    return true;
  }

  if (
    /\b(?:llc|ltd|limited|inc|corp|corporation|group|communications|solutions|systems|services|networks?)\b/i.test(
      name
    )
  ) {
    return true;
  }

  return /^[A-Z0-9][A-Za-z0-9&().' ]{2,48}$/.test(name) && !looksLikeProductTitle(name);
}

function looksLikeProductTitle(value: string) {
  const lower = value.toLowerCase();
  return (
    hasAny(lower, productTitleTerms) ||
    /\b(?:\d{2,5}\s?w|\d{2,5}w|48v|24v|85-300|vac|vdc|sfp\+?|100g|10g)\b/i.test(value) ||
    (hasAny(lower, ["huawei", "zte", "ericsson", "nokia", "alcatel-lucent", "eltek"]) &&
      hasAny(lower, [
        "rectifier",
        "module",
        "board",
        "rru",
        "bbu",
        "aau",
        "networking equipment",
      "hardware repair"
      ]))
  );
}

function looksLikePseudoCompanyName(value: string) {
  const lower = cleanupCompanyName(value).toLowerCase();
  return (
    /^(?:top[-\s]?rated|leading|best|trusted|premier|professional|award[-\s]?winning|one[-\s]?stop|no\.?\s*1|#1)\b/.test(
      lower
    ) ||
    /^(?:communication package|network deployment|exploring|das installation)\b/.test(lower) ||
    /\b(?:company|service|services|solutions?|package)\s+(?:in|for)\s+[a-z]/.test(lower) ||
    // 2026-05 V1-MVP+: descriptive phrases that are page section
    // headings or service descriptions, not company names:
    //   - "Telecom services: project management and certification"
    //   - "5G network solutions for enterprise"
    //   - "Accelerate Success with TheCloudPartner: Trusted Cloud Solutions"
    /^(?:telecom|5g|network|cloud|iot|it)\s+(?:services?|solutions?)\b/i.test(lower) ||
    /\b(?:accelerate|discover|explore|unlock|transform|elevate)\s+/i.test(lower)
  );
}

function looksLikeSiteBuilderCredit(value: string) {
  return siteBuilderCreditPrefixPattern.test(value.trim());
}

function companyFromDomain(url: string) {
  const domain = domainFromUrl(url);
  if (!domain) {
    return null;
  }

  const label = domain.split(".")[0] ?? domain;
  return formatDomainLabelAsCompany(label);
}

function companyFromProfileUrl(url: string) {
  const domain = domainFromUrl(url);
  const path = pathFromUrl(url);
  if (!domain || !path) {
    return null;
  }

  const linkedInMatch = domainMatches(domain, "linkedin.com")
    ? path.match(/\/(?:company|in)\/([^/?#]+)/i)
    : null;
  const slug = linkedInMatch?.[1];
  if (!slug) {
    return null;
  }

  return formatDomainLabelAsCompany(slug);
}

function formatDomainLabelAsCompany(label: string) {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (domainCompanyNameOverrides[normalized]) {
    return domainCompanyNameOverrides[normalized];
  }

  const expanded = label
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/\b(isp|hct|ats|mf|usa|uk|uae)\b/gi, (match) => match.toUpperCase())
    .trim();

  return expanded
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      domainAcronymTerms.has(part.toLowerCase())
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join(" ");
}

function normalizeWebsite(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function pathFromUrl(url: string) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeCompanyKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function inferCountry(text: string) {
  return inferCountryFromText(text) ?? inferCountryFromLegacySignals(text);
}

function inferMissingCandidateCountry(candidate: NormalizedLeadCandidate): NormalizedLeadCandidate {
  return applyCountryValidation(candidate);
}

function applyCountryValidation(candidate: NormalizedLeadCandidate): NormalizedLeadCandidate {
  const validation = assessCountryValidation(candidate);

  return {
    ...candidate,
    country: validation.inferredCountry,
    inferredCountry: validation.inferredCountry,
    countryEvidence: validation.countryEvidence,
    countryConfidence: validation.countryConfidence,
    countryConflict: validation.countryConflict,
    countryConflictCountries: validation.countryConflictCountries
  };
}

function validatedCountry(candidate: NormalizedLeadCandidate) {
  if (
    candidate.countryConfidence &&
    candidate.countryEvidence &&
    candidate.countryConflict !== undefined &&
    candidate.inferredCountry !== undefined
  ) {
    return {
      inferredCountry: candidate.inferredCountry ?? candidate.country ?? null,
      countryEvidence: candidate.countryEvidence,
      countryConfidence: candidate.countryConfidence,
      countryConflict: Boolean(candidate.countryConflict),
      countryConflictCountries: candidate.countryConflictCountries ?? []
    };
  }

  return assessCountryValidation(candidate);
}

function assessCountryValidation(candidate: NormalizedLeadCandidate) {
  const countryEvidence = collectCountryEvidence(candidate);
  const strongEvidence = countryEvidence.filter((evidence) => evidence.confidence === "high");
  const mediumEvidence = countryEvidence.filter((evidence) => evidence.confidence === "medium");
  const lowEvidence = countryEvidence.filter((evidence) => evidence.confidence === "low");
  const strongCountries = uniqueCountries(strongEvidence.map((evidence) => evidence.country));
  const mediumCountries = uniqueCountries(mediumEvidence.map((evidence) => evidence.country));
  const lowCountries = uniqueCountries(lowEvidence.map((evidence) => evidence.country));
  const candidateCountries = strongCountries.length
    ? strongCountries
    : mediumCountries.length
      ? mediumCountries
      : lowCountries;
  const evidenceConflict = candidateCountries.length > 1;

  // 2026-05 (B): Local-branch bias. When evidence points to multiple
  // countries (e.g. a Lebanese mother company with a Qatar branch that
  // has both +961 and +974 phones), and one of the conflicting countries
  // matches the queryCountry (the market we were searching for), prefer
  // that country. This resolves the common "multinational EPC with local
  // office" pattern correctly — the user searched for Qatar, the company
  // has a Qatar branch, so we infer Qatar.
  let inferredCountry: string | null = null;
  let countryConflict = evidenceConflict;
  const countryConflictCountries = countryConflict ? uniqueCountries(candidateCountries) : [];

  if (candidateCountries.length === 1) {
    inferredCountry = candidateCountries[0]!;
  } else if (evidenceConflict && candidate.queryCountry) {
    const queryCountryNorm = normalizeCountry(candidate.queryCountry);
    const matchingCountry = candidateCountries.find(
      (c) => countryMatchesTarget(c, queryCountryNorm)
    );
    if (matchingCountry) {
      // Resolve the conflict in favor of the local branch that matches
      // the search target. We still record the conflict for transparency
      // but treat the candidate as having a resolved country.
      inferredCountry = matchingCountry;
      // Downgrade conflict: we resolved it via query-country bias, so
      // the candidate is not truly "conflicted" — it has a local branch
      // in the target market. Keep countryConflictCountries for audit
      // but mark countryConflict as false so scoring does not penalize.
      countryConflict = false;
    }
  }

  const countryConfidence: CountryConfidence =
    countryConflict || !inferredCountry
      ? countryConflict
        ? "low"
        : "unknown"
      : strongCountries.length
        ? "high"
        : mediumCountries.length
          ? "medium"
          : "low";

  return {
    inferredCountry,
    countryEvidence,
    countryConfidence,
    countryConflict,
    countryConflictCountries
  };
}

function collectCountryEvidence(candidate: NormalizedLeadCandidate): CountryEvidence[] {
  const evidence: CountryEvidence[] = [];
  const text = [
    candidate.companyName,
    candidate.website,
    candidate.sourceUrl,
    stripSearchContext(candidate.summary ?? "")
  ]
    .filter(Boolean)
    .join("\n");

  // Country evidence intentionally does NOT use website TLD or email TLD
  // anymore. Per the 2026-05 product policy, country verification only
  // looks at:
  //   1. Address text on the candidate's official pages (city / region /
  //      country / postcode mentions inside contact/about content).
  //   2. Phone numbers (with or without the leading "+"); the phone is
  //      labeled with the country we can infer from the number itself.
  // If neither is present, the candidate stays "country unconfirmed" and
  // still flows into the main customer list.

  for (const contact of candidate.contacts) {
    if (contact.type !== "phone") {
      continue;
    }

    const country = inferCountryFromPhone(contact.value);
    if (!country) {
      continue;
    }

    evidence.push({
      type: "phone",
      country,
      value: contact.value,
      sourceUrl: contact.sourceUrl,
      // Phones used to be "high" automatically; we now require the phone
      // to appear alongside an address-style cue on the same page before
      // we trust it as high confidence. Without that anchor it stays
      // "medium" so the candidate is verified but not over-weighted.
      confidence: phoneHasAddressContext(candidate, contact.value) ? "high" : "medium"
    });
  }

  for (const textEvidence of extractCountryEvidenceFromOfficialText(text, candidate.sourceUrl)) {
    evidence.push(textEvidence);
  }

  return dedupeCountryEvidence(evidence);
}

function phoneHasAddressContext(candidate: NormalizedLeadCandidate, phoneValue: string) {
  const summary = stripSearchContext(candidate.summary ?? "");
  if (!summary) {
    return false;
  }
  const lower = summary.toLowerCase();
  if (!lower.includes(phoneValue.toLowerCase())) {
    // Phone may appear in any of the probed pages stitched into summary;
    // if it does not appear at all there is no nearby address context to
    // verify against.
    return /\b(?:address|po box|p\.o\. box|street|building|tower|floor|office|hq|headquarters)\b/i.test(
      summary
    );
  }
  return /\b(?:address|po box|p\.o\. box|street|building|tower|floor|office|hq|headquarters|located in|based in)\b/i.test(
    summary
  );
}

function normalizeQueryCountry(country: string | undefined) {
  return country && !isMacroTargetRegion(country) ? normalizeCountry(country) : null;
}

function stripSearchContext(value: string) {
  return value.replace(/\bQuery context:\s*.*$/gis, "").trim();
}

function extractCountryEvidenceFromOfficialText(text: string, sourceUrl: string) {
  const chunks = text
    .split(/(?<=[.!?])\s+|[\n\r]+|(?<=\s)\|\s+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 8 && chunk.length <= 600);
  const evidence: CountryEvidence[] = [];

  for (const chunk of chunks) {
    if (!hasCountryContextCue(chunk)) {
      continue;
    }

    const country = inferCountry(chunk);
    if (!country) {
      continue;
    }

    evidence.push({
      type: hasServiceAreaCue(chunk) ? "service_area" : "official_text",
      country,
      value: chunk.slice(0, 220),
      sourceUrl,
      confidence: hasServiceAreaCue(chunk) || hasAddressCue(chunk) ? "medium" : "low"
    });
  }

  return evidence;
}

function hasCountryContextCue(text: string) {
  return /\b(?:address|office|offices|headquarters|hq|located|based|serves?|serving|service area|coverage|locations?|branches|operations?|operates?|region|country|city|cities|province|state|county|market)\b/i.test(
    text
  );
}

function hasServiceAreaCue(text: string) {
  return /\b(?:serves?|serving|service area|coverage|operations?|operates?|market|region)\b/i.test(
    text
  );
}

function hasAddressCue(text: string) {
  return /\b(?:address|office|offices|headquarters|hq|located|based|locations?|branches)\b/i.test(
    text
  );
}

function uniqueCountries(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = normalizeCountry(value);
    const key = countryMatchKey(normalized) ?? normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }

  return output;
}

function dedupeCountryEvidence(evidence: CountryEvidence[]) {
  const seen = new Set<string>();
  const output: CountryEvidence[] = [];

  for (const item of evidence) {
    const key = `${item.type}:${countryMatchKey(item.country) ?? item.country}:${item.value.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
  }

  return output;
}

function inferCountryFromPhone(phone: string) {
  const trimmed = phone.trim();
  const digits = digitsOnly(trimmed);
  // Accept either an explicit "+", a "00" international prefix, or any
  // long phone whose first 1-3 digits match a known country dial code.
  // The user's policy is to verify country whenever there is a phone;
  // requiring the "+" symbol filtered out a large set of GCC numbers
  // formatted as "(02) 643 1828" or "+971 2 643 1828" rendered as
  // "971 2 643 1828". Here we check both the strict international form
  // and a relaxed form where digits match a dial code without symbols.
  const strictDigits = trimmed.startsWith("+")
    ? digits
    : digits.startsWith("00")
      ? digits.slice(2)
      : "";

  if (strictDigits) {
    const match = phoneCountryCodeSignals.find(([code]) => strictDigits.startsWith(code));
    if (match) {
      return normalizeCountry(match[1]);
    }
  }

  // US toll-free / North American formatting first — these patterns
  // would otherwise be misread (e.g. "1-800-..." has digits "1800..."
  // which looks like Egypt's "+20" only after the leading "1").
  if (/^1[\s.-]?(?:800|888|877|866|855|844|833)[\s.-]?\d{3}[\s.-]?\d{4}$/.test(trimmed)) {
    return normalizeCountry("United States");
  }

  // Classic North-American 10-digit format with separators (e.g.
  // "630-209-8300", "(630) 209 8300"). We commit to "United States"
  // here BEFORE attempting the relaxed dial-code match, otherwise a
  // raw "63" prefix would be misclassified as the Philippines.
  if (!digits.startsWith("0") && /^\(?[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}$/.test(trimmed)) {
    return normalizeCountry("United States");
  }

  // Relaxed form: try to spot the dial code at the very front of the
  // digits, but only when the number is long enough to plausibly include
  // a country code (>= 9 digits) and the leading digits are not "0".
  if (!strictDigits && digits.length >= 9 && !digits.startsWith("0")) {
    const match = phoneCountryCodeSignals.find(([code]) => digits.startsWith(code));
    if (match) {
      return normalizeCountry(match[1]);
    }
  }

  return null;
}

function inferCountryFromLegacySignals(text: string) {
  const lower = text.toLowerCase();
  const domain = domainFromUrl(text);

  for (const [token, country] of countrySignals) {
    if (lower.includes(token) || domain?.endsWith(token)) {
      return country;
    }
  }

  return null;
}

function normalizeCountry(country: string) {
  return normalizeCountryName(country);
}

function countryMatchesTarget(candidateCountry: string, targetCountry: string) {
  const candidateKey = countryMatchKey(candidateCountry);
  const targetKey = countryMatchKey(targetCountry);
  if (!candidateKey || !targetKey) {
    return false;
  }
  return candidateKey === targetKey;
}

function extractContacts(text: string, sourceUrl: string): NormalizedLeadCandidate["contacts"] {
  const contacts = [
    ...extractEmails(text).map((value) => ({ type: "email" as const, value, sourceUrl })),
    ...extractPhoneContacts(text, sourceUrl),
    ...extractSocialUrls(text).map((value) => ({ type: "social" as const, value, sourceUrl }))
  ];
  const seen = new Set<string>();

  return contacts.filter((contact) => {
    const key = `${contact.type}:${contact.value.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function extractContactsFromHtml(
  html: string,
  sourceUrl: string
): NormalizedLeadCandidate["contacts"] {
  const decoded = decodeHtmlEntities(html);
  const searchable = htmlToSearchableText(html);
  const contacts = [
    ...extractEmailsFromHtml(decoded).map((value) => ({
      type: "email" as const,
      value,
      sourceUrl
    })),
    ...extractTelLinkPhones(decoded).map((value) => ({ type: "phone" as const, value, sourceUrl })),
    ...extractPhoneContacts(searchable, sourceUrl),
    ...extractSocialUrls(decoded).map((value) => ({ type: "social" as const, value, sourceUrl }))
  ];

  return dedupeContacts(contacts);
}

function extractEmails(text: string) {
  return uniqueStrings([...extractDirectEmails(text), ...extractObfuscatedEmails(text)]).filter(
    isUsableEmail
  );
}

function extractEmailsFromHtml(html: string) {
  return uniqueStrings([
    ...extractDirectEmails(html),
    ...extractMailtoEmails(html),
    ...extractCloudflareProtectedEmails(html),
    ...extractObfuscatedEmails(html)
  ]).filter(isUsableEmail);
}

function extractDirectEmails(text: string) {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return matches.map(normalizeEmailCandidate);
}

function extractMailtoEmails(html: string) {
  const matches = html.match(/mailto:([^"'\s?<>]+)/gi) ?? [];
  return matches.map((value) => normalizeEmailCandidate(value.replace(/^mailto:/i, "")));
}

function extractCloudflareProtectedEmails(html: string) {
  const matches = [
    ...Array.from(html.matchAll(/\bdata-cfemail=["']([a-f0-9]+)["']/gi)),
    ...Array.from(html.matchAll(/\/cdn-cgi\/l\/email-protection#([a-f0-9]+)/gi))
  ];

  return matches
    .map((match) => (match[1] ? decodeCloudflareEmail(match[1]) : ""))
    .filter(Boolean)
    .map(normalizeEmailCandidate);
}

function decodeCloudflareEmail(encoded: string) {
  if (!encoded || encoded.length < 4 || encoded.length % 2 !== 0) {
    return "";
  }

  const key = Number.parseInt(encoded.slice(0, 2), 16);
  if (!Number.isFinite(key)) {
    return "";
  }

  let output = "";
  for (let index = 2; index < encoded.length; index += 2) {
    const charCode = Number.parseInt(encoded.slice(index, index + 2), 16);
    if (!Number.isFinite(charCode)) {
      return "";
    }
    output += String.fromCharCode(charCode ^ key);
  }

  return output;
}

function extractObfuscatedEmails(text: string) {
  const matches =
    text.match(
      /[A-Z0-9._%+-]+\s*(?:\[at\]|\(at\)|\sat\s)\s*[A-Z0-9.-]+\s*(?:\[dot\]|\(dot\)|\sdot\s)\s*[A-Z]{2,}/gi
    ) ?? [];

  return matches.map((value) =>
    normalizeEmailCandidate(
      value
        .replace(/\s*(?:\[at\]|\(at\)|\sat\s)\s*/gi, "@")
        .replace(/\s*(?:\[dot\]|\(dot\)|\sdot\s)\s*/gi, ".")
    )
  );
}

function normalizeEmailCandidate(email: string) {
  return trimEmailToKnownTld(
    safeDecodeURIComponent(email)
      .replace(/[),.;:]+$/g, "")
      .replace(/[\\/"'<>]+$/g, "")
      .replace(/^mailto:/i, "")
      .trim()
      .toLowerCase()
  );
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isUsableEmail(email: string) {
  if (!email || email.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i)) {
    return false;
  }

  const [localPart, domain] = email.split("@");
  if (!localPart || !domain || !domain.includes(".")) {
    return false;
  }

  if (/^\d+$/.test(localPart) && ["email.com", "example.com"].includes(domain)) {
    return false;
  }

  if (discardedEmailLocalParts.has(localPart)) {
    return false;
  }

  if (
    /^(?:your|sample|test|demo|username|user|name|email|mail|admin)(?:[._-]?(?:name|email|mail|company|domain|address|id))?$/i.test(
      localPart
    )
  ) {
    return false;
  }

  return !discardedEmailDomains.includes(domain);
}

function trimEmailToKnownTld(email: string) {
  return email.replace(
    /(\.(?:com|net|org|edu|gov|info|biz|io|co|ae|sa|gh|ma|jo|lb|in|uk|de|fr|es|pt|ro|ie|qa|om|bh|kw|ng|za|br|au|ca|us))(?:email|marketing|phone|tel|contact|sales|support|office|address|location|privacy|terms|career|careers|newsletter).*$/i,
    "$1"
  );
}

function extractTelLinkPhones(html: string) {
  const matches = html.match(/href=["']tel:([^"']+)["']/gi) ?? [];
  return matches
    .map((value) => value.replace(/^href=["']tel:/i, "").replace(/["']$/g, ""))
    .map((value) =>
      safeDecodeURIComponent(value)
        .replace(/[^\d+().\-\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(isPlausiblePhoneNumber);
}

function extractPhoneContacts(
  text: string,
  sourceUrl: string
): NormalizedLeadCandidate["contacts"] {
  const normalized = text.replace(/\s+/g, " ");
  const loosePhones = new Set(extractPhones(normalized));
  const matches = Array.from(normalized.matchAll(/(?:\+?\d[\d\s().-]{7,}\d)/g)).filter((match) =>
    loosePhones.has(match[0].replace(/\s+/g, " ").trim())
  );
  return matches
    .map((match) => {
      const value = match[0].replace(/\s+/g, " ").trim();
      const index = match.index ?? 0;
      const context = normalized.slice(
        Math.max(0, index - 120),
        Math.min(normalized.length, index + value.length + 120)
      );
      return { value, context };
    })
    .filter(({ value }) => isPlausiblePhoneNumber(value))
    .filter(({ value, context }) => hasPhoneSignal(value, context))
    .filter(({ context }) => !hasPartNumberContext(context))
    .map(({ value }) => ({ type: "phone" as const, value, sourceUrl }))
    .filter(
      (contact, index, contacts) =>
        contacts.findIndex((item) => digitsOnly(item.value) === digitsOnly(contact.value)) === index
    );
}

function isPlausiblePhoneNumber(phone: string) {
  const digits = digitsOnly(phone);
  const hasCountryPrefix = phone.trim().startsWith("+");
  if (digits.length > 16 || (hasCountryPrefix ? digits.length < 8 : digits.length < 10)) {
    return false;
  }

  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(phone)) {
    return false;
  }

  if (/(?:19|20)\d{2}\s*[-\u2013]\s*(?:19|20)\d{2}/.test(phone)) {
    return false;
  }

  if (looksLikeTemplatePhoneNumber(phone)) {
    return false;
  }

  if ((phone.match(/\(/g)?.length ?? 0) !== (phone.match(/\)/g)?.length ?? 0)) {
    return false;
  }

  return true;
}

function hasPhoneSignal(phone: string, context: string) {
  if (phone.trim().startsWith("+")) {
    return true;
  }

  if (
    /\b(?:phone|tel|telephone|mobile|cell|call|fax|whatsapp|contact|office|main|direct|sales|support|customer service)\b\s*[:#-]?/i.test(
      context
    )
  ) {
    return true;
  }

  return /^\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}$/.test(phone.trim());
}

function hasPartNumberContext(context: string) {
  return /\b(?:model|models|model\s*(?:no|number)|part\s*(?:no|number)|pn|p\/n|sku|item\s*(?:no|number)|catalog|catalogue|serial|series|pid|kdu|krc|roj|roa|rectifier\s+models?|repair\s+(?:list|models?)|comprehensive\s+list|including,\s+but\s+not\s+limited\s+to)\b/i.test(
    context
  );
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function looksLikeTemplatePhoneNumber(phone: string) {
  const digits = digitsOnly(phone);
  if (
    /^(?:38640(?:222555|44445555)|15551234567|1800458556)$/.test(digits) ||
    /(?:000000|111111|222222|333333|444444|555555|666666|777777|888888|999999)/.test(
      digits
    )
  ) {
    return true;
  }

  const groups = phone.match(/\d+/g) ?? [];
  const repeatedGroups = groups.filter((group) => group.length <= 3);
  return repeatedGroups.some(
    (group) => repeatedGroups.filter((candidate) => candidate === group).length >= 3
  );
}

function extractPhones(text: string) {
  const matches = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? [];
  return matches
    .map((phone) => phone.replace(/\s+/g, " ").trim())
    .filter((phone) => !/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(phone))
    .filter((phone) => !/(?:19|20)\d{2}\s*[-\u2013]\s*(?:19|20)\d{2}/.test(phone))
    .filter((phone) => (phone.match(/\(/g)?.length ?? 0) === (phone.match(/\)/g)?.length ?? 0))
    .filter((phone) => {
      const digits = phone.replace(/\D/g, "");
      const hasCountryPrefix = phone.trim().startsWith("+");
      return digits.length <= 16 && (hasCountryPrefix ? digits.length >= 8 : digits.length >= 10);
    });
}

function extractSocialUrls(text: string) {
  const matches =
    text.match(
      /https?:\/\/(?:www\.)?(?:linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|wa\.me)\/[^\s),"'<]+/gi
    ) ?? [];
  return matches.map((url) => url.replace(/[),.;:]+$/g, ""));
}

async function enrichCandidateContacts(
  candidate: NormalizedLeadCandidate
): Promise<NormalizedLeadCandidate> {
  if (!candidate.website) {
    return candidate;
  }

  const urls = contactProbeUrls(candidate.website, candidate.sourceUrl);
  const contacts: NormalizedLeadCandidate["contacts"] = [...candidate.contacts];
  const snippets: string[] = [];
  const companyNameCandidates: string[] = [];
  const pages = await fetchProbePages(urls);
  const linkedUrls: string[] = [];

  for (const { url, html } of pages) {
    if (!html) {
      continue;
    }
    const text = htmlToSearchableText(html).slice(0, 20000);
    snippets.push(text.slice(0, 800));
    companyNameCandidates.push(...extractCompanyNamesFromOfficialHtml(html, url));
    contacts.push(...extractContactsFromHtml(html, url));
    contacts.push(...extractContacts(text, url));
    linkedUrls.push(...extractContactLinks(html, url));
  }

  const linkedPages = await fetchProbePages(
    linkedUrls.filter((url) => !urls.includes(url)).slice(0, contactLinkedProbePageLimit)
  );
  for (const { url, html } of linkedPages) {
    if (!html) {
      continue;
    }
    const text = htmlToSearchableText(html).slice(0, 20000);
    snippets.push(text.slice(0, 800));
    companyNameCandidates.push(...extractCompanyNamesFromOfficialHtml(html, url));
    contacts.push(...extractContactsFromHtml(html, url));
    contacts.push(...extractContacts(text, url));
  }

  const companyName = chooseBestCompanyName(
    candidate.companyName,
    candidate.website,
    companyNameCandidates
  );
  return {
    ...candidate,
    companyName,
    summary:
      [candidate.summary, ...snippets].filter(Boolean).join("\n").slice(0, 5000) ||
      candidate.summary,
    contacts: dedupeContacts(contacts)
  };
}

function extractCompanyNamesFromOfficialHtml(html: string, url: string) {
  return uniqueStrings([
    ...extractJsonLdOrganizationNames(html),
    ...extractMetaCompanyNames(html),
    ...extractLogoAltCompanyNames(html),
    ...extractCopyrightCompanyNames(html),
    ...extractTitleCompanyNames(html, url)
  ]);
}

function chooseBestCompanyName(currentName: string, website: string | null, candidates: string[]) {
  const domainCompany = website ? companyFromDomain(website) : null;
  const cleanedCandidates = uniqueStrings(candidates.map(cleanupCompanyName)).filter((name) =>
    isLikelyCompanyName(name, domainCompany)
  );

  if (cleanedCandidates.length) {
    return cleanedCandidates[0] ?? currentName;
  }

  if (isLikelyCompanyName(currentName, domainCompany)) {
    return currentName;
  }

  return domainCompany ?? currentName;
}

function extractJsonLdOrganizationNames(html: string) {
  const scripts =
    html.match(/<script\b[^>]*type=["'][^"']*ld\+json[^"']*["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const names: string[] = [];

  for (const script of scripts) {
    const json = decodeHtmlEntities(
      script
        .replace(/^<script\b[^>]*>/i, "")
        .replace(/<\/script>$/i, "")
        .trim()
    );
    try {
      collectOrganizationNames(JSON.parse(json), names);
    } catch {
      // Ignore malformed site metadata.
    }
  }

  return names;
}

function collectOrganizationNames(value: unknown, names: string[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectOrganizationNames(item, names));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const type = record["@type"];
  const types = Array.isArray(type) ? type : [type];
  const isOrganization = types.some(
    (item) =>
      typeof item === "string" &&
      /^(organization|corporation|localbusiness|professionalservice)$/i.test(item)
  );
  if (isOrganization && typeof record.name === "string") {
    names.push(record.name);
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      collectOrganizationNames(nested, names);
    }
  }
}

function extractMetaCompanyNames(html: string) {
  const names: string[] = [];
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const key = (htmlAttribute(tag, "property") ?? htmlAttribute(tag, "name") ?? "").toLowerCase();
    if (["og:site_name", "application-name", "twitter:site"].includes(key)) {
      const content = htmlAttribute(tag, "content");
      if (content) {
        names.push(content.replace(/^@/, ""));
      }
    }
  }

  return names;
}

function extractLogoAltCompanyNames(html: string) {
  const images = html.match(/<img\b[^>]*>/gi) ?? [];
  return images
    .filter((tag) => /\blogo\b/i.test(tag))
    .map((tag) => htmlAttribute(tag, "alt") ?? htmlAttribute(tag, "title") ?? "")
    .filter(Boolean);
}

function extractCopyrightCompanyNames(html: string) {
  const text = htmlToSearchableText(html);
  const matches = Array.from(
    text.matchAll(
      /(?:copyright|©|\(c\))\s*(?:copyright)?\s*(?:©|\(c\))?\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?)?\s+([A-Z][A-Za-z0-9&.,'() -]{2,80})/gi
    )
  );
  return matches.map((match) =>
    (match[1] ?? "").replace(/\b(?:all rights reserved|privacy policy|terms).*$/i, "").trim()
  );
}

function extractTitleCompanyNames(html: string, url: string) {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!title) {
    return [];
  }

  const domainCompany = companyFromDomain(url);
  const cleanTitle = decodeHtmlEntities(title).replace(/\s+/g, " ").trim();
  const attributed = extractAttributedCompanyName(cleanTitle);
  const parts = cleanTitle
    .split(/\s(?:[-鈥撯€攟:禄]\s)+|\s[|]\s/)
    .map(cleanupCompanyName)
    .filter(Boolean);

  return [attributed, ...parts.filter((part) => isLikelyCompanyName(part, domainCompany))].filter(
    (value): value is string => Boolean(value)
  );
}

function htmlAttribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] ? decodeHtmlEntities(match[2]) : null;
}

function shouldProbeContactPages(candidate: NormalizedLeadCandidate) {
  if (!candidate.website) {
    return false;
  }

  const domain = domainFromUrl(candidate.website) ?? domainFromUrl(candidate.sourceUrl);
  const path = pathFromUrl(candidate.sourceUrl);
  const text = [candidate.companyName, candidate.website, candidate.sourceUrl, candidate.summary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (domain && (isBlockedContentDomain(domain) || isBlockedMarketplaceDomain(domain))) {
    return false;
  }

  if (
    looksLikeKnowledgeContentPage(candidate) ||
    looksLikeNonCustomerProductPage(candidate) ||
    looksLikeIndustryOrganizationOrEventPage(candidate)
  ) {
    return false;
  }

  if (looksLikeBuyerSideCompanyPage(candidate)) {
    return true;
  }

  if (hasAny(text, consumerElectronicsTerms) || looksLikeContentTitle(candidate.companyName)) {
    return false;
  }

  return !looksLikeArticlePath(path) || hasAny(text, buyerRoleTerms);
}

// 2026-05 V1-MVP+: tier-1 mobile network operators (MNOs) blacklist.
// These companies buy equipment directly from OEMs (Huawei, Ericsson,
// Nokia, ZTE) — they are NOT spare-parts distributors, system
// integrators, or maintenance contractors. Their pages (news, press
// releases, marketing) routinely appear in telecom Brave queries but
// are never valid B2B buyer leads for a spare-parts seller.
//
// The list covers major MNOs in the target markets (Middle East,
// Africa, South Asia) plus global operators whose regional pages
// appear frequently. It is intentionally conservative — only
// operators whose DOMAIN or EXACT company name matches are rejected.
// A company named "Zain Telecom Services LLC" (a different entity)
// would need to match the domain to be rejected.
const TIER1_OPERATOR_DOMAINS = new Set([
  // Middle East
  "zain.com",
  "sa.zain.com",
  "jo.zain.com",
  "iq.zain.com",
  "bh.zain.com",
  "kw.zain.com",
  "sd.zain.com",
  "vodafone.qa",
  "vodafone.com.eg",
  "vodafone.om",
  "etisalat.ae",
  "etisalat.com",
  "e-and.com",
  "ooredoo.com",
  "ooredoo.qa",
  "ooredoo.om",
  "ooredoo.dz",
  "ooredoo.tn",
  "stc.com.sa",
  "stc.com.bh",
  "stc.com.kw",
  "omantel.om",
  "mobily.com.sa",
  "du.ae",
  "batelco.com",
  // Africa
  "mtn.com",
  "mtn.co.za",
  "safaricom.co.ke",
  "airtel.in",
  "airtel.africa",
  "glo.com",
  "9mobile.com.ng",
  // Global (regional pages appear in ME/Africa queries)
  "vodafone.com",
  "t-mobile.com",
  "orange.com",
  "telefonica.com",
  "telenor.com",
  "axiata.com",
  "singtel.com"
]);

// Company name patterns that indicate a tier-1 operator. These are
// checked as word-boundary matches against the candidate company name
// to avoid false positives on companies like "Zain Trading LLC".
const TIER1_OPERATOR_NAME_PATTERNS = [
  /\bzain\s+(ksa|saudi|jordan|iraq|bahrain|kuwait|sudan)\b/i,
  /\bvodafone\s+(qatar|egypt|oman|ghana|turkey)\b/i,
  /\betisalat\b/i,
  /\be&\b/i,
  /\booreedoo\b/i,
  /\booreedoo\s/i,
  /\booredoo\b/i,
  /\bstc\s+(saudi|bahrain|kuwait)\b/i,
  /\bomantel\b/i,
  /\bmobily\b/i,
  /\b(?:du|du\s+telecom)\b.*\buae\b/i,
  /\bmtn\s+(group|south\s+africa|nigeria|ghana)\b/i,
  /\bsafaricom\b/i,
  /\bairtel\s+(africa|india|nigeria)\b/i
];

function looksLikeTier1MobileOperator(
  candidate: NormalizedLeadCandidate,
  domain: string | null
): boolean {
  // 1) Domain match: any candidate whose website or source URL is on
  //    an operator domain is hard-rejected — UNLESS the page is a
  //    vendor-registration / procurement page (those are useful
  //    intelligence signals even though the operator itself isn't a
  //    buyer lead).
  if (domain) {
    let isOperatorDomain = false;
    for (const opDomain of TIER1_OPERATOR_DOMAINS) {
      if (domain === opDomain || domain.endsWith(`.${opDomain}`)) {
        isOperatorDomain = true;
        break;
      }
    }
    if (isOperatorDomain) {
      // Check if this is a vendor/procurement page — if so, let it
      // through to the intelligence classification path.
      const path = pathFromUrl(candidate.sourceUrl).toLowerCase();
      const text = [candidate.companyName, candidate.sourceUrl, candidate.summary]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const isVendorPage =
        /vendor|supplier|procurement|tender|rfp|rfq|registration/i.test(path) ||
        /vendor\s*(?:registration|relations|portal)|supplier\s*registration|procurement\s*portal/i.test(text);
      if (!isVendorPage) {
        return true;
      }
      // Vendor page on operator domain — don't hard reject; let it
      // flow to intelligence classification downstream.
    }
  }

  // 2) Company name match: only specific patterns that unambiguously
  //    identify the operator entity (not a reseller or subsidiary with
  //    a similar name). These are rejected regardless of page type
  //    because the company name itself IS the operator.
  //    Exception: if the source URL is a vendor/procurement page, we
  //    still let it through (handled above by domain check).
  if (candidate.companyName && !domain) {
    // Only apply name-based rejection when we couldn't check the
    // domain (rare edge case — usually domain is available).
    const name = candidate.companyName;
    for (const pattern of TIER1_OPERATOR_NAME_PATTERNS) {
      if (pattern.test(name)) {
        return true;
      }
    }
    const normalized = name.trim().toLowerCase();
    if (
      normalized === "zain ksa" ||
      normalized === "vodafone qatar" ||
      normalized === "vodafone qatar p.q.s.c." ||
      normalized === "etisalat" ||
      normalized === "ooredoo" ||
      normalized === "omantel" ||
      normalized === "mobily" ||
      normalized === "du" ||
      normalized === "stc" ||
      normalized === "mtn"
    ) {
      return true;
    }
  }

  // If domain IS an operator domain but it's a vendor page, we
  // already returned false above (didn't enter the hard-reject).
  // If domain is NOT an operator domain, also check name patterns
  // but only when the domain check didn't already handle it.
  if (candidate.companyName && domain) {
    let isOperatorDomain = false;
    for (const opDomain of TIER1_OPERATOR_DOMAINS) {
      if (domain === opDomain || domain.endsWith(`.${opDomain}`)) {
        isOperatorDomain = true;
        break;
      }
    }
    // If domain is NOT an operator domain but the name matches an
    // operator pattern, it's likely a news article ABOUT the operator
    // (e.g. arabnews.com article titled "Zain KSA integrates...").
    // These should also be rejected.
    if (!isOperatorDomain) {
      const name = candidate.companyName;
      for (const pattern of TIER1_OPERATOR_NAME_PATTERNS) {
        if (pattern.test(name)) {
          return true;
        }
      }
      const normalized = name.trim().toLowerCase();
      if (
        normalized === "zain ksa" ||
        normalized === "vodafone qatar" ||
        normalized === "vodafone qatar p.q.s.c." ||
        normalized === "etisalat" ||
        normalized === "ooredoo" ||
        normalized === "omantel" ||
        normalized === "mobily" ||
        normalized === "du" ||
        normalized === "stc" ||
        normalized === "mtn"
      ) {
        return true;
      }
    }
  }

  return false;
}

// 2026-05 V1-MVP+ P2: certification / inspection / testing /
// compliance service detector. These companies (Applus, SGS, Bureau
// Veritas, TÜV, Intertek, DNV, etc.) provide testing and
// certification services to the telecom industry. They are NOT
// equipment buyers. Their pages appear in telecom queries because
// they mention "telecom" + "services" but in a testing/audit context.
//
// The detector is intentionally conservative:
//   1. Strong domain match (known certification companies) → reject
//   2. Strong text signals (certification + inspection + compliance
//      vocabulary, 2+ hits) → reject UNLESS buyer-role signals present
//   3. If buyer-role signals are present (distributor, stockist,
//      system integrator, contractor, spare parts, equipment supply),
//      do NOT reject — the company may do both.
const CERTIFICATION_COMPANY_DOMAINS = new Set([
  "applus.com",
  "sgs.com",
  "bureauveritas.com",
  "tuv.com",
  "tuvsud.com",
  "tuvnord.com",
  "tuvrheinland.com",
  "intertek.com",
  "dnv.com",
  "dnvgl.com",
  "ul.com",
  "dekra.com",
  "kiwa.com",
  "nemko.com",
  "csa-group.org",
  "ptl.co.uk",
  "element.com",
  "eurofins.com",
  "nqa.com",
  "bsigroup.com"
]);

const CERTIFICATION_TEXT_SIGNALS = [
  "certification",
  "certified",
  "inspection",
  "testing service",
  "testing laboratory",
  "compliance",
  "audit",
  "auditing",
  "calibration",
  "assessment service",
  "verification service",
  "type approval",
  "conformity assessment",
  "accreditation",
  "quality assurance service",
  "iso certification",
  "ce marking"
];

const BUYER_ROLE_SIGNALS = [
  "distributor",
  "stockist",
  "reseller",
  "system integrator",
  "telecom contractor",
  "maintenance company",
  "maintenance contractor",
  "spare parts",
  "equipment supplier",
  "equipment supply",
  "rru",
  "bbu",
  "rectifier",
  "base station equipment",
  "tower maintenance",
  "field service",
  "network deployment",
  "installation contractor"
];

function looksLikeCertificationOrInspectionService(
  candidate: NormalizedLeadCandidate,
  domain: string | null,
  text: string
): boolean {
  // 1) Known certification company domain → always reject.
  if (domain) {
    for (const certDomain of CERTIFICATION_COMPANY_DOMAINS) {
      if (domain === certDomain || domain.endsWith(`.${certDomain}`)) {
        return true;
      }
    }
  }

  // 2) Text-based detection: need 2+ certification signals AND no
  //    buyer-role signals to reject.
  const lowerText = text.toLowerCase();
  const certHits = CERTIFICATION_TEXT_SIGNALS.filter((signal) =>
    lowerText.includes(signal)
  );
  if (certHits.length < 2) {
    return false;
  }

  // Check for buyer-role signals that would override the rejection.
  const hasBuyerRole = BUYER_ROLE_SIGNALS.some((signal) =>
    lowerText.includes(signal)
  );
  if (hasBuyerRole) {
    return false;
  }

  return true;
}

function looksLikeTrainingOrCourseSite(candidate: NormalizedLeadCandidate, text: string) {
  const path = pathFromUrl(candidate.sourceUrl).toLowerCase();
  const domain = (candidate.website
    ? domainFromUrl(candidate.website)
    : domainFromUrl(candidate.sourceUrl)
  )?.toLowerCase() ?? "";

  // Domain or path explicitly references coaching / civil-service
  // exam preparation / academy.
  if (
    /(?:^|[.-])(?:academy|institute|coaching|tutorials?|tutoring|edu(?:cation)?|exams?|upsc|ias|ssc|gate)(?:[.-]|$)/i.test(
      domain
    )
  ) {
    return true;
  }
  if (
    /(?:^|\/)(?:course|courses|training|tutorial|tutorials|exam|exams|syllabus|admission|admissions|coaching|notes|study-?material|prep|preparation)(?:\/|$)/i.test(
      path
    )
  ) {
    return true;
  }

  const lowerText = text.toLowerCase();
  const trainingHits = [
    "course fee",
    "course fees",
    "course duration",
    "course outline",
    "course curriculum",
    "course schedule",
    "training program",
    "training programme",
    "training schedule",
    "training calendar",
    "syllabus",
    "admissions",
    "exam preparation",
    "exam prep",
    "civil services exam",
    "upsc",
    "civil services",
    "online classes",
    "live classes",
    "video lectures",
    "study material",
    "previous year papers"
  ].filter((token) => lowerText.includes(token));
  // Two or more training-vocabulary hits is a strong "this is a course
  // page, not a buyer" signal. One hit alone (e.g. an industrial
  // company that mentions "training program" once) is not enough.
  return trainingHits.length >= 2;
}

function shouldHardRejectCandidate(
  candidate: NormalizedLeadCandidate,
  criteria: IcpScoringCriteria
) {
  const domain = candidate.website
    ? domainFromUrl(candidate.website)
    : domainFromUrl(candidate.sourceUrl);
  const text = [candidate.companyName, candidate.website, candidate.sourceUrl, candidate.summary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const pageType = classifyCandidatePage(candidate, criteria);
  const evidenceClassification = classifyEvidenceLead(candidate, criteria, pageType);
  const nonTargetChinaSupplier = hasNonTargetChinaSupplierSignal(candidate, criteria);

  if (pageType === "own_site") {
    return true;
  }

  // 2026-05 P1+: reference-customer self-rejection. The seller gave us
  // these domains as look-alike anchors, NOT as buyer leads. A Lane D
  // Pattern A query (`site:reference.com (...)`) will return the
  // reference's own pages, and without this guard those pages flow
  // into the qualified table as if they were new customers. We reject
  // any candidate whose domain matches a reference-customer domain
  // (exact match or subdomain).
  if (
    domain &&
    criteria.referenceCustomerDomains &&
    criteria.referenceCustomerDomains.some((refDomain) => domainMatches(domain, refDomain))
  ) {
    return true;
  }

  // 2026-05 P0: fuzzy company-name match. Domain match is not enough —
  // the seller's reference URL might not match the actual company
  // domain (e.g. picture: profile lists highcloud.ae but the company
  // also operates as hctgroup.ae). When the candidate company name
  // contains a reference customer's name (subject to multi-word and
  // non-generic constraints), hard-reject.
  //
  // 2026-05 V1-MVP: also support single-word aliases like "HighCloud"
  // (split out from "HighCloud / HCT Group" by buildIcpCriteria).
  // For safety, single-word aliases use a STRICTER match: word-boundary
  // OR the candidate's compact-form name (lowercased, spaces removed)
  // must contain the lowercased alias. Generic single words like
  // "Spectrum" are still rejected by refNameQualifiesForFuzzyMatch.
  if (
    criteria.referenceCustomerNames &&
    criteria.referenceCustomerNames.length > 0 &&
    candidate.companyName
  ) {
    const candidateName = candidate.companyName.toLowerCase();
    const candidateCompact = candidateName.replace(/\s+/g, "");
    const matched = criteria.referenceCustomerNames.some((refName) => {
      const refLower = refName.toLowerCase().trim();
      if (!refLower) {
        return false;
      }
      // Multi-word alias: existing fuzzy rule (substring after lowercase).
      if (refNameQualifiesForFuzzyMatch(refName)) {
        return candidateName.includes(refLower);
      }
      // Single-word alias: only if length >= 6, non-generic, and the
      // candidate's compact name contains it OR the candidate name
      // has it as a whole word.
      if (refNameQualifiesAsSingleWordAlias(refName)) {
        const refCompact = refLower.replace(/\s+/g, "");
        const wordBoundary = new RegExp(`\\b${escapeRegex(refLower)}\\b`, "i");
        return wordBoundary.test(candidateName) || candidateCompact.includes(refCompact);
      }
      return false;
    });
    if (matched) {
      return true;
    }
  }

  if (nonTargetChinaSupplier) {
    return true;
  }

  // 2026-05 V1-MVP+: tier-1 mobile network operators (MNOs) are the
  // END USERS of telecom equipment — they buy from Huawei/Ericsson/Nokia
  // directly, not from spare-parts distributors. Their news pages,
  // marketing pages, and press releases routinely appear in Brave
  // results for telecom queries but are never valid B2B buyer leads.
  // Hard reject by domain or company name.
  if (looksLikeTier1MobileOperator(candidate, domain)) {
    return true;
  }

  // 2026-05: training / course / exam-prep sites are not buyers and
  // routinely show up under telecom/5G queries (e.g. UPSC and other
  // civil-service prep pages). Hard reject if any of these signals
  // appear on the candidate page or its URL path.
  if (looksLikeTrainingOrCourseSite(candidate, text)) {
    return true;
  }

  // 2026-05 V1-MVP+ P2: certification / inspection / testing /
  // compliance service companies. These are NOT telecom equipment
  // buyers — they provide testing, auditing, and certification
  // services TO the industry. Their pages routinely appear in telecom
  // queries (e.g. "Applus telecom certification", "SGS network
  // testing") but are never valid buyer leads.
  //
  // Conservative: only reject when there are NO buyer-role signals
  // (distributor, stockist, system integrator, contractor, etc.).
  // This avoids false positives on companies that do both testing
  // AND equipment supply.
  if (looksLikeCertificationOrInspectionService(candidate, domain, text)) {
    return true;
  }

  if (looksLikeNonCustomerProductPage(candidate) && !evidenceClassification) {
    return true;
  }

  // 2026-05: news / trade-media / research-firm domains are always
  // noise per the user's policy. Reject them BEFORE the evidence
  // classification fallback would otherwise rescue them as
  // "intelligence" (e.g. RCR Wireless project news, MarketsAndMarkets
  // research). The user's quote: "新闻站不要 ... 报告页不要".
  if (domain && (isNewsMediaDomain(domain) || isMarketResearchDomain(domain))) {
    return true;
  }

  if (domain && evidenceClassification && isPreHardRejectReviewDomain(domain)) {
    return false;
  }

  if (pageType === "third_party_profile") {
    return true;
  }

  if (domain && isAlwaysHardRejectedContentDomain(domain)) {
    return true;
  }

  if (domain && isLegacyMigratedDomain(domain)) {
    return true;
  }

  if (evidenceClassification) {
    return false;
  }

  if (pageType === "non_procurement_document") {
    return true;
  }

  if (pageType === "procurement_document") {
    return false;
  }

  if (pageType === "supplier_or_storefront") {
    return true;
  }

  if (domain && isHardRejectedDiscoveryDomain(domain)) {
    return true;
  }

  if (domain && isBlockedMarketplaceDomain(domain)) {
    return true;
  }

  if (domain && isBlockedContentDomain(domain)) {
    return true;
  }

  if (
    (looksLikeContentTitle(candidate.companyName) || hasAny(text, hardRejectContentTerms)) &&
    !looksLikeDirectCompanyEvidence(candidate)
  ) {
    return true;
  }

  return false;
}

function isRiskyDiscoveryPage(candidate: NormalizedLeadCandidate) {
  const domain = candidate.website
    ? domainFromUrl(candidate.website)
    : domainFromUrl(candidate.sourceUrl);
  const path = pathFromUrl(candidate.sourceUrl);
  const text = [candidate.companyName, candidate.website, candidate.sourceUrl, candidate.summary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (looksLikeBuyerSideCompanyPage(candidate)) {
    return false;
  }

  return Boolean(
    (domain && (isBlockedContentDomain(domain) || isBlockedMarketplaceDomain(domain))) ||
      looksLikeKnowledgeContentPage(candidate) ||
      looksLikeArticlePath(path) ||
      looksLikeContentTitle(candidate.companyName) ||
      hasContentNoiseSignal(text)
  );
}

function looksLikeBuyerSideCompanyPage(candidate: NormalizedLeadCandidate) {
  const domain = candidate.website
    ? domainFromUrl(candidate.website)
    : domainFromUrl(candidate.sourceUrl);
  const path = pathFromUrl(candidate.sourceUrl);
  const text = [
    candidate.companyName,
    candidate.website,
    candidate.sourceUrl,
    candidate.summary,
    candidate.country,
    candidate.contacts.map((contact) => contact.value).join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!domain || isBlockedContentDomain(domain) || isBlockedMarketplaceDomain(domain)) {
    return false;
  }

  if (
    looksLikeStorefrontPath(path) ||
    looksLikeNonCustomerProductPage(candidate) ||
    looksLikeIndustryOrganizationOrEventPage(candidate) ||
    isVendorOemDomain(domain)
  ) {
    return false;
  }

  if (looksLikeKnowledgeContentPage(candidate)) {
    return false;
  }

  if (looksLikeContentTitle(candidate.companyName) || hasAny(text, hardBuyerPageExclusionTerms)) {
    return false;
  }

  const hasCustomerProfile =
    hasAny(text, infrastructureCustomerTerms) ||
    hasAny(text, buyerRoleTerms) ||
    hasAny(text, buyerUseCaseTerms) ||
    hasAny(text, genericBuyerIntentTerms);
  if (!hasCustomerProfile) {
    return false;
  }

  const serviceOrCompanyPath =
    looksLikeCompanyOrDirectoryPath(path) ||
    buyerServicePagePathTerms.some((term) => path.includes(term));
  const hasCompanyIdentity =
    candidate.contacts.some((contact) => contact.type === "email" || contact.type === "phone") ||
    hasAny(text, generalCompanyEntityTerms) ||
    /\b(inc|llc|ltd|limited|corp|corporation|company|group|systems|services)\b/.test(text);

  return serviceOrCompanyPath || hasCompanyIdentity || hasAny(text, genericBuyerPageSignalTerms);
}

function looksLikeDirectCompanyEvidence(candidate: NormalizedLeadCandidate) {
  const domain = candidate.website
    ? domainFromUrl(candidate.website)
    : domainFromUrl(candidate.sourceUrl);
  const path = pathFromUrl(candidate.sourceUrl);
  const text = [candidate.companyName, candidate.website, candidate.sourceUrl, candidate.summary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!domain || isBlockedContentDomain(domain) || isBlockedMarketplaceDomain(domain)) {
    return false;
  }

  if (
    looksLikeArticlePath(path) ||
    looksLikeContentTitle(candidate.companyName) ||
    looksLikeNonCustomerProductPage(candidate) ||
    looksLikeIndustryOrganizationOrEventPage(candidate)
  ) {
    return false;
  }

  return (
    looksLikeCompanyOrDirectoryPath(path) &&
    (hasAny(text, buyerRoleTerms) ||
      hasAny(text, generalCompanyEntityTerms) ||
      hasTelecomContext(text))
  );
}

function contactProbeUrls(website: string, sourceUrl: string) {
  const urls: string[] = [];
  const seen = new Set<string>();
  const addUrl = (value: string) => {
    const normalized = normalizeProbeUrl(value);
    if (!normalized || seen.has(normalized.key)) {
      return;
    }
    seen.add(normalized.key);
    urls.push(normalized.url);
  };

  try {
    const parsed = new URL(website);
    const origin = parsed.origin;
    addUrl(origin);
    addUrl(sourceUrl);
    addUrl(website);
    for (const path of contactPagePathCandidates(sourceUrl, website)) {
      addUrl(`${origin}${path}`);
    }
  } catch {
    addUrl(sourceUrl);
  }

  return urls.slice(0, contactProbePageLimit);
}

function normalizeProbeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    if (url.pathname === "/" && !url.search) {
      return { url: url.origin, key: url.origin };
    }
    return { url: url.toString(), key: url.toString() };
  } catch {
    const trimmed = value.trim();
    return trimmed ? { url: trimmed, key: trimmed } : null;
  }
}

function contactPagePathCandidates(...urls: string[]) {
  const observedPrefixes = new Set<string>();
  for (const url of urls) {
    const prefix = installBasePathPrefix(url);
    if (prefix) {
      observedPrefixes.add(prefix);
    }
  }

  // The 4 contact-page forms users actually click on most modern sites.
  const topRootContactPaths = [
    "/contact",
    "/contact-us",
    "/contacts",
    "/contactus"
  ];

  // English-locale variants right after the root contact paths. Winncom
  // exposes /en/contacts, while NESIC keeps contact data on about.php?lang=en.
  const enLocaleContactPaths = [
    "/en/contact",
    "/en/contact-us",
    "/en/contacts",
    "/en/contactus",
    "/about.php?lang=en"
  ];

  const observedPrefixContactPaths = [...observedPrefixes].flatMap((prefix) =>
    topRootContactPaths.map((suffix) => `${prefix}${suffix}`)
  );
  const wpContactPaths = topRootContactPaths.map((suffix) => `/wp${suffix}`);

  // Trailing-slash and .html variants of the root contact paths, plus common
  // verbal forms ("get in touch", "reach us", "connect").
  const rootContactVariants = [
    "/contact/",
    "/contact-us/",
    "/contacts/",
    "/contactus/",
    "/contact.html",
    "/contact-us.html",
    "/contactus.html",
    "/get-in-touch",
    "/get-in-touch/",
    "/getintouch",
    "/getintouch/",
    "/reach-us",
    "/reach-us/",
    "/connect",
    "/connect/"
  ];

  const prefixedContactVariants = [
    "/contact/",
    "/contact-us/",
    "/contacts/",
    "/contactus/"
  ];

  // Lower-value fallbacks. /about, /company are intentionally NOT in
  // this list; they almost never carry contact info on modern sites
  // and waste probe budget. The contactLinkPathTerms list already lets
  // us follow about/company anchors discovered on the homepage when
  // they exist.
  const otherFallbackPaths = [
    "/our-team",
    "/our-team/",
    "/team",
    "/team/",
    "/our-offices",
    "/our-offices/",
    "/our-locations",
    "/our-locations/",
    "/who-we-are",
    "/who-we-are/",
    "/imprint",
    "/imprint/",
    "/legal-notice",
    "/legal-notice/",
    "/legal/imprint",
    "/legal/imprint/",
    "/request-a-quote",
    "/request-a-quote/",
    "/quote",
    "/quote/",
    "/sales",
    "/sales/",
    "/support",
    "/support/",
    "/locations",
    "/locations/",
    "/offices",
    "/offices/"
  ];

  const candidates: string[] = [
    ...topRootContactPaths,
    ...enLocaleContactPaths,
    ...observedPrefixContactPaths,
    ...wpContactPaths,
    ...rootContactVariants,
    ...[...observedPrefixes].flatMap((prefix) =>
      prefixedContactVariants.map((suffix) => `${prefix}${suffix}`)
    ),
    ...prefixedContactVariants.map((suffix) => `/wp${suffix}`),
    ...otherFallbackPaths
  ];

  return uniqueStrings(candidates);
}

function installBasePathPrefix(url: string) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const firstSegment = segments[0];
    if (!firstSegment || firstSegment.includes(".") || firstSegment.length > 24) {
      return "";
    }

    if (
      [
        "contact",
        "contactus",
        "contact-us",
        "contacts",
        "get-in-touch",
        "getintouch",
        "reach-us",
        "connect",
        "our-team",
        "team",
        "our-offices",
        "our-locations",
        "who-we-are",
        "imprint",
        "legal-notice",
        "legal",
        "about",
        "about-us",
        "company",
        "support",
        "sales",
        "locations",
        "offices"
      ].includes(firstSegment.toLowerCase())
    ) {
      return "";
    }

    return `/${firstSegment}`;
  } catch {
    return "";
  }
}

async function fetchProbePages(urls: string[]) {
  const uniqueUrls = uniqueStrings(urls);
  const results: Array<{ url: string; html: string }> = [];
  const concurrency = 4;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < uniqueUrls.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const url = uniqueUrls[currentIndex]!;
      results[currentIndex] = { url, html: await fetchText(url) };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueUrls.length) }, () => worker()));
  return results.filter(Boolean);
}

function extractContactLinks(html: string, baseUrl: string) {
  const origin = urlOrigin(baseUrl);
  if (!origin) {
    return [];
  }

  const links = html.match(/href\s*=\s*["'][^"']+["']/gi) ?? [];
  const urls = links
    .map((value) => value.replace(/^href\s*=\s*["']|["']$/gi, "").replace(/&amp;/gi, "&"))
    .map((href) => {
      try {
        return new URL(href, baseUrl);
      } catch {
        return null;
      }
    })
    .filter((url): url is URL => Boolean(url))
    .filter((url) => url.origin === origin)
    .filter((url) => {
      const path = url.pathname.toLowerCase();
      return (
        contactLinkPathTerms.some((term) => path.includes(term)) &&
        !path.includes("/feed") &&
        !path.includes("wp-json") &&
        !path.endsWith(".xml")
      );
    })
    .map((url) => {
      url.hash = "";
      if (!hasMeaningfulContactSearchParams(url)) {
        url.search = "";
      }
      return url.toString();
    });

  return uniqueStrings(urls).slice(0, 12);
}

function hasMeaningfulContactSearchParams(url: URL) {
  return ["lang", "language", "locale"].some((param) => url.searchParams.has(param));
}

function urlOrigin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

type ContactProbeFetchResult = {
  ok: boolean;
  status: number;
  html: string;
};

async function fetchText(url: string) {
  const first = await fetchTextOnce(url);
  if (first.ok) {
    return first.html;
  }

  const sucuriCookie = extractSucuriChallengeCookie(first.html);
  if (!sucuriCookie) {
    return "";
  }

  const second = await fetchTextOnce(url, sucuriCookie);
  return second.ok ? second.html : "";
}

async function fetchTextOnce(url: string, cookie?: string): Promise<ContactProbeFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), contactProbeTimeoutMs);

  try {
    const headers: Record<string, string> = {
      accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
    };
    if (cookie) {
      headers.cookie = cookie;
    }
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return { ok: false, status: response.status, html: "" };
    }

    const html = await response.text();
    return { ok: response.ok, status: response.status, html };
  } catch {
    return { ok: false, status: 0, html: "" };
  } finally {
    clearTimeout(timeout);
  }
}

function extractSucuriChallengeCookie(html: string) {
  if (!html.includes("sucuri_cloudproxy") || !html.includes("You are being redirected")) {
    return null;
  }

  const encoded = html.match(/\bS=["']([A-Za-z0-9+/=]+)["']/)?.[1];
  if (!encoded) {
    return null;
  }

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const assignment = decoded.match(
    /^\s*([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?);\s*document\.cookie=/
  );
  if (!assignment?.[1] || !assignment[2]) {
    return null;
  }

  const cookieValue = evaluateSafeJavascriptConcat(assignment[2]);
  const cookieNamePattern = new RegExp(
    `document\\.cookie\\s*=\\s*([\\s\\S]*?)\\+\\s*["']=["']\\s*\\+\\s*${assignment[1]}\\s*\\+`
  );
  const cookieNameExpression = decoded.match(cookieNamePattern)?.[1];
  const cookieName = cookieNameExpression
    ? evaluateSafeJavascriptConcat(cookieNameExpression)
    : null;

  return cookieName && cookieValue ? `${cookieName}=${cookieValue}` : null;
}

function evaluateSafeJavascriptConcat(expression: string) {
  const parts = expression.split("+");
  let output = "";

  for (const rawPart of parts) {
    const part = rawPart.trim();
    const quoted = part.match(/^["']([\s\S]*)["']$/);
    if (quoted) {
      output += quoted[1];
      continue;
    }

    const charCode = part.match(/^String\.fromCharCode\((\d+)\)$/);
    if (charCode?.[1]) {
      output += String.fromCharCode(Number(charCode[1]));
      continue;
    }

    if (!part) {
      continue;
    }

    return null;
  }

  return output;
}

function htmlToSearchableText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code) => {
      const valueCode = Number(code);
      return Number.isFinite(valueCode) ? String.fromCodePoint(valueCode) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const valueCode = Number.parseInt(code, 16);
      return Number.isFinite(valueCode) ? String.fromCodePoint(valueCode) : " ";
    });
}

function dedupeContacts(contacts: NormalizedLeadCandidate["contacts"]) {
  const seen = new Set<string>();

  return contacts.filter((contact) => {
    const key = `${contact.type}:${contact.value.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

// 2026-05 Stage 2 follow-up (P2): negation-aware variant of
// text.includes for the disqualifier penalty path. We walk every
// occurrence of `term` in `text` and check if the run of words
// immediately preceding it is one of the standard negation cues
// ("do not", "don't", "no ", "without", "except", "exclude",
// "instead of", "never", "doesn't", "isn't", "aren't", etc.). If a
// match is governed by a negation cue, we skip it; if any match in
// the text is NOT under a negation cue, we count it as a real hit.
//
// Heuristic, not full NLP — we only look back ~40 chars (a few words)
// so multi-clause sentences are not over-suppressed. We DON'T anchor
// the cue to the very end of the window — phrases like "do not sell
// consumer mobile phones" put "do not" several words before the
// disqualifier. As long as the cue is somewhere in that small
// preceding window, we treat the match as negated.
const negationCuePatterns: RegExp[] = [
  /\b(do|does|did)\s+not\b/i,
  /\b(don|doesn|didn|won|wouldn|isn|aren|wasn|weren|hasn|haven|hadn|cannot|couldn|shouldn|mustn|shan|can)['']?t\b/i,
  /\bnever\b/i,
  /\bno\s+(?!one|other)/i,
  /\bnone\s+of\b/i,
  /\bwithout\b/i,
  /\bexclud(?:e|es|ed|ing)\b/i,
  /\bexcept\b/i,
  /\binstead\s+of\b/i,
  /\brather\s+than\b/i,
  /\bnot\s+(?:a\s+|the\s+)?\w*\s*$/i,
  /\bopt(?:ed)?\s+out\s+of\b/i
];

function containsOutsideNegationContext(text: string, term: string) {
  const needle = term.toLowerCase();
  if (!needle) return false;
  let from = 0;
  while (from <= text.length) {
    const idx = text.indexOf(needle, from);
    if (idx === -1) {
      return false;
    }
    // Scan a small window before `idx` for a negation cue. We look
    // back 40 characters (≈ a short clause) so phrases like "do not
    // sell consumer mobile phones" are caught even when the cue
    // doesn't sit right next to the disqualifier.
    const windowStart = Math.max(0, idx - 40);
    const window = text.slice(windowStart, idx);
    const isNegated = negationCuePatterns.some((pattern) => pattern.test(window));
    if (!isNegated) {
      return true;
    }
    from = idx + needle.length;
  }
  return false;
}

function hasTelecomContext(text: string) {
  if (hasAny(text, telecomIndustryTerms)) {
    return true;
  }

  return /\bnetwork\b/.test(text) && hasAny(text, networkTelecomQualifiers);
}

function hasSearchContext(text: string, criteria: IcpScoringCriteria) {
  const criteriaTerms = [
    ...criteria.productKeywords,
    ...criteria.customerTypeKeywords,
    ...(criteria.brandTerms ?? [])
  ].filter((term) => term.trim().length >= 2);

  return hasAny(text, criteriaTerms) || (criteriaIndicatesTelecom(criteria) && hasTelecomContext(text));
}

function criteriaIndicatesTelecom(criteria: IcpScoringCriteria) {
  const criteriaText = [
    ...criteria.productKeywords,
    ...criteria.customerTypeKeywords,
    ...(criteria.brandTerms ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return hasTelecomContext(criteriaText) || hasAny(criteriaText, specificTelecomProductTerms);
}

function isSpecificProductTerm(term: string) {
  const normalized = term.toLowerCase();
  return specificTelecomProductTerms.some((specificTerm) => normalized.includes(specificTerm));
}

function matchesTargetRegion(country: string, targetRegions: string[]) {
  const candidateCountryKey = countryMatchKey(country);
  if (!candidateCountryKey) {
    return false;
  }

  return targetRegions.some((region) => targetRegionAllowsCountry(region, candidateCountryKey));
}

function hasTargetRegionConstraint(targetRegions: string[]) {
  return targetRegions.length > 0 && !targetRegions.some(isGlobalTargetRegion);
}

function countryConflictHasOnlyOffTargetEvidence(
  countryValidation: Pick<
    NormalizedLeadCandidate,
    "countryConflict" | "countryConflictCountries"
  >,
  targetRegions: string[]
) {
  if (!hasTargetRegionConstraint(targetRegions) || !countryValidation.countryConflict) {
    return false;
  }
  const conflictCountries = uniqueStrings(countryValidation.countryConflictCountries ?? []).filter(
    Boolean
  );
  return (
    conflictCountries.length > 0 &&
    conflictCountries.every((country) => !matchesTargetRegion(country, targetRegions))
  );
}

function isMacroTargetRegion(region: string) {
  return macroTargetRegions.has(region.trim().toLowerCase());
}

function isGlobalTargetRegion(region: string) {
  return globalTargetRegions.has(normalizeRegionKey(region));
}

function targetRegionAllowsCountry(region: string, candidateCountryKey: string) {
  const regionKey = normalizeRegionKey(region);
  if (globalTargetRegions.has(regionKey)) {
    return true;
  }

  const macroCountries = targetRegionCountryMap[regionKey];
  if (macroCountries) {
    return macroCountries.some((country) => countryMatchKey(country) === candidateCountryKey);
  }

  return countryMatchKey(region) === candidateCountryKey;
}

function countryMatchKey(country: string) {
  const resolved = resolveCountry(country);
  if (resolved) {
    return `code:${resolved.code}`;
  }

  const normalized = normalizeCountry(country).trim().toLowerCase();
  return normalized ? `name:${normalized}` : null;
}

function normalizeRegionKey(region: string) {
  return region.trim().toLowerCase();
}

function classifyCandidatePage(
  candidate: NormalizedLeadCandidate,
  criteria: IcpScoringCriteria
): PageType {
  const domain = candidate.website
    ? domainFromUrl(candidate.website)
    : domainFromUrl(candidate.sourceUrl);
  const path = pathFromUrl(candidate.sourceUrl);
  const text = [
    candidate.companyName,
    candidate.website,
    candidate.sourceUrl,
    candidate.summary,
    candidate.country,
    candidate.contacts.map((contact) => contact.value).join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (domain && isOwnDomain(domain, criteria.ownDomains ?? [])) {
    return "own_site";
  }

  if (looksLikeDocumentPath(path)) {
    return hasProcurementIntent(text) ? "procurement_document" : "non_procurement_document";
  }

  if (domain && isThirdPartyProfileDomain(domain)) {
    return hasProcurementIntent(text) ? "procurement_document" : "third_party_profile";
  }

  if (domain && isDirectoryIntelligenceDomain(domain)) {
    return hasProcurementIntent(text) ? "procurement_document" : "third_party_profile";
  }

  if (domain && isProcurementIntelligenceDomain(domain) && hasProcurementIntent(text)) {
    return "procurement_document";
  }

  if (domain && isBrandOemDomain(domain, criteria)) {
    return "brand_oem_site";
  }

  if (looksLikeIndustryOrganizationOrEventPage(candidate)) {
    return "content_or_directory";
  }

  if (isSupplierOrStorefrontPage(text, path)) {
    return "supplier_or_storefront";
  }

  if (looksLikeKnowledgeContentPage(candidate)) {
    return "content_or_directory";
  }

  if (looksLikeBuyerSideCompanyPage(candidate)) {
    return "official_company_site";
  }

  if (isRiskyDiscoveryPage(candidate)) {
    return "content_or_directory";
  }

  if (looksLikeDirectCompanyEvidence(candidate) || looksLikeCompanyOrDirectoryPath(path)) {
    return "official_company_site";
  }

  return "unknown";
}

function isOwnDomain(domain: string, ownDomains: string[]) {
  return ownDomains.some((ownDomain) => domainMatches(domain, ownDomain));
}

function isThirdPartyProfileDomain(domain: string) {
  return thirdPartyProfileDomains.some((profileDomain) => domainMatches(domain, profileDomain));
}

function isBrandOemDomain(domain: string, criteria: IcpScoringCriteria) {
  if (isVendorOemDomain(domain)) {
    return true;
  }

  const normalizedDomain = domain.replace(/[^a-z0-9]/g, "");
  return (criteria.brandTerms ?? [])
    .map((brand) => brand.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((brand) => brand.length >= 4)
    .some((brand) => normalizedDomain === brand || normalizedDomain.startsWith(brand));
}

function isVendorOemDomain(domain: string) {
  return knownBrandOemDomains.some((brandDomain) => domainMatches(domain, brandDomain));
}

function domainMatches(domain: string, expectedDomain: string) {
  const normalized = expectedDomain.replace(/^www\./, "").toLowerCase();
  return Boolean(normalized) && (domain === normalized || domain.endsWith(`.${normalized}`));
}

// 2026-05 P0: reference-customer fuzzy name match qualifier.
// A reference name only qualifies for fuzzy matching against candidate
// company names if it is specific enough to be unambiguous:
//   1. Multi-word (>= 2 words)
//   2. Length >= 6 chars
//   3. After removing generic corporate suffix words (Group, Solutions,
//      Telecom, Connect, Spectrum, Communications, Company, Corp, Ltd,
//      LLC, Co), at least one non-generic word remains.
// Examples:
//   "HCT Group"           -> qualifies (HCT is non-generic)
//   "Spectrum MEA"        -> qualifies (MEA is non-generic)
//   "High Cloud Technologies" -> qualifies
//   "Spectrum"            -> rejects (single word + generic-only)
//   "Solutions"           -> rejects (single word + generic-only)
//   "Telecom Connect"     -> rejects (both words generic)
function refNameQualifiesForFuzzyMatch(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 6) {
    return false;
  }
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 2) {
    return false;
  }
  const genericRefNameWords = new Set([
    "group",
    "solutions",
    "solution",
    "telecom",
    "telecoms",
    "connect",
    "spectrum",
    "communications",
    "communication",
    "company",
    "corp",
    "corporation",
    "ltd",
    "limited",
    "llc",
    "co",
    "inc",
    "international",
    "global",
    "tech",
    "technology",
    "technologies",
    "network",
    "networks",
    "systems",
    "system",
    "services",
    "service"
  ]);
  const nonGenericWords = words.filter(
    (w) => !genericRefNameWords.has(w.toLowerCase().replace(/[.,&]/g, ""))
  );
  return nonGenericWords.length > 0;
}

// 2026-05 V1-MVP: single-word reference alias qualifier. Used after
// splitting combined GPT aliases like "HighCloud / HCT Group" into
// individual entries. Single words must be:
//   1. Length >= 6 (rules out short ambiguous tokens)
//   2. Not in the generic word blocklist (Spectrum, Solutions, ...)
// Examples that qualify: "HighCloud" (9 chars, non-generic)
// Examples that don't: "Spectrum" (generic), "ABC" (too short)
function refNameQualifiesAsSingleWordAlias(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 6) {
    return false;
  }
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length !== 1) {
    return false;
  }
  const word = words[0]!.toLowerCase().replace(/[.,&]/g, "");
  const genericRefNameWords = new Set([
    "group",
    "solutions",
    "solution",
    "telecom",
    "telecoms",
    "connect",
    "spectrum",
    "communications",
    "communication",
    "company",
    "corp",
    "corporation",
    "limited",
    "international",
    "global",
    "technology",
    "technologies",
    "network",
    "networks",
    "systems",
    "service",
    "services"
  ]);
  return !genericRefNameWords.has(word);
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasProcurementIntent(text: string) {
  if (hasAny(text, strongProcurementIntentTerms)) {
    return true;
  }

  return /\bprocurement\b/i.test(text) && hasAny(text, procurementContextTerms);
}

function isSupplierOrStorefrontPage(text: string, path: string) {
  if (looksLikeProductDetailPath(path) && !hasBuyerSideSignal(text)) {
    return true;
  }

  const storefrontSignalFlags = [
    hasAny(text, storefrontSearchTerms),
    hasAny(text, storefrontCatalogTerms),
    hasAny(text, storefrontCommerceTerms),
    hasAny(text, storefrontAccountTerms),
    hasAny(text, storefrontPriceTerms),
    looksLikeStorefrontPath(path),
    hasAny(text, storefrontSellerTerms)
  ];

  const signalCount = storefrontSignalFlags.filter(Boolean).length;
  if (signalCount >= 4) {
    return true;
  }

  if (hasBuyerSideSignal(text)) {
    return false;
  }

  return signalCount >= 2;
}

function hasBuyerSideSignal(text: string) {
  return (
    hasAny(text, buyerUseCaseTerms) ||
    hasAny(text, buyerRoleTerms) ||
    hasAny(text, genericBuyerIntentTerms) ||
    hasProcurementIntent(text)
  );
}

function classifyEvidenceLead(
  candidate: NormalizedLeadCandidate,
  criteria: IcpScoringCriteria,
  pageType = classifyCandidatePage(candidate, criteria)
): EvidenceLeadClassification | null {
  const domain = candidate.website
    ? domainFromUrl(candidate.website)
    : domainFromUrl(candidate.sourceUrl);
  const path = pathFromUrl(candidate.sourceUrl);
  const originalText = [
    candidate.companyName,
    candidate.website,
    candidate.sourceUrl,
    candidate.summary,
    candidate.country,
    candidate.contacts.map((contact) => contact.value).join(" ")
  ]
    .filter(Boolean)
    .join(" ");
  const text = originalText.toLowerCase();
  const isDocument = looksLikeDocumentPath(path);
  const isProcurement = hasProcurementIntent(text);
  const isGovernment =
    (domain ? isGovernmentInformationDomain(domain) : false) ||
    hasAny(text, governmentInformationTerms) ||
    path.includes("/information-and-services/");
  const isNewsOrContent =
    (domain ? isNewsMediaDomain(domain) : false) ||
    looksLikeArticlePath(path) ||
    hasNewsContentSignal(text) ||
    pageType === "content_or_directory";
  const isExplicitNewsArticle =
    (domain ? isNewsMediaDomain(domain) : false) ||
    looksLikeArticlePath(path) ||
    hasAny(text, ["reported", "news article", "press release"]);
  const isDirectory =
    looksLikeDirectoryEvidence(path, text) ||
    (pageType === "third_party_profile" && hasAny(text, directoryDocumentTerms));
  const hasRelevantSearchContext =
    hasSearchContext(text, criteria) ||
    hasAny(text, specificTelecomProductTerms);
  const extractableCompanies = extractMentionedCompanySignals(originalText);
  const usefulProjectNews =
    isExplicitNewsArticle &&
    hasRelevantSearchContext &&
    hasAny(text, projectNewsTerms);
  const usefulDocumentIntelligence =
    isDocument &&
    hasRelevantSearchContext &&
    (isProcurement || hasAny(text, exhibitionDocumentTerms) || hasAny(text, directoryDocumentTerms));
  const allowedProcurementDirectory =
    isProcurement && domain ? isProcurementIntelligenceDomain(domain) : false;
  const hardContentNoise =
    looksLikeContentTitle(candidate.companyName) ||
    hasAny(text, hardRejectContentTerms) ||
    hasAny(text, [
      "market report",
      "industry report",
      "market research",
      "technology indicator",
      "mobile network codes",
      "mcc & mnc",
      "mcc mnc",
      "lookup",
      "regulatory registration",
      "register as a telecommunications provider",
      "policy alert",
      "commission restricts"
    ]);

  if (domain && isOperatorVendorRegistrationPage(domain, path, text)) {
    return intelligenceClassification(
      "operator_vendor_registration",
      ["operator_vendor_registration", "procurement_intelligence"],
      extractableCompanies
    );
  }

  if (looksLikeIndustryOrganizationOrEventPage(candidate)) {
    return {
      leadType: "content_evidence",
      reviewLabels: ["industry_organization_or_event", "content_evidence"],
      extractableCompanies,
      status: "evidence_review",
      scoreCap: 49,
      reason: "Industry organization, standards body, conference, or event page kept only as evidence",
      risk:
        "Associations, alliances, standards organizations, conferences, agendas, and technical programmes are not direct customer companies"
    };
  }

  if (domain && isLinkedInDomain(domain) && hasRelevantSearchContext) {
    const isDecisionMakerProfile = path.includes("/in/");
    return intelligenceClassification(
      isDecisionMakerProfile ? "decision_maker_profile" : "company_directory",
      [
        isDecisionMakerProfile ? "decision_maker_profile" : "linkedin_company_profile",
        "linkedin_intelligence"
      ],
      extractableCompanies
    );
  }

  if (domain && isDirectoryIntelligenceDomain(domain) && hasRelevantSearchContext) {
    return intelligenceClassification(
      "company_directory",
      ["company_directory", "directory_intelligence", "extractable_companies"],
      extractableCompanies
    );
  }

  if (domain && isB2bBuyerIntelligenceDomain(domain) && hasB2bBuyerIntelligenceSignal(text, path)) {
    return intelligenceClassification(
      isProcurement ? "rfq_notice" : "buyer_directory",
      ["buyer_directory", "b2b_buyer_intelligence"],
      extractableCompanies
    );
  }

  if (
    pageType === "supplier_or_storefront" ||
    isSupplierOrStorefrontPage(text, path) ||
    hasAny(text, consumerElectronicsTerms)
  ) {
    return null;
  }

  if (domain && isBlockedMarketplaceDomain(domain) && !allowedProcurementDirectory) {
    return null;
  }

  if (
    hardContentNoise &&
    !isGovernment &&
    !usefulProjectNews &&
    !usefulDocumentIntelligence &&
    !allowedProcurementDirectory
  ) {
    return null;
  }

  if (isGovernment && isProcurement) {
    return intelligenceClassification(
      "government_tender",
      ["government_tender", "procurement_intelligence"],
      extractableCompanies
    );
  }

  if (
    isProcurement &&
    (pageType === "procurement_document" ||
      isDocument ||
      isNewsOrContent ||
      isDirectory ||
      (domain ? isProcurementIntelligenceDomain(domain) : false))
  ) {
    return intelligenceClassification(
      "rfq_notice",
      ["rfq_notice", "procurement_intelligence"],
      extractableCompanies
    );
  }

  if (isDocument && hasRelevantSearchContext) {
    if (hasAny(text, exhibitionDocumentTerms)) {
      return intelligenceClassification(
        "exhibition_pdf",
        ["exhibition_pdf", "pdf_list", "extractable_companies"],
        extractableCompanies
      );
    }

    if (hasAny(text, directoryDocumentTerms)) {
      return intelligenceClassification(
        "company_directory",
        ["company_directory", "pdf_list", "extractable_companies"],
        extractableCompanies
      );
    }
  }

  if (isDirectory && hasRelevantSearchContext) {
    return intelligenceClassification(
      "company_directory",
      ["company_directory", "extractable_companies"],
      extractableCompanies
    );
  }

  if (isGovernment) {
    return {
      leadType: "government_information",
      reviewLabels: ["government_information"],
      extractableCompanies,
      status: "evidence_review",
      scoreCap: 49,
      reason: "Government information page kept for review as evidence",
      risk: "Government information pages are not buyer companies and cannot enter ICP 75+"
    };
  }

  if (isNewsOrContent && hasRelevantSearchContext) {
    if (usefulProjectNews) {
      return intelligenceClassification(
        "project_news",
        ["project_news", "extractable_companies"],
        extractableCompanies
      );
    }

    return {
      leadType: "content_evidence",
      reviewLabels: ["content_evidence"],
      extractableCompanies,
      status: "evidence_review",
      scoreCap: 49,
      reason: "Content page kept only as evidence, not as a customer",
      risk:
        "News, article, blog, media, report, or content page cannot enter the main customer list"
    };
  }

  return null;
}

function intelligenceClassification(
  intelligenceType: IntelligenceType,
  reviewLabels: string[],
  extractableCompanies: string[]
): EvidenceLeadClassification {
  return {
    leadType: "intelligence",
    intelligenceType,
    reviewLabels: uniqueStrings(["intelligence", ...reviewLabels]),
    extractableCompanies,
    status: "intelligence_review",
    scoreCap: 49,
    reason: "Search result is useful buyer intelligence but not a direct customer",
    risk:
      "Intelligence sources must be reviewed and mined for real local companies before outreach or CRM sync"
  };
}

function isOfficialMainCustomerPage(candidate: NormalizedLeadCandidate, pageType: PageType) {
  if (pageType !== "official_company_site") {
    return false;
  }

  const domain = candidate.website
    ? domainFromUrl(candidate.website)
    : domainFromUrl(candidate.sourceUrl);
  const path = pathFromUrl(candidate.sourceUrl);

  if (!domain || isBlockedContentDomain(domain) || isBlockedMarketplaceDomain(domain)) {
    return false;
  }

  if (looksLikeArticlePath(path) || looksLikeDocumentPath(path)) {
    return false;
  }

  return looksLikeOfficialCustomerPath(path) || looksLikeBuyerSideCompanyPage(candidate);
}

function looksLikeOfficialCustomerPath(path: string) {
  if (!path || path === "/" || path.split("/").filter(Boolean).length <= 1) {
    return true;
  }

  return officialCustomerPagePathTerms.some((term) => path.includes(term));
}

function looksLikeDirectoryEvidence(path: string, text: string) {
  return (
    path.includes("/directory") ||
    path.includes("/directories") ||
    path.includes("/listing") ||
    path.includes("/listings") ||
    hasAny(text, directoryDocumentTerms)
  );
}

function extractMentionedCompanySignals(text: string) {
  const companies: string[] = [];
  for (const [name, pattern] of extractableCompanySignalPatterns) {
    if (pattern.test(text)) {
      companies.push(name);
    }
  }

  return uniqueStrings(companies);
}

function assessPageQuality(
  candidate: NormalizedLeadCandidate,
  criteria: IcpScoringCriteria,
  pageType = classifyCandidatePage(candidate, criteria)
): PageQualityAssessment {
  const domain = candidate.website
    ? domainFromUrl(candidate.website)
    : domainFromUrl(candidate.sourceUrl);
  const path = pathFromUrl(candidate.sourceUrl);
  const text = [
    candidate.companyName,
    candidate.website,
    candidate.sourceUrl,
    candidate.summary,
    candidate.country,
    candidate.contacts.map((contact) => contact.value).join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const reasons: string[] = [];
  const risks: string[] = [];
  let positiveScore = 0;
  let negativeScore = 0;
  const isDocument = looksLikeDocumentPath(path);
  const hasCompanyOrDirectoryPath = looksLikeCompanyOrDirectoryPath(path);
  const hasDirectContact = candidate.contacts.some(
    (contact) => contact.type === "email" || contact.type === "phone"
  );
  const hasDirectCompanyEvidence = looksLikeDirectCompanyEvidence(candidate);
  const buyerServicePage = looksLikeBuyerSideCompanyPage(candidate);

  if (pageType === "own_site") {
    negativeScore += 80;
    risks.push("Search result is from the user's own product website");
  }

  if (pageType === "third_party_profile") {
    negativeScore += 50;
    risks.push(
      "Search result is a third-party company profile; use it only as evidence to find the official buyer site"
    );
  }

  if (pageType === "brand_oem_site") {
    negativeScore += 30;
    risks.push("Search result is a brand/OEM official site rather than a downstream buyer");
  }

  if (pageType === "supplier_or_storefront") {
    negativeScore += 52;
    risks.push("Search result is a seller storefront or product catalog, not a buyer lead");
  }

  if (pageType === "procurement_document") {
    positiveScore += 8;
    reasons.push(
      "Search result looks like procurement, tender, RFQ, or vendor-registration evidence"
    );
  }

  if (pageType === "non_procurement_document") {
    negativeScore += 42;
    risks.push(
      "Search result is a non-procurement document such as a brochure, paper, datasheet, or manual"
    );
  }

  if (pageType !== "procurement_document" && domain && isBlockedContentDomain(domain)) {
    negativeScore += 24;
    risks.push(`Search result is from a social/content platform: ${domain}`);
  }

  if (domain && isBlockedMarketplaceDomain(domain)) {
    negativeScore += 18;
    risks.push(`Search result is from a B2B marketplace or supplier directory: ${domain}`);
  }

  if (hasAny(text, consumerElectronicsTerms)) {
    negativeScore += 26;
    risks.push(
      "Search result is about consumer phone accessories or retail electronics, not telecom infrastructure"
    );
  }

  if (hasCompanyOrDirectoryPath) {
    positiveScore += 12;
    reasons.push("Result looks like a company website or contact page");
  }

  if (hasDirectCompanyEvidence) {
    positiveScore += 8;
    reasons.push("Result appears to be direct company evidence, not just a discovery page");
  }

  if (isDocument && pageType !== "procurement_document") {
    negativeScore += 8;
    risks.push(
      "Search result is a document, brochure, or catalog; keeping it for scoring instead of auto-skipping"
    );
  }

  if (hasAny(text, buyerRoleTerms)) {
    positiveScore += 10;
    reasons.push("Contains buyer, integrator, distributor, or maintenance signals");
  } else if (hasAny(text, generalCompanyEntityTerms)) {
    positiveScore += 4;
  }

  if (hasAny(text, criteria.customerTypeKeywords)) {
    positiveScore += 8;
  }

  if (hasDirectContact) {
    positiveScore += 8;
    reasons.push("Includes direct contact details");
  }

  const hasContentNoise = looksLikeArticlePath(path) || hasContentNoiseSignal(text);
  if (hasContentNoise) {
    if (buyerServicePage) {
      negativeScore += looksLikeArticlePath(path) ? 6 : 0;
      if (looksLikeArticlePath(path)) {
        risks.push("Company article or resource page is kept as buyer-side evidence");
      }
    } else {
      negativeScore += isDocument ? 16 : 28;
      risks.push("Search result looks like article, report, job, training, or media content");
    }
  }

  if (looksLikeContentTitle(candidate.companyName)) {
    negativeScore += 24;
    risks.push("Search result is an article/list page, not a direct company lead");
  }

  if (hasContentNoise && !buyerServicePage && !hasAny(text, buyerRoleTerms) && !isDocument) {
    negativeScore += 10;
  }

  const skip = false;
  const scoreAdjustment = clamp(positiveScore - negativeScore, -35, 18);

  return {
    skip,
    scoreAdjustment,
    reasons,
    risks
  };
}

function isBlockedContentDomain(domain: string) {
  if (isGovernmentInformationDomain(domain) || isNewsMediaDomain(domain)) {
    return true;
  }

  return blockedContentDomains.some(
    (blockedDomain) => domain === blockedDomain || domain.endsWith(`.${blockedDomain}`)
  );
}

function isMarketResearchDomain(domain: string) {
  return marketResearchDomains.some(
    (researchDomain) => domain === researchDomain || domain.endsWith(`.${researchDomain}`)
  );
}

function isBlockedMarketplaceDomain(domain: string) {
  return blockedMarketplaceDomains.some(
    (blockedDomain) => domain === blockedDomain || domain.endsWith(`.${blockedDomain}`)
  );
}

function isLinkedInDomain(domain: string) {
  return domainMatches(domain, "linkedin.com");
}

function isDirectoryIntelligenceDomain(domain: string) {
  return directoryIntelligenceDomains.some((directoryDomain) =>
    domainMatches(domain, directoryDomain)
  );
}

function isB2bBuyerIntelligenceDomain(domain: string) {
  return b2bBuyerIntelligenceDomains.some((buyerDomain) => domainMatches(domain, buyerDomain));
}

function hasB2bBuyerIntelligenceSignal(text: string, path: string) {
  return (
    hasProcurementIntent(text) ||
    hasAny(text, b2bBuyerIntelligenceTerms) ||
    /(?:buyer|buyers|buying-lead|buying-leads|rfq|inquiry|inquiries|request-for-quotation)/i.test(
      path
    )
  );
}

function isPreHardRejectReviewDomain(domain: string) {
  return (
    isLinkedInDomain(domain) ||
    isDirectoryIntelligenceDomain(domain) ||
    isB2bBuyerIntelligenceDomain(domain)
  );
}

function isOperatorVendorRegistrationPage(domain: string, path: string, text: string) {
  const hasOperatorIdentity =
    operatorVendorDomains.some((operatorDomain) => domainMatches(domain, operatorDomain)) ||
    hasAny(text, operatorVendorIdentityTerms);
  if (!hasOperatorIdentity) {
    return false;
  }

  return (
    hasProcurementIntent(text) ||
    /(?:vendor|supplier|procurement|purchasing|registration|prequalification|pre-qualification)/i.test(
      path
    )
  );
}

function isAlwaysHardRejectedContentDomain(domain: string) {
  return alwaysHardRejectedContentDomains.some((blockedDomain) =>
    domainMatches(domain, blockedDomain)
  );
}

function isProcurementIntelligenceDomain(domain: string) {
  if (isGovernmentOrEducationDomain(domain) || isGovernmentInformationDomain(domain)) {
    return true;
  }

  return procurementIntelligenceDomains.some((procurementDomain) =>
    domainMatches(domain, procurementDomain)
  );
}

function isGovernmentInformationDomain(domain: string) {
  return (
    isGovernmentOrEducationDomain(domain) ||
    governmentPortalDomains.some((governmentDomain) => domainMatches(domain, governmentDomain))
  );
}

function isNewsMediaDomain(domain: string) {
  return newsMediaDomains.some((newsDomain) => domainMatches(domain, newsDomain));
}

function isHardRejectedDiscoveryDomain(domain: string) {
  if (isGovernmentOrEducationDomain(domain)) {
    return true;
  }

  return hardRejectedDiscoveryDomains.some(
    (blockedDomain) => domain === blockedDomain || domain.endsWith(`.${blockedDomain}`)
  );
}

function isGovernmentOrEducationDomain(domain: string) {
  return (
    domain.endsWith(".gov") ||
    domain.endsWith(".edu") ||
    /(^|\.)gov\.[a-z]{2}$/i.test(domain) ||
    /(^|\.)edu\.[a-z]{2}$/i.test(domain)
  );
}

function isLegacyMigratedDomain(domain: string) {
  return legacyMigratedDomains.some((legacyDomain) => domainMatches(domain, legacyDomain));
}

function looksLikeCompanyOrDirectoryPath(path: string) {
  if (!path || path === "/" || path.split("/").filter(Boolean).length <= 1) {
    return true;
  }

  return companyPagePathTerms.some((term) => path.includes(term));
}

function looksLikeArticlePath(path: string) {
  if (!path) {
    return false;
  }

  return articlePathTerms.some((term) => path.includes(term)) || /\/20\d{2}\/\d{1,2}\//.test(path);
}

function looksLikeKnowledgeContentPage(candidate: NormalizedLeadCandidate) {
  const path = pathFromUrl(candidate.sourceUrl);
  const text = [candidate.companyName, candidate.website, candidate.sourceUrl, candidate.summary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    /\/(?:what-is|what-does|definition|glossary|topics?|resources?|applications?|knowledge|learn|guide|guides|specifications?|standards?|whitepaper|paper|journal|article|blog)\b/i.test(
      path
    ) ||
    looksLikeMarketingArticleSlug(path) ||
    hasAny(text, [
      "what is",
      "what does",
      "definition",
      "glossary",
      "stands for",
      "stands-for",
      "learn about",
      "guide to",
      "specifications",
      "standards & performance",
      "application information",
      "open access journal",
      "research article",
      "science direct",
      "whitepaper",
      "future-proofing",
      "future proofing",
      "businesses in 2026",
      "technical programme",
      "technical program"
    ])
  );
}

function looksLikeMarketingArticleSlug(path: string) {
  const slug = path.split("/").filter(Boolean).at(-1) ?? "";
  if (!slug || !slug.includes("-")) {
    return false;
  }

  const tokenCount = slug.split("-").filter(Boolean).length;
  return (
    tokenCount >= 6 &&
    (/\b20\d{2}\b/.test(slug) ||
      /\b(?:future|proof|guide|what|why|how|businesses?|trends?|market|top|best|complete)\b/i.test(
        slug
      ))
  );
}

function looksLikeDocumentPath(path: string) {
  return /\.(?:pdf|xls|xlsx|csv|doc|docx|ppt|pptx)$/i.test(path);
}

function looksLikeStorefrontPath(path: string) {
  if (!path) {
    return false;
  }

  return /\/(?:product(?:s)?|catalog(?:ue|s)?|category(?:ies)?|collection(?:s)?|shop|store|cart|checkout|item(?:s)?|sku)\b/.test(
    path
  );
}

function looksLikeProductDetailPath(path: string) {
  if (!path) {
    return false;
  }

  return /(?:\/product(?:s)?(?:\/|\.php\b)|\/product-detail\b|\/item(?:s)?(?:\/|\b)|\/sku(?:\/|\b)|\/catalog(?:ue|s)?(?:\/|\b)|\/shop(?:\/|\b)|\/store(?:\/|\b)|\/category(?:ies)?(?:\/|\b))/i.test(
    path
  );
}

function looksLikeNonCustomerProductPage(candidate: NormalizedLeadCandidate) {
  const path = pathFromUrl(candidate.sourceUrl);
  const text = candidateSignalText(candidate);

  if (looksLikeProductDetailPath(path)) {
    return true;
  }

  if (looksLikeProductTitle(candidate.companyName) && !hasAny(text, buyerRoleTerms)) {
    return true;
  }

  const hasSkuOrModelSignal = /\b(?:sku|model|part\s*(?:no|number)|p\/n|datasheet|product details?)\b/i.test(
    text
  );
  const hasCommerceOrCatalogSignal =
    hasAny(text, storefrontCommerceTerms) ||
    hasAny(text, storefrontCatalogTerms) ||
    hasAny(text, storefrontPriceTerms);

  return hasSkuOrModelSignal && hasCommerceOrCatalogSignal && !hasAny(text, buyerUseCaseTerms);
}

function looksLikeIndustryOrganizationOrEventPage(candidate: NormalizedLeadCandidate) {
  const domain = candidate.website
    ? domainFromUrl(candidate.website)
    : domainFromUrl(candidate.sourceUrl);
  const path = pathFromUrl(candidate.sourceUrl);
  const text = candidateSignalText(candidate);

  return Boolean(
    (domain && industryOrganizationOrEventDomains.some((item) => domainMatches(domain, item))) ||
      /\/(?:conference|event|events|agenda|technical-program|technical-programme|workshop|symposium|program-committee)\b/i.test(
        path
      ) ||
      hasAny(text, industryOrganizationOrEventTerms)
  );
}

function hasNonTargetChinaSupplierSignal(
  candidate: NormalizedLeadCandidate,
  criteria: IcpScoringCriteria
) {
  if (!hasTargetRegionConstraint(criteria.targetRegions)) {
    return false;
  }

  if (matchesTargetRegion("China", criteria.targetRegions)) {
    return false;
  }

  const hasVerifiedTargetCountry =
    Boolean(candidate.inferredCountry) &&
    matchesTargetRegion(candidate.inferredCountry!, criteria.targetRegions);
  const hasChinaPhone = candidate.contacts.some(
    (contact) => contact.type === "phone" && inferCountryFromPhone(contact.value) === "CHINA"
  );

  return hasChinaSupplierSignal(candidate) || (hasChinaPhone && !hasVerifiedTargetCountry);
}

function hasChinaSupplierSignal(candidate: NormalizedLeadCandidate) {
  const domain = candidate.website
    ? domainFromUrl(candidate.website)
    : domainFromUrl(candidate.sourceUrl);
  const text = candidateSignalText(candidate);

  return Boolean(
    (domain &&
        (domain.endsWith(".cn") ||
          chinaSupplierDomains.some((item) => domainMatches(domain, item)) ||
          /\bchina\b/i.test(domain))) ||
      hasAny(text, chinaSupplierSignalTerms)
  );
}

function candidateSignalText(candidate: NormalizedLeadCandidate) {
  return [
    candidate.companyName,
    candidate.website,
    candidate.sourceUrl,
    candidate.summary,
    candidate.country,
    candidate.inferredCountry,
    candidate.queryCountry,
    candidate.contacts.map((contact) => contact.value).join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function looksLikeContentTitle(value: string) {
  const lower = value.toLowerCase();
  return (
    /\b(top|best)\s+\d+\b/i.test(value) ||
    genericDiscoveryTitlePatterns.some((pattern) => pattern.test(lower)) ||
    hasAny(lower, contentTitleTerms)
  );
}

function contactCompletenessScore(contacts: NormalizedLeadCandidate["contacts"]) {
  const types = new Set(contacts.map((contact) => contact.type));
  let score = 0;
  if (types.has("email")) score += 10;
  if (types.has("phone")) score += 5;
  if (types.has("social")) score += 3;
  return Math.min(score, 15);
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => {
      if (item === undefined) {
        return null;
      }

      if (typeof item === "number" && !Number.isFinite(item)) {
        return null;
      }

      if (typeof item === "string") {
        return item.split(String.fromCharCode(0)).join("").replace(/\\u0000/gi, "");
      }

      return item;
    })
  ) as Prisma.InputJsonValue;
}

const telecomIndustryTerms = [
  "telecom",
  "telecommunication",
  "tele-communication",
  "telecommunication works",
  "tele-communication works",
  "wireless",
  "4g",
  "5g",
  "fiber",
  "internet service provider",
  "broadband provider",
  "broadband internet",
  "internet banda larga",
  "microwave",
  "tower",
  "ibs",
  "das",
  "small cell",
  "private 5g",
  "cbrs",
  "public safety",
  "broadband",
  "ftth",
  "base station",
  "radio access",
  "ran equipment",
  "mobile operator",
  "carrier network"
];

const networkTelecomQualifiers = [
  "telecom",
  "telecommunication",
  "tele-communication",
  "wireless",
  "mobile",
  "carrier",
  "operator",
  "internet service provider",
  "broadband provider",
  "broadband internet",
  "internet banda larga",
  "ftth",
  "ran",
  "base station",
  "microwave",
  "tower"
];

const specificTelecomProductTerms = [
  "telecom equipment",
  "5g telecom equipment",
  "5g base station",
  "base station equipment",
  "radio access network",
  "ran equipment",
  "remote radio unit",
  "baseband unit",
  "rru",
  "bbu",
  "aau",
  "microwave backhaul",
  "telecom power",
  "rectifier",
  "optical module",
  "rf module",
  "antenna feeder",
  "huawei",
  "zte",
  "bts",
  "enodeb",
  "gnodeb"
];

const buyerRoleTerms = [
  "internet service provider",
  "broadband provider",
  "broadband internet service",
  "wireless internet provider",
  "internet banda larga",
  "base station maintenance company",
  "base station maintenance",
  "ran maintenance",
  "radio access network maintenance",
  "cell site maintenance",
  "cell site services",
  "telecom field services",
  "field maintenance",
  "operations and maintenance",
  "o&m",
  "tower maintenance company",
  "tower maintenance",
  "tower company",
  "telecom infrastructure company",
  "telecom infrastructure operator",
  "communications infrastructure company",
  "communications infrastructure operator",
  "infrastructure operator",
  "neutral host",
  "small cell operator",
  "fiber infrastructure operator",
  "fiber backbone operator",
  "wholesale fiber operator",
  "towerco",
  "cell tower services",
  "cell towers",
  "small cells",
  "wireless infrastructure contractor",
  "wireless infrastructure services",
  "telecom power maintenance",
  "cell site power",
  "rectifier replacement",
  "mobile network operator",
  "network operator",
  "isp network operations",
  "wisp",
  "isp",
  "ftth operator",
  "fiber network operator",
  "telecom equipment distributor",
  "distributor",
  "stockist",
  "reseller",
  "importer",
  "system integrator",
  "telecom system integrator",
  "wireless system integrator",
  "das integrator",
  "distributed antenna system integrator",
  "in-building wireless",
  "public safety das",
  "private lte",
  "private 5g",
  "cbrs",
  "optical lan",
  "telecom contractor",
  "network contractor",
  "tower contractor",
  "tower construction",
  "turnkey contractor",
  "turnkey design",
  "design build",
  "maintenance company",
  "equipment repair",
  "repair service",
  "reverse logistics",
  "spare parts management",
  "network maintenance",
  "site maintenance",
  "project procurement",
  "procurement",
  "purchasing",
  "vendor registration",
  "partner registration",
  "project supply"
];

const buyerUseCaseTerms = [
  "internet service provider",
  "broadband provider",
  "broadband internet service",
  "wireless internet provider",
  "internet banda larga",
  "base station maintenance",
  "ran maintenance",
  "radio access network maintenance",
  "cell site maintenance",
  "cell site services",
  "telecom field services",
  "field maintenance",
  "operations and maintenance",
  "o&m",
  "tower maintenance",
  "tower company",
  "telecom infrastructure operator",
  "communications infrastructure operator",
  "neutral host",
  "fiber infrastructure operator",
  "fiber backbone operator",
  "wholesale fiber operator",
  "towerco",
  "cell tower services",
  "cell towers",
  "small cells",
  "wireless infrastructure contractor",
  "wireless infrastructure services",
  "telecom power maintenance",
  "cell site power",
  "rectifier replacement",
  "mobile network operator",
  "telecom operator",
  "network operator",
  "isp network operations",
  "wisp",
  "isp",
  "ftth operator",
  "fiber network operator",
  "in-building cellular",
  "distributed antenna system",
  "das",
  "small cell",
  "public safety das",
  "private lte",
  "private 5g",
  "cbrs",
  "optical lan",
  "managed private 5g",
  "5g as a service",
  "mission-critical communications",
  "critical communications",
  "equipment repair",
  "repair service",
  "reverse logistics",
  "spare parts management"
];

const infrastructureCustomerTerms = [
  "internet service provider",
  "broadband provider",
  "broadband internet service",
  "wireless internet provider",
  "internet banda larga",
  "mobile network operator",
  "telecom operator",
  "network operator",
  "isp",
  "wisp",
  "ftth operator",
  "fiber network operator",
  "fiber infrastructure",
  "fiber backbone",
  "wholesale fiber",
  "cell tower",
  "cell towers",
  "tower company",
  "towerco",
  "telecom infrastructure",
  "communications infrastructure",
  "neutral host",
  "small cell",
  "small cells",
  "das",
  "distributed antenna system",
  "in-building cellular",
  "public safety das",
  "public safety communication",
  "private lte",
  "private 5g",
  "cbrs",
  "optical lan",
  "wireless infrastructure",
  "wireless communications company",
  "full-service wireless communications",
  "telecom contractor",
  "wireless contractor",
  "system integrator",
  "turnkey design",
  "turnkey design/build",
  "design/build",
  "design build",
  "tower construction",
  "base station installation",
  "telecom infrastructure rollout",
  "telecommunication works",
  "tele-communication works",
  "communications systems",
  "low voltage systems",
  "managed private 5g",
  "5g as a service",
  "mission-critical communications",
  "critical communications"
];

const genericBuyerIntentTerms = [
  "maintenance",
  "maintenance company",
  "operations",
  "operations and maintenance",
  "o&m",
  "field service",
  "field services",
  "repair service",
  "replacement",
  "installer",
  "installation contractor",
  "system integrator",
  "integrator",
  "engineering contractor",
  "contractor",
  "operator",
  "service provider",
  "fleet operator",
  "facility operator",
  "plant operator",
  "network operator",
  "project owner",
  "project developer",
  "project procurement",
  "procurement",
  "purchasing",
  "rfq",
  "tender",
  "vendor registration",
  "supplier registration"
];

const genericServiceBuyerGateTerms = [
  "maintenance company",
  "maintenance services",
  "service provider",
  "network services",
  "system integrator",
  "field service",
  "field services",
  "managed services",
  "network maintenance",
  "repair service",
  "installation contractor"
];

const genericBuyerPageSignalTerms = [
  ...genericBuyerIntentTerms,
  "services",
  "solutions",
  "projects",
  "industries",
  "applications",
  "aftermarket",
  "spare parts management",
  "asset management",
  "infrastructure",
  "technical support"
];

const buyerServicePagePathTerms = [
  "/service",
  "/services",
  "/solution",
  "/solutions",
  "/industry",
  "/industries",
  "/infrastructure",
  "/connectivity",
  "/wireless",
  "/telecom",
  "/technology",
  "/portfolio",
  "/our-portfolio",
  "/division",
  "/divisions",
  "/locations",
  "/markets",
  "/network",
  "/networks",
  "/about"
];

const storefrontSearchTerms = [
  "search for products",
  "product search",
  "browse products",
  "browse categories",
  "search products"
];

const storefrontCatalogTerms = [
  "product catalog",
  "catalog",
  "catalogue",
  "all products",
  "product categories",
  "product list",
  "product details"
];

const storefrontCommerceTerms = [
  "add to cart",
  "cart",
  "checkout",
  "shop now",
  "buy now",
  "order now",
  "wishlist",
  "compare",
  "add to basket"
];

const storefrontAccountTerms = ["login", "register", "sign in", "sign up"];

const storefrontPriceTerms = ["price", "pricing", "price list", "in stock"];

const storefrontSellerTerms = [
  "supplier",
  "stockist",
  "reseller",
  "wholesale",
  "wholesaler",
  "dealer",
  "store",
  "shop",
  "marketplace",
  "manufacturer",
  "exporter",
  "distributor",
  "retailer",
  "ecommerce",
  "e-commerce"
];

const genericItServiceTerms = [
  "it infrastructure",
  "it solutions",
  "managed it",
  "cybersecurity",
  "cloud solutions",
  "software development",
  "structured cabling",
  "cctv",
  "pbx",
  "telephony",
  "voip",
  "modern businesses"
];

const consumerElectronicsTerms = [
  "phone accessories",
  "cell phone",
  "mobile phone accessories",
  "smartphone",
  "iphone",
  "android phone",
  "phone repair",
  "repair parts",
  "lcd screen",
  "consumer electronics",
  "retail electronics"
];

const chinaSupplierDomains = [
  "hua-network.com",
  "fiberolt.com",
  "etulinktechnology.com",
  "etulink.com",
  "pcbaaa.com",
  "suntelecom.cn",
  "hilinktech.com",
  "optical-module.com",
  "opticaltransceiver-module.com",
  "wolontek.com",
  "yxfiber-sfp.com",
  "chinatelecomglobal.com"
];

const chinaSupplierSignalTerms = [
  "china manufacturer",
  "chinese manufacturer",
  "china supplier",
  "chinese supplier",
  "made in china",
  "made-in-china",
  "supplier in china",
  "suppliers in china",
  "china factory",
  "shenzhen",
  "guangzhou",
  "dongguan",
  "wuhan",
  "china sourcing",
  "best chinese sourcing",
  "finding a manufacturer in china"
];

const industryOrganizationOrEventDomains = [
  "telecominfraproject.com",
  "o-ran.org",
  "gsma.com",
  "3gpp.org",
  "ieee.org",
  "ieee-icc.org",
  "aaai.org"
];

const industryOrganizationOrEventTerms = [
  "telecom infra project",
  "o-ran alliance",
  "open ran alliance",
  "industry association",
  "standards body",
  "standards organization",
  "technical programme",
  "technical program",
  "conference programme",
  "conference program",
  "program committee",
  "technical committee",
  "conference agenda",
  "workshop",
  "symposium",
  "webinar",
  "call for papers",
  "accepted papers"
];

const defaultRiskTerms = [
  "job",
  "career",
  "training",
  "course",
  "news",
  "forum",
  "marketplace",
  "supplier directory",
  "company directory",
  "trade directory",
  "yellow pages",
  "b2b marketplace"
];

// 2026-05 Stage 2 follow-up: off-industry buckets used by
// detectOffIndustryBucket. Each bucket is the set of words that, when
// present in a candidate's title/snippet/summary alongside no target
// product or customer signal, indicates the candidate is from an
// industry the user did not ask about. Buckets are evaluated
// independently; a candidate can only trip ONE bucket per scoring
// pass.
//
// 2026-05 Stage 2 follow-up (revised): each bucket has STRONG and
// WEAK terms.
//
// STRONG = unambiguous industry self-identification, e.g.
//   "private bank" / "investment bank" / "wealth management firm"
//   / "aesthetic clinic" / "developer database platform". These
//   are phrases real off-industry companies say about themselves.
//
// WEAK = single nouns that legitimate target buyers commonly print
// in served-industries menus, e.g. "bank", "banking", "healthcare",
// "hospital", "retail". A telecom system integrator's homepage
// often lists "Banking, Healthcare, Retail, Government" as the
// industries it serves — those should NOT count as the candidate
// being a bank/hospital/retailer themselves.
//
// Detection rule: fire only when the candidate trips
//   (a) at least one STRONG hit AND total ≥ 2 hits, OR
//   (b) at least 2 STRONG hits.
//
// Two WEAK hits alone (e.g. "Banking" + "Healthcare" in a nav menu)
// no longer fire. A real bank like "Hamburg Commercial Bank" still
// fires because the body text contains "private banking", "asset
// management", "investment banking" — multiple STRONG phrases.
//
// Self-guard: when the user's own product/customer keywords contain
// any token from a bucket's STRONG list, that bucket is skipped
// entirely. (Weak terms are too generic for self-guard; using them
// would disable the medical bucket for any task that mentions
// "healthcare verticals" in its product keywords.)
const offIndustryBuckets: Record<string, { strong: string[]; weak: string[] }> = {
  medical: {
    strong: [
      "medical clinic",
      "medical center",
      "aesthetic clinic",
      "aesthetic medical",
      "aesthetix",
      "dental clinic",
      "dental practice",
      "dentist",
      "cosmetic clinic",
      "skincare",
      "beauty clinic",
      "beauty salon",
      "pharmaceutical company",
      "pharma manufacturer",
      "biotech firm",
      "biocartis",
      "molecular diagnostic",
      "surgical center",
      "surgery center",
      "wellness center",
      "spa resort",
      "health clinic"
    ],
    // Weak terms: single-word industry mentions that nav menus and
    // generic copy commonly use without meaning the company itself
    // is a medical org.
    weak: [
      "medical",
      "clinical",
      "clinic",
      "hospital",
      "pharma",
      "pharmaceutical",
      "biotech",
      "diagnostic",
      "surgery",
      "surgical",
      "dental",
      "cosmetic",
      "aesthetic",
      "beauty",
      "spa",
      "wellness",
      "healthcare",
      "health care"
    ]
  },
  software_saas: {
    strong: [
      "saas platform",
      "developer database",
      "cloud database",
      "developer platform",
      "no-code platform",
      "low-code platform",
      "kubernetes platform",
      "managed cloud platform",
      "data lake platform",
      "data warehouse platform",
      "code repository",
      "git platform",
      "antivirus software",
      "cybersecurity software",
      "crm software",
      "erp software"
    ],
    weak: [
      "saas",
      "database",
      "cloud platform",
      "software platform",
      "devops",
      "crm",
      "analytics platform",
      "data platform",
      "data lake",
      "data warehouse",
      "managed cloud",
      "kubernetes"
    ]
  },
  consumer_retail: {
    strong: [
      "consumer electronics",
      "mobile phone retail",
      "online shopping",
      "ecommerce platform",
      "e-commerce platform",
      "fashion brand",
      "clothing brand",
      "footwear brand",
      "grocery chain"
    ],
    weak: [
      "retail store",
      "grocery",
      "fashion",
      "apparel",
      "footwear",
      "toys",
      "household goods",
      "kitchenware"
    ]
  },
  finance: {
    // Strong = unambiguous "we are a financial firm" phrases. A real
    // bank's homepage will print "private banking", "investment
    // banking", "wealth management" etc. multiple times in body
    // copy, easily clearing the threshold. A telecom integrator's
    // industries menu listing "Banking" alone will not.
    strong: [
      "private bank",
      "investment bank",
      "commercial bank",
      "private banking",
      "investment banking",
      "retail banking",
      "wealth management",
      "asset management",
      "fintech",
      "credit card issuer",
      "stock trading",
      "investment fund",
      "private equity",
      "hedge fund",
      "insurance broker",
      "insurance company"
    ],
    weak: ["bank", "banking", "insurance", "loans"]
  },
  food_hospitality: {
    strong: [
      "restaurant",
      "cafe",
      "catering company",
      "hotel chain",
      "travel agency",
      "tourism agency",
      "food service",
      "kitchen equipment"
    ],
    weak: ["hospitality", "tourism", "menu"]
  },
  education: {
    strong: [
      "university",
      "college",
      "kindergarten",
      "tutoring center",
      "online course",
      "e-learning platform",
      "mooc"
    ],
    weak: ["school", "academy", "tutoring"]
  }
};

function detectOffIndustryBucket(
  text: string,
  context: {
    productKeywords: string[];
    customerTypeKeywords: string[];
    hasSpecificProductSignal: boolean;
    hasTargetCustomerType: boolean;
  }
): string | null {
  // Override gate: candidate already shows a specific product term or
  // a target customer-type match in its own text — that's a stronger
  // signal than any off-industry bucket can be, so don't reject.
  if (context.hasSpecificProductSignal || context.hasTargetCustomerType) {
    return null;
  }
  const lowerText = text.toLowerCase();
  // Self-guard: combine the user's own product + customer keywords
  // (lowercased) so we can skip any bucket the user is actually
  // shopping in. Example: a user looking for "MongoDB resellers"
  // would have "mongodb" or "database" in productKeywords; the
  // software_saas bucket is then disabled for that scoring pass.
  // We only check overlap against the STRONG list; weak terms are
  // too generic to drive self-guard (they'd disable medical for any
  // task that incidentally mentions healthcare as a vertical).
  const userKeywords = [
    ...context.productKeywords,
    ...context.customerTypeKeywords
  ]
    .map((term) => term.toLowerCase())
    .filter(Boolean);
  for (const [bucketName, bucket] of Object.entries(offIndustryBuckets)) {
    const userOverlapsBucket = bucket.strong.some((bucketTerm) =>
      userKeywords.some(
        (userTerm) => userTerm.includes(bucketTerm) || bucketTerm.includes(userTerm)
      )
    );
    if (userOverlapsBucket) {
      continue;
    }
    let strongHits = 0;
    let weakHits = 0;
    const seen = new Set<string>();
    for (const term of bucket.strong) {
      if (lowerText.includes(term) && !seen.has(term)) {
        seen.add(term);
        strongHits += 1;
      }
    }
    for (const term of bucket.weak) {
      if (lowerText.includes(term) && !seen.has(term)) {
        seen.add(term);
        weakHits += 1;
      }
    }
    // Fire when:
    //   (a) ≥1 strong AND total ≥2 (real industry phrasing plus any
    //       additional signal)
    //   (b) ≥2 strong (multiple unambiguous phrases regardless of
    //       weak signal)
    if (strongHits >= 2 || (strongHits >= 1 && strongHits + weakHits >= 2)) {
      return bucketName;
    }
  }
  return null;
}

const strongProcurementIntentTerms = [
  "tender",
  "rfq",
  "rfp",
  "request for quotation",
  "request for proposal",
  "invitation to tender",
  "bid",
  "bidding",
  "purchase requirement",
  "purchase order",
  "supply contract",
  "vendor registration",
  "supplier registration",
  "expression of interest",
  "eoi",
  "prequalification",
  "pre-qualification"
];

const procurementContextTerms = [
  "notice",
  "notices",
  "opportunity",
  "opportunities",
  "portal",
  "contract",
  "contracts",
  "solicitation",
  "purchase requirement",
  "vendor registration",
  "supplier registration"
];

const thirdPartyProfileDomains = [
  "globaldata.com",
  "lca.logcluster.org",
  "crunchbase.com",
  "zoominfo.com",
  "rocketreach.co",
  "apollo.io",
  "dnb.com",
  "dnb.co.uk",
  "dunandbradstreet.com",
  "signalhire.com",
  "theorg.com",
  "pitchbook.com",
  "owler.com",
  "tracxn.com",
  "craft.co",
  "cbinsights.com"
];

const knownBrandOemDomains = [
  "ericsson.com",
  "huawei.com",
  "nokia.com",
  "zte.com.cn",
  "zte.com",
  "comba-telecom.com",
  "tejasnetworks.com",
  "calix.com",
  "cambiumnetworks.com",
  "mavenir.com",
  "raycap.com",
  "anritsu.com",
  "viavisolutions.com",
  "perle.com",
  "fs.com",
  "cablefree.net",
  "wavesight.com",
  "celona.io",
  "wispzone.com",
  "ispshop.com.br",
  "cogentdistribution.com",
  "lightyear.ai",
  "l-p.com",
  "yxfiber-sfp.com",
  // 2026-05: pure telecom-software / BSS/OSS vendors. They sell
  // software to operators, not hardware. They are never buyers of
  // RRU/BBU/OLT/rectifier equipment.
  "amdocs.com",
  "csgi.com",
  "csgnets.com",
  "netcracker.com",
  "comverse.com",
  "subex.com",
  "optiva.com",
  // 2026-05 P1+: global tier-1 telecom carriers / hyperscalers. They
  // appear on 5G/RAN/private-5G queries via product/solutions pages,
  // but they are NOT buyers in target markets — they are competitors
  // or solution providers. Treating them as buyers pollutes the list.
  "verizon.com",
  "att.com",
  "t-mobile.com",
  "sprint.com",
  "vodafone.com",
  "vodafone.co.uk",
  "telefonica.com",
  "orange.com",
  "deutschetelekom.com",
  "ntt.com",
  "softbank.jp",
  "kt.com",
  "skt.com",
  "ntt-docomo.com",
  "rakuten.com"
];

const blockedContentDomains = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "tiktok.com",
  "reddit.com",
  "nairaland.com",
  "wikipedia.org",
  "wikidata.org",
  "medium.com",
  "researchgate.net",
  "slideshare.net",
  "scribd.com",
  "developingtelecoms.com",
  "tracxn.com",
  "crunchbase.com",
  "owler.com",
  "budde.com.au",
  "buymadeeasy.com",
  "celltowerfinder.com",
  "crtc.gc.ca",
  "dlapiperintelligence.com",
  "expertmarketresearch.com",
  "graphiteconnect.com",
  "meter.com",
  "techtarget.com",
  "telcomagazine.com",
  "thebusinessresearchcompany.com",
  "mordorintelligence.com",
  "marketsandmarkets.com",
  "grandviewresearch.com",
  "researchandmarkets.com",
  "precedenceresearch.com",
  "fortunebusinessinsights.com",
  "china-index.io",
  "semiconductorinsight.com",
  "supplyframe.com",
  "sohoify.com",
  "the7sourcing.com",
  "lidergroupinc.com",
  "globaltradealert.org",
  "netsuite.com",
  "rantcell.com",
  "penguindata.com",
  "eximpedia.app",
  "pdfcoffee.com",
  "ebay.com",
  "ebay.ca",
  "ebay.com.au",
  "alibaba.com",
  "amazon.com",
  "aliexpress.com",
  "yellowpages.com",
  "yellowpages.ae",
  "yello.ae",
  // 2026-05 additions: trade media + research firms reliably flagged
  // as noise in the Brave result set; these are evidence pages, not
  // buyer companies, and never produce a real outreach contact.
  "telecoms.com",
  "lightreading.com",
  "fiercewireless.com",
  "rcrwireless.com",
  "totaltele.com",
  "telecomreview.com",
  "capacitymedia.com",
  "datacenterdynamics.com",
  "towerxchange.com",
  "marketresearch.com",
  "globenewswire.com",
  "prnewswire.com",
  "businesswire.com",
  "nuoptima.com",
  "smart-minded.com",
  "accio.com",
  // 2026-05 P1 additions: cross-industry trade media and SEO "Top X
  // suppliers" content farms that reliably show up in branded OR-group
  // queries (e.g. "Flowserve" OR "Emerson") and crowd out real buyer
  // companies in the top 20 results.
  "petro-online.com",
  "automation.com",
  "linquip.com",
  "everlastingvalveusa.com",
  "valveworld.net",
  "pumpsandsystems.com",
  "flowcontrolnetwork.com",
  "processingmagazine.com",
  "controlglobal.com",
  "instrumentationandcontrol.net",
  "oilandgasonline.com",
  "offshore-technology.com",
  "hydrocarbonprocessing.com",
  "oilandgasiq.com",
  "rigzone.com",
  // 2026-05 P1+: consumer-complaint sites that aggregate brand
  // contact info but are not buyer companies.
  "pissedconsumer.com",
  "complaintsboard.com",
  "consumeraffairs.com",
  "trustpilot.com",
  // Free-host / template-site platforms. Real B2B companies do not
  // build their public site on these; nearly every result is either
  // an SEO content page, a course landing page, or a pseudo-company.
  "sites.google.com",
  "wixsite.com",
  "weebly.com",
  "webnode.com",
  "godaddysites.com",
  "business.site",
  "blogspot.com",
  "wordpress.com"
];

const alwaysHardRejectedContentDomains = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "tiktok.com",
  "reddit.com",
  "wikipedia.org",
  "wikidata.org",
  "slideshare.net",
  "scribd.com",
  "pdfcoffee.com"
];

const legacyMigratedDomains = ["etisalat.ae"];

const discardedEmailDomains = [
  "example.com",
  "example.org",
  "example.net",
  "domain.com",
  "yourdomain.com",
  "your-domain.com",
  "yourmail.com",
  "company.com",
  "companyname.com",
  "email.com",
  "emailaddress.com",
  "yoursite.com",
  "yourcompany.com",
  "sample.com",
  "test.com",
  "mywebsite.com",
  "site.com",
  "tecnologia.com"
];

const discardedEmailLocalParts = new Set([
  "yourmail",
  "your-email",
  "youremail",
  "your.email",
  "email",
  "mail",
  "username",
  "user",
  "name",
  "test",
  "sample",
  "demo"
]);

const procurementIntelligenceDomains = [
  "tendersontime.com",
  "globaltenders.com",
  "biddetail.com",
  "tendernews.com",
  "tendersinfo.com",
  "dgmarket.com",
  "procurement-notices.undp.org"
];

const directoryIntelligenceDomains = [
  "yellowpages.com",
  "yellowpages.ae",
  "yellowpages.co.za",
  "yellowpages.com.ng",
  "dubaiyellowpages.com",
  "saudidirectory.com",
  "yello.ae",
  "yellosa.co.za",
  "mapquest.com",
  "uaeplusplus.com",
  "kompass.com",
  "europages.com",
  "europages.co.uk",
  "telecom.directory"
];

const b2bBuyerIntelligenceDomains = [
  "alibaba.com",
  "accio.com",
  "tradewheel.com",
  "made-in-china.com",
  "globalsources.com",
  "indiamart.com",
  "go4worldbusiness.com",
  "tradeindia.com",
  "ec21.com",
  "exporthub.com"
];

const b2bBuyerIntelligenceTerms = [
  "buyer",
  "buyers",
  "buying lead",
  "buying leads",
  "request for quotation",
  "rfq",
  "inquiry",
  "inquiries",
  "purchase request",
  "sourcing request",
  "wanted",
  "looking for supplier"
];

const operatorVendorDomains = [
  "stc.com.kw",
  "stc.com.sa",
  "ooredoo.qa",
  "ooredoo.com",
  "zain.com",
  "zain.com.kw",
  "eand.ae",
  "etisalat.ae",
  "du.ae",
  "omantel.om",
  "batelco.com",
  "vodafone.qa"
];

const operatorVendorIdentityTerms = [
  "stc",
  "ooredoo",
  "zain",
  "etisalat",
  "e&",
  "du telecom",
  "omantel",
  "batelco",
  "vodafone qatar",
  "mobile network operator",
  "telecom operator"
];

const governmentPortalDomains = ["u.ae"];

const newsMediaDomains = [
  "rcrwireless.com",
  "euronews.com",
  "jpost.com",
  "telecomreview.com",
  "developingtelecoms.com",
  "capacitymedia.com",
  "lightreading.com",
  "totaltele.com",
  // 2026-05 P1: mainstream news outlets that appear in telecom/5G
  // queries via brand acquisition / partnership articles.
  "theguardian.com",
  "bbc.com",
  "bbc.co.uk",
  "reuters.com",
  "bloomberg.com",
  "cnbc.com",
  "ft.com",
  "techcrunch.com",
  "zdnet.com",
  "cnet.com",
  "theverge.com",
  "wired.com"
];

// Market-research / industry-report firms. These are noise per the
// 2026-05 product policy ("报告页不要"); they look like buyer-style
// articles but never contain a real customer.
const marketResearchDomains = [
  "marketsandmarkets.com",
  "expertmarketresearch.com",
  "mordorintelligence.com",
  "grandviewresearch.com",
  "researchandmarkets.com",
  "precedenceresearch.com",
  "fortunebusinessinsights.com",
  "thebusinessresearchcompany.com",
  "datainsightsmarket.com",
  "datacenterdynamics.com",
  "towerxchange.com",
  "marketresearch.com",
  "gartner.com",
  "mckinsey.com",
  "statista.com",
  // 2026-05: Dell'Oro is a telecom market research firm that
  // consistently appears in 5G/telecom queries but is not a buyer.
  "delloro.com"
];

const governmentInformationTerms = [
  "official platform",
  "government portal",
  "ministry",
  "authority",
  "information-and-services",
  "public service",
  "regulator",
  "regulatory authority"
];

// 2026-05 P1 follow-up: news/content term split. Same pattern as
// contentNoiseTerms — strong phrases unambiguously identify a news/
// content page; weak single nouns ("news", "media") are kept because
// they're real signals when paired but cannot fire alone.
const newsContentStrongTerms = [
  "press release",
  "news article",
  "reported by",
  "market report",
  "industry report",
  "research report",
  "white paper",
  "the journalist",
  "publishing platform"
];

const newsContentWeakTerms = [
  "news",
  "media",
  "article",
  "blog",
  "reported",
  "journalist",
  "publisher"
];

function hasNewsContentSignal(text: string): boolean {
  let strong = 0;
  let weak = 0;
  const seen = new Set<string>();
  for (const t of newsContentStrongTerms) {
    if (text.includes(t) && !seen.has(t)) {
      seen.add(t);
      strong += 1;
      if (strong >= 2) return true;
    }
  }
  for (const t of newsContentWeakTerms) {
    if (text.includes(t) && !seen.has(t)) {
      seen.add(t);
      weak += 1;
    }
  }
  if (strong >= 1 && strong + weak >= 2) return true;
  if (weak >= 3) return true;
  return false;
}

// All callers migrated to hasNewsContentSignal — the legacy flat
// newsContentTerms array has been removed.

const projectNewsTerms = [
  "project",
  "rollout",
  "deployment",
  "deploy",
  "build",
  "contract",
  "agreement",
  "partnership",
  "launch",
  "private 5g",
  "network upgrade",
  "tower rollout",
  "fiber rollout"
];

const exhibitionDocumentTerms = [
  "exhibition",
  "exhibitor",
  "exhibitors",
  "expo",
  "conference",
  "trade show",
  "delegate list",
  "participant list",
  "attendee list",
  "event catalogue",
  "event catalog"
];

const directoryDocumentTerms = [
  "directory",
  "company directory",
  "member directory",
  "members directory",
  "association",
  "exhibitor list",
  "supplier list",
  "vendor list",
  "participant list",
  "attendee list",
  "catalogue",
  "catalog"
];

const officialCustomerPagePathTerms = [
  "/about",
  "/contact",
  "/services",
  "/service",
  "/solutions",
  "/solution",
  "/industries",
  "/industry",
  "/telecom",
  "/projects",
  "/project",
  "/locations",
  "/location"
];

const extractableCompanySignalPatterns: Array<[string, RegExp]> = [
  ["ADNOC", /\bADNOC\b/i],
  ["e&", /(^|[^a-z0-9])e&([^a-z0-9]|$)|\betisalat by e&/i],
  ["Nokia", /\bNokia\b/i],
  ["Huawei", /\bHuawei\b/i],
  ["ZTE", /\bZTE\b/i],
  ["Ericsson", /\bEricsson\b/i],
  ["du", /\bdu\b|\bEmirates Integrated Telecommunications\b/i],
  ["stc", /\bstc\b|\bSaudi Telecom\b/i],
  ["Ooredoo", /\bOoredoo\b/i],
  ["Vodafone", /\bVodafone\b/i],
  ["Orange", /\bOrange\b/i],
  ["MTN", /\bMTN\b/i],
  ["Airtel", /\bAirtel\b/i]
];

const blockedMarketplaceDomains = [
  "directory.org.ng",
  "ensun.io",
  "sourcesecurity.com",
  "targetd.com",
  "telecom.directory",
  "accio.com",
  "tradewheel.com",
  "alibaba.com",
  "1688.com",
  "ebay.com",
  "ebay.ca",
  "ebay.com.au",
  "made-in-china.com",
  "globalsources.com",
  "indiamart.com",
  "tradeindia.com",
  "ec21.com",
  "exporthub.com",
  "go4worldbusiness.com",
  "kompass.com",
  "tendersontime.com",
  "globaltenders.com",
  "biddetail.com",
  "tendernews.com",
  "tendersinfo.com",
  "dgmarket.com",
  "procurement-notices.undp.org",
  "europages.co.uk",
  "europages.com",
  "yellowpages.ae",
  "yellowpages.com",
  "yellowpages.co.za",
  "yellowpages.com.ng",
  "yello.ae",
  "yellosa.co.za",
  "uaeplusplus.com",
  // 2026-05 additions:
  // Company / contact directories — not buyer companies; the page
  // never produces a real outreach contact, just a profile snippet.
  "dnb.com",
  "dnb.co.uk",
  "zoominfo.com",
  "apollo.io",
  "rocketreach.co",
  "lusha.com",
  "clutch.co",
  "goodfirms.co",
  "manta.com",
  "thomasnet.com",
  "zaubacorp.com",
  "yelp.com",
  // Job boards / recruitment portals — telecom/5G queries trip these
  // a lot via "engineering company" / "system integrator" wording.
  "indeed.com",
  "indeed.ae",
  "indeed.co.uk",
  "indeed.com.sa",
  "glassdoor.com",
  "glassdoor.co.uk",
  "naukrigulf.com",
  "naukri.com",
  "bayt.com",
  "gulftalent.com",
  "monster.com",
  "monstergulf.com",
  "linkedin.com/jobs",
  // 2026-05 P1 additions: GCC / regional business directories that
  // reliably flood the top 20 result slots on branded OR-group
  // queries (e.g. "Flowserve" OR "KSB" OR "Sulzer" UAE pumps). These
  // are profile-aggregator pages, never reachable buyer companies.
  "yellowpages-uae.com",
  "reachuae.com",
  "atninfo.com",
  "uaecontact.com",
  "uaedirectory.com",
  "saudiyp.com",
  "saudidir.com",
  "qatardirectory.com",
  "qataryp.com",
  "omanyp.com",
  "kuwaityp.com",
  "industrystock.com",
  "exportersindia.com",
  "tradeford.com",
  "go4worldbusiness.com",
  // OEM-side distributor-finder sub-brands. The query
  // ("Tyco" OR ...) routinely matches sub-brand sites like
  // tycoaquamist.com that are still OEM-controlled, not buyers.
  "tycoaquamist.com",
  "tycofire.com",
  "tycoint.com",
  // 2026-05 P2: more B2B platforms / aggregator sites that look like
  // buyer companies but are actually directories or content farms.
  "tradekey.com",
  "eworldtrade.com",
  "famaga.ae",
  "famaga.com",
  "famaga.de",
  "ec21.com",
  "panjiva.com",
  "importgenius.com",
  "tradeatlas.com",
  // OEM partner-directory pages (Legrand / Atlassian / etc list their
  // distributors but those are still controlled by the OEM).
  "partnerdirectory.atlassian.com",
  "legrand.ng",
  "legrand.com",
  // SEO content / "guest blogging" platforms
  "anselec.com",
  "linquip.com",
  "everlastingvalveusa.com",
  // Mobile phone repair shops (Lane K's "spare parts" keyword pulls
  // these in; they are not telecom network equipment buyers).
  "mobilepartsdubai.com",
  "phonerestore.in",
  "techycompany.com"
];

const hardRejectedDiscoveryDomains = [
  "wikipedia.org",
  "wikidata.org",
  "mobilityforesights.com",
  "mordorintelligence.com",
  "analysysmason.com",
  "grantthornton.com",
  "grantthornton.global",
  "datacenterdynamics.com",
  "towerxchange.com",
  "capacitylatam.com",
  "capacityglobal.com",
  "telecomreview.com",
  "intelligenceonline.com",
  "criticalcommunicationsreview.com",
  "datainsightsmarket.com",
  "dgtlinfra.com",
  "inven.ai",
  "xytower.com",
  "xhtower.com",
  "grokipedia.com",
  "baike.baidu.com",
  "gartner.com",
  "mckinsey.com",
  "statista.com",
  "pdfcoffee.com",
  "wordpress.com"
];

const companyPagePathTerms = [
  "/about",
  "/contact",
  "/company",
  "/products",
  "/product",
  "/solutions",
  "/services",
  "/distributor",
  "/distributors",
  "/stockist",
  "/stockists",
  "/partners",
  "/telecom",
  "/network"
];

const contactLinkPathTerms = [
  "contact",
  "about",
  "company",
  "get-in-touch",
  "quote",
  "request",
  "sales",
  "support",
  "office",
  "offices",
  "location",
  "locations",
  "enquiry",
  "inquiry",
  "reach-us",
  "connect"
];

const articlePathTerms = [
  "/article",
  "/articles",
  "/blog",
  "/blogs",
  "/news",
  "/press",
  "/press-release",
  "/media",
  "/insight",
  "/insights",
  "/report",
  "/reports",
  "/research",
  "/resource",
  "/resources",
  "/whitepaper",
  "/case-study",
  "/event",
  "/events",
  "/webinar",
  "/application",
  "/applications",
  "/category",
  "/categories",
  "/catalog",
  "/catalogs",
  "/directory",
  "/directories",
  "/listing",
  "/listings",
  "/job",
  "/jobs",
  "/career",
  "/careers",
  "/training",
  "/course",
  "/courses",
  "/wiki",
  "/forum"
];

// 2026-05 P1 follow-up: split content/news term lists into STRONG
// and WEAK to stop nav-menu single-word false positives.
//
// The old flat-includes approach against contentNoiseTerms (and
// newsContentTerms) hard-rejected real telecom/SI buyer pages just
// because their nav menu contained "News" or "Media" links — see
// Kuwait Telecom and Amanco SA in the e2e replay. The fix mirrors
// the off-industry strong/weak split:
//
//   STRONG = unambiguous "this page IS a content/news page" phrases
//     ("press release", "market report", "industry report",
//     "research report", "news article", "white paper"...).
//   WEAK = single nouns commonly found in nav menus and footers
//     ("news", "media", "blog", "article", "category", "showroom").
//
// Detection fires only when (a) ≥1 strong hit AND total ≥2, or
// (b) ≥2 strong hits, or (c) ≥3 weak hits (a true content site
// usually mentions multiple of these in body copy, not just one
// menu link).
const contentNoiseStrongTerms = [
  "press release",
  "market report",
  "industry report",
  "research report",
  "market size",
  "market share",
  "market forecast",
  "market trends",
  "global market",
  "top startups",
  "startup database",
  "company database",
  "mou targets",
  "supplier directory",
  "yellow pages",
  "company directory",
  "trade directory",
  "b2b marketplace",
  "manufacturers and suppliers",
  "wholesale suppliers",
  "technology indicator",
  "market indicator",
  "business strategies",
  "import export data",
  "shipment details",
  "case study",
  "white paper",
  "application note",
  "product application",
  "deployment challenges",
  "discussion board",
  "what is",
  "what are",
  "what does",
  "how to",
  "how to buy",
  "guide to",
  "key component",
  "signal transmission",
  "lightning protection",
  "damages to telecommunication infrastructure",
  "interim assessment",
  "commission restricts",
  "state act",
  "types, challenges",
  "truck spare parts",
  "companies in the world",
  "companies worldwide"
];

const contentNoiseWeakTerms = [
  "article",
  "blog",
  "news",
  "forecast",
  "marketplace",
  "category",
  "catalog",
  "showroom",
  "regulation",
  "inventory management",
  "software tools",
  "management system",
  "forum",
  "tips",
  "commodity",
  "maintenance & repair",
  "webinar",
  "event",
  "career",
  "job opening",
  "training",
  "course",
  "certification",
  "wikipedia",
  "linkedin",
  "facebook"
];

function hasContentNoiseSignal(text: string): boolean {
  let strong = 0;
  let weak = 0;
  const seen = new Set<string>();
  for (const t of contentNoiseStrongTerms) {
    if (text.includes(t) && !seen.has(t)) {
      seen.add(t);
      strong += 1;
      if (strong >= 2) return true;
    }
  }
  for (const t of contentNoiseWeakTerms) {
    if (text.includes(t) && !seen.has(t)) {
      seen.add(t);
      weak += 1;
    }
  }
  if (strong >= 1 && strong + weak >= 2) return true;
  if (weak >= 3) return true;
  return false;
}

// All callers migrated to hasContentNoiseSignal — the legacy flat
// contentNoiseTerms array has been removed.

const contentTitleTerms = [
  "market report",
  "industry report",
  "global market",
  "market size",
  "market trends",
  "forecast",
  "business strategies",
  "technology indicator",
  "market indicator",
  "china index",
  "import export data",
  "shipment details",
  "showroom",
  "what is",
  "what does",
  "glossary",
  "definition",
  "how to",
  "guide",
  "future-proofing",
  "future proofing",
  "businesses in 2026",
  "technical programme",
  "technical program",
  "conference agenda",
  "state act",
  "commission restricts",
  "regulation",
  "interim assessment",
  "inventory management",
  "management system",
  "deployment challenges",
  "software tools",
  "types, challenges",
  "companies in the world",
  "companies worldwide"
];

const hardBuyerPageExclusionTerms = [
  "market report",
  "market research",
  "market size",
  "market share",
  "market forecast",
  "industry report",
  "research report",
  "telecom review",
  "intelligence online",
  "critical communications review",
  "data insights market",
  "publisher",
  "press release",
  "news article",
  "media platform",
  "event platform",
  "conference platform",
  "rebranding educational message",
  "looking for etisalat",
  "we're now eand.ae",
  "welcome to the new era",
  "supplier directory",
  "manufacturers and suppliers",
  "wholesale suppliers",
  "b2b marketplace"
];

const hardRejectContentTerms = [
  "market report",
  "market research",
  "market size",
  "market share",
  "market forecast",
  "industry report",
  "research report",
  "top 10",
  "top companies",
  "best companies",
  "company database",
  "startup database",
  "wikipedia",
  "grokipedia",
  "what is",
  "glossary",
  "dictionary",
  "datasheet",
  "price and datasheet",
  "buy now",
  "add to cart",
  "for sale",
  "showroom",
  "wholesale suppliers",
  "manufacturers and suppliers",
  "supplier directory",
  "product details",
  "rebranding educational message",
  "looking for etisalat",
  "we're now eand.ae",
  "welcome to the new era",
  "technical programme",
  "technical program",
  "conference agenda",
  "conference programme",
  "program committee"
];

const genericDiscoveryTitlePatterns = [
  /\bmcc\s*&?\s*mnc\b/,
  /\bmobile network codes?\b/,
  /\blookup\b/,
  /\bregulatory (?:bodies|authorit)/,
  /\bregister as a telecommunications provider\b/,
  /\bwhat is\b/,
  /\bsoftware systems integrators\b/,
  /\bwholesale telecommunications distributors\b/,
  /\btelecom equipment manufacturers\s*&\s*suppliers\b/,
  /\bsuppliers? directory\b/,
  /\bcompany directory\b/,
  /\blist of\b/
];

const generalCompanyEntityTerms = [
  "trading",
  "general trading",
  "llc",
  "l.l.c",
  "fze",
  "fzc",
  "co.",
  "company",
  "limited",
  "ltd",
  "solutions",
  "technologies",
  "electronics"
];

const productTitleTerms = [
  "private 5g",
  "critical networks",
  "hardware repair",
  "repair service",
  "networking equipment",
  "telecom networking equipment",
  "rectifier",
  "rectifier module",
  "flatpack",
  "power module",
  "baseband",
  "radio unit",
  "optical module",
  "sfp",
  "datasheet",
  "price",
  "buy",
  "stock",
  "product",
  "products"
];

const domainCompanyNameOverrides: Record<string, string> = {
  ats4solutions: "ATS 4 Solutions",
  greenportsuppliers: "Greenport Suppliers",
  hctgroup: "HCT Group",
  alhazmservices: "Al Hazm Services",
  ispsupplies: "ISP Supplies",
  mfcomm: "MF Communications",
  rtesqatar: "RTES Qatar",
  screamerelectronicservices: "Screamer Electronic Services",
  sfttradingllc: "SFT Trading LLC",
  sfps: "SFPS",
  stc: "STC",
  telephonyme: "TelephonyME",
  tempestns: "Tempest"
};

const domainAcronymTerms = new Set([
  "isp",
  "hct",
  "ats",
  "mf",
  "rtes",
  "sfps",
  "stc",
  "usa",
  "uk",
  "uae"
]);

const genericTitleTerms = [
  "telecom equipment",
  "telecom distributor",
  "equipment distributor",
  "stockist",
  "supplier",
  "system integrator",
  "contractor",
  "repair service",
  "hardware repair services",
  "networking equipment",
  "private 5g",
  "critical networks",
  "home"
];

const genericExactTitleTerms = [
  "about",
  "about us",
  "awesome image",
  "business",
  "by",
  "contact",
  "contact us",
  "distribution",
  "home",
  "homepage",
  "pdf",
  "products",
  "services",
  "category",
  "catalog",
  "tagline",
  "listing",
  "telecom",
  "telecommunications"
];

const forbiddenCompanyNameTerms = new Set([
  "about",
  "about us",
  "article author",
  "awesome image",
  "blog category",
  "by",
  "category",
  "contact",
  "contact us",
  // 2026-05 V1-MVP+: more generic page-title terms that leaked through
  // as company names (e.g. Mobilink Kuwait's "/contact-us" page has
  // <title>Contacts</title>, which was being extracted as a brand new
  // candidate company. Same story for "get in touch", "our team",
  // "team", "services", etc.).
  "contacts",
  "contact info",
  "contact information",
  "get in touch",
  "reach us",
  "reach out",
  "connect with us",
  "our team",
  "team",
  "our offices",
  "offices",
  "our locations",
  "locations",
  "services",
  "our services",
  "products",
  "our products",
  "solutions",
  "our solutions",
  "support",
  "careers",
  "careers home",
  "jobs",
  "blog",
  "news",
  "media",
  "press",
  "privacy",
  "privacy policy",
  "terms",
  "terms of service",
  "cookie policy",
  "sitemap",
  "search",
  "login",
  "sign in",
  "sign up",
  "register",
  "home",
  "homepage",
  "pdf",
  "tagline",
  "welcome"
]);

const siteBuilderCreditPrefixPattern =
  /^\s*(?:created|designed|powered|developed|maintained|hosted)\s+by\s+|^\s*website\s+by\s+/i;

const globalTargetRegions = new Set(["global", "worldwide", "all countries", "all markets"]);

const targetRegionCountryMap: Record<string, string[]> = {
  asia: [
    "UAE",
    "Saudi Arabia",
    "Qatar",
    "Oman",
    "Kuwait",
    "Bahrain",
    "Jordan",
    "Iraq",
    "Iran",
    "Turkey",
    "India",
    "Pakistan",
    "Bangladesh",
    "Sri Lanka",
    "Nepal",
    "Kazakhstan",
    "Uzbekistan",
    "Kyrgyzstan",
    "Tajikistan",
    "Turkmenistan",
    "Indonesia",
    "Vietnam",
    "Malaysia",
    "Philippines",
    "Thailand",
    "Singapore",
    "Cambodia",
    "Myanmar",
    "Laos",
    "China",
    "Japan",
    "South Korea"
  ],
  "southeast asia": [
    "Indonesia",
    "Vietnam",
    "Malaysia",
    "Philippines",
    "Thailand",
    "Singapore",
    "Cambodia",
    "Myanmar",
    "Laos"
  ],
  "south asia": ["India", "Pakistan", "Bangladesh", "Sri Lanka", "Nepal"],
  "central asia": ["Kazakhstan", "Uzbekistan", "Kyrgyzstan", "Tajikistan", "Turkmenistan"],
  "middle east": [
    "UAE",
    "United Arab Emirates",
    "Saudi Arabia",
    "Qatar",
    "Oman",
    "Kuwait",
    "Bahrain",
    "Jordan",
    "Iraq",
    "Iran",
    "Lebanon",
    "Israel",
    "Palestine",
    "Yemen",
    "Syria",
    "Turkey",
    "Egypt"
  ],
  gcc: ["UAE", "United Arab Emirates", "Saudi Arabia", "Qatar", "Kuwait", "Oman", "Bahrain"],
  europe: [
    "United Kingdom",
    "Ireland",
    "France",
    "Germany",
    "Italy",
    "Spain",
    "Portugal",
    "Netherlands",
    "Belgium",
    "Switzerland",
    "Austria",
    "Poland",
    "Czechia",
    "Slovakia",
    "Hungary",
    "Romania",
    "Bulgaria",
    "Greece",
    "Sweden",
    "Norway",
    "Finland",
    "Denmark",
    "Ukraine",
    "Russia"
  ],
  africa: [
    "Nigeria",
    "South Africa",
    "Kenya",
    "Egypt",
    "Morocco",
    "Ghana",
    "Ethiopia",
    "Tanzania",
    "Uganda",
    "Algeria",
    "Tunisia",
    "Libya",
    "Sudan",
    "Senegal",
    "Ivory Coast",
    "Cote d'Ivoire",
    "Cameroon",
    "Angola",
    "Zambia",
    "Zimbabwe",
    "Mozambique",
    "Botswana",
    "Namibia",
    "Rwanda",
    "Somalia",
    "Mali",
    "Burkina Faso",
    "Benin",
    "Togo",
    "Niger",
    "Malawi",
    "Mauritius"
  ],
  "north america": ["United States", "Canada", "Mexico"],
  "latin america": [
    "Brazil",
    "Mexico",
    "Chile",
    "Colombia",
    "Peru",
    "Argentina",
    "Ecuador",
    "Costa Rica",
    "Panama",
    "Uruguay",
    "Paraguay",
    "Bolivia",
    "Guatemala",
    "Honduras",
    "El Salvador",
    "Dominican Republic"
  ],
  latam: [
    "Brazil",
    "Mexico",
    "Chile",
    "Colombia",
    "Peru",
    "Argentina",
    "Ecuador",
    "Costa Rica",
    "Panama",
    "Uruguay",
    "Paraguay",
    "Bolivia",
    "Guatemala",
    "Honduras",
    "El Salvador",
    "Dominican Republic"
  ],
  americas: [
    "United States",
    "Canada",
    "Mexico",
    "Brazil",
    "Chile",
    "Colombia",
    "Peru",
    "Argentina"
  ],
  oceania: ["Australia", "New Zealand", "Papua New Guinea"]
};

const macroTargetRegions = new Set([
  "global",
  "worldwide",
  "all countries",
  "all markets",
  "全球",
  "asia",
  "亚洲",
  "southeast asia",
  "东南亚",
  "south asia",
  "南亚",
  "central asia",
  "中亚",
  "middle east",
  "中东",
  "gcc",
  "海湾国家",
  "europe",
  "欧洲",
  "africa",
  "非洲",
  "north america",
  "北美",
  "北美洲",
  "latin america",
  "latam",
  "拉美",
  "americas",
  "美洲",
  "oceania",
  "大洋洲"
]);

const phoneCountryCodeSignals: Array<[string, string]> = [
  ["971", "UAE"],
  ["966", "Saudi Arabia"],
  ["974", "Qatar"],
  ["968", "Oman"],
  ["965", "Kuwait"],
  ["973", "Bahrain"],
  ["44", "United Kingdom"],
  ["55", "Brazil"],
  ["61", "Australia"],
  ["1", "United States"],
  ["49", "Germany"],
  ["33", "France"],
  ["39", "Italy"],
  ["34", "Spain"],
  ["48", "Poland"],
  ["234", "Nigeria"],
  ["27", "South Africa"],
  ["254", "Kenya"],
  ["20", "Egypt"],
  ["212", "Morocco"],
  ["233", "Ghana"],
  ["91", "India"],
  ["63", "Philippines"],
  ["62", "Indonesia"],
  ["60", "Malaysia"],
  ["65", "Singapore"],
  ["66", "Thailand"],
  ["84", "Vietnam"],
  ["86", "China"],
  ["52", "Mexico"],
  ["57", "Colombia"],
  ["56", "Chile"],
  ["51", "Peru"],
  ["90", "Turkey"],
  ["7", "Russia"]
];

const countrySignals: Array<[string, string]> = [
  ["阿联酋", "UAE"],
  ["uae", "UAE"],
  ["united arab emirates", "UAE"],
  [".ae", "UAE"],
  ["dubai", "UAE"],
  ["abu dhabi", "UAE"],
  ["卡塔尔", "QATAR"],
  ["qatar", "QATAR"],
  [".qa", "QATAR"],
  ["沙特", "SAUDI ARABIA"],
  ["saudi", "SAUDI ARABIA"],
  ["riyadh", "SAUDI ARABIA"],
  ["jeddah", "SAUDI ARABIA"],
  [".sa", "SAUDI ARABIA"],
  ["尼日利亚", "NIGERIA"],
  ["nigeria", "NIGERIA"],
  ["lagos", "NIGERIA"],
  [".ng", "NIGERIA"],
  ["肯尼亚", "KENYA"],
  ["kenya", "KENYA"],
  ["nairobi", "KENYA"],
  [".ke", "KENYA"],
  ["南非", "SOUTH AFRICA"],
  ["south africa", "SOUTH AFRICA"],
  [".za", "SOUTH AFRICA"],
  ["俄罗斯", "RUSSIA"],
  ["russia", "RUSSIA"],
  [".ru", "RUSSIA"],
  ["乌克兰", "UKRAINE"],
  ["ukraine", "UKRAINE"],
  [".ua", "UKRAINE"],
  ["oman", "OMAN"],
  [".om", "OMAN"],
  ["kuwait", "KUWAIT"],
  [".kw", "KUWAIT"],
  ["bahrain", "BAHRAIN"],
  [".bh", "BAHRAIN"],
  ["china", "CHINA"],
  [".cn", "CHINA"],
  ["shenzhen", "CHINA"],
  ["guangzhou", "CHINA"]
];
