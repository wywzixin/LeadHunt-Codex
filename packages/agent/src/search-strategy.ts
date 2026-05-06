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
    "5G telecom equipment",
    "5G base station equipment",
    "radio access network equipment",
    "RRU",
    "BBU",
    "AAU",
    "microwave backhaul",
    "telecom power",
    "optical module",
    "spare parts"
  ],
  longTailProductTerms: [
    "Huawei RRU spare parts",
    "ZTE BBU boards",
    "telecom power rectifier module",
    "microwave backhaul spare parts",
    "5G RAN spare parts",
    "refurbished telecom equipment"
  ],
  customerIntentTerms: [
    "telecom equipment distributor",
    "distributor",
    "stockist",
    "system integrator",
    "telecom system integrator",
    "telecom contractor",
    "turnkey contractor",
    "importer",
    "project supply",
    "project procurement",
    "purchasing",
    "procurement",
    "network maintenance company",
    "telecom operator procurement"
  ],
  marketTerms: [
    "UAE",
    "Saudi Arabia",
    "Qatar",
    "Oman",
    "Iran",
    "Israel",
    "Ukraine",
    "Russia",
    "United States",
    "Germany",
    "United Kingdom",
    "Brazil",
    "Chile",
    "Nigeria",
    "South Africa"
  ],
  scenarioTerms: [
    "telecom infrastructure",
    "5G network rollout",
    "network rollout",
    "site maintenance",
    "base station maintenance",
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
    "youtube",
    "facebook",
    "linkedin",
    "wiki",
    "consumer",
    "marketplace",
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
    "direct_distributor_country",
    "brave_official",
    "experimental",
    "direct_company buyer_profile",
    "(\"telecom equipment distributor\" OR \"telecom spare parts stockist\" OR \"telecom equipment stockist\") {country}",
    ["productTerms", "customerIntentTerms", "marketTerms"],
    0.96
  ),
  template(
    "direct_integrator_contact",
    "brave_official",
    "experimental",
    "direct_company contact",
    "(\"telecom system integrator\" OR \"telecom contractor\" OR \"network rollout contractor\") {country} (\"contact\" OR \"about\" OR \"services\" OR \"projects\")",
    ["productTerms", "customerIntentTerms", "marketTerms"],
    0.94
  ),
  template(
    "radio_parts_stockist",
    "brave_official",
    "experimental",
    "radio_parts buyer_profile",
    "(\"RRU\" OR \"BBU\" OR \"AAU\") (\"distributor\" OR \"stockist\" OR \"spare parts\" OR \"repair\") {country}",
    ["productTerms", "customerIntentTerms", "marketTerms"],
    0.93
  ),
  template(
    "specific_model_stockist",
    "brave_official",
    "experimental",
    "catalog_model buyer_profile",
    "({specific_product_or}) (\"telecom spare parts\" OR stockist OR distributor OR supplier) {country}",
    ["productTerms", "customerIntentTerms", "marketTerms"],
    0.92
  ),
  template(
    "brand_equipment_supplier",
    "brave_official",
    "experimental",
    "brand_parts buyer_profile",
    "({brand_or}) (\"telecom equipment\" OR \"RRU\" OR \"BBU\" OR \"AAU\") (\"supplier\" OR \"stockist\" OR \"distributor\") {country}",
    ["brandTerms", "productTerms", "customerIntentTerms", "marketTerms"],
    0.91
  ),
  template(
    "network_maintenance_company",
    "brave_official",
    "experimental",
    "maintenance buyer_profile",
    "(\"network maintenance company\" OR \"site maintenance\" OR \"base station maintenance\") (\"telecom\" OR \"5G\" OR \"mobile network\") {country}",
    ["scenarioTerms", "customerIntentTerms", "marketTerms"],
    0.9
  ),
  template(
    "microwave_power_service",
    "brave_official",
    "experimental",
    "specialized_service buyer_profile",
    "(\"microwave backhaul\" OR \"telecom power\" OR \"rectifier module\") (\"system integrator\" OR \"maintenance\" OR \"supplier\") {country}",
    ["productTerms", "scenarioTerms", "marketTerms"],
    0.88
  ),
  template(
    "company_contact_broad",
    "brave_official",
    "experimental",
    "contact_page buyer_profile",
    "(\"telecom equipment\" OR \"telecom spare parts\" OR \"base station equipment\") (\"contact\" OR \"about us\" OR \"products\" OR \"services\") {country}",
    ["productTerms", "customerIntentTerms", "marketTerms"],
    0.87
  ),
  template(
    "procurement_signal_broad",
    "brave_official",
    "experimental",
    "procurement buyer_signal",
    "(\"procurement\" OR \"purchasing\" OR RFQ OR tender) (\"telecom equipment\" OR \"base station\" OR \"5G\") {country}",
    ["productTerms", "customerIntentTerms", "marketTerms"],
    0.84
  ),
  template(
    "marketplace_directory_discovery",
    "brave_official",
    "experimental",
    "directory_discovery buyer_profile",
    "(\"telecom equipment\" OR \"RRU\" OR \"BBU\") (\"supplier directory\" OR marketplace OR B2B OR importer) {country}",
    ["productTerms", "customerIntentTerms", "marketTerms"],
    0.8
  ),
  template(
    "regional_projects_signal",
    "brave_official",
    "experimental",
    "project_delivery buyer_profile",
    "(\"telecom infrastructure\" OR \"5G network rollout\" OR \"base station\") (project OR implementation OR deployment OR contractor) {country}",
    ["scenarioTerms", "customerIntentTerms", "marketTerms"],
    0.82
  ),
  template(
    "pdf_company_brochure",
    "brave_official",
    "experimental",
    "filetype company_profile",
    "filetype:pdf \"telecom equipment\" (\"company profile\" OR brochure OR contact OR projects) {country}",
    ["productTerms", "scenarioTerms", "marketTerms"],
    0.78
  ),
  template(
    "spare_parts_inventory",
    "brave_official",
    "experimental",
    "stock_inventory buyer_profile",
    "(\"telecom spare parts\" OR \"telecom inventory\" OR \"Huawei ZTE spare parts\") (stock OR inventory OR supplier OR stockist) {country}",
    ["longTailProductTerms", "customerIntentTerms", "marketTerms"],
    0.79
  ),
  template(
    "intitle_integrator_country",
    "brave_official",
    "experimental",
    "intitle buyer_profile",
    "intitle:\"telecom\" (distributor OR stockist OR \"system integrator\" OR contractor) {country}",
    ["customerIntentTerms", "marketTerms"],
    0.76
  ),
  template(
    "brand_repair_parts_services",
    "brave_official",
    "experimental",
    "brand_repair buyer_profile",
    "({brand_or}) (repair OR refurbished OR \"spare parts\") (telecom OR RRU OR BBU) {country}",
    ["brandTerms", "productTerms", "marketTerms"],
    0.75
  ),
  template(
    "operator_procurement_contact",
    "google_official",
    "experimental",
    "operator_procurement buyer_signal",
    "(\"mobile network operator\" OR \"telecom operator\" OR carrier) (\"procurement contact\" OR partners OR tender) (\"5G\" OR \"telecom equipment\") {country}",
    ["productTerms", "customerIntentTerms", "marketTerms"],
    0.64
  ),
  template(
    "distributor_exact_scenario",
    "google_official",
    "experimental",
    "exact_phrase boolean_or",
    "\"telecom equipment distributor\" ({scenario_or}) {country}",
    ["customerIntentTerms", "scenarioTerms", "marketTerms"],
    0.63
  ),
  template(
    "tower_power_ibs",
    "brave_official",
    "experimental",
    "exact_phrase buyer_profile",
    "(\"tower power\" OR \"IBS service\" OR \"site maintenance\") (\"telecom\" OR \"mobile network\") {country}",
    ["scenarioTerms", "marketTerms"],
    0.62
  ),
  template(
    "language_contractor",
    "brave_official",
    "experimental",
    "contractor boolean_or",
    "(\"telecom contractor\" OR \"network rollout\" OR \"network maintenance\") {country}",
    ["customerIntentTerms", "scenarioTerms", "marketTerms"],
    0.61
  ),
  template(
    "required_term_stockist",
    "brave_official",
    "experimental",
    "required_term boolean_or",
    "+telecom (\"RRU\" OR \"BBU\") (\"stockist\" OR \"distributor\") {country}",
    ["productTerms", "customerIntentTerms", "marketTerms"],
    0.69
  ),
  template(
    "site_country_company_contact",
    "brave_official",
    "experimental",
    "site company_contact",
    "site:{country_site} (\"telecom equipment\" OR \"RRU\" OR \"BBU\") (\"distributor\" OR stockist OR \"system integrator\" OR contact) {country}",
    ["productTerms", "customerIntentTerms", "marketTerms"],
    0.68
  ),
  template(
    "brand_parts_country_site",
    "brave_official",
    "experimental",
    "site boolean_or",
    "({brand_or}) (\"RRU\" OR \"BBU\" OR \"AAU\") (\"spare parts\" OR \"repair\" OR stock OR maintenance) site:{country_site} {country}",
    ["brandTerms", "productTerms", "marketTerms"],
    0.66
  ),
  template(
    "operator_vendor_signal",
    "brave_official",
    "experimental",
    "operator_procurement buyer_signal",
    "site:{country_site} (\"mobile network operator\" OR \"telecom operator\" OR carrier) (\"vendor registration\" OR \"supplier registration\" OR procurement) (\"5G\" OR telecom) {country}",
    ["productTerms", "customerIntentTerms", "marketTerms"],
    0.58
  )
];

const nonExecutableTemplates: SearchStrategyTemplate[] = [
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
    .replaceAll("{exclude}", "")
    .replace(/\s+/g, " ")
    .trim();
}

function quoteOr(terms: string[]) {
  return terms.map((term) => `"${term}"`).join(" OR ");
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
  if (!modelTemplate || chunks.length <= 1) {
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
