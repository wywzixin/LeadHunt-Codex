export type LeadHuntPromptTemplate = {
  title: string;
  instruction: string;
  outputShape: unknown;
};

export const leadHuntSystemPrompt = [
  "You are LeadHunt AI, a B2B export sales intelligence analyst for telecom equipment companies.",
  "Use only the provided input. If evidence is limited, mark confidence lower instead of inventing facts.",
  "Return valid JSON only. Do not include Markdown, comments, explanations, or code fences."
].join("\n");

export const leadHuntPromptTemplates = {
  productProfileAnalysis: {
    title: "Product profile analysis",
    instruction:
      "Analyze the seller's product information for outbound prospecting. Focus on product categories, key SKUs, use cases, buyer pain points, supply capabilities, and practical search keywords.",
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
      "Expand the user's task into structured keyword groups for Brave Search. Include telecom product terms, buyer intent terms, target market terms, scenario terms, and exclusions.",
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
        "Generate at least 15 Brave-compatible B2B prospecting search queries from the provided seller products, buyer persona, target markets, feedback, and operator strategy library.",
        "Act as a telecom export salesperson: prefer real buyer scenarios such as maintenance contractors, tower companies, system integrators, ISP/network operations, operator procurement, stockists, and project contractors.",
        "The country field is a geographic routing field for Brave Search. It MUST be exactly one of the provided targetMarkets values. It is not a customer type, industry label, or long-tail keyword. Bad country examples: \"Canada telecom equipment distributor\", \"Australia FTTH network operator\", \"Middle East telecom buyer\". Good country examples: \"Canada\", \"Australia\", \"Saudi Arabia\".",
        "Each query must focus on exactly one country/market and the query text must mention only the same country as its country field. Do not mix countries or profile leftovers. Bad query: site:.ru Huawei RRU Russia \"UAE\". Bad query: Canada \"Australia telecom tower maintenance\". Good query: (\"base station maintenance\" OR \"RAN maintenance\") Canada telecom -jobs -news.",
        "Every query must include a buyer-side role or operating scenario, such as maintenance contractor, tower maintenance, ISP/FTTH operator, mobile network operator, system integrator, network operations, procurement, field services, or repair service. Do not generate product-only SKU, price, datasheet, supplier, manufacturer, wholesale, eBay, Alibaba, or buy-now queries; those find sellers or documents, not buyers.",
        "Keep each query concise: target length <= 120 characters, max one OR group, max three OR terms in that group, max three negative terms. Do not add repeated negatives such as -job and -jobs together.",
        "Use only supported or experimental operators for automated execution. Do not use site:.xx unless the TLD matches the country field. Avoid broad marketplace, directory, report, article, encyclopedia, or supplier-manufacturer discovery unless explicitly requested.",
        "Return a balanced mix: about 30% wide queries with simple buyer terms, 50% medium queries with one OR group, and 20% narrow product-specific queries."
      ].join(" "),
    outputShape: {
      queries: [
        {
          query: "string",
          country: "one exact value from input.targetMarkets, e.g. Canada",
          language: "language code",
          operatorSource: "google_official | brave_official | common_seo",
          executionStatus: "supported | experimental | manual_only | disabled",
          rationale: "string",
          priority: "integer 1-5"
        }
      ]
    }
  },
  candidateBuyerEvaluation: {
    title: "Candidate buyer evaluation",
    instruction:
      "Evaluate whether one search result is a real potential B2B buyer for the seller's telecom spare parts and infrastructure equipment. Distinguish target buyers from competitors/suppliers, directories, articles, market reports, job pages, and irrelevant pages. Do not invent evidence. If evidence is weak but the company may be relevant, choose review instead of qualified.",
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
      "Generate a concise B2B outreach email for a telecom equipment prospect. Personalize using the candidate and product fit, avoid exaggerated claims, and keep it suitable for Gmail sending after human review.",
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
