import { expandLeadKeywords, type KeywordExpansionInput } from "./keyword-expansion.js";
import {
  countryToLoc as genericCountryToLoc,
  countryToSite as genericCountryToSite
} from "./country-market.js";

export type OperatorSource = "brave_official" | "google_official" | "common_seo";

export type ExecutionStatus = "supported" | "experimental" | "manual_only" | "disabled";

export type KeywordGroups = {
  brandTerms: string[];
  productTerms: string[];
  longTailProductTerms: string[];
  customerIntentTerms: string[];
  marketTerms: string[];
  scenarioTerms: string[];
  excludeTerms: string[];
};

export type SearchStrategyTemplate = {
  id: string;
  operatorSource: OperatorSource;
  executionStatus: ExecutionStatus;
  operatorName: string;
  strategyTemplate: string;
  keywordGroups: Array<keyof KeywordGroups>;
  effectivenessScore: number;
};

export type SearchStrategyLibrary = {
  version: string;
  operators: SearchStrategyTemplate[];
  templates: SearchStrategyTemplate[];
  keywordGroups: KeywordGroups;
  businessExperienceSources: string[];
};

export type SearchStrategyInput = KeywordExpansionInput & {
  minQueryCount?: number;
};

export type GeneratedSearchQuery = {
  provider: "brave";
  operatorSource: OperatorSource;
  executionStatus: Extract<ExecutionStatus, "supported" | "experimental">;
  operatorName: string;
  strategyTemplate: string;
  query: string;
  keywordGroups: KeywordGroups;
  country: string;
  effectivenessScore: number;
  templateId: string;
};

// 2026-05: Telecom-only keyword defaults removed. The system is a
// generic foreign-trade lead generator, not telecom-specific.
// Telecom keywords used to be merged unconditionally into every
// task's keywordGroups, polluting GPT's context for non-telecom
// industries. The marketTerms and excludeTerms below are kept
// because they are industry-agnostic geographic/exclusion fallbacks.
// The detect*() functions in keyword-expansion.ts continue to emit
// telecom keywords ONLY when the prompt explicitly mentions telecom
// signals (5G, RAN, RRU, BBU, base station, etc.), so telecom users
// still get full coverage; non-telecom users no longer see telecom
// vocabulary leak into their queries.
export const defaultKeywordGroups: KeywordGroups = {
  brandTerms: [],
  productTerms: [],
  longTailProductTerms: [],
  customerIntentTerms: [],
  marketTerms: [
    "UAE",
    "Saudi Arabia",
    "Qatar",
    "Oman",
    "Brazil",
    "Mexico",
    "Colombia",
    "Indonesia",
    "Philippines",
    "Nigeria",
    "South Africa",
    "Kenya",
    "Egypt",
    "Morocco",
    "Ghana",
    "Tanzania",
    "Vietnam",
    "Thailand",
    "Malaysia",
    "Chile",
    "Peru"
  ],
  scenarioTerms: [],
  excludeTerms: [
    "job",
    "jobs",
    "career",
    "training",
    "course",
    "forum",
    "youtube",
    "facebook",
    "wiki",
    "consumer",
    "consumer phone",
    "phone accessories",
    "smartphone",
    "Amazon",
    "AliExpress",
    "China",
    "Chinese",
    "cn"
  ]
};

const operatorCatalog: SearchStrategyTemplate[] = [
  operator(
    "exact_phrase",
    "brave_official",
    "experimental",
    '"keyword phrase"',
    ["productTerms"],
    0.78
  ),
  operator(
    "negative_term",
    "brave_official",
    "manual_only",
    "-job -training -course",
    ["excludeTerms"],
    0.82
  ),
  operator(
    "boolean_or",
    "brave_official",
    "experimental",
    "(term OR term)",
    ["productTerms"],
    0.76
  ),
  operator("site", "brave_official", "experimental", "site:.ae", ["marketTerms"], 0.73),
  operator("filetype", "brave_official", "experimental", "filetype:pdf", ["scenarioTerms"], 0.71),
  operator(
    "intitle",
    "brave_official",
    "experimental",
    'intitle:"telecom equipment"',
    ["productTerms"],
    0.69
  ),
  operator("inpage", "brave_official", "disabled", "inpage:telecom", ["productTerms"], 0.64),
  operator("loc_lang", "brave_official", "disabled", "loc:ae lang:en", ["marketTerms"], 0.62),
  operator(
    "google_exact_phrase",
    "google_official",
    "experimental",
    '"keyword phrase"',
    ["productTerms"],
    0.66
  ),
  operator(
    "google_site",
    "google_official",
    "experimental",
    "site:example.com",
    ["marketTerms"],
    0.6
  ),
  operator(
    "common_inurl",
    "common_seo",
    "manual_only",
    "inurl:distributor",
    ["customerIntentTerms"],
    0.4
  ),
  operator(
    "common_intext",
    "common_seo",
    "manual_only",
    'intext:"telecom equipment"',
    ["productTerms"],
    0.38
  ),
  operator(
    "common_allintitle",
    "common_seo",
    "disabled",
    "allintitle:telecom equipment",
    ["productTerms"],
    0.2
  ),
  operator(
    "common_related_cache",
    "common_seo",
    "disabled",
    "related: cache:",
    ["productTerms"],
    0.1
  )
];

const executableTemplates: SearchStrategyTemplate[] = [
  template(
    "maintenance_company_contact",
    "brave_official",
    "experimental",
    "maintenance_company contact",
    '("network maintenance" OR "field service" OR "base station maintenance") ({product_or}) {country} ("contact" OR services OR projects) {exclude}',
    ["scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.98
  ),
  template(
    "ran_field_service",
    "brave_official",
    "experimental",
    "ran_field_service buyer_profile",
    '("RAN maintenance" OR "field services" OR "repair service") ({product_or}) {country} contact {exclude}',
    ["productTerms", "scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.97
  ),
  template(
    "tower_company_maintenance",
    "brave_official",
    "experimental",
    "towerco_maintenance buyer_profile",
    '("tower maintenance" OR "tower company" OR towerco) ({product_or}) {country} contact {exclude}',
    ["scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.96
  ),
  template(
    "telecom_power_maintenance",
    "brave_official",
    "experimental",
    "power_maintenance buyer_profile",
    '("telecom power maintenance" OR rectifier OR "power module") {country} contact {exclude}',
    ["productTerms", "scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.95
  ),
  template(
    "wireless_infrastructure_contractor",
    "brave_official",
    "experimental",
    "contractor buyer_profile",
    '("infrastructure contractor" OR "telecom contractor" OR "network maintenance company") ({product_or}) {country} {exclude}',
    ["productTerms", "scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.94
  ),
  template(
    "ftth_isp_operations",
    "brave_official",
    "experimental",
    "isp_operations buyer_profile",
    '(operator OR ISP OR WISP) ("network operations" OR maintenance OR procurement) ({product_or}) {country} {exclude}',
    ["productTerms", "scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.93
  ),
  template(
    "operator_vendor_registration",
    "brave_official",
    "experimental",
    "operator_procurement buyer_signal",
    '(operator OR carrier OR "service provider") ("vendor registration" OR procurement OR purchasing) ({product_or}) {country} {exclude}',
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.92
  ),
  template(
    "direct_integrator_contact",
    "brave_official",
    "experimental",
    "direct_company contact",
    '("telecom system integrator" OR "network contractor" OR "wireless contractor") {country} ("contact" OR services OR projects) {exclude}',
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.91
  ),
  template(
    "company_contact_broad",
    "brave_official",
    "experimental",
    "contact_page buyer_profile",
    '("telecom services" OR "network infrastructure" OR "wireless solutions") {country} ("contact" OR "about us" OR projects) {exclude}',
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.9
  ),
  template(
    "radio_parts_service_repair",
    "brave_official",
    "experimental",
    "radio_parts service_profile",
    '("RRU" OR "BBU" OR "AAU") (maintenance OR repair OR replacement) {country} contact {exclude}',
    ["productTerms", "scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.89
  ),
  template(
    "specific_model_stockist",
    "brave_official",
    "experimental",
    "catalog_model service_profile",
    '({specific_product_or}) ("spare parts" OR maintenance OR replacement) {country} contact {exclude}',
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.88
  ),
  template(
    "spare_parts_repair_inventory",
    "brave_official",
    "experimental",
    "spare_parts_management buyer_profile",
    '("spare parts" OR "replacement parts" OR "maintenance parts") ("spare parts management" OR repair OR maintenance OR replacement) {country} {exclude}',
    ["longTailProductTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.87
  ),
  template(
    "regional_projects_signal",
    "brave_official",
    "experimental",
    "project_delivery buyer_profile",
    '("telecom project" OR rollout OR deployment) ({product_or}) {country} contact {exclude}',
    ["scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.86
  ),
  template(
    "das_small_cell_integrator",
    "brave_official",
    "experimental",
    "das_private_5g buyer_profile",
    '(DAS OR "small cell" OR "private 5G" OR "in-building wireless") ("system integrator" OR contractor OR maintenance) {country} {exclude}',
    ["productTerms", "scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.84
  ),
  template(
    "pdf_company_brochure",
    "brave_official",
    "experimental",
    "filetype company_profile",
    'filetype:pdf ("telecom" OR "network infrastructure" OR wireless) ("company profile" OR projects OR contact) {country} {exclude}',
    ["productTerms", "scenarioTerms", "marketTerms", "excludeTerms"],
    0.8
  ),
  template(
    "direct_distributor_country",
    "brave_official",
    "experimental",
    "secondary_distributor buyer_profile",
    "(distributor OR stockist OR reseller OR dealer) ({product_or}) {country} {exclude}",
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.74
  ),
  template(
    "intitle_integrator_country",
    "brave_official",
    "experimental",
    "intitle buyer_profile",
    'intitle:"integrator" ("system integrator" OR contractor OR maintenance OR operations) {country} {exclude}',
    ["customerIntentTerms", "marketTerms", "excludeTerms"],
    0.72
  ),
  template(
    "brand_repair_parts_services",
    "brave_official",
    "experimental",
    "brand_repair buyer_profile",
    '({brand_or}) (repair OR maintenance OR "spare parts") {country} contact {exclude}',
    ["brandTerms", "productTerms", "marketTerms", "excludeTerms"],
    0.71
  ),
  template(
    "procurement_signal_broad",
    "google_official",
    "experimental",
    "procurement buyer_signal",
    '("procurement" OR "purchasing" OR RFQ OR tender) ({product_or}) {country} {exclude}',
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.68
  ),
  template(
    "distributor_exact_scenario",
    "google_official",
    "experimental",
    "exact_phrase boolean_or",
    "(distributor OR stockist OR reseller) ({scenario_or}) {country} {exclude}",
    ["customerIntentTerms", "scenarioTerms", "marketTerms", "excludeTerms"],
    0.62
  ),
  template(
    "tower_power_ibs",
    "brave_official",
    "experimental",
    "exact_phrase buyer_profile",
    '("tower power" OR "IBS service" OR "site maintenance") ({product_or}) {country} {exclude}',
    ["scenarioTerms", "marketTerms", "excludeTerms"],
    0.62
  ),
  template(
    "language_contractor",
    "brave_official",
    "experimental",
    "contractor boolean_or",
    '("telecom contractor" OR "field services" OR "network maintenance") {country} contact {exclude}',
    ["customerIntentTerms", "scenarioTerms", "marketTerms", "excludeTerms"],
    0.61
  ),
  template(
    "required_term_stockist",
    "brave_official",
    "experimental",
    "required_term boolean_or",
    '+equipment ("RRU" OR "BBU" OR "product") (maintenance OR repair OR replacement) {country} {exclude}',
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.6
  ),
  template(
    "site_country_company_contact",
    "brave_official",
    "experimental",
    "site company_contact",
    'site:{country_site} (telecom OR wireless OR "network maintenance") ("contact" OR services OR projects) {country} {exclude}',
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.59
  ),
  template(
    "brand_parts_country_site",
    "brave_official",
    "experimental",
    "site boolean_or",
    '({brand_or}) ("spare parts" OR repair OR maintenance) site:{country_site} {country} {exclude}',
    ["brandTerms", "productTerms", "marketTerms", "excludeTerms"],
    0.58
  ),
  template(
    "operator_vendor_signal",
    "brave_official",
    "experimental",
    "operator_procurement buyer_signal",
    'site:{country_site} (operator OR carrier OR "service provider") ("vendor registration" OR "supplier registration" OR procurement) ({product_or}) {country} {exclude}',
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.57
  ),
  template(
    "linkedin_company_procurement",
    "brave_official",
    "manual_only",
    "linkedin_company procurement_intelligence",
    'site:linkedin.com/company ("procurement" OR purchasing OR "supply chain") ({product_or}) {country} {exclude}',
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.56
  ),
  template(
    "linkedin_decision_maker",
    "brave_official",
    "manual_only",
    "linkedin_profile decision_maker_intelligence",
    'site:linkedin.com/in ("procurement manager" OR purchasing OR "head of procurement") ({product_or}) {country} {exclude}',
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.55
  ),
  template(
    "local_directory_intelligence",
    "brave_official",
    "manual_only",
    "local_directory company_directory_intelligence",
    '("yellow pages" OR "company directory" OR "business directory") ({product_or}) {country} (contractor OR integrator OR maintenance) {exclude}',
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.54
  ),
  template(
    "b2b_buyer_intelligence",
    "brave_official",
    "manual_only",
    "b2b_buyer rfq_intelligence",
    '(buyer OR RFQ OR inquiry OR "buying lead") ({product_or}) {country} (GlobalSources OR IndiaMART OR Go4WorldBusiness) {exclude}',
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.53
  ),
  template(
    "whatsapp_phone_code_contact",
    "brave_official",
    "manual_only",
    "whatsapp_phone_code contact_intelligence",
    '("WhatsApp" OR "wa.me/{country_phone_code}") ({product_or}) {country} (contractor OR integrator OR maintenance) {exclude}',
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.52
  )
];

const nonExecutableTemplates: SearchStrategyTemplate[] = [
  template(
    "marketplace_directory_discovery",
    "common_seo",
    "manual_only",
    "directory_discovery",
    '("telecom equipment" OR "RRU" OR "BBU") ("supplier directory" OR marketplace OR B2B OR importer) {country} {exclude}',
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.24
  ),
  template(
    "manual_inurl_distributor",
    "common_seo",
    "manual_only",
    "inurl",
    'inurl:distributor "telecom equipment" {country}',
    ["customerIntentTerms", "marketTerms"],
    0.36
  ),
  template(
    "disabled_allintitle_equipment",
    "common_seo",
    "disabled",
    "allintitle",
    "allintitle:telecom equipment distributor {country}",
    ["productTerms", "customerIntentTerms", "marketTerms"],
    0.18
  )
];

export function getSearchStrategyLibrary(): SearchStrategyLibrary {
  return {
    version: "v1.0",
    operators: operatorCatalog,
    templates: [...executableTemplates, ...nonExecutableTemplates],
    keywordGroups: defaultKeywordGroups,
    businessExperienceSources: ["google search.md", "search/advanced-search-strategy-library.md"]
  };
}

export function getExecutableSearchStrategyTemplates(library = getSearchStrategyLibrary()) {
  return library.templates.filter(
    (item): item is SearchStrategyTemplate & { executionStatus: "supported" | "experimental" } =>
      item.executionStatus === "supported" || item.executionStatus === "experimental"
  );
}

export function createKeywordGroups(input: SearchStrategyInput = {}): KeywordGroups {
  const expanded = expandLeadKeywords(input);

  return {
    ...defaultKeywordGroups,
    productTerms: mergeTerms(
      [...expanded.mainProductTerms, ...expanded.relatedProductTerms],
      defaultKeywordGroups.productTerms
    ),
    longTailProductTerms: mergeTerms(
      expanded.longTailProductTerms,
      defaultKeywordGroups.longTailProductTerms
    ),
    customerIntentTerms: mergeCustomerIntentTerms(
      expanded.customerIntentTerms,
      defaultKeywordGroups.customerIntentTerms,
      isChannelCustomerRequest(input)
    ),
    marketTerms: expanded.marketTerms.length
      ? expanded.marketTerms
      : defaultKeywordGroups.marketTerms,
    scenarioTerms: mergeTerms(expanded.scenarioTerms, defaultKeywordGroups.scenarioTerms),
    excludeTerms: mergeTerms(expanded.excludeTerms, defaultKeywordGroups.excludeTerms)
  };
}

export function generateSearchQueries(input: SearchStrategyInput = {}): GeneratedSearchQuery[] {
  const keywordGroups = createKeywordGroups(input);
  const countries = keywordGroups.marketTerms.length ? keywordGroups.marketTerms : ["UAE"];
  const requestedMinimum = input.minQueryCount ?? 30;
  const minimum = Math.min(Math.max(requestedMinimum, countries.length), 80);
  const templates = getExecutableSearchStrategyTemplates().filter(
    (item) => isChannelCustomerRequest(input) || !channelTemplateIds.has(item.id)
  );
  const generated: GeneratedSearchQuery[] = [];

  if (!templates.length) {
    return generated;
  }

  let cursor = 0;
  while (generated.length < minimum) {
    const strategy = templates[cursor % templates.length] ?? templates[0]!;
    const country = countries[cursor % countries.length] ?? countries[0] ?? "UAE";
    generated.push({
      provider: "brave",
      operatorSource: strategy.operatorSource,
      executionStatus: strategy.executionStatus,
      operatorName: strategy.operatorName,
      strategyTemplate: strategy.strategyTemplate,
      query: renderStrategyTemplate(strategy.strategyTemplate, keywordGroups, country),
      keywordGroups,
      country,
      effectivenessScore: strategy.effectivenessScore,
      templateId: strategy.id
    });
    cursor += 1;
  }

  appendCatalogModelQueries(generated, templates, keywordGroups, countries);

  return generated;
}

function operator(
  id: string,
  operatorSource: OperatorSource,
  executionStatus: ExecutionStatus,
  operatorName: string,
  keywordGroups: Array<keyof KeywordGroups>,
  effectivenessScore: number
): SearchStrategyTemplate {
  return {
    id,
    operatorSource,
    executionStatus,
    operatorName,
    strategyTemplate: operatorName,
    keywordGroups,
    effectivenessScore
  };
}

function template(
  id: string,
  operatorSource: OperatorSource,
  executionStatus: ExecutionStatus,
  operatorName: string,
  strategyTemplate: string,
  keywordGroups: Array<keyof KeywordGroups>,
  effectivenessScore: number
): SearchStrategyTemplate {
  return {
    id,
    operatorSource,
    executionStatus,
    operatorName,
    strategyTemplate,
    keywordGroups,
    effectivenessScore
  };
}

function mergeTerms(input: string[] | undefined, fallback: string[]) {
  return unique([...(input ?? []), ...fallback].map((item) => item.trim()).filter(Boolean));
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function mergeCustomerIntentTerms(
  input: string[] | undefined,
  fallback: string[],
  promoteChannel: boolean
) {
  return prioritizeCustomerIntentTerms(mergeTerms(input, fallback), promoteChannel);
}

const channelTemplateIds = new Set(["direct_distributor_country", "distributor_exact_scenario"]);

const channelCustomerPattern =
  /\b(channels?|channel partners?|suppliers?|distributors?|stockists?|resellers?|dealers?|wholesale|wholesalers?|importers?)\b|\u7ecf\u9500|\u5206\u9500|\u6e20\u9053|\u5e93\u5b58\u5546|\u4ee3\u7406\u5546|\u8fdb\u53e3\u5546|\u6279\u53d1/i;

function isChannelCustomerRequest(input: KeywordExpansionInput) {
  const source = input.taskText ?? "";

  return channelCustomerPattern.test(source);
}

function prioritizeCustomerIntentTerms(terms: string[], promoteChannel: boolean) {
  if (promoteChannel) {
    return terms;
  }

  const primary: string[] = [];

  for (const term of terms) {
    if (!isChannelCustomerTerm(term)) {
      primary.push(term);
    }
  }

  return primary;
}

function isChannelCustomerTerm(term: string) {
  return channelCustomerPattern.test(term);
}

function renderStrategyTemplate(
  templateText: string,
  keywordGroups: KeywordGroups,
  country: string,
  overrides: { specificProductTerms?: string[] } = {}
) {
  const productTerms = keywordGroups.productTerms.length
    ? keywordGroups.productTerms
    : ["equipment", "maintenance parts"];
  const fallbackBrandTerms = specificProductTerms(productTerms);
  const brandTerms = keywordGroups.brandTerms.length
    ? keywordGroups.brandTerms
    : fallbackBrandTerms.length
      ? fallbackBrandTerms
      : productTerms;
  const scenarioTerms = keywordGroups.scenarioTerms.length
    ? keywordGroups.scenarioTerms
    : productTerms;
  const intentTerms = keywordGroups.customerIntentTerms.length
    ? keywordGroups.customerIntentTerms
    : scenarioTerms;
  return compactRenderedSearchQuery(
    templateText
    .replaceAll(
      "{specific_product_or}",
      quoteOr(overrides.specificProductTerms ?? specificProductTerms(keywordGroups.productTerms))
    )
      .replaceAll("{product_or}", quoteOr(productTerms.slice(0, 3)))
      .replaceAll("{intent_or}", quoteOr(intentTerms.slice(0, 3)))
      .replaceAll("{brand_or}", quoteOr(brandTerms.slice(0, 3)))
      .replaceAll("{scenario_or}", quoteOr(scenarioTerms.slice(0, 3)))
    .replaceAll("{country}", country)
    .replaceAll("{country_site}", countryToSite(country))
    .replaceAll("{country_phone_code}", countryToPhoneCode(country))
    .replaceAll("{loc}", countryToLoc(country))
    .replaceAll("{exclude_terms}", excludeClause(keywordGroups.excludeTerms))
    .replaceAll("{exclude}", excludeClause(keywordGroups.excludeTerms))
    .replace(/\s+/g, " ")
      .trim()
  );
}

function quoteOr(terms: string[]) {
  return terms.map((term) => `"${term}"`).join(" OR ");
}

function excludeClause(terms: string[]) {
  return prioritizeExcludeTerms(terms)
    .slice(0, 3)
    .map(toNegativeSearchTerm)
    .filter(Boolean)
    .join(" ");
}

function prioritizeExcludeTerms(terms: string[]) {
  const priority = [
    "job",
    "jobs",
    "career",
    "careers",
    "training",
    "course",
    "forum",
    "wikipedia",
    "youtube",
    "facebook",
    "consumer phone",
    "phone accessories",
    "smartphone"
  ];
  const normalizedPriority = new Map(priority.map((term, index) => [term.toLowerCase(), index]));

  const sorted = [...terms].sort((left, right) => {
    const leftPriority = normalizedPriority.get(left.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = normalizedPriority.get(right.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.localeCompare(right);
  });
  const output: string[] = [];
  const seen = new Set<string>();

  for (const term of sorted) {
    const key = canonicalNegativeTerm(term);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(term);
  }

  return output;
}

function toNegativeSearchTerm(term: string) {
  const cleaned = term.trim();
  if (!cleaned || forbiddenContactNegativeTerms.has(cleaned.toLowerCase())) {
    return "";
  }

  return /[^A-Za-z0-9-]/.test(cleaned) ? `-"${cleaned}"` : `-${cleaned}`;
}

const forbiddenContactNegativeTerms = new Set([
  "phone",
  "contact",
  "tel",
  "email",
  "mail",
  "fax",
  "address",
  "mobile",
  "whatsapp"
]);

function canonicalNegativeTerm(term: string) {
  const normalized = term.trim().toLowerCase();
  const aliases: Record<string, string> = {
    careers: "career",
    jobs: "job",
    wikipedia: "wiki"
  };
  return aliases[normalized] ?? normalized;
}

function compactRenderedSearchQuery(query: string) {
  const withCompactGroups = query.replace(/\(([^()]*\bOR\b[^()]*)\)/gi, (match, group: string) => {
    const terms = group
      .split(/\s+OR\s+/i)
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 4);
    return terms.length > 1 ? `(${terms.join(" OR ")})` : (terms[0] ?? match);
  });
  return limitRenderedNegativeTerms(withCompactGroups, 3).replace(/\s+/g, " ").trim();
}

function limitRenderedNegativeTerms(query: string, maxTerms: number) {
  const tokens = query.split(/\s+/);
  const output: string[] = [];
  const seen = new Set<string>();
  let negatives = 0;

  for (const token of tokens) {
    if (token.startsWith("-")) {
      const key = canonicalNegativeTerm(token.toLowerCase().replace(/^-+/, "").replace(/^"|"$/g, ""));
      if (seen.has(key) || negatives >= maxTerms) {
        continue;
      }
      seen.add(key);
      negatives += 1;
    }
    output.push(token);
  }

  return output.join(" ");
}

function specificProductTerms(terms: string[]) {
  const catalogTerms = catalogSearchProductTerms(terms);
  const specific = prioritizeSpecificProductTerms(catalogTerms).slice(0, 4);
  return specific.length ? specific : terms.slice(0, 4);
}

function appendCatalogModelQueries(
  generated: GeneratedSearchQuery[],
  templates: Array<SearchStrategyTemplate & { executionStatus: "supported" | "experimental" }>,
  keywordGroups: KeywordGroups,
  countries: string[]
) {
  const modelTemplate = templates.find(
    (templateItem) => templateItem.id === "specific_model_stockist"
  );
  const chunks = specificProductTermChunks(keywordGroups.productTerms);
  if (!modelTemplate || chunks.length < 1) {
    return;
  }

  const seen = new Set(
    generated.map((query) => `${query.templateId}\n${query.country}\n${query.query}`)
  );
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    if (generated.length >= 80) {
      return;
    }

    const chunk = chunks[chunkIndex] ?? [];
    const country = countries[chunkIndex % countries.length] ?? countries[0] ?? "UAE";
    const queryText = renderStrategyTemplate(
      modelTemplate.strategyTemplate,
      keywordGroups,
      country,
      {
        specificProductTerms: chunk
      }
    );
    const key = `${modelTemplate.id}\n${country}\n${queryText}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    generated.push({
      provider: "brave",
      operatorSource: modelTemplate.operatorSource,
      executionStatus: modelTemplate.executionStatus,
      operatorName: modelTemplate.operatorName,
      strategyTemplate: modelTemplate.strategyTemplate,
      query: queryText,
      keywordGroups,
      country,
      effectivenessScore: modelTemplate.effectivenessScore,
      templateId: modelTemplate.id
    });
  }
}

function specificProductTermChunks(terms: string[]) {
  const chunkSize = 4;
  const specific = catalogSearchProductTerms(terms);
  const chunks: string[][] = [];
  for (let index = 0; index < specific.length; index += chunkSize) {
    chunks.push(specific.slice(index, index + chunkSize));
  }
  return chunks;
}

function catalogSearchProductTerms(terms: string[]) {
  return terms.filter(isCatalogSearchProductTerm);
}

function prioritizeSpecificProductTerms(terms: string[]) {
  return [...terms].sort(
    (left, right) =>
      Number(isSpecificSearchProductTerm(right)) - Number(isSpecificSearchProductTerm(left))
  );
}

function isCatalogSearchProductTerm(term: string) {
  const normalized = term.trim().toLowerCase();
  if (!normalized || genericSearchProductTerms.has(normalized)) {
    return false;
  }

  return !/\b(?:distributor|stockist|supplier|contractor|procurement|telecom equipment|spare parts)\b/i.test(
    term
  );
}

function isSpecificSearchProductTerm(term: string) {
  const normalized = term.trim().toLowerCase();
  if (!normalized || genericSearchProductTerms.has(normalized)) {
    return false;
  }

  return (
    /\d/.test(normalized) ||
    /\b(?:rru|bbu|aau|olt|sfp|xfp|umpt|ubbp|wbbp|r8882|r8862|r4850|baseband)\b/i.test(term)
  );
}

const genericSearchProductTerms = new Set([
  "equipment",
  "components",
  "spare parts",
  "industrial equipment",
  "maintenance parts",
  "replacement parts",
  "field service parts",
  "industrial components",
  "network equipment",
  "equipment spare parts replacement",
  "field service replacement parts",
  "maintenance spare parts",
  "industrial equipment replacement",
  "telecom equipment",
  "5g telecom equipment",
  "5g base station equipment",
  "radio access network equipment",
  "base station equipment",
  "ran equipment",
  "telecom power",
  "rectifier module",
  "optical module",
  "rru",
  "remote radio unit",
  "bbu",
  "baseband unit",
  "aau",
  "microwave backhaul",
  "olt",
  "telecom spare parts",
  "spare parts",
  "board"
]);

function countryToSite(country: string) {
  const genericSite = genericCountryToSite(country);
  if (genericSite !== ".com") {
    return genericSite;
  }

  const normalized = country.toLowerCase();
  const siteMap: Record<string, string> = {
    uae: ".ae",
    "united arab emirates": ".ae",
    阿联酋: ".ae",
    dubai: ".ae",
    "abu dhabi": ".ae",
    "saudi arabia": ".sa",
    沙特: ".sa",
    riyadh: ".sa",
    jeddah: ".sa",
    qatar: ".qa",
    nigeria: ".ng",
    尼日利亚: ".ng",
    kenya: ".ke",
    肯尼亚: ".ke",
    "south africa": ".za",
    indonesia: ".id",
    vietnam: ".vn",
    malaysia: ".my",
    philippines: ".ph",
    thailand: ".th",
    singapore: ".sg",
    cambodia: ".kh",
    myanmar: ".mm",
    laos: ".la",
    brazil: ".br",
    india: ".in",
    pakistan: ".pk",
    bangladesh: ".bd",
    "sri lanka": ".lk",
    nepal: ".np",
    kazakhstan: ".kz",
    uzbekistan: ".uz",
    kyrgyzstan: ".kg",
    tajikistan: ".tj",
    turkmenistan: ".tm",
    kuwait: ".kw",
    oman: ".om",
    bahrain: ".bh",
    jordan: ".jo",
    iraq: ".iq",
    turkey: ".tr",
    egypt: ".eg",
    germany: ".de",
    "united kingdom": ".uk",
    france: ".fr",
    italy: ".it",
    spain: ".es",
    poland: ".pl",
    netherlands: ".nl",
    romania: ".ro",
    "united states": ".us",
    canada: ".ca",
    mexico: ".mx",
    chile: ".cl",
    colombia: ".co",
    peru: ".pe",
    argentina: ".ar",
    ecuador: ".ec",
    "costa rica": ".cr",
    australia: ".au",
    "new zealand": ".nz",
    "papua new guinea": ".pg",
    morocco: ".ma",
    ghana: ".gh",
    ethiopia: ".et",
    tanzania: ".tz",
    uganda: ".ug",
    algeria: ".dz",
    russia: ".ru",
    俄罗斯: ".ru",
    ukraine: ".ua",
    乌克兰: ".ua"
  };

  return siteMap[normalized] ?? ".com";
}

function countryToPhoneCode(country: string) {
  const normalized = country.trim().toLowerCase();
  const codeMap: Record<string, string> = {
    uae: "971",
    "united arab emirates": "971",
    dubai: "971",
    "abu dhabi": "971",
    "saudi arabia": "966",
    riyadh: "966",
    jeddah: "966",
    qatar: "974",
    oman: "968",
    kuwait: "965",
    bahrain: "973",
    jordan: "962",
    iraq: "964",
    iran: "98",
    turkey: "90",
    egypt: "20",
    morocco: "212",
    nigeria: "234",
    kenya: "254",
    "south africa": "27",
    ghana: "233",
    tanzania: "255",
    brazil: "55",
    russia: "7",
    ukraine: "380",
    india: "91",
    indonesia: "62",
    vietnam: "84",
    malaysia: "60",
    philippines: "63",
    thailand: "66",
    mexico: "52",
    colombia: "57",
    chile: "56",
    peru: "51"
  };

  return codeMap[normalized] ?? "";
}

function countryToLoc(country: string) {
  const genericLoc = genericCountryToLoc(country);
  if (
    genericLoc !== "us" ||
    country.toLowerCase() === "united states" ||
    country.toLowerCase() === "usa"
  ) {
    return genericLoc;
  }

  const normalized = country.toLowerCase();
  const locMap: Record<string, string> = {
    uae: "ae",
    "united arab emirates": "ae",
    阿联酋: "ae",
    dubai: "ae",
    "abu dhabi": "ae",
    "saudi arabia": "sa",
    沙特: "sa",
    riyadh: "sa",
    jeddah: "sa",
    qatar: "qa",
    nigeria: "ng",
    尼日利亚: "ng",
    kenya: "ke",
    肯尼亚: "ke",
    "south africa": "za",
    indonesia: "id",
    vietnam: "vn",
    malaysia: "my",
    philippines: "ph",
    thailand: "th",
    singapore: "sg",
    cambodia: "kh",
    myanmar: "mm",
    laos: "la",
    brazil: "br",
    india: "in",
    pakistan: "pk",
    bangladesh: "bd",
    "sri lanka": "lk",
    nepal: "np",
    kazakhstan: "kz",
    uzbekistan: "uz",
    kyrgyzstan: "kg",
    tajikistan: "tj",
    turkmenistan: "tm",
    kuwait: "kw",
    oman: "om",
    bahrain: "bh",
    jordan: "jo",
    iraq: "iq",
    turkey: "tr",
    egypt: "eg",
    germany: "de",
    "united kingdom": "gb",
    france: "fr",
    italy: "it",
    spain: "es",
    poland: "pl",
    netherlands: "nl",
    romania: "ro",
    "united states": "us",
    canada: "ca",
    mexico: "mx",
    chile: "cl",
    colombia: "co",
    peru: "pe",
    argentina: "ar",
    ecuador: "ec",
    "costa rica": "cr",
    australia: "au",
    "new zealand": "nz",
    "papua new guinea": "pg",
    morocco: "ma",
    ghana: "gh",
    ethiopia: "et",
    tanzania: "tz",
    uganda: "ug",
    algeria: "dz",
    russia: "ru",
    俄罗斯: "ru",
    ukraine: "ua",
    乌克兰: "ua"
  };

  return locMap[normalized] ?? "us";
}
