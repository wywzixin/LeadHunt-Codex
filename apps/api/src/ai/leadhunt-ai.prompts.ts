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
        "Generate exactly input.minQueryCount Brave-compatible B2B prospecting search queries from the analyzed productProfile and customerProfile. If input.minQueryCount is missing, generate 15. Product evidence may come from the user prompt, saved product profile, website content, uploaded files, product lists, CRM samples, historical tasks, or manual notes. Do not assume the seller has a website and do not assume the industry is telecom.",
        "Before writing queries, use productProfile to decide what is being sold and customerProfile to decide who should buy, maintain, repair, replace, install, integrate, operate, import, distribute, or resell it. Every executable query must be traceable to both, but keep output compact: rationale must be under 12 words, productEvidence/customerEvidence should be omitted or contain at most one short phrase each.",
        "Core goal: find direct company/customer pages, not intelligence pages. Do not simply search for who sells the same product. Infer who would realistically use, maintain, repair, replace, install, integrate, operate, import, distribute, or resell the product.",
        "First build a product search matrix from the available evidence: productCategory, productType, coreProducts, modelTerms, priorityModelTerms, brandTerms, productGroups, applicationScenarios, demandTriggers, likelyBuyerTypes, channelTypes, and badTargets. If evidence is thin, infer cautiously from product category instead of inventing exact SKUs.",
        "Target markets: input.targetMarkets has already been expanded to concrete countries. Never put macro regions such as Middle East, Africa, Europe, LATAM, MENA, GCC, Global, or worldwide in a query or country field. Each query must contain exactly one concrete country and the country field must be the same concrete country.",
        "Model/SKU handling: when many models exist, do not default to evenly generating many queries for every model. Cluster models into productGroups first. Select 10-20 representative product/model terms for the whole task, balanced by product group. Select priority models only when they are mentioned by the user, marked as main/hot/in-stock/high-value, shown on the homepage or key category, representative of a group, or present in CRM history. Non-priority models should inform product understanding but should not each receive their own query by default. If the user explicitly asks to search every model, keep it batched and generate only 1-3 buyer-intent queries per model.",
        "Search matrix types for the main customer list: buyer_scenario 50%, product_group 30%, brand_ecosystem 10%, model_specific 10%, procurement_event 0%, channel 0%. For a 15-query batch this means about 8 buyer_scenario, 4 product_group, 1 brand_ecosystem, and 2 model_specific queries. Execution priority must be buyer_scenario first, then product_group, then brand_ecosystem, then model_specific, with channel last only if explicitly requested. Do not generate procurement_event queries for the default customer search.",
        "Every query must contain buyer-side intent plus a specific product/category/application clue plus exactly one concrete target country plus a direct company entry point such as contact, contact us, services, solutions, projects, locations, offices, about us, or company. Default buyer-side intent should prioritize maintain, repair, replace, operate, install, integrate, manage network operations, service delivery, or project deployment. Do not use supplier/distributor/stockist/reseller/wholesale as the default customer type.",
        "Good generic patterns: \"[application scenario]\" [country] contact; \"[product group] maintenance\" [country] contact; \"[brand ecosystem]\" [country] integrator contact; \"[operator/ISP/FTTH/WISP] network operations\" [country] contact; \"[product group] service company\" [country] contact; \"[model]\" replacement [country] contact only when the model is a priority model; \"[product category] distributor\" [country] contact only when channel customers are explicitly requested.",
        "Bad query patterns: SKU-only, product-only, supplier-only, manufacturer-only, RFQ, tender, vendor registration, procurement notice, government procurement, filetype:pdf, LinkedIn profile, yellow pages, directory, B2B marketplace, buyer board, WhatsApp hunting, price, datasheet, manual, buy now, marketplace, market report, encyclopedia, glossary, blog, article, resources page, jobs, training, course, mixed-country query, or a country field that is a long phrase. Bad examples: \"Huawei MA5800 Canada supplier price datasheet\"; \"industrial pump datasheet Australia\"; \"Canada telecom equipment distributor\" as country; site:.ru Russia \"UAE\".",
        "The country field is a geographic routing field for Brave Search. It MUST be exactly one of the provided concrete targetMarkets values. It is not a customer type, industry label, macro region, or long-tail keyword. Each query text must mention only that same country/market. User prompt target markets override saved profile regions; profile regions are weak defaults only.",
        "Keep each query concise: target length <= 120 characters, max one OR group, max three OR terms in that group, max three negative terms. Do not add repeated negatives such as -job and -jobs together. Choose negatives by query type instead of mechanically repeating every exclusion. Never use contact evidence fields as negative terms: -phone, -contact, -tel, -email, -mail, -fax, -address, -mobile, or -whatsapp are forbidden. If you need to avoid consumer phone retailers, use exact phrase negatives such as -\"consumer phone\", -\"phone accessories\", or -\"mobile phone shop\" instead of -phone.",
        "Use only supported or experimental operators for automated execution; executionStatus must be supported or experimental only. Never output manual_only or disabled. If a query is not safe for automated execution, omit it and write a better executable query instead. Do not use site:.xx unless the TLD matches the country field. Do not use LinkedIn profiles, local directories, B2B marketplaces, buyer boards, WhatsApp-link hunting, PDFs, news, reports, articles, glossary pages, or procurement/tender/RFQ/vendor-registration searches in the automated main customer search.",
        "Reject broad filler queries. Do not rely on generic words such as infrastructure, equipment, network, service, spare parts, or contractor unless the same query also contains a specific product/category/application clue from productProfile such as a model, product group, brand ecosystem, base station/RAN/OLT/rectifier/microwave/private-network equivalent, or another domain-specific term.",
        "Keep JSON small. evidenceSummary, productUnderstanding, rejectedIdeas, productEvidence, customerEvidence, and negativeTerms may be empty unless they add important evidence. Do not write long explanations.",
        "If input.refillContext is present, this is a second-pass refill. Keep the same productProfile and customerProfile logic, avoid duplicating acceptedQueries, and replace rejectedQueries with stronger executable alternatives that fix the stated rejection reasons. Return exactly input.minQueryCount new queries; the system will merge them with acceptedQueries."
      ].join(" "),
    outputShape: {
      queries: [
        {
          query: "string",
          country: "one exact value from input.targetMarkets, e.g. Canada",
          strategyType: "buyer_scenario | product_group | brand_ecosystem | model_specific | channel",
          priority: "integer 1-5"
        }
      ]
    }
  },
  candidateBuyerEvaluation: {
    title: "Candidate buyer evaluation",
    instruction:
      "Evaluate whether one search result is a real potential B2B buyer for the seller's product. Distinguish target buyers from competitors/suppliers, procurement intelligence pages, directories, articles, market reports, job pages, and irrelevant pages. Do not invent evidence. If evidence is weak but the company may be relevant, choose review instead of qualified.",
    outputShape: {
      companyName: "string",
      websiteUrl: "string",
      resultType:
        "target_buyer | possible_buyer | procurement_intelligence | supplier_or_competitor | directory | content_article | job_page | market_report | irrelevant | unknown",
      buyerType: "string such as maintenance company, operator procurement, system integrator, service provider, unknown",
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
