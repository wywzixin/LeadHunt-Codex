export type KeywordExpansionInput = {
  taskText?: string;
  productProfileUrls?: string[];
  productProfileNotes?: string;
  referenceCustomerUrls?: string[];
  crmSampleNames?: string[];
  customerProfileNotes?: string;
  targetMarkets?: string[];
  productTerms?: string[];
  customerIntentTerms?: string[];
  scenarioTerms?: string[];
};

export type ExpandedKeywords = {
  mainProductTerms: string[];
  relatedProductTerms: string[];
  longTailProductTerms: string[];
  upstreamDownstreamTerms: string[];
  customerIntentTerms: string[];
  marketTerms: string[];
  scenarioTerms: string[];
  excludeTerms: string[];
};

type ProfileHints = Partial<ExpandedKeywords>;

const defaultMainProducts = [
  "equipment",
  "components",
  "spare parts",
  "industrial equipment",
  "telecom equipment"
];

const defaultRelatedProducts = [
  "maintenance parts",
  "replacement parts",
  "field service parts",
  "spare parts",
  "industrial components",
  "network equipment",
  "5G telecom equipment",
  "5G base station equipment",
  "radio access network equipment",
  "base station spare parts",
  "RRU",
  "BBU",
  "AAU",
  "microwave backhaul",
  "telecom power",
  "remote radio unit",
  "baseband unit",
  "rectifier module",
  "optical module"
];

const defaultLongTailProducts = [
  "equipment spare parts replacement",
  "field service replacement parts",
  "maintenance spare parts",
  "industrial equipment replacement",
  "base station spare parts replacement",
  "Huawei ZTE spare parts",
  "Huawei RRU spare parts",
  "ZTE BBU boards",
  "telecom power rectifier module",
  "microwave backhaul spare parts",
  "5G RAN spare parts",
  "tower power IBS service"
];

const defaultUpstreamDownstreamTerms = [
  "system integration",
  "engineering services",
  "maintenance services",
  "power module",
  "RF module",
  "antenna feeder",
  "site power",
  "IBS solution",
  "equipment refurbishment"
];

const primaryCustomerIntentTerms = [
  "maintenance company",
  "network maintenance company",
  "base station maintenance company",
  "RAN maintenance",
  "cell site maintenance",
  "telecom field services",
  "field service company",
  "service provider",
  "operations company",
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
  "turnkey contractor",
  "engineering contractor",
  "tower contractor",
  "project supply"
];

const channelCustomerIntentTerms = [
  "supplier",
  "telecom equipment distributor",
  "stockist",
  "distributor",
  "reseller",
  "dealer",
  "wholesaler",
  "telecom importer"
];

const defaultScenarioTerms = [
  "B2B buyer scenario",
  "equipment replacement",
  "maintenance service",
  "project procurement",
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
  "IBS service",
  "equipment replacement"
];

const defaultMarketTerms = [
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
];

const defaultExcludeTerms = [
  "job",
  "jobs",
  "career",
  "training",
  "consumer phone",
  "consumer",
  "course",
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
];

const marketMatchers: Array<{ terms: string[]; patterns: RegExp[] }> = [
  {
    terms: expandMarketMacro("Global"),
    patterns: [/global/i, /worldwide/i, /all countries/i, /all markets/i, /\u5168\u7403/]
  },
  {
    terms: expandMarketMacro("Asia"),
    patterns: [/(?<!central )(?<!south )(?<!southeast )\basia\b/i, /apac/i, /\u4e9a\u6d32/]
  },
  {
    terms: expandMarketMacro("Southeast Asia"),
    patterns: [/southeast asia/i, /asean/i, /\u4e1c\u5357\u4e9a/]
  },
  {
    terms: expandMarketMacro("South Asia"),
    patterns: [/south asia/i, /\u5357\u4e9a/]
  },
  {
    terms: expandMarketMacro("Central Asia"),
    patterns: [/central asia/i, /\u4e2d\u4e9a/]
  },
  {
    terms: expandMarketMacro("Middle East"),
    patterns: [/middle east/i, /\bmena\b/i, /\u4e2d\u4e1c/]
  },
  {
    terms: expandMarketMacro("GCC"),
    patterns: [/\bgcc\b/i, /gulf countries/i, /\u6d77\u6e7e\u56fd\u5bb6/]
  },
  {
    terms: expandMarketMacro("Europe"),
    patterns: [/\beurope\b/i, /\u6b27\u6d32/]
  },
  {
    terms: expandMarketMacro("Africa"),
    patterns: [/\bafrica\b/i, /\u975e\u6d32/]
  },
  {
    terms: expandMarketMacro("North America"),
    patterns: [/north america/i, /\u5317\u7f8e|\u5317\u7f8e\u6d32/]
  },
  {
    terms: expandMarketMacro("Latin America"),
    patterns: [/latin america/i, /\blatam\b/i, /\u62c9\u7f8e/]
  },
  {
    terms: expandMarketMacro("Americas"),
    patterns: [/americas/i, /(?<!\u5317)\u7f8e\u6d32/]
  },
  {
    terms: expandMarketMacro("Oceania"),
    patterns: [/oceania/i, /\u5927\u6d0b\u6d32/]
  },
  { terms: ["Canada"], patterns: [/canada/i, /\u52a0\u62ff\u5927/] },
  { terms: ["Australia"], patterns: [/australia/i, /\u6fb3\u5927\u5229\u4e9a|\u6fb3\u6d32/] },
  {
    terms: ["UAE", "Dubai", "Abu Dhabi"],
    patterns: [/uae/i, /united arab emirates/i, /dubai/i, /abu dhabi/i, /\u963f\u8054\u914b/]
  },
  {
    terms: ["Saudi Arabia", "Riyadh", "Jeddah"],
    patterns: [/saudi/i, /riyadh/i, /jeddah/i, /\u6c99\u7279|\u963f\u62c9\u4f2f/]
  },
  { terms: ["Qatar", "Doha"], patterns: [/qatar/i, /doha/i, /\u5361\u5854\u5c14/] },
  { terms: ["Iran"], patterns: [/iran/i, /\u4f0a\u6717/] },
  { terms: ["Israel"], patterns: [/israel/i, /\u4ee5\u8272\u5217/] },
  { terms: ["Nigeria", "Lagos"], patterns: [/nigeria/i, /lagos/i, /\u5c3c\u65e5\u5229\u4e9a/] },
  { terms: ["Kenya", "Nairobi"], patterns: [/kenya/i, /nairobi/i, /\u80af\u5c3c\u4e9a/] },
  { terms: ["South Africa"], patterns: [/south africa/i, /\u5357\u975e/] },
  { terms: ["Indonesia"], patterns: [/indonesia/i, /\u5370\u5c3c|\u5370\u5ea6\u5c3c\u897f\u4e9a/] },
  { terms: ["Brazil"], patterns: [/brazil/i, /\u5df4\u897f/] },
  { terms: ["Russia", "Moscow"], patterns: [/russia/i, /moscow/i, /\u4fc4\u7f57\u65af/] },
  { terms: ["Ukraine", "Kyiv"], patterns: [/ukraine/i, /kyiv/i, /kiev/i, /\u4e4c\u514b\u5170/] }
];

export function expandLeadKeywords(input: KeywordExpansionInput = {}): ExpandedKeywords {
  const profileHints = deriveProfileHints(input);
  const taskText = input.taskText ?? "";
  const sourceText = [
    taskText,
    ...(input.productProfileUrls ?? []),
    input.productProfileNotes,
    ...(input.referenceCustomerUrls ?? []),
    ...(input.crmSampleNames ?? []),
    input.customerProfileNotes,
    ...(input.productTerms ?? []),
    ...(input.customerIntentTerms ?? []),
    ...(input.targetMarkets ?? []),
    ...(input.scenarioTerms ?? [])
  ]
    .filter(Boolean)
    .join(" ");
  const explicitMarketTerms = normalizeMarketTerms(input.targetMarkets ?? []);
  const detectedMarketTerms = explicitMarketTerms.length
    ? explicitMarketTerms
    : unique([...detectMarketTerms(sourceText), ...(profileHints.marketTerms ?? [])]);
  const customerIntentTerms = prioritizeCustomerIntentTerms(
    [
      ...detectCustomerIntentTerms(sourceText),
      ...(profileHints.customerIntentTerms ?? []),
      ...(input.customerIntentTerms ?? []),
      ...primaryCustomerIntentTerms,
      ...(isChannelCustomerRequest(taskText) ? channelCustomerIntentTerms : [])
    ],
    isChannelCustomerRequest(taskText)
  );

  return {
    mainProductTerms: unique([
      ...detectMainProducts(sourceText),
      ...(profileHints.mainProductTerms ?? []),
      ...(input.productTerms ?? []),
      ...defaultMainProducts
    ]),
    relatedProductTerms: unique([
      ...detectRelatedProducts(sourceText),
      ...(profileHints.relatedProductTerms ?? []),
      ...defaultRelatedProducts
    ]),
    longTailProductTerms: unique([
      ...(profileHints.longTailProductTerms ?? []),
      ...defaultLongTailProducts
    ]),
    upstreamDownstreamTerms: unique([
      ...(profileHints.upstreamDownstreamTerms ?? []),
      ...defaultUpstreamDownstreamTerms
    ]),
    customerIntentTerms,
    marketTerms: detectedMarketTerms.length ? detectedMarketTerms : unique(defaultMarketTerms),
    scenarioTerms: unique([
      ...detectScenarioTerms(sourceText),
      ...(profileHints.scenarioTerms ?? []),
      ...(input.scenarioTerms ?? []),
      ...defaultScenarioTerms
    ]),
    excludeTerms: unique(defaultExcludeTerms)
  };
}

function detectMainProducts(sourceText: string) {
  const terms: string[] = [];
  if (/5g/i.test(sourceText)) {
    terms.push(
      "5G telecom equipment",
      "5G base station equipment",
      "radio access network equipment"
    );
  }
  if (/base station|bts|enodeb|gnodeb|ran equipment/i.test(sourceText)) {
    terms.push("base station equipment", "RAN equipment");
  }
  if (/telecom equipment/i.test(sourceText) || /\u901a\u4fe1\u8bbe\u5907/.test(sourceText)) {
    terms.push("telecom equipment");
  }
  if (/rru|remote radio/i.test(sourceText)) {
    terms.push("RRU", "remote radio unit");
  }
  if (/bbu|baseband/i.test(sourceText)) {
    terms.push("BBU", "baseband unit");
  }
  if (/aau/i.test(sourceText)) {
    terms.push("AAU");
  }
  if (/microwave|\u5fae\u6ce2/i.test(sourceText)) {
    terms.push("microwave backhaul");
  }
  if (/power|\u7535\u6e90|rectifier/i.test(sourceText)) {
    terms.push("telecom power", "rectifier module");
  }
  return terms;
}

function detectRelatedProducts(sourceText: string) {
  const terms: string[] = [];
  if (/spare|\u914d\u4ef6|\u5907\u4ef6|\u677f\u5361|board/i.test(sourceText)) {
    terms.push("spare parts", "board");
  }
  if (/\u5149\u6a21\u5757|optical/i.test(sourceText)) {
    terms.push("optical module");
  }
  if (/olt/i.test(sourceText)) {
    terms.push("OLT");
  }
  return terms;
}

function detectCustomerIntentTerms(sourceText: string) {
  const terms: string[] = [];
  if (/procurement|purchasing|buyer|tender|rfq/i.test(sourceText)) {
    terms.push("procurement", "purchasing", "RFQ", "tender");
  }
  if (/operator|carrier|service provider/i.test(sourceText)) {
    terms.push(
      "operator procurement",
      "service provider",
      "telecom operator procurement",
      "mobile network operator"
    );
  }
  if (/\u7ef4\u62a4|maintenance|o&m|operations/i.test(sourceText)) {
    terms.push(
      "maintenance company",
      "field service company",
      "network maintenance company",
      "base station maintenance company",
      "telecom field services"
    );
  }
  if (/base station|bts|enodeb|gnodeb|\u57fa\u7ad9|ran/i.test(sourceText)) {
    terms.push("RAN maintenance", "cell site maintenance");
  }
  if (/tower|towerco|\u94c1\u5854/i.test(sourceText)) {
    terms.push("tower maintenance company", "tower company");
  }
  if (/power|rectifier|\u7535\u6e90/i.test(sourceText)) {
    terms.push("telecom power maintenance");
  }
  if (/isp|wisp|ftth|fiber operator|fiber network/i.test(sourceText)) {
    terms.push("ISP network operations", "WISP", "FTTH operator");
  }
  if (/\u7ecf\u9500|distributor/i.test(sourceText)) {
    terms.push("distributor", "dealer", "telecom equipment distributor");
  }
  if (/\u73b0\u8d27|stock/i.test(sourceText)) {
    terms.push("stockist");
  }
  if (/\u7cfb\u7edf\u96c6\u6210|integrator/i.test(sourceText)) {
    terms.push("system integrator", "telecom system integrator");
  }
  if (/\u5de5\u7a0b|\u627f\u5305|contractor/i.test(sourceText)) {
    terms.push(
      "engineering contractor",
      "turnkey contractor",
      "telecom contractor",
      "tower contractor"
    );
  }
  if (/\u8fdb\u53e3|import/i.test(sourceText)) {
    terms.push("telecom importer");
  }
  return terms;
}

const channelCustomerPattern =
  /\b(channels?|channel partners?|suppliers?|distributors?|stockists?|resellers?|dealers?|wholesale|wholesalers?|importers?)\b|\u7ecf\u9500|\u5206\u9500|\u6e20\u9053|\u5e93\u5b58\u5546|\u4ee3\u7406\u5546|\u8fdb\u53e3\u5546|\u6279\u53d1/i;

function isChannelCustomerRequest(sourceText: string) {
  return channelCustomerPattern.test(sourceText);
}

function prioritizeCustomerIntentTerms(terms: string[], promoteChannel: boolean) {
  const uniqueTerms = unique(terms);
  if (promoteChannel) {
    return uniqueTerms;
  }

  const primary: string[] = [];
  for (const term of uniqueTerms) {
    if (!isChannelCustomerTerm(term)) {
      primary.push(term);
    }
  }

  return primary;
}

function isChannelCustomerTerm(term: string) {
  return channelCustomerPattern.test(term);
}

function detectMarketTerms(sourceText: string) {
  return marketMatchers.flatMap((market) =>
    market.patterns.some((pattern) => pattern.test(sourceText)) ? market.terms : []
  );
}

function normalizeMarketTerms(terms: string[]) {
  return unique(terms.flatMap((term) => normalizeMarketTerm(term)).filter(Boolean) as string[]);
}

function normalizeMarketTerm(term: string) {
  const normalized = term.trim().toLowerCase();
  const macroAliases: Record<string, string> = {
    "\u5168\u7403": "Global",
    global: "Global",
    worldwide: "Global",
    "all countries": "Global",
    "all markets": "Global",
    "\u4e9a\u6d32": "Asia",
    asia: "Asia",
    apac: "Asia",
    "\u4e1c\u5357\u4e9a": "Southeast Asia",
    "southeast asia": "Southeast Asia",
    asean: "Southeast Asia",
    "\u5357\u4e9a": "South Asia",
    "south asia": "South Asia",
    "\u4e2d\u4e9a": "Central Asia",
    "central asia": "Central Asia",
    "\u4e2d\u4e1c": "Middle East",
    "middle east": "Middle East",
    mena: "Middle East",
    "\u6d77\u6e7e\u56fd\u5bb6": "GCC",
    gcc: "GCC",
    "gulf countries": "GCC",
    "\u6b27\u6d32": "Europe",
    europe: "Europe",
    "\u975e\u6d32": "Africa",
    africa: "Africa",
    "\u5317\u7f8e": "North America",
    "\u5317\u7f8e\u6d32": "North America",
    "north america": "North America",
    "\u62c9\u7f8e": "Latin America",
    "latin america": "Latin America",
    latam: "Latin America",
    "\u7f8e\u6d32": "Americas",
    americas: "Americas",
    "\u5927\u6d0b\u6d32": "Oceania",
    oceania: "Oceania"
  };
  const macro = macroAliases[normalized];

  if (macro) {
    return expandMarketMacro(macro);
  }

  const aliases: Record<string, string> = {
    "\u963f\u8054\u914b": "UAE",
    "united arab emirates": "UAE",
    "\u6c99\u7279": "Saudi Arabia",
    "\u6c99\u7279\u963f\u62c9\u4f2f": "Saudi Arabia",
    "\u963f\u62c9\u4f2f": "Saudi Arabia",
    saudi: "Saudi Arabia",
    "\u5361\u5854\u5c14": "Qatar",
    qatar: "Qatar",
    "\u963f\u66fc": "Oman",
    oman: "Oman",
    "\u4f0a\u6717": "Iran",
    iran: "Iran",
    "\u4ee5\u8272\u5217": "Israel",
    israel: "Israel",
    "\u5c3c\u65e5\u5229\u4e9a": "Nigeria",
    nigeria: "Nigeria",
    "\u80af\u5c3c\u4e9a": "Kenya",
    kenya: "Kenya",
    "\u5357\u975e": "South Africa",
    "south africa": "South Africa",
    "\u5370\u5c3c": "Indonesia",
    "\u5370\u5ea6\u5c3c\u897f\u4e9a": "Indonesia",
    indonesia: "Indonesia",
    "\u5df4\u897f": "Brazil",
    brazil: "Brazil",
    "\u4fc4\u7f57\u65af": "Russia",
    russia: "Russia",
    "\u4e4c\u514b\u5170": "Ukraine",
    ukraine: "Ukraine"
  };

  return aliases[normalized] ?? term.trim();
}

function expandMarketMacro(market: string): string[] {
  const expansions: Record<string, string[]> = {
    Global: [
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
      "Peru",
      "Kuwait",
      "Bahrain",
      "Iraq",
      "Jordan",
      "Egypt",
      "Turkey",
      "France",
      "Italy",
      "Spain",
      "Poland",
      "Argentina",
      "Ecuador",
      "Costa Rica"
    ],
    Asia: [
      "UAE",
      "Saudi Arabia",
      "Qatar",
      "India",
      "Pakistan",
      "Bangladesh",
      "Indonesia",
      "Vietnam",
      "Malaysia",
      "Philippines",
      "Thailand",
      "Kazakhstan",
      "Uzbekistan",
      "Turkey"
    ],
    "Southeast Asia": [
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
    "South Asia": ["India", "Pakistan", "Bangladesh", "Sri Lanka", "Nepal"],
    "Central Asia": ["Kazakhstan", "Uzbekistan", "Kyrgyzstan", "Tajikistan", "Turkmenistan"],
    "Middle East": [
      "UAE",
      "Saudi Arabia",
      "Qatar",
      "Oman",
      "Kuwait",
      "Bahrain",
      "Jordan",
      "Iraq",
      "Turkey",
      "Egypt"
    ],
    GCC: ["UAE", "Saudi Arabia", "Qatar", "Kuwait", "Oman", "Bahrain"],
    Europe: [
      "Germany",
      "United Kingdom",
      "France",
      "Italy",
      "Spain",
      "Poland",
      "Netherlands",
      "Romania",
      "Ukraine"
    ],
    Africa: [
      "Nigeria",
      "Kenya",
      "South Africa",
      "Egypt",
      "Morocco",
      "Ghana",
      "Ethiopia",
      "Tanzania",
      "Uganda",
      "Algeria"
    ],
    "North America": ["United States", "Canada", "Mexico"],
    "Latin America": [
      "Brazil",
      "Mexico",
      "Chile",
      "Colombia",
      "Peru",
      "Argentina",
      "Ecuador",
      "Costa Rica"
    ],
    Americas: [
      "United States",
      "Canada",
      "Mexico",
      "Brazil",
      "Chile",
      "Colombia",
      "Peru",
      "Argentina"
    ],
    Oceania: ["Australia", "New Zealand", "Papua New Guinea"]
  };

  return expansions[market] ?? [market];
}

function detectScenarioTerms(sourceText: string) {
  const terms: string[] = [];
  if (/5g/i.test(sourceText)) {
    terms.push("5G network rollout", "base station maintenance");
  }
  if (/\u7ef4\u62a4|maintenance/i.test(sourceText)) {
    terms.push(
      "site maintenance",
      "network maintenance",
      "RAN maintenance",
      "spare parts replacement"
    );
  }
  if (/base station|bts|enodeb|gnodeb|\u57fa\u7ad9|ran/i.test(sourceText)) {
    terms.push("base station maintenance", "cell site maintenance");
  }
  if (/rollout|\u5efa\u8bbe|\u90e8\u7f72/i.test(sourceText)) {
    terms.push("network rollout");
  }
  if (/tower|\u94c1\u5854/i.test(sourceText)) {
    terms.push("tower power", "tower maintenance");
  }
  if (/power|rectifier|\u7535\u6e90/i.test(sourceText)) {
    terms.push("telecom power maintenance", "rectifier replacement");
  }
  if (/isp|wisp|ftth|fiber/i.test(sourceText)) {
    terms.push("FTTH network maintenance");
  }
  if (/ibs|\u5ba4\u5206/i.test(sourceText)) {
    terms.push("IBS service", "IBS solution");
  }
  if (/project|delivery|\u9879\u76ee|\u4ea4\u4ed8/i.test(sourceText)) {
    terms.push("project delivery", "telecom infrastructure");
  }
  return terms;
}

function deriveProfileHints(input: KeywordExpansionInput): ProfileHints {
  const urls = [...(input.productProfileUrls ?? []), ...(input.referenceCustomerUrls ?? [])];
  const hints = urls.reduce<ProfileHints>((acc, url) => mergeHints(acc, hintsForUrl(url)), {});

  return mergeHints(hints, hintsFromCrmSamples(input.crmSampleNames ?? []));
}

function hintsForUrl(url: string): ProfileHints {
  const domain = domainFromUrl(url);
  if (!domain) {
    return {};
  }

  return {
    marketTerms: detectMarketTerms(domain)
  };
}

function hintsFromCrmSamples(samples: string[]): ProfileHints {
  const source = samples.join(" ");

  return {
    customerIntentTerms: detectCustomerIntentTerms(source),
    scenarioTerms: detectScenarioTerms(source),
    marketTerms: detectMarketTerms(source)
  };
}

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function mergeHints(left: ProfileHints, right: ProfileHints): ProfileHints {
  return {
    mainProductTerms: unique([...(left.mainProductTerms ?? []), ...(right.mainProductTerms ?? [])]),
    relatedProductTerms: unique([
      ...(left.relatedProductTerms ?? []),
      ...(right.relatedProductTerms ?? [])
    ]),
    longTailProductTerms: unique([
      ...(left.longTailProductTerms ?? []),
      ...(right.longTailProductTerms ?? [])
    ]),
    upstreamDownstreamTerms: unique([
      ...(left.upstreamDownstreamTerms ?? []),
      ...(right.upstreamDownstreamTerms ?? [])
    ]),
    customerIntentTerms: unique([
      ...(left.customerIntentTerms ?? []),
      ...(right.customerIntentTerms ?? [])
    ]),
    marketTerms: unique([...(left.marketTerms ?? []), ...(right.marketTerms ?? [])]),
    scenarioTerms: unique([...(left.scenarioTerms ?? []), ...(right.scenarioTerms ?? [])]),
    excludeTerms: unique([...(left.excludeTerms ?? []), ...(right.excludeTerms ?? [])])
  };
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}
