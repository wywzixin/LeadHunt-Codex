export type ResolvedCountry = {
  code: string;
  name: string;
};

const regionCodes = [
  "AF",
  "AX",
  "AL",
  "DZ",
  "AS",
  "AD",
  "AO",
  "AI",
  "AQ",
  "AG",
  "AR",
  "AM",
  "AW",
  "AU",
  "AT",
  "AZ",
  "BS",
  "BH",
  "BD",
  "BB",
  "BY",
  "BE",
  "BZ",
  "BJ",
  "BM",
  "BT",
  "BO",
  "BQ",
  "BA",
  "BW",
  "BV",
  "BR",
  "IO",
  "BN",
  "BG",
  "BF",
  "BI",
  "CV",
  "KH",
  "CM",
  "CA",
  "KY",
  "CF",
  "TD",
  "CL",
  "CN",
  "CX",
  "CC",
  "CO",
  "KM",
  "CG",
  "CD",
  "CK",
  "CR",
  "CI",
  "HR",
  "CU",
  "CW",
  "CY",
  "CZ",
  "DK",
  "DJ",
  "DM",
  "DO",
  "EC",
  "EG",
  "SV",
  "GQ",
  "ER",
  "EE",
  "SZ",
  "ET",
  "FK",
  "FO",
  "FJ",
  "FI",
  "FR",
  "GF",
  "PF",
  "TF",
  "GA",
  "GM",
  "GE",
  "DE",
  "GH",
  "GI",
  "GR",
  "GL",
  "GD",
  "GP",
  "GU",
  "GT",
  "GG",
  "GN",
  "GW",
  "GY",
  "HT",
  "HM",
  "VA",
  "HN",
  "HK",
  "HU",
  "IS",
  "IN",
  "ID",
  "IR",
  "IQ",
  "IE",
  "IM",
  "IL",
  "IT",
  "JM",
  "JP",
  "JE",
  "JO",
  "KZ",
  "KI",
  "KP",
  "KR",
  "KW",
  "KG",
  "LA",
  "LV",
  "LB",
  "LS",
  "LR",
  "LY",
  "LI",
  "LT",
  "LU",
  "MO",
  "MG",
  "MW",
  "MY",
  "MV",
  "ML",
  "MT",
  "MH",
  "MQ",
  "MR",
  "MU",
  "YT",
  "MX",
  "FM",
  "MD",
  "MC",
  "MN",
  "ME",
  "MS",
  "MA",
  "MZ",
  "MM",
  "NA",
  "NR",
  "NP",
  "NL",
  "NC",
  "NZ",
  "NI",
  "NE",
  "NU",
  "NF",
  "MK",
  "MP",
  "NO",
  "OM",
  "PK",
  "PW",
  "PS",
  "PA",
  "PG",
  "PY",
  "PE",
  "PH",
  "PN",
  "PL",
  "PT",
  "PR",
  "QA",
  "RE",
  "RO",
  "RW",
  "BL",
  "SH",
  "KN",
  "LC",
  "MF",
  "PM",
  "VC",
  "WS",
  "SM",
  "ST",
  "SA",
  "SN",
  "RS",
  "SC",
  "SL",
  "SG",
  "SX",
  "SK",
  "SI",
  "SB",
  "SO",
  "ZA",
  "GS",
  "SS",
  "ES",
  "LK",
  "SD",
  "SR",
  "SJ",
  "SE",
  "CH",
  "SY",
  "TW",
  "TJ",
  "TZ",
  "TH",
  "TL",
  "TG",
  "TK",
  "TO",
  "TT",
  "TN",
  "TR",
  "TM",
  "TC",
  "TV",
  "UG",
  "AE",
  "GB",
  "US",
  "UM",
  "UY",
  "UZ",
  "VU",
  "VE",
  "VN",
  "VG",
  "VI",
  "WF",
  "EH",
  "YE",
  "ZM",
  "ZW",
  "XK"
] as const;

const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

const nameOverrides: Record<string, string> = {
  AE: "UAE",
  GB: "United Kingdom",
  KP: "North Korea",
  KR: "South Korea",
  LA: "Laos",
  RU: "Russia",
  SY: "Syria",
  TZ: "Tanzania",
  US: "United States",
  VE: "Venezuela",
  VN: "Vietnam",
  XK: "Kosovo"
};

const leadNameOverrides: Record<string, string> = {
  AE: "UAE"
};

const siteOverrides: Record<string, string> = {
  GB: ".uk"
};

const globallyUsedCountryDomains = new Set([".ai", ".am", ".cc", ".co", ".fm", ".io", ".ly", ".me", ".tv", ".to", ".ws"]);

const braveSupportedCountries = new Set([
  "AR",
  "AU",
  "AT",
  "BD",
  "BE",
  "BR",
  "CA",
  "CL",
  "CN",
  "CO",
  "CR",
  "DE",
  "DK",
  "DZ",
  "EC",
  "EG",
  "ES",
  "ET",
  "FI",
  "FR",
  "GB",
  "GH",
  "HK",
  "ID",
  "IN",
  "IQ",
  "IT",
  "JP",
  "JO",
  "KE",
  "KG",
  "KH",
  "KR",
  "KZ",
  "LA",
  "MA",
  "MX",
  "MY",
  "NG",
  "NL",
  "NO",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PH",
  "PK",
  "PL",
  "PT",
  "RO",
  "RU",
  "SA",
  "SE",
  "SG",
  "TH",
  "TJ",
  "TR",
  "TZ",
  "UA",
  "UG",
  "US",
  "UZ",
  "VN",
  "ZA"
]);

const aliases: Array<[string, string]> = [
  ["uae", "AE"],
  ["u.a.e", "AE"],
  ["united arab emirates", "AE"],
  ["阿联酋", "AE"],
  ["dubai", "AE"],
  ["abu dhabi", "AE"],
  ["saudi", "SA"],
  ["saudi arabia", "SA"],
  ["沙特", "SA"],
  ["沙特阿拉伯", "SA"],
  ["阿拉伯", "SA"],
  ["riyadh", "SA"],
  ["jeddah", "SA"],
  ["oman", "OM"],
  ["阿曼", "OM"],
  ["iran", "IR"],
  ["伊朗", "IR"],
  ["israel", "IL"],
  ["以色列", "IL"],
  ["uk", "GB"],
  ["u.k", "GB"],
  ["britain", "GB"],
  ["great britain", "GB"],
  ["england", "GB"],
  ["united kingdom", "GB"],
  ["usa", "US"],
  ["u.s.a", "US"],
  ["united states", "US"],
  ["united states of america", "US"],
  ["america", "US"],
  ["south korea", "KR"],
  ["north korea", "KP"],
  ["russia", "RU"],
  ["俄罗斯", "RU"],
  ["ukraine", "UA"],
  ["乌克兰", "UA"],
  ["vietnam", "VN"],
  ["laos", "LA"],
  ["bolivia", "BO"],
  ["venezuela", "VE"],
  ["syria", "SY"],
  ["tanzania", "TZ"],
  ["kosovo", "XK"],
  ["new york", "US"],
  ["los angeles", "US"],
  ["singapore", "SG"],
  ["lagos", "NG"],
  ["nairobi", "KE"],
  ["moscow", "RU"],
  ["kyiv", "UA"],
  ["kiev", "UA"]
];

const codeByName = new Map<string, string>();
for (const code of regionCodes) {
  codeByName.set(normalizeLookupKey(code), code);
  codeByName.set(normalizeLookupKey(countryNameFromCode(code)), code);
  const displayName = displayNames.of(code);
  if (displayName) {
    codeByName.set(normalizeLookupKey(displayName), code);
  }
}
for (const [alias, code] of aliases) {
  codeByName.set(normalizeLookupKey(alias), code);
}

export function resolveCountry(value: string | null | undefined): ResolvedCountry | null {
  const key = normalizeLookupKey(value ?? "");
  if (!key) {
    return null;
  }

  const code = /^[a-z]{2}$/i.test(key) ? key.toUpperCase() : codeByName.get(key);
  if (!code || !isKnownRegionCode(code)) {
    return null;
  }

  return {
    code,
    name: countryNameFromCode(code)
  };
}

export function countryToSite(country: string) {
  const resolved = resolveCountry(country);
  if (!resolved) {
    return ".com";
  }

  return siteOverrides[resolved.code] ?? `.${resolved.code.toLowerCase()}`;
}

export function countryToLoc(country: string) {
  return resolveCountry(country)?.code.toLowerCase() ?? "us";
}

export function countryToSearchApiCode(country: string | null | undefined) {
  const code = resolveCountry(country)?.code;
  if (!code) {
    return "US";
  }

  return braveSupportedCountries.has(code) ? code : "ALL";
}

export function normalizeCountryName(country: string) {
  const resolved = resolveCountry(country);
  if (!resolved) {
    return country.toUpperCase();
  }

  return (leadNameOverrides[resolved.code] ?? resolved.name).toUpperCase();
}

export function inferCountryFromText(text: string) {
  const domains = domainsFromText(text);
  const normalizedText = ` ${normalizeLookupKey(text)} `;

  for (const code of regionCodes) {
    const name = countryNameFromCode(code);
    const candidateAliases = [name, displayNames.of(code) ?? name, ...aliasesForCode(code)];
    const aliasMatch = candidateAliases.some((alias) => {
      const normalizedAlias = normalizeLookupKey(alias);
      return normalizedAlias.length >= 3 && normalizedText.includes(` ${normalizedAlias} `);
    });
    const site = countryToSite(name);
    const domainMatch =
      site !== ".com" &&
      !globallyUsedCountryDomains.has(site) &&
      domains.some((domain) => domain === site.slice(1) || domain.endsWith(site));

    if (aliasMatch || domainMatch) {
      return normalizeCountryName(name);
    }
  }

  return null;
}

function aliasesForCode(code: string) {
  return aliases.filter(([, aliasCode]) => aliasCode === code).map(([alias]) => alias);
}

function countryNameFromCode(code: string) {
  return nameOverrides[code] ?? displayNames.of(code) ?? code;
}

function domainsFromText(text: string) {
  const domains = new Set<string>();
  const urlMatches = text.match(/https?:\/\/[^\s),;]+/gi) ?? [];
  const hostMatches = text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? [];

  for (const value of urlMatches) {
    try {
      domains.add(new URL(value).hostname.replace(/^www\./, "").toLowerCase());
    } catch {
      // Ignore malformed URL-like fragments.
    }
  }

  for (const value of hostMatches) {
    domains.add(value.replace(/^www\./, "").toLowerCase());
  }

  return [...domains];
}

function normalizeLookupKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isKnownRegionCode(code: string): code is (typeof regionCodes)[number] {
  return (regionCodes as readonly string[]).includes(code);
}
