import { z } from "zod";

export const productProfileAnalysisSchema = z.object({
  brandName: z.string().min(1),
  websiteUrl: z.string().url(),
  productCategories: z.array(z.string().min(1)).min(1),
  keyProducts: z.array(z.string().min(1)).min(1),
  targetUseCases: z.array(z.string().min(1)).min(1),
  buyerPainPoints: z.array(z.string().min(1)).min(1),
  supplyCapabilities: z.array(z.string().min(1)).min(1),
  searchKeywords: z.array(z.string().min(1)).min(5),
  negativeKeywords: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1)).default([])
});

export const customerProfileAnalysisSchema = z.object({
  targetRegions: z.array(z.string().min(1)).min(1),
  idealCustomerTypes: z.array(z.string().min(1)).min(1),
  buyingSignals: z.array(z.string().min(1)).min(1),
  referenceCompanies: z.array(z.string().min(1)).default([]),
  industries: z.array(z.string().min(1)).min(1),
  searchKeywords: z.array(z.string().min(1)).min(5),
  disqualifiers: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1)).default([])
});

export const keywordExpansionSchema = z.object({
  primaryProducts: z.array(z.string().min(1)).min(1),
  relatedProducts: z.array(z.string().min(1)).min(1),
  longTailProducts: z.array(z.string().min(1)).min(1),
  upstreamDownstreamTerms: z.array(z.string().min(1)).min(1),
  purchaseIntentTerms: z.array(z.string().min(1)).min(1),
  targetMarketTerms: z.array(z.string().min(1)).min(1),
  industryScenarioTerms: z.array(z.string().min(1)).min(1),
  exclusionTerms: z.array(z.string().min(1)).default([])
});

export const searchStrategyPlanSchema = z.object({
  evidenceSummary: z
    .object({
      availableSources: z.array(z.string().min(1)).default([]),
      missingSources: z.array(z.string().min(1)).default([]),
      confidence: z.number().min(0).max(1).default(0.5)
    })
    .optional(),
  productUnderstanding: z
    .object({
      productCategory: z.string().optional(),
      productType: z.string().optional(),
      coreProducts: z.array(z.string()).default([]),
      modelTerms: z.array(z.string()).default([]),
      priorityModelTerms: z.array(z.string()).default([]),
      brandTerms: z.array(z.string()).default([]),
      productGroups: z.array(z.string()).default([]),
      applicationScenarios: z.array(z.string()).default([]),
      demandTriggers: z.array(z.string()).default([]),
      likelyBuyerTypes: z.array(z.string()).default([]),
      channelTypes: z.array(z.string()).default([]),
      badTargets: z.array(z.string()).default([])
    })
    .optional(),
  strategyMix: z
    .object({
      buyerScenario: z.number().int().min(0).max(100).default(0),
      productGroup: z.number().int().min(0).max(100).default(0),
      brandEcosystem: z.number().int().min(0).max(100).default(0),
      modelSpecific: z.number().int().min(0).max(100).default(0),
      procurementEvent: z.number().int().min(0).max(100).default(0),
      channel: z.number().int().min(0).max(100).default(0)
    })
    .optional(),
  queries: z
    .array(
      z.object({
        query: z.string().min(1),
        country: z.string().min(2),
        language: z.string().min(2).default("en"),
        operatorSource: z
          .enum(["google_official", "brave_official", "common_seo"])
          .default("brave_official"),
        executionStatus: z.enum(["supported", "experimental"]).default("supported"),
        rationale: z.string().min(1).default("buyer-led profile query"),
        strategyType: z
          .enum(["buyer_scenario", "product_group", "brand_ecosystem", "model_specific", "procurement_event", "channel"])
          .optional(),
        sourceEvidence: z.enum(["user_prompt", "product_profile", "website", "product_list", "crm_sample", "inferred"]).optional(),
        buyerIntent: z.string().optional(),
        productEvidence: z.array(z.string().min(1)).default([]),
        customerEvidence: z.array(z.string().min(1)).default([]),
        negativeTerms: z.array(z.string()).default([]),
        priority: z.number().int().min(1).max(5).default(3)
      })
    )
    .min(10),
  rejectedIdeas: z
    .array(
      z.object({
        badQueryIdea: z.string().min(1),
        reason: z.string().min(1)
      })
    )
    .default([])
});

export const icpScoreSchema = z.object({
  companyName: z.string().min(1),
  websiteUrl: z.string().url(),
  score: z.number().int().min(0).max(100),
  fitLevel: z.enum(["high", "medium", "low"]),
  reasons: z.array(z.string().min(1)).min(1),
  risks: z.array(z.string().min(1)).default([]),
  recommendedAction: z.enum(["approve", "review", "reject"]),
  extractedContacts: z
    .object({
      emails: z.array(z.string()).default([]),
      phones: z.array(z.string()).default([]),
      socialProfiles: z.array(z.string()).default([])
    })
    .default({ emails: [], phones: [], socialProfiles: [] })
});

export const candidateBuyerEvaluationSchema = z.object({
  companyName: z.string().min(1),
  websiteUrl: z.string().min(1),
  resultType: z.enum([
    "target_buyer",
    "possible_buyer",
    "procurement_intelligence",
    "supplier_or_competitor",
    "directory",
    "content_article",
    "job_page",
    "market_report",
    "irrelevant",
    "unknown"
  ]),
  buyerType: z.string().default("unknown"),
  fitScore: z.number().int().min(0).max(100),
  confidence: z.number().min(0).max(1),
  decision: z.enum(["qualified", "review", "reject"]),
  matchedSignals: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([])
});

export const outreachEmailSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  language: z.string().min(1),
  tone: z.string().min(1),
  personalizationNotes: z.array(z.string().min(1)).default([]),
  complianceNotes: z.array(z.string().min(1)).default([])
});

export const rewriteEmailSchema = z.object({
  subject: z.string().optional(),
  body: z.string().min(1),
  changes: z.array(z.string().min(1)).default([])
});

export const replyClassificationSchema = z.object({
  category: z.enum([
    "interested",
    "request_quote",
    "request_catalog",
    "rejection",
    "unsubscribe",
    "auto_reply",
    "other"
  ]),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1),
  nextAction: z.string().min(1)
});

export const taskSummarySchema = z.object({
  completedActions: z.array(z.string().min(1)).min(1),
  foundCompanies: z.number().int().min(0),
  qualifiedCompanies: z.number().int().min(0),
  keyFindings: z.array(z.string().min(1)).default([]),
  nextSteps: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([])
});

export type ProductProfileAnalysis = z.infer<typeof productProfileAnalysisSchema>;
export type CustomerProfileAnalysis = z.infer<typeof customerProfileAnalysisSchema>;
export type KeywordExpansionResult = z.infer<typeof keywordExpansionSchema>;
export type SearchStrategyPlan = z.infer<typeof searchStrategyPlanSchema>;
export type IcpScoreResult = z.infer<typeof icpScoreSchema>;
export type CandidateBuyerEvaluationResult = z.infer<typeof candidateBuyerEvaluationSchema>;
export type OutreachEmailResult = z.infer<typeof outreachEmailSchema>;
export type RewriteEmailResult = z.infer<typeof rewriteEmailSchema>;
export type ReplyClassificationResult = z.infer<typeof replyClassificationSchema>;
export type TaskSummaryResult = z.infer<typeof taskSummarySchema>;
