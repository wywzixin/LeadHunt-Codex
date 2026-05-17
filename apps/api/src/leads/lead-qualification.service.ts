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
  status: "qualified" | "review" | "needs_country_review" | "country_conflict_review" | "rejected";
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

export type CandidateAiEvaluator = (candidate: NormalizedLeadCandidate) => Promise<CandidateBuyerEvaluation | null>;

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

const contactProbeTimeoutMs = 8000;
const contactProbePageLimit = 14;
const contactLinkedProbePageLimit = 10;
const maxAiCandidateEvaluationsPerBatch = 5;

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
    const pageType = classifyCandidatePage(candidate, criteria);
    const pageQuality = assessPageQuality(candidate, criteria, pageType);
    const countryValidation = validatedCountry(candidate);
    const hasTelecomContextSignal = hasTelecomContext(text);
    const hasIndustryContextSignal =
      hasTelecomContextSignal ||
      hasAny(text, criteria.productKeywords) ||
      hasAny(text, criteria.customerTypeKeywords) ||
      hasAny(text, buyerRoleTerms) ||
      hasAny(text, buyerUseCaseTerms) ||
      hasAny(text, infrastructureCustomerTerms) ||
      hasAny(text, genericBuyerIntentTerms);
    const hasProductKeywordSignal = hasAny(text, criteria.productKeywords);
    const hasSpecificProductSignal =
      hasAny(text, specificTelecomProductTerms) || hasAny(text, criteria.productKeywords.filter(isSpecificProductTerm));
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

    score += pageQuality.scoreAdjustment;
    reasons.push(...pageQuality.reasons);
    risks.push(...pageQuality.risks);

    if (hasIndustryContextSignal) {
      score += 20;
      reasons.push("Matches relevant product, industry, or buyer context");
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
      reasons.push("Matches maintenance, operator, tower, power, ISP, or field-service buyer scenario");
    }

    if (hasInfrastructureCustomerSignal && hasIndustryContextSignal) {
      score += 18;
      reasons.push("Matches operator, infrastructure, engineering, maintenance, or service customer profile");
    }

    const hasTargetMarketConstraint = hasTargetRegionConstraint(criteria.targetRegions);
    const targetCountryMismatch = Boolean(
      countryValidation.inferredCountry &&
        hasTargetMarketConstraint &&
        !matchesTargetRegion(countryValidation.inferredCountry, criteria.targetRegions)
    );
    const targetCountryVerified =
      Boolean(countryValidation.inferredCountry) &&
      (countryValidation.countryConfidence === "high" || countryValidation.countryConfidence === "medium") &&
      !countryValidation.countryConflict;
    const targetCountryUnverified =
      hasTargetMarketConstraint &&
      (!countryValidation.inferredCountry ||
        countryValidation.countryConfidence === "low" ||
        countryValidation.countryConfidence === "unknown");

    if (targetCountryVerified && matchesTargetRegion(countryValidation.inferredCountry!, criteria.targetRegions)) {
      score += 15;
      reasons.push(`Target country verified from official evidence: ${countryValidation.inferredCountry}`);
    } else if (targetCountryMismatch) {
      score -= 20;
      risks.push("Official country evidence does not match the selected target markets");
    } else if (!hasTargetMarketConstraint && hasAny(text, criteria.targetRegions)) {
      score += 10;
      reasons.push("Mentions target market");
    } else if (targetCountryUnverified) {
      risks.push("Target country is not verified from official website evidence");
    }

    const buyerOrIndustryFit = hasBuyerRoleSignal || hasIndustryContextSignal;
    if (countryValidation.countryConflict) {
      forcedStatus = buyerOrIndustryFit ? "country_conflict_review" : "rejected";
      risks.push(
        `Country evidence conflicts${
          countryValidation.countryConflictCountries.length ? `: ${countryValidation.countryConflictCountries.join(", ")}` : ""
        }`
      );
    } else if (targetCountryMismatch) {
      forcedStatus = buyerOrIndustryFit ? "country_conflict_review" : "rejected";
    } else if (targetCountryUnverified) {
      forcedStatus = "needs_country_review";
    }

    const contactScore = contactCompletenessScore(candidate.contacts);
    if (contactScore > 0) {
      score += contactScore;
      reasons.push("Has usable contact signals");
    }

    const riskyTerms = [...defaultRiskTerms, ...(criteria.disqualifiers ?? [])].filter(Boolean);
    const matchedRisks = riskyTerms.filter((term) => text.includes(term.toLowerCase()));
    if (matchedRisks.length > 0) {
      score -= 20;
      risks.push(`Contains disqualifying terms: ${matchedRisks.slice(0, 4).join(", ")}`);
    }

    if (!candidate.website) {
      score -= 10;
      risks.push("Missing official website URL");
    }

    if (!hasSpecificProductSignal && hasAny(text, genericItServiceTerms) && !hasInfrastructureCustomerSignal) {
      score = Math.min(score, 74);
      risks.push("Only generic IT/service signal; no explicit product or buyer context");
    }

    if (!hasSpecificProductSignal && !(hasBuyerRoleSignal && hasIndustryContextSignal)) {
      score = Math.min(score, 64);
      risks.push("No clear buyer, operator, integrator, procurement, or maintenance signal");
    }

    if (hasInfrastructureCustomerSignal && !hasSpecificProductSignal && !hasProcurementIntent(text)) {
      score = Math.min(score, 74);
      risks.push("Infrastructure or service customer fit is kept for outreach validation");
    }

    const hasDirectContact = candidate.contacts.some((contact) => contact.type === "email" || contact.type === "phone");
    const buyerServicePage = looksLikeBuyerSideCompanyPage(candidate);
    const riskyDiscoveryPage = pageType !== "procurement_document" && isRiskyDiscoveryPage(candidate) && !buyerServicePage;
    if (!hasDirectContact) {
      score = Math.min(score, 74);
      risks.push("No usable email or phone found yet");
    }

    if (riskyDiscoveryPage) {
      const evidenceCap = hasDirectContact && hasSpecificProductSignal && hasUseCaseCustomerSignal ? 58 : 44;
      score = Math.min(score, evidenceCap);
      risks.push("Third-party, directory, or content page is kept as evidence but needs manual validation");
      if (!hasDirectContact) {
        risks.push("Discovery/content page without direct contact stays low-confidence");
      }
    } else if (buyerServicePage && pageType === "official_company_site") {
      score = Math.max(score, hasDirectContact ? 58 : 52);
      reasons.push("Official service or infrastructure page is kept for ICP review even without explicit spare-parts demand");
    }

    if (targetCountryMismatch) {
      score = Math.min(score, 49);
      risks.push("Verified candidate country is outside the selected target markets; kept for country-conflict review");
    }

    if (targetCountryUnverified) {
      score = Math.min(score, 49);
      risks.push("Low or missing country confidence keeps this lead out of the main review list");
    }

    if (countryValidation.countryConflict) {
      score = Math.min(score, 49);
      risks.push("Conflicting country evidence keeps this lead out of the main review list");
    }

    if (pageType === "procurement_document") {
      score = Math.max(Math.min(score, 74), 50);
      risks.push("Procurement/RFQ document is kept as a buying-signal lead but needs buyer extraction before qualification");
    }

    if (pageType === "brand_oem_site") {
      score = Math.min(score, 44);
      risks.push("Brand or OEM official site is usually supplier/competitor evidence, not a buyer lead");
    }

    if (pageType === "supplier_or_storefront") {
      score = Math.min(score, 44);
      risks.push("Seller storefront or product catalog is not a buyer lead");
    }

    if (pageType === "third_party_profile" || pageType === "non_procurement_document") {
      score = Math.min(score, 44);
      risks.push("Third-party profile or non-procurement document is evidence only, not a direct buyer lead");
    }

    const finalScore = clamp(Math.round(score), 0, 100);
    const grade = finalScore >= 75 ? "high" : finalScore >= 50 ? "medium" : "low";
    const hardRejectedPage =
      riskyDiscoveryPage ||
      pageType === "brand_oem_site" ||
      pageType === "supplier_or_storefront" ||
      pageType === "third_party_profile" ||
      pageType === "non_procurement_document";
    const status =
      forcedStatus === "rejected"
        ? "rejected"
        : forcedStatus === "country_conflict_review" && !hardRejectedPage
          ? "country_conflict_review"
        : forcedStatus === "needs_country_review" && !hardRejectedPage
          ? "needs_country_review"
          : finalScore >= 75
            ? "qualified"
            : finalScore >= 50
              ? "review"
              : "rejected";

    return {
      score: finalScore,
      grade,
      reasons: reasons.length ? reasons : ["Insufficient explicit ICP signals"],
      risks,
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
    const allCandidates = results.map((result) => normalizeResult(result, { taskId, defaultCountry }));
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
      const enrichedCandidate = inferMissingCandidateCountry(canProbeContact ? await enrichCandidateContacts(candidate) : candidate);
      if (shouldHardRejectCandidate(enrichedCandidate, criteria)) {
        skipped += 1;
        continue;
      }

      const key = candidateKey(enrichedCandidate);
      const emailKeys = enrichedCandidate.contacts
        .filter((contact) => contact.type === "email")
        .map((contact) => `email:${contact.value.toLowerCase()}`);
      const existingLead = existingLeadByKey.get(key) ?? emailKeys.map((emailKey) => existingLeadByKey.get(emailKey)).find(Boolean);
      if (existingLead) {
        const missingContacts = missingExistingContacts(existingLead.contacts, enrichedCandidate.contacts);
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
      const aiEvaluation = shouldUseAi ? await safelyEvaluateCandidate(aiEvaluator!, enrichedCandidate) : null;
      if (shouldUseAi) {
        aiEvaluationsUsed += 1;
      }
      const icp = aiEvaluation ? mergeAiEvaluationWithRuleScore(ruleIcp, aiEvaluation) : ruleIcp;

      const record = await this.prisma.leadCandidate.create({
        data: {
          taskId,
          companyName: enrichedCandidate.companyName,
          website: enrichedCandidate.website,
          country: enrichedCandidate.inferredCountry ?? enrichedCandidate.country,
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
                ruleScore: ruleIcp.score
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
  const countryValidation = validatedCountry(candidate);
  if (
    hasTargetRegionConstraint(criteria.targetRegions) &&
    (countryValidation.countryConflict ||
      !countryValidation.inferredCountry ||
      countryValidation.countryConfidence === "low" ||
      countryValidation.countryConfidence === "unknown" ||
      !matchesTargetRegion(countryValidation.inferredCountry, criteria.targetRegions))
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

  if ((ruleIcp.score < 35 && !buyerServicePage) || (isRiskyDiscoveryPage(candidate) && !buyerServicePage)) {
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
  const hasDirectContact = candidate.contacts.some((contact) => contact.type === "email" || contact.type === "phone");
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

async function safelyEvaluateCandidate(aiEvaluator: CandidateAiEvaluator, candidate: NormalizedLeadCandidate) {
  try {
    return await aiEvaluator(candidate);
  } catch {
    return null;
  }
}

function mergeAiEvaluationWithRuleScore(ruleIcp: IcpScoreDraft, ai: CandidateBuyerEvaluation): IcpScoreDraft {
  const weightedScore = Math.round(clamp(ai.fitScore, 0, 100) * 0.6 + ruleIcp.score * 0.4);
  let score = weightedScore;
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
  } else if (ai.resultType === "target_buyer" && ai.decision === "qualified" && ai.confidence >= 0.72) {
    score = Math.max(score, 75);
  }

  const finalScore = clamp(score, 0, 100);
  const status =
    ruleIcp.status === "country_conflict_review"
      ? "country_conflict_review"
      : ruleIcp.status === "needs_country_review"
        ? "needs_country_review"
        : finalScore >= 75
          ? "qualified"
          : finalScore >= 50
            ? "review"
            : "rejected";
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
      : [])
  ]);

  return {
    score: finalScore,
    grade,
    reasons,
    risks,
    status
  };
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

function mergeExistingContacts(
  candidateContacts: NormalizedLeadCandidate["contacts"],
  existingContacts: ExistingLead["contacts"]
) {
  return dedupeContacts([
    ...candidateContacts,
    ...existingContacts.map((contact) => ({
      type: contact.type as NormalizedLeadCandidate["contacts"][number]["type"],
      value: contact.value,
      sourceUrl: contact.sourceUrl ?? ""
    }))
  ]);
}

function missingExistingContacts(
  existingContacts: ExistingLead["contacts"],
  candidateContacts: NormalizedLeadCandidate["contacts"]
) {
  const existingContactKeys = new Set(existingContacts.map(contactKey));
  return dedupeContacts(candidateContacts).filter((contact) => !existingContactKeys.has(contactKey(contact)));
}

function extractCompanyName(title: string, url: string) {
  const attributedCompany = extractAttributedCompanyName(title);
  if (attributedCompany) {
    return attributedCompany;
  }

  const domainCompany = companyFromDomain(url);
  const parts = title
    .split(/\s(?:[-–—|:»]\s)+|\s[|]\s/)
    .map((part) => cleanupCompanyName(part))
    .filter(Boolean);
  const selected = parts.find((part) => isLikelyCompanyName(part, domainCompany)) ?? parts.find((part) => !isGenericTitle(part));

  return selected || domainCompany || "Unknown Company";
}

function cleanupCompanyName(value: string) {
  return value
    .replace(/\b(home|official site|website|about us|contact us|logo)\b/gi, "")
    .replace(/^\s*(?:welcome to|official)\s+/i, "")
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
    genericExactTitleTerms.some((term) => lower === term) ||
    genericTitleTerms.some((term) => lower === term || lower.includes(term)) ||
    looksLikeProductTitle(value)
  );
}

function isLikelyCompanyName(value: string, domainCompany: string | null) {
  const name = cleanupCompanyName(value);
  const lower = name.toLowerCase();
  if (!name || name.length > 72 || isGenericTitle(name)) {
    return false;
  }

  if (domainCompany && normalizeCompanyKey(name) === normalizeCompanyKey(domainCompany)) {
    return true;
  }

  if (generalCompanyEntityTerms.some((term) => lower.includes(term))) {
    return true;
  }

  if (/\b(?:llc|ltd|limited|inc|corp|corporation|group|communications|solutions|systems|services|networks?)\b/i.test(name)) {
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
      hasAny(lower, ["rectifier", "module", "board", "rru", "bbu", "aau", "networking equipment", "hardware repair"]))
  );
}

function companyFromDomain(url: string) {
  const domain = domainFromUrl(url);
  if (!domain) {
    return null;
  }

  const label = domain.split(".")[0] ?? domain;
  return formatDomainLabelAsCompany(label);
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
    .map((part) => (domainAcronymTerms.has(part.toLowerCase()) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
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
  const queryCountry = candidate.queryCountry ?? null;
  const queryConflict = Boolean(
    queryCountry && candidateCountries.length === 1 && !matchesTargetRegion(candidateCountries[0]!, [queryCountry])
  );
  const evidenceConflict = candidateCountries.length > 1;
  const countryConflict = evidenceConflict || queryConflict;
  const countryConflictCountries = uniqueCountries([
    ...candidateCountries,
    ...(queryConflict && queryCountry ? [queryCountry] : [])
  ]);
  const inferredCountry = candidateCountries.length === 1 ? candidateCountries[0]! : null;
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
  const websiteCountry = inferDomainCountry(candidate.website ?? candidate.sourceUrl);
  if (websiteCountry) {
    evidence.push({
      type: "website_domain",
      country: websiteCountry,
      value: domainFromUrl(candidate.website ?? candidate.sourceUrl) ?? candidate.website ?? candidate.sourceUrl,
      sourceUrl: candidate.website ?? candidate.sourceUrl,
      confidence: "medium"
    });
  }

  for (const contact of candidate.contacts) {
    if (contact.type === "phone") {
      const country = inferCountryFromPhone(contact.value);
      if (country) {
        evidence.push({
          type: "phone",
          country,
          value: contact.value,
          sourceUrl: contact.sourceUrl,
          confidence: "high"
        });
      }
      continue;
    }

    if (contact.type === "email") {
      const country = inferDomainCountry(contact.value);
      if (country) {
        evidence.push({
          type: "email_domain",
          country,
          value: contact.value,
          sourceUrl: contact.sourceUrl,
          confidence: "medium"
        });
      }
    }
  }

  for (const textEvidence of extractCountryEvidenceFromOfficialText(text, candidate.sourceUrl)) {
    evidence.push(textEvidence);
  }

  return dedupeCountryEvidence(evidence);
}

function normalizeQueryCountry(country: string | undefined) {
  return country && !isMacroTargetRegion(country) ? normalizeCountry(country) : null;
}

function inferDomainCountry(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return inferCountryFromText(value);
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
  return /\b(?:serves?|serving|service area|coverage|operations?|operates?|market|region)\b/i.test(text);
}

function hasAddressCue(text: string) {
  return /\b(?:address|office|offices|headquarters|hq|located|based|locations?|branches)\b/i.test(text);
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
  const internationalDigits = trimmed.startsWith("+") ? digits : digits.startsWith("00") ? digits.slice(2) : "";

  if (internationalDigits) {
    const match = phoneCountryCodeSignals.find(([code]) => internationalDigits.startsWith(code));
    return match ? normalizeCountry(match[1]) : null;
  }

  if (/^1[\s.-]?(?:800|888|877|866|855|844|833)[\s.-]?\d{3}[\s.-]?\d{4}$/.test(trimmed)) {
    return normalizeCountry("United States");
  }

  if (!digits.startsWith("0") && /^\(?[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}$/.test(trimmed)) {
    return normalizeCountry("United States");
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

function extractContactsFromHtml(html: string, sourceUrl: string): NormalizedLeadCandidate["contacts"] {
  const decoded = decodeHtmlEntities(html);
  const searchable = htmlToSearchableText(html);
  const contacts = [
    ...extractEmailsFromHtml(decoded).map((value) => ({ type: "email" as const, value, sourceUrl })),
    ...extractTelLinkPhones(decoded).map((value) => ({ type: "phone" as const, value, sourceUrl })),
    ...extractPhoneContacts(searchable, sourceUrl),
    ...extractSocialUrls(decoded).map((value) => ({ type: "social" as const, value, sourceUrl }))
  ];

  return dedupeContacts(contacts);
}

function extractEmails(text: string) {
  return uniqueStrings([
    ...extractDirectEmails(text),
    ...extractObfuscatedEmails(text)
  ]).filter(isUsableEmail);
}

function extractEmailsFromHtml(html: string) {
  return uniqueStrings([
    ...extractDirectEmails(html),
    ...extractMailtoEmails(html),
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

  return !["example.com", "domain.com", "yourdomain.com", "company.com", "email.com"].includes(domain);
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
    .map((value) => safeDecodeURIComponent(value).replace(/[^\d+().\-\s]/g, " ").replace(/\s+/g, " ").trim())
    .filter(isPlausiblePhoneNumber);
}

function extractPhoneContacts(text: string, sourceUrl: string): NormalizedLeadCandidate["contacts"] {
  const normalized = text.replace(/\s+/g, " ");
  const loosePhones = new Set(extractPhones(normalized));
  const matches = Array.from(normalized.matchAll(/(?:\+?\d[\d\s().-]{7,}\d)/g)).filter((match) =>
    loosePhones.has(match[0].replace(/\s+/g, " ").trim())
  );
  return matches
    .map((match) => {
      const value = match[0].replace(/\s+/g, " ").trim();
      const index = match.index ?? 0;
      const context = normalized.slice(Math.max(0, index - 120), Math.min(normalized.length, index + value.length + 120));
      return { value, context };
    })
    .filter(({ value }) => isPlausiblePhoneNumber(value))
    .filter(({ value, context }) => hasPhoneSignal(value, context))
    .filter(({ context }) => !hasPartNumberContext(context))
    .map(({ value }) => ({ type: "phone" as const, value, sourceUrl }))
    .filter((contact, index, contacts) => contacts.findIndex((item) => digitsOnly(item.value) === digitsOnly(contact.value)) === index);
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

  if ((phone.match(/\(/g)?.length ?? 0) !== (phone.match(/\)/g)?.length ?? 0)) {
    return false;
  }

  return true;
}

function hasPhoneSignal(phone: string, context: string) {
  if (phone.trim().startsWith("+")) {
    return true;
  }

  if (/\b(?:phone|tel|telephone|mobile|cell|call|fax|whatsapp|contact|office|main|direct|sales|support|customer service)\b\s*[:#-]?/i.test(context)) {
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

function extractPhones(text: string) {
  const matches = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? [];
  return matches
    .map((phone) => phone.replace(/\s+/g, " ").trim())
    .filter((phone) => !/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(phone))
    .filter((phone) => !/(?:19|20)\d{2}\s*[-\u2013]\s*(?:19|20)\d{2}/.test(phone))
    .filter((phone) => (phone.match(/\(/g)?.length ?? 0) === ((phone.match(/\)/g)?.length ?? 0)))
    .filter((phone) => {
      const digits = phone.replace(/\D/g, "");
      const hasCountryPrefix = phone.trim().startsWith("+");
      return digits.length <= 16 && (hasCountryPrefix ? digits.length >= 8 : digits.length >= 10);
    });
}

function extractSocialUrls(text: string) {
  const matches =
    text.match(/https?:\/\/(?:www\.)?(?:linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|wa\.me)\/[^\s),"'<]+/gi) ??
    [];
  return matches.map((url) => url.replace(/[),.;:]+$/g, ""));
}

async function enrichCandidateContacts(candidate: NormalizedLeadCandidate): Promise<NormalizedLeadCandidate> {
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

  const companyName = chooseBestCompanyName(candidate.companyName, candidate.website, companyNameCandidates);
  return {
    ...candidate,
    companyName,
    summary: [candidate.summary, ...snippets].filter(Boolean).join("\n").slice(0, 5000) || candidate.summary,
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
  const scripts = html.match(/<script\b[^>]*type=["'][^"']*ld\+json[^"']*["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const names: string[] = [];

  for (const script of scripts) {
    const json = decodeHtmlEntities(script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim());
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
    (item) => typeof item === "string" && /^(organization|corporation|localbusiness|professionalservice)$/i.test(item)
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
    text.matchAll(/(?:copyright|©|\(c\))\s*(?:copyright)?\s*(?:©|\(c\))?\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?)?\s+([A-Z][A-Za-z0-9&.,'() -]{2,80})/gi)
  );
  return matches.map((match) => (match[1] ?? "").replace(/\b(?:all rights reserved|privacy policy|terms).*$/i, "").trim());
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

  if (looksLikeBuyerSideCompanyPage(candidate)) {
    return true;
  }

  if (hasAny(text, consumerElectronicsTerms) || looksLikeContentTitle(candidate.companyName)) {
    return false;
  }

  return !looksLikeArticlePath(path) || hasAny(text, buyerRoleTerms);
}

function shouldHardRejectCandidate(candidate: NormalizedLeadCandidate, criteria: IcpScoringCriteria) {
  const domain = candidate.website ? domainFromUrl(candidate.website) : domainFromUrl(candidate.sourceUrl);
  const text = [candidate.companyName, candidate.website, candidate.sourceUrl, candidate.summary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const pageType = classifyCandidatePage(candidate, criteria);

  if (pageType === "own_site" || pageType === "third_party_profile" || pageType === "non_procurement_document") {
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

  if ((looksLikeContentTitle(candidate.companyName) || hasAny(text, hardRejectContentTerms)) && !looksLikeDirectCompanyEvidence(candidate)) {
    return true;
  }

  return false;
}

function isRiskyDiscoveryPage(candidate: NormalizedLeadCandidate) {
  const domain = candidate.website ? domainFromUrl(candidate.website) : domainFromUrl(candidate.sourceUrl);
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
      looksLikeArticlePath(path) ||
      looksLikeContentTitle(candidate.companyName) ||
      hasAny(text, contentNoiseTerms)
  );
}

function looksLikeBuyerSideCompanyPage(candidate: NormalizedLeadCandidate) {
  const domain = candidate.website ? domainFromUrl(candidate.website) : domainFromUrl(candidate.sourceUrl);
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

  if (looksLikeStorefrontPath(path) || isVendorOemDomain(domain)) {
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
    looksLikeCompanyOrDirectoryPath(path) || buyerServicePagePathTerms.some((term) => path.includes(term));
  const hasCompanyIdentity =
    candidate.contacts.some((contact) => contact.type === "email" || contact.type === "phone") ||
    hasAny(text, generalCompanyEntityTerms) ||
    /\b(inc|llc|ltd|limited|corp|corporation|company|group|systems|services)\b/.test(text);

  return serviceOrCompanyPath || hasCompanyIdentity || hasAny(text, genericBuyerPageSignalTerms);
}

function looksLikeDirectCompanyEvidence(candidate: NormalizedLeadCandidate) {
  const domain = candidate.website ? domainFromUrl(candidate.website) : domainFromUrl(candidate.sourceUrl);
  const path = pathFromUrl(candidate.sourceUrl);
  const text = [candidate.companyName, candidate.website, candidate.sourceUrl, candidate.summary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!domain || isBlockedContentDomain(domain) || isBlockedMarketplaceDomain(domain)) {
    return false;
  }

  if (looksLikeArticlePath(path) || looksLikeContentTitle(candidate.companyName)) {
    return false;
  }

  return (
    looksLikeCompanyOrDirectoryPath(path) &&
    (hasAny(text, buyerRoleTerms) || hasAny(text, generalCompanyEntityTerms) || hasTelecomContext(text))
  );
}

function contactProbeUrls(website: string, sourceUrl: string) {
  const urls = new Set<string>();
  try {
    const parsed = new URL(website);
    const origin = parsed.origin;
    urls.add(origin);
    urls.add(website);
    urls.add(sourceUrl);
    for (const path of contactPagePathCandidates(sourceUrl, website)) {
      urls.add(`${origin}${path}`);
    }
    for (const path of ["/about", "/about-us", "/company", "/support", "/sales", "/request-a-quote", "/quote"]) {
      urls.add(`${origin}${path}`);
    }
  } catch {
    urls.add(sourceUrl);
  }

  return [...urls].slice(0, contactProbePageLimit);
}

function contactPagePathCandidates(...urls: string[]) {
  const prefixes = new Set<string>([""]);
  for (const url of urls) {
    const prefix = installBasePathPrefix(url);
    if (prefix) {
      prefixes.add(prefix);
    }
  }
  prefixes.add("/wp");

  const suffixes = [
    "/contact",
    "/contact/",
    "/contact.html",
    "/contact-us",
    "/contact-us/",
    "/contact-us.html",
    "/contacts",
    "/contacts/",
    "/get-in-touch",
    "/get-in-touch/",
    "/get-in-touch-customers",
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
  return uniqueStrings(suffixes.flatMap((suffix) => [...prefixes].map((prefix) => `${prefix}${suffix}`)));
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
        "contact-us",
        "contacts",
        "get-in-touch",
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
  return Promise.all(uniqueStrings(urls).map(async (url) => ({ url, html: await fetchText(url) })));
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
      url.search = "";
      return url.toString();
    });

  return uniqueStrings(urls).slice(0, 12);
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

async function fetchText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), contactProbeTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; LeadHuntAI/0.1 contact enrichment)"
      }
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || (!contentType.includes("text/html") && !contentType.includes("text/plain"))) {
      return "";
    }

    return await response.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
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

function hasTelecomContext(text: string) {
  if (hasAny(text, telecomIndustryTerms)) {
    return true;
  }

  return /\bnetwork\b/.test(text) && hasAny(text, networkTelecomQualifiers);
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

function classifyCandidatePage(candidate: NormalizedLeadCandidate, criteria: IcpScoringCriteria): PageType {
  const domain = candidate.website ? domainFromUrl(candidate.website) : domainFromUrl(candidate.sourceUrl);
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

  if (domain && isBrandOemDomain(domain, criteria)) {
    return "brand_oem_site";
  }

  if (isSupplierOrStorefrontPage(text, path)) {
    return "supplier_or_storefront";
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

function hasProcurementIntent(text: string) {
  if (hasAny(text, strongProcurementIntentTerms)) {
    return true;
  }

  return /\bprocurement\b/i.test(text) && hasAny(text, procurementContextTerms);
}

function isSupplierOrStorefrontPage(text: string, path: string) {
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

function assessPageQuality(
  candidate: NormalizedLeadCandidate,
  criteria: IcpScoringCriteria,
  pageType = classifyCandidatePage(candidate, criteria)
): PageQualityAssessment {
  const domain = candidate.website ? domainFromUrl(candidate.website) : domainFromUrl(candidate.sourceUrl);
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
  const hasDirectContact = candidate.contacts.some((contact) => contact.type === "email" || contact.type === "phone");
  const hasDirectCompanyEvidence = looksLikeDirectCompanyEvidence(candidate);
  const buyerServicePage = looksLikeBuyerSideCompanyPage(candidate);

  if (pageType === "own_site") {
    negativeScore += 80;
    risks.push("Search result is from the user's own product website");
  }

  if (pageType === "third_party_profile") {
    negativeScore += 50;
    risks.push("Search result is a third-party company profile; use it only as evidence to find the official buyer site");
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
    reasons.push("Search result looks like procurement, tender, RFQ, or vendor-registration evidence");
  }

  if (pageType === "non_procurement_document") {
    negativeScore += 42;
    risks.push("Search result is a non-procurement document such as a brochure, paper, datasheet, or manual");
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
    risks.push("Search result is about consumer phone accessories or retail electronics, not telecom infrastructure");
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
    risks.push("Search result is a document, brochure, or catalog; keeping it for scoring instead of auto-skipping");
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

  const hasContentNoise = looksLikeArticlePath(path) || hasAny(text, contentNoiseTerms);
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
  if (domain.endsWith(".edu") || domain.endsWith(".gov")) {
    return true;
  }

  return blockedContentDomains.some((blockedDomain) => domain === blockedDomain || domain.endsWith(`.${blockedDomain}`));
}

function isBlockedMarketplaceDomain(domain: string) {
  return blockedMarketplaceDomains.some(
    (blockedDomain) => domain === blockedDomain || domain.endsWith(`.${blockedDomain}`)
  );
}

function isHardRejectedDiscoveryDomain(domain: string) {
  if (domain.endsWith(".edu") || domain.endsWith(".gov")) {
    return true;
  }

  return hardRejectedDiscoveryDomains.some((blockedDomain) => domain === blockedDomain || domain.endsWith(`.${blockedDomain}`));
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

function looksLikeDocumentPath(path: string) {
  return /\.(?:pdf|xls|xlsx|csv|doc|docx|ppt|pptx)$/i.test(path);
}

function looksLikeStorefrontPath(path: string) {
  if (!path) {
    return false;
  }

  return /\/(?:product(?:s)?|catalog(?:ue|s)?|category(?:ies)?|collection(?:s)?|shop|store|cart|checkout|item(?:s)?|sku)\b/.test(path);
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
        return item.split(String.fromCharCode(0)).join("");
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

const storefrontAccountTerms = [
  "login",
  "register",
  "sign in",
  "sign up"
];

const storefrontPriceTerms = [
  "price",
  "pricing",
  "price list",
  "in stock"
];

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
  "yxfiber-sfp.com"
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
  "yello.ae"
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
  "uaeplusplus.com"
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

const contentNoiseTerms = [
  "article",
  "blog",
  "news",
  "press release",
  "market report",
  "industry report",
  "research report",
  "forecast",
  "market size",
  "market share",
  "top startups",
  "startup database",
  "company database",
  "mou targets",
  "marketplace",
  "supplier directory",
  "yellow pages",
  "company directory",
  "trade directory",
  "b2b marketplace",
  "manufacturers and suppliers",
  "wholesale suppliers",
  "category",
  "catalog",
  "technology indicator",
  "market indicator",
  "business strategies",
  "import export data",
  "shipment details",
  "showroom",
  "what is",
  "how to",
  "guide to",
  "case study",
  "white paper",
  "state act",
  "commission restricts",
  "regulation",
  "interim assessment",
  "damages to telecommunication infrastructure",
  "inventory management",
  "software tools",
  "management system",
  "deployment challenges",
  "forum",
  "discussion board",
  "types, challenges",
  "tips",
  "application note",
  "product application",
  "how to buy",
  "commodity",
  "maintenance & repair",
  "truck spare parts",
  "key component",
  "signal transmission",
  "lightning protection",
  "what are",
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
  "how to",
  "guide",
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
  "product details"
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
  hctgroup: "HCT Group",
  ispsupplies: "ISP Supplies",
  mfcomm: "MF Communications",
  screamerelectronicservices: "Screamer Electronic Services",
  tempestns: "Tempest"
};

const domainAcronymTerms = new Set(["isp", "hct", "ats", "mf", "usa", "uk", "uae"]);

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
  "business",
  "distribution",
  "products",
  "services",
  "category",
  "catalog",
  "listing",
  "telecom",
  "telecommunications"
];

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
  americas: ["United States", "Canada", "Mexico", "Brazil", "Chile", "Colombia", "Peru", "Argentina"],
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
  [".bh", "BAHRAIN"]
];
