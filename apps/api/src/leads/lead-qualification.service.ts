import { Inject, Injectable } from "@nestjs/common";
import { countryToSite, inferCountryFromText, normalizeCountryName } from "@leadhunt/agent";
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
};

export type NormalizedLeadCandidate = {
  taskId: string;
  companyName: string;
  website: string | null;
  country: string | null;
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
  status: "qualified" | "review" | "rejected";
};

export type CandidateBuyerEvaluation = {
  companyName: string;
  websiteUrl: string;
  resultType:
    | "target_buyer"
    | "possible_buyer"
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

const contactProbeTimeoutMs = 3500;
const contactProbePageLimit = 6;
const contactLinkedProbePageLimit = 4;
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
    const pageQuality = assessPageQuality(candidate, criteria);
    const hasTelecomContextSignal = hasTelecomContext(text);
    const hasSpecificProductSignal =
      hasAny(text, specificTelecomProductTerms) || hasAny(text, criteria.productKeywords.filter(isSpecificProductTerm));
    const hasTargetCustomerType = hasAny(text, criteria.customerTypeKeywords);
    const hasUseCaseCustomerSignal = hasAny(text, buyerUseCaseTerms);
    const hasBuyerRoleSignal = hasAny(text, buyerRoleTerms) || hasUseCaseCustomerSignal || hasTargetCustomerType;

    score += pageQuality.scoreAdjustment;
    reasons.push(...pageQuality.reasons);
    risks.push(...pageQuality.risks);

    if (hasTelecomContextSignal) {
      score += 20;
      reasons.push("Matches telecom infrastructure context");
    }

    if (hasSpecificProductSignal) {
      score += 20;
      reasons.push("Mentions relevant product keywords");
    } else if (hasAny(text, criteria.productKeywords)) {
      score += 10;
      risks.push("Only generic product wording found; no explicit telecom equipment category");
    }

    if (hasTargetCustomerType) {
      score += 20;
      reasons.push("Matches target customer type");
    }

    if (hasUseCaseCustomerSignal) {
      score += 12;
      reasons.push("Matches maintenance, operator, tower, power, ISP, or field-service buyer scenario");
    }

    if (candidate.country && matchesTargetRegion(candidate.country, criteria.targetRegions)) {
      score += 15;
      reasons.push("Located in target market");
    } else if (hasAny(text, criteria.targetRegions)) {
      score += 10;
      reasons.push("Mentions target market");
    } else if (candidate.country && criteria.targetRegions.length && !hasMacroTargetRegion(criteria.targetRegions)) {
      score -= 10;
      risks.push("Country does not match the selected target markets");
    } else if (criteria.targetRegions.length && !hasMacroTargetRegion(criteria.targetRegions)) {
      risks.push("Target market is not confirmed from the search result");
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

    if (!hasSpecificProductSignal && hasAny(text, genericItServiceTerms)) {
      score = Math.min(score, 74);
      risks.push("Only generic IT/network service signal; no explicit telecom equipment signal");
    }

    if (!hasSpecificProductSignal && !(hasBuyerRoleSignal && hasTelecomContextSignal)) {
      score = Math.min(score, 64);
      risks.push("No clear telecom equipment buyer, distributor, integrator, or maintenance signal");
    }

    const hasDirectContact = candidate.contacts.some((contact) => contact.type === "email" || contact.type === "phone");
    const riskyDiscoveryPage = isRiskyDiscoveryPage(candidate);
    const targetCountryMismatch = Boolean(
      candidate.country &&
        criteria.targetRegions.length &&
        !hasMacroTargetRegion(criteria.targetRegions) &&
        !matchesTargetRegion(candidate.country, criteria.targetRegions)
    );

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
    }

    if (targetCountryMismatch) {
      score = Math.min(score, 74);
      risks.push("Candidate country is outside the selected target markets; kept for ICP review");
    }

    const finalScore = clamp(Math.round(score), 0, 100);
    const grade = finalScore >= 75 ? "high" : finalScore >= 50 ? "medium" : "low";
    const status = finalScore >= 75 ? "qualified" : finalScore >= 50 ? "review" : "rejected";

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
      const key = candidateKey(candidate);
      const emailKeys = candidate.contacts
        .filter((contact) => contact.type === "email")
        .map((contact) => `email:${contact.value.toLowerCase()}`);
      const existingLead = existingLeadByKey.get(key) ?? emailKeys.map((emailKey) => existingLeadByKey.get(emailKey)).find(Boolean);
      if (existingLead) {
        if (shouldProbeContactPages(candidate)) {
          const enrichedExistingCandidate = await enrichCandidateContacts({
            ...candidate,
            contacts: mergeExistingContacts(candidate.contacts, existingLead.contacts)
          });
          const missingContacts = missingExistingContacts(existingLead.contacts, enrichedExistingCandidate.contacts);
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
        }
        skipped += 1;
        continue;
      }

      const canProbeContact = shouldProbeContactPages(candidate);
      const enrichedCandidate = canProbeContact ? await enrichCandidateContacts(candidate) : candidate;
      const enrichedEmailKeys = enrichedCandidate.contacts
        .filter((contact) => contact.type === "email")
        .map((contact) => `email:${contact.value.toLowerCase()}`);
      const enrichedExistingLead = enrichedEmailKeys
        .map((emailKey) => existingLeadByKey.get(emailKey))
        .find(Boolean);
      if (enrichedExistingLead) {
        const missingContacts = missingExistingContacts(enrichedExistingLead.contacts, enrichedCandidate.contacts);
        if (missingContacts.length) {
          await this.prisma.leadContact.createMany({
            data: missingContacts.map((contact) => ({
              leadId: enrichedExistingLead.id,
              type: contact.type,
              value: contact.value,
              sourceUrl: contact.sourceUrl
            }))
          });
          enrichedExistingLead.contacts.push(...missingContacts);
          for (const contact of missingContacts) {
            existingKeys.add(contactKey(contact));
            existingLeadByKey.set(contactKey(contact), enrichedExistingLead);
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
          country: enrichedCandidate.country,
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
      for (const emailKey of enrichedEmailKeys) {
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
  if (ruleIcp.score >= 50) {
    return true;
  }

  if (ruleIcp.score < 35 || isRiskyDiscoveryPage(candidate)) {
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
    hasTelecomContext(text) &&
    (hasAny(text, buyerRoleTerms) ||
      hasAny(text, buyerUseCaseTerms) ||
      hasAny(text, criteria.customerTypeKeywords) ||
      hasAny(text, specificTelecomProductTerms) ||
      hasAny(text, criteria.productKeywords.filter(isSpecificProductTerm)));

  return hasDirectContact || hasBuyerOrProductSignal;
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
  const rejectTypes = new Set(["directory", "content_article", "job_page", "market_report", "irrelevant"]);

  if (rejectTypes.has(ai.resultType)) {
    score = Math.min(score, 44);
  } else if (ai.resultType === "supplier_or_competitor") {
    score = Math.min(score, 64);
  } else if (ai.decision === "reject") {
    score = Math.min(score, 49);
  } else if (ai.resultType === "target_buyer" && ai.decision === "qualified" && ai.confidence >= 0.72) {
    score = Math.max(score, 75);
  }

  const finalScore = clamp(score, 0, 100);
  const status = finalScore >= 75 ? "qualified" : finalScore >= 50 ? "review" : "rejected";
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
      ? ["AI marked this result as supplier or competitor; keep for review only"]
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

  return {
    taskId: options.taskId,
    companyName: extractCompanyName(result.title, result.url),
    website,
    country: inferCountry(fullText) ?? defaultCountryForCandidate(options.defaultCountry, sourceUrl, fullText),
    sourceUrl,
    summary: result.snippet || null,
    contacts: extractContacts(fullText, sourceUrl)
  };
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
  const parts = title
    .split(/\s(?:[-–—|:»]\s)+|\s[|]\s/)
    .map((part) => cleanupCompanyName(part))
    .filter(Boolean);
  const selected = parts.find((part) => !isGenericTitle(part));

  return selected || companyFromDomain(url) || "Unknown Company";
}

function cleanupCompanyName(value: string) {
  return value
    .replace(/\b(home|official site|website|about us|contact us)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericTitle(value: string) {
  const lower = value.toLowerCase();
  return (
    genericExactTitleTerms.some((term) => lower === term) ||
    genericTitleTerms.some((term) => lower === term || lower.includes(term))
  );
}

function companyFromDomain(url: string) {
  const domain = domainFromUrl(url);
  if (!domain) {
    return null;
  }

  const label = domain.split(".")[0] ?? domain;
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
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

function defaultCountryForCandidate(country: string | undefined, sourceUrl: string, fullText: string) {
  if (!country || isMacroTargetRegion(country)) {
    return null;
  }

  const domain = domainFromUrl(sourceUrl);
  const text = fullText.toLowerCase();
  if (
    (domain && (isBlockedContentDomain(domain) || isBlockedMarketplaceDomain(domain))) ||
    (looksLikeArticlePath(pathFromUrl(sourceUrl)) && !hasAny(text, buyerRoleTerms))
  ) {
    return null;
  }

  const targetSite = countryToSite(country).toLowerCase();
  if (domain && targetSite !== ".com" && (domain === targetSite.slice(1) || domain.endsWith(targetSite))) {
    return normalizeCountry(country);
  }

  return null;
}

function extractContacts(text: string, sourceUrl: string): NormalizedLeadCandidate["contacts"] {
  const contacts = [
    ...extractEmails(text).map((value) => ({ type: "email" as const, value, sourceUrl })),
    ...extractPhones(text).map((value) => ({ type: "phone" as const, value, sourceUrl })),
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

function extractEmails(text: string) {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return matches
    .map((email) => email.replace(/[),.;:]+$/g, "").toLowerCase())
    .filter((email) => !email.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i));
}

function extractPhones(text: string) {
  const matches = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? [];
  return matches
    .map((phone) => phone.replace(/\s+/g, " ").trim())
    .filter((phone) => !/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(phone))
    .filter((phone) => !/(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}/.test(phone))
    .filter((phone) => (phone.match(/\(/g)?.length ?? 0) === ((phone.match(/\)/g)?.length ?? 0)))
    .filter((phone) => {
      const digits = phone.replace(/\D/g, "");
      const hasCountryPrefix = phone.trim().startsWith("+");
      return digits.length <= 16 && (hasCountryPrefix ? digits.length >= 8 : digits.length >= 10);
    });
}

function extractSocialUrls(text: string) {
  const matches =
    text.match(/https?:\/\/(?:www\.)?(?:linkedin\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|wa\.me)\/[^\s),]+/gi) ??
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
  const pages = await fetchProbePages(urls);
  const linkedUrls: string[] = [];

  for (const { url, html } of pages) {
    if (!html) {
      continue;
    }
    const text = htmlToSearchableText(html).slice(0, 20000);
    snippets.push(text.slice(0, 800));
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
    contacts.push(...extractContacts(text, url));
  }

  return {
    ...candidate,
    summary: [candidate.summary, ...snippets].filter(Boolean).join("\n").slice(0, 5000) || candidate.summary,
    contacts: dedupeContacts(contacts)
  };
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

  if (hasAny(text, consumerElectronicsTerms) || looksLikeContentTitle(candidate.companyName)) {
    return false;
  }

  return !looksLikeArticlePath(path) || hasAny(text, buyerRoleTerms);
}

function isRiskyDiscoveryPage(candidate: NormalizedLeadCandidate) {
  const domain = candidate.website ? domainFromUrl(candidate.website) : domainFromUrl(candidate.sourceUrl);
  const path = pathFromUrl(candidate.sourceUrl);
  const text = [candidate.companyName, candidate.website, candidate.sourceUrl, candidate.summary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return Boolean(
    (domain && (isBlockedContentDomain(domain) || isBlockedMarketplaceDomain(domain))) ||
      looksLikeArticlePath(path) ||
      looksLikeContentTitle(candidate.companyName) ||
      hasAny(text, contentNoiseTerms)
  );
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
    for (const path of contactPagePathCandidates(sourceUrl, website)) {
      urls.add(`${origin}${path}`);
    }
    urls.add(sourceUrl);
    urls.add(website);
    for (const path of ["/about", "/about-us", "/company", "/support"]) {
      urls.add(`${origin}${path}`);
    }
  } catch {
    urls.add(sourceUrl);
  }

  return [...urls].slice(0, contactProbePageLimit);
}

function contactPagePathCandidates(...urls: string[]) {
  const prefixes = new Set<string>([""]);
  prefixes.add("/wp");
  for (const url of urls) {
    const prefix = installBasePathPrefix(url);
    if (prefix) {
      prefixes.add(prefix);
    }
  }

  const suffixes = ["/contact", "/contact/", "/contact-us", "/contact-us/"];
  return uniqueStrings([...prefixes].flatMap((prefix) => suffixes.map((suffix) => `${prefix}${suffix}`)));
}

function installBasePathPrefix(url: string) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const firstSegment = segments[0];
    if (!firstSegment || firstSegment.includes(".") || firstSegment.length > 24) {
      return "";
    }

    if (["contact", "contact-us", "about", "about-us", "company", "support"].includes(firstSegment.toLowerCase())) {
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
        path.includes("contact") &&
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
  if (hasMacroTargetRegion(targetRegions)) {
    return true;
  }

  const normalized = country.toLowerCase();
  return targetRegions.some((region) => normalizeCountry(region).toLowerCase() === normalized);
}

function hasMacroTargetRegion(targetRegions: string[]) {
  return targetRegions.some(isMacroTargetRegion);
}

function isMacroTargetRegion(region: string) {
  return macroTargetRegions.has(region.trim().toLowerCase());
}

function assessPageQuality(
  candidate: NormalizedLeadCandidate,
  criteria: IcpScoringCriteria
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

  if (domain && isBlockedContentDomain(domain)) {
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

  if (isDocument) {
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
    negativeScore += isDocument ? 16 : 28;
    risks.push("Search result looks like article, report, job, training, or media content");
  }

  if (looksLikeContentTitle(candidate.companyName)) {
    negativeScore += 24;
    risks.push("Search result is an article/list page, not a direct company lead");
  }

  if (hasContentNoise && !hasAny(text, buyerRoleTerms) && !isDocument) {
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
        return item.replace(/\u0000/g, "");
      }

      return item;
    })
  ) as Prisma.InputJsonValue;
}

const telecomIndustryTerms = [
  "telecom",
  "telecommunication",
  "wireless",
  "4g",
  "5g",
  "fiber",
  "microwave",
  "tower",
  "ibs",
  "base station",
  "radio access",
  "ran equipment",
  "mobile operator",
  "carrier network"
];

const networkTelecomQualifiers = [
  "telecom",
  "telecommunication",
  "wireless",
  "mobile",
  "carrier",
  "operator",
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
  "towerco",
  "cell tower services",
  "wireless infrastructure contractor",
  "telecom power maintenance",
  "cell site power",
  "rectifier replacement",
  "mobile network operator",
  "network operator",
  "isp network operations",
  "wisp",
  "ftth operator",
  "fiber network operator",
  "telecom equipment distributor",
  "distributor",
  "stockist",
  "reseller",
  "importer",
  "system integrator",
  "telecom system integrator",
  "telecom contractor",
  "network contractor",
  "tower contractor",
  "turnkey contractor",
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
  "towerco",
  "cell tower services",
  "wireless infrastructure contractor",
  "telecom power maintenance",
  "cell site power",
  "rectifier replacement",
  "mobile network operator",
  "telecom operator",
  "network operator",
  "isp network operations",
  "wisp",
  "ftth operator",
  "fiber network operator",
  "equipment repair",
  "repair service",
  "reverse logistics",
  "spare parts management"
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

const genericTitleTerms = [
  "telecom equipment",
  "telecom distributor",
  "equipment distributor",
  "stockist",
  "supplier",
  "system integrator",
  "contractor",
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
