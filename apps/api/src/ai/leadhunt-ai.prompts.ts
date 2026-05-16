export type LeadHuntPromptTemplate = {
  title: string;
  instruction: string;
  outputShape: unknown;
};

export const leadHuntSystemPrompt = [
  "You are LeadHunt AI, a B2B export sales intelligence analyst for any export company.",
  "Use only the provided input. If evidence is limited, mark confidence lower instead of inventing facts.",
  "Return valid JSON only. Do not include Markdown, comments, explanations, or code fences."
].join("\n");

export const leadHuntPromptTemplates = {
  productProfileAnalysis: {
    title: "Product profile analysis",
    instruction:
      "Analyze the seller's product information for outbound prospecting across any B2B industry. Focus on product categories, key SKUs or specifications, use cases, buyer pain points, supply capabilities, and practical search keywords.",
    outputShape: {
      brandName: "string",
      websiteUrl: "valid URL",
      productCategories: ["string"],
      keyProducts: ["string"],
      targetUseCases: ["string"],
      buyerPainPoints: ["string"],
      supplyCapabilities: ["string"],
      searchKeywords: ["at least 5 strings"],
      negativeKeywords: ["string"],
      confidence: "number between 0 and 1",
      evidence: ["string"]
    }
  },
  customerProfileAnalysis: {
    title: "Reference customer profile analysis",
    instruction:
      "Analyze target regions and reference customer websites. Identify ideal customer types, buying signals, industries, search keywords, and disqualifiers for ICP matching.",
    outputShape: {
      targetRegions: ["string"],
      idealCustomerTypes: ["string"],
      buyingSignals: ["string"],
      referenceCompanies: ["string"],
      industries: ["string"],
      searchKeywords: ["at least 5 strings"],
      disqualifiers: ["string"],
      confidence: "number between 0 and 1",
      evidence: ["string"]
    }
  },
  keywordExpansion: {
    title: "Keyword expansion",
    instruction:
      "Expand the user's task into structured keyword groups for Brave Search across any B2B industry. Include product terms, buyer intent terms, target market terms, application/scenario terms, and exclusions.",
    outputShape: {
      primaryProducts: ["string"],
      relatedProducts: ["string"],
      longTailProducts: ["string"],
      upstreamDownstreamTerms: ["string"],
      purchaseIntentTerms: ["string"],
      targetMarketTerms: ["string"],
      industryScenarioTerms: ["string"],
      exclusionTerms: ["string"]
    }
  },
  searchStrategyGeneration: {
    title: "Search strategy generation",
    instruction:
      [
        "Generate at least 15 Brave-compatible B2B prospecting search queries from the current product evidence. Product evidence may come from the user prompt, saved product profile, website content, uploaded files, product lists, CRM samples, historical tasks, or manual notes. Do not assume the seller has a website and do not assume the industry is telecom.",
        "Core goal: do not simply search for who sells the same product. Infer who would realistically use, maintain, repair, replace, install, integrate, procure, import, distribute, tender for, or resell the product.",
        "First build a product search matrix from the available evidence: productCategory, productType, coreProducts, modelTerms, priorityModelTerms, brandTerms, productGroups, applicationScenarios, demandTriggers, likelyBuyerTypes, channelTypes, and badTargets. If evidence is thin, infer cautiously from product category instead of inventing exact SKUs.",
        "Model/SKU handling: when many models exist, do not default to evenly generating many queries for every model. Cluster models into productGroups first. Select priority models only when they are mentioned by the user, marked as main/hot/in-stock/high-value, shown on the homepage or key category, representative of a group, or present in CRM history. Non-priority models should inform product understanding but should not each receive their own query by default. If the user explicitly asks to search every model, keep it batched and generate only 1-3 buyer-intent queries per model.",
        "Search matrix types: buyer_scenario, product_group, brand_ecosystem, model_specific, procurement_event, channel. Default mix: buyer_scenario 35%, product_group 25%, brand_ecosystem 15%, procurement_event 15%, model_specific 10%, channel 0-10%. If only a short product description is available, use buyer_scenario 45%, product_group 30%, procurement_event 15%, channel 10%, model_specific 0%. If the user asks for channel customers, raise channel to 30-40%. If the user asks for end buyers, reduce channel to 0-10%.",
        "Every query must contain buyer-side intent plus a product clue plus exactly one target market plus a contact/procurement/RFQ/tender/vendor-registration entry point. Buyer-side intent includes use, maintain, repair, replace, operate, install, integrate, procure, import, distribute, tender, or resell depending on the task.",
        "Good generic patterns: \"[application scenario]\" [country] contact; \"[product group] maintenance\" [country] contact; \"[brand ecosystem]\" [country] integrator contact; \"[product category]\" [country] RFQ; \"[product category] distributor\" [country] contact when channel customers are allowed; \"[model]\" replacement [country] contact only when the model is a priority model.",
        "Bad query patterns: SKU-only, product-only, supplier-only, manufacturer-only, price, datasheet, manual, buy now, marketplace, market report, encyclopedia, jobs, training, course, mixed-country query, or a country field that is a long phrase. Bad examples: \"Huawei MA5800 Canada supplier price datasheet\"; \"industrial pump datasheet Australia\"; \"Canada telecom equipment distributor\" as country; site:.ru Russia \"UAE\".",
        "The country field is a geographic routing field for Brave Search. It MUST be exactly one of the provided targetMarkets values. It is not a customer type, industry label, or long-tail keyword. Each query text must mention only that same country/market. User prompt target markets override saved profile regions; profile regions are weak defaults only.",
        "Keep each query concise: target length <= 120 characters, max one OR group, max three OR terms in that group, max three negative terms. Do not add repeated negatives such as -job and -jobs together. Choose negatives by query type instead of mechanically repeating every exclusion.",
        "Use only supported or experimental operators for automated execution. Do not use site:.xx unless the TLD matches the country field. Avoid broad marketplace, directory, report, article, encyclopedia, price, datasheet, PDF, job, course, or supplier-manufacturer discovery unless explicitly requested."
      ].join(" "),
    outputShape: {
      evidenceSummary: {
        availableSources: ["string"],
        missingSources: ["string"],
        confidence: "number between 0 and 1"
      },
      productUnderstanding: {
        productCategory: "string",
        productType: "equipment | spare_parts | raw_materials | consumables | machinery | software | service | components | finished_goods | unknown",
        coreProducts: ["string"],
        modelTerms: ["string"],
        priorityModelTerms: ["string"],
        brandTerms: ["string"],
        productGroups: ["string"],
        applicationScenarios: ["string"],
        demandTriggers: ["string"],
        likelyBuyerTypes: ["string"],
        channelTypes: ["string"],
        badTargets: ["string"]
      },
      strategyMix: {
        buyerScenario: "integer percentage",
        productGroup: "integer percentage",
        brandEcosystem: "integer percentage",
        modelSpecific: "integer percentage",
        procurementEvent: "integer percentage",
        channel: "integer percentage"
      },
      queries: [
        {
          query: "string",
          country: "one exact value from input.targetMarkets, e.g. Canada",
          language: "language code",
          operatorSource: "google_official | brave_official | common_seo",
          executionStatus: "supported | experimental | manual_only | disabled",
          rationale: "string",
          strategyType: "buyer_scenario | product_group | brand_ecosystem | model_specific | procurement_event | channel",
          sourceEvidence: "user_prompt | product_profile | website | product_list | crm_sample | inferred",
          buyerIntent: "string",
          negativeTerms: ["string"],
          priority: "integer 1-5"
        }
      ],
      rejectedIdeas: [
        {
          badQueryIdea: "string",
          reason: "string"
        }
      ]
    }
  },
  candidateBuyerEvaluation: {
    title: "Candidate buyer evaluation",
    instruction:
      "Evaluate whether one search result is a real potential B2B buyer for the seller's product. Distinguish target buyers from competitors/suppliers, directories, articles, market reports, job pages, and irrelevant pages. Do not invent evidence. If evidence is weak but the company may be relevant, choose review instead of qualified.",
    outputShape: {
      companyName: "string",
      websiteUrl: "string",
      resultType:
        "target_buyer | possible_buyer | supplier_or_competitor | directory | content_article | job_page | market_report | irrelevant | unknown",
      buyerType: "string such as telecom system integrator, tower maintenance company, operator procurement, stockist, unknown",
      fitScore: "integer 0-100",
      confidence: "number between 0 and 1",
      decision: "qualified | review | reject",
      matchedSignals: ["string"],
      risks: ["string"]
    }
  },
  icpScoring: {
    title: "ICP scoring",
    instruction:
      "Score one candidate company against the product profile and customer profile. Reward industry relevance, buyer type, product match, target region, and contact completeness. Penalize weak evidence and irrelevant sectors.",
    outputShape: {
      companyName: "string",
      websiteUrl: "valid URL",
      score: "integer 0-100",
      fitLevel: "high | medium | low",
      reasons: ["string"],
      risks: ["string"],
      recommendedAction: "approve | review | reject",
      extractedContacts: {
        emails: ["string"],
        phones: ["string"],
        socialProfiles: ["string"]
      }
    }
  },
  outreachEmailGeneration: {
    title: "Outreach email generation",
    instruction:
      "Generate a concise B2B outreach email for a prospect. Personalize using the candidate and product fit, avoid exaggerated claims, and keep it suitable for Gmail sending after human review.",
    outputShape: {
      subject: "string",
      body: "string",
      language: "string",
      tone: "string",
      personalizationNotes: ["string"],
      complianceNotes: ["string"]
    }
  },
  emailRewrite: {
    title: "AI email rewrite",
    instruction:
      "Rewrite the provided email according to the requested language, tone, and change instructions. Preserve factual meaning and avoid adding unverifiable claims.",
    outputShape: {
      subject: "optional string",
      body: "string",
      changes: ["string"]
    }
  },
  replyClassification: {
    title: "Reply classification",
    instruction:
      "Classify the prospect reply for follow-up routing. Distinguish interest, quote requests, catalog requests, rejection, unsubscribe, auto-reply, and other replies.",
    outputShape: {
      category:
        "interested | request_quote | request_catalog | rejection | unsubscribe | auto_reply | other",
      sentiment: "positive | neutral | negative",
      confidence: "number between 0 and 1",
      summary: "string",
      nextAction: "string"
    }
  },
  taskSummary: {
    title: "Task summary",
    instruction:
      "Summarize an AI foreign trade task in plain business terms: actions completed, companies found, qualified companies, key findings, next steps, and risks.",
    outputShape: {
      completedActions: ["string"],
      foundCompanies: "integer",
      qualifiedCompanies: "integer",
      keyFindings: ["string"],
      nextSteps: ["string"],
      risks: ["string"]
    }
  }
} satisfies Record<string, LeadHuntPromptTemplate>;

export function buildJsonPrompt(template: LeadHuntPromptTemplate, input: unknown) {
  return [
    `Task: ${template.title}`,
    "",
    template.instruction,
    "",
    "Required JSON shape:",
    JSON.stringify(template.outputShape, null, 2),
    "",
    "Input:",
    JSON.stringify(input, null, 2)
  ].join("\n");
}
