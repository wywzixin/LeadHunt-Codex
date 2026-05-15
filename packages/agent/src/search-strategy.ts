import { expandLeadKeywords, type KeywordExpansionInput } from "./keyword-expansion.js";
import { countryToLoc as genericCountryToLoc, countryToSite as genericCountryToSite } from "./country-market.js";

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

export const defaultKeywordGroups: KeywordGroups = {
  brandTerms: ["Huawei", "ZTE", "Ericsson", "Nokia", "Eltek", "Delta", "Vertiv"],
  productTerms: [
    "telecom equipment",
    "telecom spare parts",
    "5G telecom equipment",
    "5G base station equipment",
    "radio access network equipment",
    "base station spare parts",
    "RRU",
    "BBU",
    "AAU",
    "microwave backhaul",
    "telecom power",
    "optical module",
    "spare parts"
  ],
  longTailProductTerms: [
    "base station spare parts replacement",
    "Huawei RRU spare parts",
    "ZTE BBU boards",
    "telecom power rectifier module",
    "microwave backhaul spare parts",
    "5G RAN spare parts",
    "refurbished telecom equipment"
  ],
  customerIntentTerms: [
    "network maintenance company",
    "base station maintenance company",
    "RAN maintenance",
    "cell site maintenance",
    "telecom field services",
    "tower maintenance company",
    "tower company",
    "wireless infrastructure contractor",
    "telecom power maintenance",
    "telecom contractor",
    "telecom system integrator",
    "system integrator",
    "mobile network operator",
    "telecom operator procurement",
    "vendor registration",
    "ISP network operations",
    "WISP",
    "FTTH operator",
    "equipment repair service",
    "spare parts management",
    "project procurement",
    "purchasing",
    "procurement",
    "telecom equipment distributor",
    "stockist",
    "distributor",
    "turnkey contractor",
    "importer",
    "project supply"
  ],
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
  scenarioTerms: [
    "telecom infrastructure",
    "5G network rollout",
    "network rollout",
    "site maintenance",
    "base station maintenance",
    "RAN maintenance",
    "cell site maintenance",
    "tower maintenance",
    "telecom power maintenance",
    "rectifier replacement",
    "spare parts replacement",
    "FTTH network maintenance",
    "tower power",
    "IBS solution",
    "equipment replacement"
  ],
  excludeTerms: [
    "job",
    "jobs",
    "career",
    "training",
    "course",
    "news",
    "blog",
    "forum",
    "directory",
    "yellow pages",
    "supplier directory",
    "company directory",
    "trade directory",
    "youtube",
    "facebook",
    "linkedin",
    "wiki",
    "consumer",
    "consumer phone",
    "phone accessories",
    "smartphone",
    "marketplace",
    "B2B marketplace",
    "Alibaba",
    "Accio",
    "TradeWheel",
    "Made-in-China",
    "GlobalSources",
    "IndiaMART",
    "TradeIndia",
    "EC21",
    "ExportHub",
    "Go4WorldBusiness",
    "Amazon",
    "AliExpress",
    "China",
    "Chinese",
    "cn"
  ]
};

const operatorCatalog: SearchStrategyTemplate[] = [
  operator("exact_phrase", "brave_official", "experimental", "\"keyword phrase\"", ["productTerms"], 0.78),
  operator("negative_term", "brave_official", "manual_only", "-job -training -news", ["excludeTerms"], 0.82),
  operator("boolean_or", "brave_official", "experimental", "(term OR term)", ["productTerms"], 0.76),
  operator("site", "brave_official", "experimental", "site:.ae", ["marketTerms"], 0.73),
  operator("filetype", "brave_official", "experimental", "filetype:pdf", ["scenarioTerms"], 0.71),
  operator("intitle", "brave_official", "experimental", "intitle:\"telecom equipment\"", ["productTerms"], 0.69),
  operator("inpage", "brave_official", "disabled", "inpage:telecom", ["productTerms"], 0.64),
  operator("loc_lang", "brave_official", "disabled", "loc:ae lang:en", ["marketTerms"], 0.62),
  operator("google_exact_phrase", "google_official", "experimental", "\"keyword phrase\"", ["productTerms"], 0.66),
  operator("google_site", "google_official", "experimental", "site:example.com", ["marketTerms"], 0.6),
  operator("common_inurl", "common_seo", "manual_only", "inurl:distributor", ["customerIntentTerms"], 0.4),
  operator("common_intext", "common_seo", "manual_only", "intext:\"telecom equipment\"", ["productTerms"], 0.38),
  operator("common_allintitle", "common_seo", "disabled", "allintitle:telecom equipment", ["productTerms"], 0.2),
  operator("common_related_cache", "common_seo", "disabled", "related: cache:", ["productTerms"], 0.1)
];

const executableTemplates: SearchStrategyTemplate[] = [
  template(
    "maintenance_company_contact",
    "brave_official",
    "experimental",
    "maintenance_company contact",
    "(\"base station maintenance\" OR \"RAN maintenance\" OR \"cell site maintenance\" OR \"network maintenance company\") (telecom OR \"mobile network\" OR 5G) {country} (\"contact\" OR \"about us\" OR services) {exclude}",
    ["scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.98
  ),
  template(
    "ran_field_service",
    "brave_official",
    "experimental",
    "ran_field_service buyer_profile",
    "(\"telecom field services\" OR \"RAN services\" OR \"radio access network maintenance\") (\"base station\" OR RRU OR BBU OR AAU) {country} {exclude}",
    ["productTerms", "scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.97
  ),
  template(
    "tower_company_maintenance",
    "brave_official",
    "experimental",
    "towerco_maintenance buyer_profile",
    "(\"tower maintenance\" OR \"cell tower services\" OR \"tower company\" OR towerco) (telecom OR \"mobile network\" OR \"base station\") {country} {exclude}",
    ["scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.96
  ),
  template(
    "telecom_power_maintenance",
    "brave_official",
    "experimental",
    "power_maintenance buyer_profile",
    "(\"telecom power maintenance\" OR \"cell site power\" OR \"rectifier replacement\" OR \"48V power system\") (rectifier OR \"power module\" OR Eltek OR Huawei) {country} {exclude}",
    ["productTerms", "scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.95
  ),
  template(
    "wireless_infrastructure_contractor",
    "brave_official",
    "experimental",
    "contractor buyer_profile",
    "(\"wireless infrastructure contractor\" OR \"telecom infrastructure contractor\" OR \"network rollout contractor\") (\"base station\" OR RAN OR 5G) {country} {exclude}",
    ["productTerms", "scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.94
  ),
  template(
    "ftth_isp_operations",
    "brave_official",
    "experimental",
    "isp_operations buyer_profile",
    "(ISP OR WISP OR \"FTTH operator\" OR \"fiber network operator\") (\"network operations\" OR maintenance OR procurement) (OLT OR SFP OR \"optical module\" OR telecom) {country} {exclude}",
    ["productTerms", "scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.93
  ),
  template(
    "operator_vendor_registration",
    "brave_official",
    "experimental",
    "operator_procurement buyer_signal",
    "(\"mobile network operator\" OR \"telecom operator\" OR carrier) (\"vendor registration\" OR \"supplier registration\" OR procurement OR purchasing) (\"telecom equipment\" OR \"base station\" OR 5G) {country} {exclude}",
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.92
  ),
  template(
    "direct_integrator_contact",
    "brave_official",
    "experimental",
    "direct_company contact",
    "(\"telecom system integrator\" OR \"telecom contractor\" OR \"network rollout contractor\") {country} (\"contact\" OR \"about\" OR \"services\" OR \"projects\") {exclude}",
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.91
  ),
  template(
    "company_contact_broad",
    "brave_official",
    "experimental",
    "contact_page buyer_profile",
    "(\"telecom infrastructure\" OR \"base station equipment\" OR \"radio access network\") (\"contact\" OR \"about us\" OR \"services\" OR \"projects\") {country} {exclude}",
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.9
  ),
  template(
    "radio_parts_service_repair",
    "brave_official",
    "experimental",
    "radio_parts service_profile",
    "(\"RRU\" OR \"BBU\" OR \"AAU\") (maintenance OR repair OR replacement OR \"spare parts management\") (telecom OR \"base station\") {country} {exclude}",
    ["productTerms", "scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.89
  ),
  template(
    "specific_model_stockist",
    "brave_official",
    "experimental",
    "catalog_model service_profile",
    "({specific_product_or}) (maintenance OR repair OR replacement OR \"spare parts\") (telecom OR \"base station\" OR RAN) {country} {exclude}",
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.88
  ),
  template(
    "spare_parts_repair_inventory",
    "brave_official",
    "experimental",
    "spare_parts_management buyer_profile",
    "(\"telecom spare parts\" OR \"base station spare parts\" OR \"RAN spare parts\") (\"spare parts management\" OR repair OR maintenance OR replacement) {country} {exclude}",
    ["longTailProductTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.87
  ),
  template(
    "regional_projects_signal",
    "brave_official",
    "experimental",
    "project_delivery buyer_profile",
    "(\"telecom infrastructure\" OR \"5G network rollout\" OR \"base station\") (project OR implementation OR deployment OR contractor) {country} {exclude}",
    ["scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.86
  ),
  template(
    "das_small_cell_integrator",
    "brave_official",
    "experimental",
    "das_private_5g buyer_profile",
    "(DAS OR \"small cell\" OR \"private 5G\") (\"system integrator\" OR contractor OR maintenance) {country} {exclude}",
    ["productTerms", "scenarioTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.84
  ),
  template(
    "pdf_company_brochure",
    "brave_official",
    "experimental",
    "filetype company_profile",
    "filetype:pdf (\"telecom infrastructure\" OR \"network maintenance\" OR \"base station\") (\"company profile\" OR brochure OR contact OR projects) {country} {exclude}",
    ["productTerms", "scenarioTerms", "marketTerms", "excludeTerms"],
    0.8
  ),
  template(
    "direct_distributor_country",
    "brave_official",
    "experimental",
    "secondary_distributor buyer_profile",
    "(\"telecom equipment distributor\" OR \"telecom spare parts stockist\" OR \"telecom equipment stockist\") {country} {exclude}",
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.74
  ),
  template(
    "intitle_integrator_country",
    "brave_official",
    "experimental",
    "intitle buyer_profile",
    "intitle:\"telecom\" (\"system integrator\" OR contractor OR maintenance OR distributor OR stockist) {country} {exclude}",
    ["customerIntentTerms", "marketTerms", "excludeTerms"],
    0.72
  ),
  template(
    "brand_repair_parts_services",
    "brave_official",
    "experimental",
    "brand_repair buyer_profile",
    "({brand_or}) (repair OR refurbished OR maintenance OR \"spare parts\") (telecom OR RRU OR BBU OR \"base station\") {country} {exclude}",
    ["brandTerms", "productTerms", "marketTerms", "excludeTerms"],
    0.71
  ),
  template(
    "procurement_signal_broad",
    "google_official",
    "experimental",
    "procurement buyer_signal",
    "(\"procurement\" OR \"purchasing\" OR RFQ OR tender) (\"telecom equipment\" OR \"base station\" OR \"5G\") {country} {exclude}",
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.68
  ),
  template(
    "distributor_exact_scenario",
    "google_official",
    "experimental",
    "exact_phrase boolean_or",
    "\"telecom equipment distributor\" ({scenario_or}) {country} {exclude}",
    ["customerIntentTerms", "scenarioTerms", "marketTerms", "excludeTerms"],
    0.62
  ),
  template(
    "tower_power_ibs",
    "brave_official",
    "experimental",
    "exact_phrase buyer_profile",
    "(\"tower power\" OR \"IBS service\" OR \"site maintenance\") (\"telecom\" OR \"mobile network\") {country} {exclude}",
    ["scenarioTerms", "marketTerms", "excludeTerms"],
    0.62
  ),
  template(
    "language_contractor",
    "brave_official",
    "experimental",
    "contractor boolean_or",
    "(\"telecom contractor\" OR \"network rollout\" OR \"network maintenance\") {country} {exclude}",
    ["customerIntentTerms", "scenarioTerms", "marketTerms", "excludeTerms"],
    0.61
  ),
  template(
    "required_term_stockist",
    "brave_official",
    "experimental",
    "required_term boolean_or",
    "+telecom (\"RRU\" OR \"BBU\") (maintenance OR repair OR stockist OR distributor) {country} {exclude}",
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.6
  ),
  template(
    "site_country_company_contact",
    "brave_official",
    "experimental",
    "site company_contact",
    "site:{country_site} (\"telecom infrastructure\" OR \"RRU\" OR \"BBU\") (maintenance OR contractor OR \"system integrator\" OR contact) {country} {exclude}",
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.59
  ),
  template(
    "brand_parts_country_site",
    "brave_official",
    "experimental",
    "site boolean_or",
    "({brand_or}) (\"RRU\" OR \"BBU\" OR \"AAU\") (\"spare parts\" OR \"repair\" OR replacement OR maintenance) site:{country_site} {country} {exclude}",
    ["brandTerms", "productTerms", "marketTerms", "excludeTerms"],
    0.58
  ),
  template(
    "operator_vendor_signal",
    "brave_official",
    "experimental",
    "operator_procurement buyer_signal",
    "site:{country_site} (\"mobile network operator\" OR \"telecom operator\" OR carrier) (\"vendor registration\" OR \"supplier registration\" OR procurement) (\"5G\" OR telecom) {country} {exclude}",
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.57
  )
];

const nonExecutableTemplates: SearchStrategyTemplate[] = [
  template(
    "marketplace_directory_discovery",
    "common_seo",
    "manual_only",
    "directory_discovery",
    "(\"telecom equipment\" OR \"RRU\" OR \"BBU\") (\"supplier directory\" OR marketplace OR B2B OR importer) {country} {exclude}",
    ["productTerms", "customerIntentTerms", "marketTerms", "excludeTerms"],
    0.24
  ),
  template(
    "manual_inurl_distributor",
    "common_seo",
    "manual_only",
    "inurl",
    "inurl:distributor \"telecom equipment\" {country}",
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
    customerIntentTerms: mergeTerms(expanded.customerIntentTerms, defaultKeywordGroups.customerIntentTerms),
    marketTerms: expanded.marketTerms.length ? expanded.marketTerms : defaultKeywordGroups.marketTerms,
    scenarioTerms: mergeTerms(expanded.scenarioTerms, defaultKeywordGroups.scenarioTerms),
    excludeTerms: mergeTerms(expanded.excludeTerms, defaultKeywordGroups.excludeTerms)
  };
}

export function generateSearchQueries(input: SearchStrategyInput = {}): GeneratedSearchQuery[] {
  const keywordGroups = createKeywordGroups(input);
  const countries = keywordGroups.marketTerms.length ? keywordGroups.marketTerms : ["UAE"];
  const requestedMinimum = input.minQueryCount ?? 15;
  const minimum = Math.min(Math.max(requestedMinimum, countries.length), 80);
  const templates = getExecutableSearchStrategyTemplates();
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
  return { id, operatorSource, executionStatus, operatorName, strategyTemplate, keywordGroups, effectivenessScore };
}

function mergeTerms(input: string[] | undefined, fallback: string[]) {
  return unique([...(input ?? []), ...fallback].map((item) => item.trim()).filter(Boolean));
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function renderStrategyTemplate(
  templateText: string,
  keywordGroups: KeywordGroups,
  country: string,
  overrides: { specificProductTerms?: string[] } = {}
) {
  return templateText
    .replaceAll(
      "{specific_product_or}",
      quoteOr(overrides.specificProductTerms ?? specificProductTerms(keywordGroups.productTerms))
    )
    .replaceAll("{product_or}", quoteOr(keywordGroups.productTerms.slice(1, 5)))
    .replaceAll("{intent_or}", quoteOr(keywordGroups.customerIntentTerms.slice(0, 4)))
    .replaceAll("{brand_or}", quoteOr(keywordGroups.brandTerms.slice(0, 4)))
    .replaceAll("{scenario_or}", quoteOr(keywordGroups.scenarioTerms.slice(0, 4)))
    .replaceAll("{country}", country)
    .replaceAll("{country_site}", countryToSite(country))
    .replaceAll("{loc}", countryToLoc(country))
    .replaceAll("{exclude_terms}", excludeClause(keywordGroups.excludeTerms))
    .replaceAll("{exclude}", excludeClause(keywordGroups.excludeTerms))
    .replace(/\s+/g, " ")
    .trim();
}

function quoteOr(terms: string[]) {
  return terms.map((term) => `"${term}"`).join(" OR ");
}

function excludeClause(terms: string[]) {
  return prioritizeExcludeTerms(terms)
    .slice(0, 14)
    .map(toNegativeSearchTerm)
    .join(" ");
}

function prioritizeExcludeTerms(terms: string[]) {
  const priority = [
    "job",
    "jobs",
    "career",
    "training",
    "course",
    "news",
    "blog",
    "forum",
    "marketplace",
    "directory",
    "yellow pages",
    "supplier directory",
    "Alibaba",
    "Accio",
    "TradeWheel",
    "Made-in-China",
    "GlobalSources",
    "IndiaMART"
  ];
  const normalizedPriority = new Map(priority.map((term, index) => [term.toLowerCase(), index]));

  return [...terms].sort((left, right) => {
    const leftPriority = normalizedPriority.get(left.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = normalizedPriority.get(right.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.localeCompare(right);
  });
}

function toNegativeSearchTerm(term: string) {
  const cleaned = term.trim();
  if (!cleaned) {
    return "";
  }

  return /[^A-Za-z0-9-]/.test(cleaned) ? `-"${cleaned}"` : `-${cleaned}`;
}

function specificProductTerms(terms: string[]) {
  const catalogTerms = catalogSearchProductTerms(terms);
  const specific = prioritizeSpecificProductTerms(catalogTerms).slice(0, 4);
  return specific.length ? specific : terms.slice(1, 5);
}

function appendCatalogModelQueries(
  generated: GeneratedSearchQuery[],
  templates: Array<SearchStrategyTemplate & { executionStatus: "supported" | "experimental" }>,
  keywordGroups: KeywordGroups,
  countries: string[]
) {
  const modelTemplate = templates.find((templateItem) => templateItem.id === "specific_model_stockist");
  const chunks = specificProductTermChunks(keywordGroups.productTerms);
  if (!modelTemplate || chunks.length < 1) {
    return;
  }

  const seen = new Set(generated.map((query) => `${query.templateId}\n${query.country}\n${query.query}`));
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    if (generated.length >= 80) {
      return;
    }

    const chunk = chunks[chunkIndex] ?? [];
    const country = countries[chunkIndex % countries.length] ?? countries[0] ?? "UAE";
    const queryText = renderStrategyTemplate(modelTemplate.strategyTemplate, keywordGroups, country, {
      specificProductTerms: chunk
    });
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
    (left, right) => Number(isSpecificSearchProductTerm(right)) - Number(isSpecificSearchProductTerm(left))
  );
}

function isCatalogSearchProductTerm(term: string) {
  const normalized = term.trim().toLowerCase();
  if (!normalized || genericSearchProductTerms.has(normalized)) {
    return false;
  }

  return !/\b(?:distributor|stockist|supplier|contractor|procurement|telecom equipment|spare parts)\b/i.test(term);
}

function isSpecificSearchProductTerm(term: string) {
  const normalized = term.trim().toLowerCase();
  if (!normalized || genericSearchProductTerms.has(normalized)) {
    return false;
  }

  return /\d/.test(normalized) || /\b(?:rru|bbu|aau|olt|sfp|xfp|umpt|ubbp|wbbp|r8882|r8862|r4850|baseband)\b/i.test(term);
}

const genericSearchProductTerms = new Set([
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
    "阿联酋": ".ae",
    dubai: ".ae",
    "abu dhabi": ".ae",
    "saudi arabia": ".sa",
    "沙特": ".sa",
    riyadh: ".sa",
    jeddah: ".sa",
    qatar: ".qa",
    nigeria: ".ng",
    "尼日利亚": ".ng",
    kenya: ".ke",
    "肯尼亚": ".ke",
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
    "俄罗斯": ".ru",
    ukraine: ".ua",
    "乌克兰": ".ua"
  };

  return siteMap[normalized] ?? ".com";
}

function countryToLoc(country: string) {
  const genericLoc = genericCountryToLoc(country);
  if (genericLoc !== "us" || country.toLowerCase() === "united states" || country.toLowerCase() === "usa") {
    return genericLoc;
  }

  const normalized = country.toLowerCase();
  const locMap: Record<string, string> = {
    uae: "ae",
    "united arab emirates": "ae",
    "阿联酋": "ae",
    dubai: "ae",
    "abu dhabi": "ae",
    "saudi arabia": "sa",
    "沙特": "sa",
    riyadh: "sa",
    jeddah: "sa",
    qatar: "qa",
    nigeria: "ng",
    "尼日利亚": "ng",
    kenya: "ke",
    "肯尼亚": "ke",
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
    "俄罗斯": "ru",
    ukraine: "ua",
    "乌克兰": "ua"
  };

  return locMap[normalized] ?? "us";
}
