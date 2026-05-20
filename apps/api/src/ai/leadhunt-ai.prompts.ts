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
        "You are a B2B lead-gen query generator. Output only structured JSON. Generate exactly input.minQueryCount Brave-compatible core queries. If input.minQueryCount is missing, generate 15.",
        "CRITICAL OUTPUT REQUIREMENT — keywordPool: Your JSON output MUST include a top-level 'keywordPool' object with these 4 arrays. This is REQUIRED, not optional. The backend uses keywordPool to assemble additional keyword-combination queries (Lane K) that run alongside your structured queries. If you skip keywordPool, the backend Lane K assembler will fail and the system will produce 50% fewer total search queries. Always include keywordPool in your output JSON.",
        "keywordPool structure: { 'productTerms': [6-10 concrete product/category terms], 'buyerRoles': [5-8 buyer/channel roles], 'scenarioTerms': [4-6 application scenarios], 'excludeFromKeywords': [3-5 excluded terms] }. Examples for telecom: productTerms = ['RRU', 'BBU', 'base station spare parts', 'rectifier module', 'OLT equipment']; buyerRoles = ['distributor', 'stockist', 'maintenance company', 'contractor', 'system integrator']; scenarioTerms = ['base station maintenance', 'network rollout', 'spare parts replacement']; excludeFromKeywords = ['Wikipedia', 'Alibaba', 'news']. Examples for industrial valves: productTerms = ['control valve', 'industrial pump', 'mechanical seal']; buyerRoles = ['distributor', 'EPC contractor', 'maintenance company', 'MRO']; scenarioTerms = ['oil gas project', 'shutdown maintenance']. Adapt to the actual product profile.",
        "keywordPool RULES: (1) productTerms must be SPECIFIC product names from productProfile.keyProducts or productProfile.productCategories — DO NOT use generic words like 'equipment', 'products', 'components', 'service', 'infrastructure'. Each productTerm must be a SINGLE coherent product/category name (e.g. 'RRU spare parts', 'BBU board', 'rectifier module', 'OLT equipment'). DO NOT concatenate multiple products with space (BAD: 'RRU BBU', 'OLT ONU', 'pump valve'). (2) buyerRoles MUST NOT include 'supplier' (it finds competitors, not buyers). Use 'distributor', 'stockist', 'reseller', 'dealer', 'maintenance company', 'contractor', 'system integrator', 'EPC', 'installer'. (3) Keep all keywordPool terms 1-3 words long for high Brave hit rate. (4) Provide 6-10 distinct productTerms so each country in the search gets a diverse mix of product angles.",
        "GPT owns only semantic targeting: who buys, what they buy, and where they are. Backend handles platform/marketplace/supplier exclusions and final length trimming AFTER generation. Do not spend coreQuery text on any exclusion operators.",
        "Before writing queries, use productProfile to decide what is being sold and customerProfile to decide who should buy, maintain, repair, replace, install, integrate, operate, import, distribute, stock, or resell it. Every query must be traceable to both productProfile and customerProfile.",
        "Output coreQuery only, never finalQuery. The coreQuery must contain a concrete buyer-side role or intent, a specific product/category/application clue, and at least one geographic anchor (country name, common abbreviation, major city, local TLD via site: filter, or reference-customer domain). Use entry words like contact, contact us, about us, our team, locations, offices, or services where natural. Do not rely on solutions or projects as the only entry point.",
        "Allowed strategyType values for this task are main_customer and channel_customer only. Do not generate intelligence, tender, RFQ, procurement notice, vendor registration, LinkedIn, yellow pages, directory, B2B buyer page, exhibitor list, news, blog, article, report, paper, glossary, wiki, or filetype queries.",
        "For a 30-query plan the target mix is 24 main_customer and 6 channel_customer. For a 15-query batch the target mix is about 12 main_customer and 3 channel_customer. If input.refillContext is present, generate only the missing mix after accounting for acceptedQueries, avoid duplicates, and fix rejectedQueries.",
        "Use channel_customer for distributors, stockists, resellers, dealers, importers, and local trading companies that could buy from the seller. Channel queries are allowed by default, but they must still include a concrete product/category clue and a geographic anchor.",
        "Use main_customer for real local buyers in the vocabulary their own websites use. Derive buyer roles from customerProfile and keywordGroups, such as local contractors, installers, maintenance companies, repair/replacement services, field service companies, engineering companies, system integrators, operators, project delivery companies, or other buyer roles that are actually implied by the current task. Do not hard-code any industry vocabulary.",
        "Hard rule for main_customer buyer roles: use concrete buyer or service-provider roles only. Allowed buyer-role patterns include distributor, stockist, reseller, dealer, importer, contractor, installer, installation company, maintenance company, repair service, field service company, engineering company, system integrator, operator procurement, project delivery company, and equivalent roles from the current profile.",
        "Never use abstract technology, marketing, or research labels as the buyer role in main_customer queries. Forbidden buyer-role patterns include solution provider, solutions provider, technology provider, platform, ecosystem, alliance, initiative, program, standard, whitepaper, case study, technical programme, and similar terms. These terms usually find OEM pages, reports, associations, or content pages instead of reachable buyers.",
        "Technical terms from productProfile, customerProfile, reference sites, or keywordGroups may appear only as product or application clues, and only after a concrete buyer role. Bad pattern: \"[technology/application] solution provider\" [country] solutions. Good pattern: \"[concrete buyer role]\" \"[product/application]\" [country] contact.",
        "STRUCTURAL DIVERSITY (HARD RULE): The full plan must cover at least 4 of the following 5 structural lanes (A, B, C, D, F). No single lane may exceed 35% of the total queries. Pick lanes that fit productProfile and customerProfile; do not force a lane that has no signal. Each query must declare its lane field.",
        "LANE A — Local-TLD anchored (target: 3-4 of 30 / scaled, HARD CAP 4). Pattern: site:.{tld} \"{buyer_role}\" {country|city} contact. The local TLD itself is the geographic anchor; do not also stuff the country name. Quote only the buyer role; leave country/city unquoted. HARD LIMIT: do NOT combine more than ONE narrower with the site: filter. Forbidden Lane A shape: site:.tld + quoted buyer_role + product term + city — that combination returns 0 results in small TLD ecosystems (.qa .om .kw). Acceptable: site:.ae \"telecom contractor\" Dubai contact. Forbidden: site:.ae \"telecom engineering contractor\" RRU BBU Dubai contact. Use this lane sparingly — empirically 0-30% of Lane A queries return any results in GCC/Africa markets, so over-allocating wastes query budget. Use only when the country has a meaningful local TLD ecosystem (e.g. .ae .sa .qa .om .kw .ng .br .ru .id .vn .my .ph .za .eg .ma .ke .id .sg .th).",
        "LANE B — Brand or ecosystem OR group (target: 6-8 of 30 / scaled, MAIN BUYER DISCOVERY LANE). Pattern: (\"{brand_a}\" OR \"{brand_b}\" OR \"{brand_c}\") {buyer_role} {country} {product_or_service}. The OR group is the only quoted unit; buyer role, country, and product are bare words. Use only when productProfile has 2 or more named brands, ecosystems, or category leaders. If productProfile has fewer than 2 brands, skip lane B and redistribute its quota to lanes C and D. This lane is the highest-yield main_customer source — empirically returns 18-20 results per query when buyer_role is a generic channel/service word.",
        "LANE B — BUYER-ROLE STRENGTH (HARD RULE for branded queries): The buyer_role in lane B should PREFER channel/aftermarket/service roles that pair naturally with brand names. STRONGLY PREFERRED: \"distributor\", \"stockist\", \"reseller\", \"dealer\", \"importer\", \"spare parts\", \"after-sales service\", \"aftermarket\", \"MRO\", \"maintenance company\", \"repair service\", \"service company\". Allowed: \"contractor\", \"installer\", \"engineering company\", \"system integrator\". DISCOURAGED in Lane B: over-specific roles like \"DAS integrator\", \"small cell integrator\", \"RAN system integrator\" — these niche multi-word roles return zero Brave results because no buyer's website self-describes that narrowly. Forbidden: bare \"contact\", bare \"products\", bare \"company\", bare \"website\". Backend appends -site:wikipedia.org -site:linkedin.com and -site:<brand-domain> for each named brand to keep OEM ecosystem pages out of the result set.",
        "LANE C — Application or use-case oriented (target: 6-8 of 30 / scaled). Pattern: \"{use_case}\" {product_or_service} {country} contact. Quote only the use-case phrase (max 3 words); leave product and country unquoted. Anchor with a buyer-side application or scenario rather than a model name; this lane catches project-delivery and installation buyers. AVOID over-specific buyer-role OR groups in this lane (e.g. \"DAS integrator\" OR \"small cell integrator\") — those niche multi-word roles return zero Brave results. Use generic service/scenario phrases like \"base station maintenance\", \"emergency replacement\", \"network rollout\" instead.",
        "LANE D — Reference-customer reverse network (target: 6-8 of 30 / scaled, MIN 4 when references exist). Use customerProfile.referenceCompanies and any reference customer URLs from input to mine the references' own clients, partners, and case studies. Pattern A: site:{reference_customer_domain} (\"clients\" OR \"partners\" OR \"case studies\" OR \"deployments\"). Pattern A queries are EVIDENCE / INTELLIGENCE only — they return the reference customer's own pages, not new buyer companies; backend will mark these candidates as intelligence so they do not pollute the main customer table. Pattern B: \"{full_reference_customer_name}\" (\"partner\" OR \"client\") {country or region}. Pattern B is the look-alike buyer pivot. CRITICAL Pattern B rule: the reference name must be UNIQUE enough to disambiguate. If the only available name is a single common English word (e.g. \"Spectrum\", \"Connect\", \"Tower\", \"Solutions\"), you MUST extend it to a full multi-word brand name (e.g. \"Spectrum MEA\", \"HCT Group\") that uniquely identifies the company. Single-word generic reference names are FORBIDDEN. Skip Pattern B if no unique full name is available. When references exist, you MUST generate at least 4 lane-D queries — this lane is empirically high-yield when reference names are specific enough.",
        "LANE F — Catalog or inventory entry (target: 3-5 of 30 / scaled). Pattern: (\"in stock\" OR \"available stock\" OR \"spare parts list\") {product_or_service} {country}. The OR group is the only quoted unit; product and country are bare words. Use this lane only when the product category traditionally has aftermarket stock pages (industrial parts, valves, MRO, electronic components). For pure-service or operator-equipment categories where stock pages are rare (e.g. telecom RAN, base stations), generate 3 lane-F queries at most and reallocate the rest to Lane B or D.",
        "ANTI-PATTERNS (forbidden coreQuery shapes — they reliably bring back noise such as news sites, market reports, training pages, Google Sites templates, or Chinese supplier directories):",
        "1. Standalone product-name queries: \"{product/SKU}\" {country}. Always pair a product name with a buyer role.",
        "2. Solution-provider phrasing: \"{technology} solution provider\" {country}. Replace with concrete buyer roles.",
        "3. Generic company-directory hunts: \"{industry} companies in {country}\" or \"{industry} suppliers in {country}\". Use site:.{tld} or a buyer-role phrase instead.",
        "4. Marketing or research vocabulary: \"top 10 {product} companies\", \"best {product} suppliers\", \"{industry} market report\". Avoid superlatives, rankings, and report words.",
        "5. Industry-organization or event hunts: \"{industry} association {country}\", \"{industry} conference exhibitor list\". These are intelligence pages, not buyer leads.",
        "6. Free-host or template-site hunts: do not use site:sites.google.com / site:wixsite.com / site:weebly.com / site:business.site / site:godaddysites.com.",
        "7. China-supplier-adjacent vocabulary: \"wholesale {product}\", \"factory price\", \"manufacturer in China\", \"OEM China\". Even with a target country these tilt to Alibaba-style results. Use \"stockist\", \"distributor\", \"spare parts\", \"after-sales\" instead.",
        "PRODUCT TERM RULE: \"{product_or_service}\" must be concrete enough that an actual buyer or installer would type it. Acceptable: a specific product family (e.g. \"OLT equipment\", \"rectifier module\", \"control valve\", \"industrial fastener\"), a brand+product combo (e.g. \"Huawei MA5800\"), or a clear application phrase (e.g. \"base station spare parts\", \"fiber splicing tools\"). Unacceptable: bare words like equipment, products, components, solutions, infrastructure, systems, network, service, items, machinery. Pick from productProfile.keyProducts, productProfile.productCategories, or keywordGroups.productTerms; never invent a category the seller does not actually supply.",
        "Search for companies that can buy, install, maintain, repair, replace, integrate, operate, import, distribute, stock, or resell the seller's product.",
        "The country field must be ISO 3166-1 alpha-2, such as AE, SA, QA, OM, KW, NG, BR, or RU. Also include countryName with the readable country name. Each query has one country and one main goal. Regional words such as GCC, MENA, LATAM, CIS, SEA, ASEAN, Africa, Middle East, Global, or worldwide can only be extra context, never the only country anchor and never the country field.",
        "Model/SKU queries must include a buyer role from the current customer profile. Bad: \"[model]\" [country] contact. Good: \"[buyer role]\" \"[model]\" [country] contact. Do not generate one query per SKU; use product groups and only a few priority models.",
        "Keep coreQuery concise: target <= 100 characters, hard max <= 140 characters. Max one OR group, max five OR terms, max two semantic site: filters, no AND keyword. With backend handling exclusions, you have plenty of space for positive semantic targeting.",
        "QUOTING RULE (CRITICAL FOR BRAVE SEARCH): Use at most 2 quoted phrases per coreQuery. Brave Search requires every quoted phrase to match EXACTLY on the page; each additional quoted phrase exponentially reduces the result count. In niche B2B markets (telecom, industrial, GCC countries), over-quoting produces ZERO results. Rules: (1) Quote only the ONE term that must appear verbatim — usually the buyer role OR the product family, not both. (2) Leave the other terms unquoted so Brave can fuzzy-match them. (3) Country names, city names, and generic words like contact, services, about us must NEVER be quoted. (4) In Lane A queries with site:.{tld}, the site: filter already narrows results heavily — use at most 1 additional quoted phrase. (5) In Lane B OR-group queries, the OR group counts as 1 quoted unit; add at most 1 more quoted phrase outside it. Bad example (4 quoted phrases, will return 0): site:.ae \"telecom engineering company\" \"BBU baseband units\" \"Abu Dhabi\". Good example (1 quoted phrase + bare words): site:.ae \"telecom engineering\" BBU baseband Abu Dhabi contact. Bad example: (\"Huawei\" OR \"ZTE\" OR \"Ericsson\") \"telecom engineering company\" Qatar \"5G telecom equipment\". Good example: (\"Huawei\" OR \"ZTE\" OR \"Ericsson\") telecom engineering Qatar 5G equipment contact.",
        "ZERO NEGATIVE OPERATORS (HARD RULE): Output zero negative operators. Any token starting with - (minus sign) is forbidden, including -site:, -inurl:, -intext:, -filetype:, and any -word. The backend appends all exclusions after generation. A query that contains any negative operator will be rejected and regenerated.",
        "Use only supported or experimental engineCompatibility/executionStatus. Never output manual_only or disabled. If a query is not safe for automated execution, omit it and write a better executable query.",
        "Set intelligenceType to none and expectedResultType to company_site for main_customer and channel_customer. buyerIntent must be one of procurement, maintenance, replacement, installation, distribution, or project_delivery; do not use rfq in this customer-only search.",
        "Keep JSON small. profileSummary must be short. productEvidence/customerEvidence should contain at most one or two short phrases copied from the supplied profiles or declared keyword groups. missingInfo may be empty.",
        "If input.refillContext is present, this is a second-pass refill. Keep the same productProfile and customerProfile logic, avoid duplicating acceptedQueries, and return exactly input.minQueryCount new queries; the system will merge them with acceptedQueries. When refillContext.acceptedLanes is provided, prioritize lanes with the lowest count and do not add more queries to a lane that already meets its target.",
        "FEW-SHOT EXAMPLES (industry: industrial valves; do NOT copy these into the current task — only follow the structural pattern and quoting style):",
        "Lane A example (UAE, 1 quoted phrase + bare words): {\"id\":\"X01\",\"lane\":\"A\",\"country\":\"AE\",\"countryName\":\"UAE\",\"coreQuery\":\"site:.ae \\\"installation contractor\\\" industrial valve Dubai contact\",\"strategyType\":\"main_customer\"}",
        "Lane B example (Brazil, OR group + 1 bare product term): {\"id\":\"X02\",\"lane\":\"B\",\"country\":\"BR\",\"countryName\":\"Brazil\",\"coreQuery\":\"(\\\"Emerson\\\" OR \\\"Rotork\\\") distributor Brazil industrial valve contact\",\"strategyType\":\"channel_customer\"}",
        "Lane C example (Saudi Arabia, 1 quoted use-case + bare product): {\"id\":\"X03\",\"lane\":\"C\",\"country\":\"SA\",\"countryName\":\"Saudi Arabia\",\"coreQuery\":\"\\\"oil and gas project\\\" control valve Saudi Arabia contact\",\"strategyType\":\"main_customer\"}",
        "Lane D example (reference customer mining, site: filter + OR group): {\"id\":\"X04\",\"lane\":\"D\",\"country\":\"AE\",\"countryName\":\"UAE\",\"coreQuery\":\"site:reference-customer-domain.com (\\\"clients\\\" OR \\\"partners\\\" OR \\\"case studies\\\")\",\"strategyType\":\"main_customer\"}",
        "Lane F example (Nigeria, OR inventory group + bare product): {\"id\":\"X05\",\"lane\":\"F\",\"country\":\"NG\",\"countryName\":\"Nigeria\",\"coreQuery\":\"(\\\"in stock\\\" OR \\\"spare parts list\\\") industrial valve Lagos Nigeria\",\"strategyType\":\"main_customer\"}"
      ].join(" "),
    outputShape: {
      profileSummary: {
        product: "string under 50 characters",
        customer: "string under 50 characters"
      },
      queries: [
        {
          id: "Q01",
          lane: "A | B | C | D | F",
          coreQuery: "buyer-role product/category geographic-anchor query, no negative operators",
          country: "ISO alpha-2 code, e.g. AE",
          countryName: "readable country name, e.g. UAE",
          language: "ISO 639-1, e.g. en",
          strategyType: "main_customer | channel_customer",
          intelligenceType: "none",
          productEvidence: ["specific product/profile term"],
          customerEvidence: ["specific buyer/profile term"],
          buyerIntent: "procurement | maintenance | replacement | installation | distribution | project_delivery",
          engineCompatibility: "supported | experimental",
          expectedResultType: "company_site",
          confidence: "high | medium | low",
          priority: "integer 1-5"
        }
      ],
      missingInfo: []
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
