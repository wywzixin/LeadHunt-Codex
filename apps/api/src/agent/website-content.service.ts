import { Injectable } from "@nestjs/common";

export type WebsiteRole = "product" | "reference_customer";

export type ExtractedWebsiteTerms = {
  productTerms: string[];
  customerIntentTerms: string[];
  scenarioTerms: string[];
  brandTerms: string[];
};

export type WebsiteEvidence = {
  url: string;
  finalUrl: string;
  domain: string;
  role: WebsiteRole;
  status: "read" | "failed" | "skipped";
  title?: string;
  wordCount: number;
  textSample: string;
  evidenceSnippets: string[];
  extractedTerms: ExtractedWebsiteTerms;
  productNames?: string[];
  productCatalog?: {
    totalProducts?: number;
    listedProducts: number;
    pagesRead: number;
    truncated: boolean;
  };
  error?: string;
  fetchedAt: string;
};

export type ProfileSiteEvidence = {
  productSites: WebsiteEvidence[];
  referenceCustomerSites: WebsiteEvidence[];
  summary: {
    attempted: number;
    read: number;
    failed: number;
  };
};

type FetchLike = typeof fetch;

const productCatalogPageLimit = 8;
const productCatalogProductLimit = 160;
const profileFetchTimeoutMs = 6000;

@Injectable()
export class WebsiteContentService {
  constructor(private readonly fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)) {}

  async readProfileSites(input: { productUrls: string[]; referenceCustomerUrls: string[] }): Promise<ProfileSiteEvidence> {
    const productSites = await Promise.all(unique(input.productUrls).map((url) => this.readUrl(url, "product")));
    const referenceCustomerSites = await Promise.all(
      unique(input.referenceCustomerUrls).map((url) => this.readUrl(url, "reference_customer"))
    );
    const allSites = [...productSites, ...referenceCustomerSites];

    return {
      productSites,
      referenceCustomerSites,
      summary: {
        attempted: allSites.length,
        read: allSites.filter((site) => site.status === "read").length,
        failed: allSites.filter((site) => site.status === "failed").length
      }
    };
  }

  private async readUrl(url: string, role: WebsiteRole): Promise<WebsiteEvidence> {
    const fetchedAt = new Date().toISOString();
    const base = {
      url,
      finalUrl: url,
      domain: domainFromUrl(url),
      role,
      fetchedAt
    };

    if (!isHttpUrl(url)) {
      return {
        ...base,
        status: "skipped",
        wordCount: 0,
        textSample: "",
        evidenceSnippets: [],
        extractedTerms: emptyTerms(),
        error: "Only http and https URLs can be read."
      };
    }

    let lastError = "";

    for (const readUrl of readUrlCandidates(url)) {
      try {
        const response = await this.fetchWithTimeout(readUrl);
        const finalUrl = response.url || url;
        const contentType = response.headers.get("content-type") ?? "";

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        if (!/text\/html|text\/plain|application\/xhtml\+xml/i.test(contentType)) {
          throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
        }

        const html = await response.text();
        const title = extractTitle(html);
        const productCatalog = role === "product" ? await this.readProductCatalog(finalUrl, html) : emptyProductCatalog();
        const productNames = unique(productCatalog.productNames).slice(0, productCatalogProductLimit);
        const text = htmlToText(html);
        const extractedTerms = extractWebsiteTerms([text, productNames.join(" ")].filter(Boolean).join(" "));
        extractedTerms.productTerms = unique([...productNames, ...extractedTerms.productTerms]);
        const evidenceSnippets = extractEvidenceSnippets(text, extractedTerms);
        if (productNames.length) {
          evidenceSnippets.unshift(`Product catalog: ${productNames.slice(0, 60).join("; ")}`);
        }

        return {
          ...base,
          finalUrl,
          domain: domainFromUrl(finalUrl),
          status: "read",
          title,
          wordCount: countWords(text),
          textSample: text.slice(0, 1200),
          evidenceSnippets: unique(evidenceSnippets).slice(0, 8),
          extractedTerms,
          productNames,
          productCatalog: {
            totalProducts: productCatalog.totalProducts,
            listedProducts: productCatalog.listedProducts,
            pagesRead: productCatalog.pagesRead,
            truncated: productCatalog.truncated
          }
        };
      } catch (error) {
        lastError = readableFetchError(error);
      }
    }

    return {
      ...base,
      status: "failed",
      wordCount: 0,
      textSample: "",
      evidenceSnippets: [],
      extractedTerms: emptyTerms(),
      error: lastError || "Unable to read URL"
    };
  }

  private async fetchWithTimeout(url: string) {
    const controller = new AbortController();
    const timeoutMs = profileFetchTimeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.fetchImpl(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
          "user-agent": "LeadHuntAI/0.1 website profile reader"
        }
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Timed out after ${timeoutMs}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readProductCatalog(url: string, firstPageHtml: string) {
    const firstPageNames = extractProductNames(firstPageHtml);
    const pageUrls = discoverProductCatalogPageUrls(url, firstPageHtml).slice(0, productCatalogPageLimit - 1);
    const pages = await Promise.all(
      pageUrls.map(async (pageUrl) => {
        try {
          const response = await this.fetchWithTimeout(pageUrl);
          const contentType = response.headers.get("content-type") ?? "";
          if (!response.ok || !/text\/html|text\/plain|application\/xhtml\+xml/i.test(contentType)) {
            return [];
          }
          return extractProductNames(await response.text());
        } catch {
          return [];
        }
      })
    );
    const listedProductNames = [...firstPageNames, ...pages.flat()];
    const productNames = unique(listedProductNames).slice(0, productCatalogProductLimit);
    const totalProducts = extractProductTotal(firstPageHtml);

    return {
      productNames,
      totalProducts,
      listedProducts: listedProductNames.length,
      pagesRead: 1 + pages.filter((items) => items.length > 0).length,
      truncated: Boolean(
        (totalProducts && listedProductNames.length < totalProducts) || unique(listedProductNames).length > productNames.length
      )
    };
  }
}

function emptyProductCatalog() {
  return {
    productNames: [] as string[],
    totalProducts: undefined as number | undefined,
    listedProducts: 0,
    pagesRead: 0,
    truncated: false
  };
}

function readUrlCandidates(url: string) {
  const candidates = new Set<string>();
  const slashUrl = withTrailingSlashForDirectory(url);

  if (slashUrl) {
    candidates.add(slashUrl);
  }
  candidates.add(url);

  return [...candidates];
}

function withTrailingSlashForDirectory(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const lastSegment = path.split("/").filter(Boolean).at(-1) ?? "";

    if (path !== "/" && !path.endsWith("/") && !lastSegment.includes(".")) {
      parsed.pathname = `${path}/`;
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function readableFetchError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") {
    return "Timed out while reading URL";
  }

  return error instanceof Error ? error.message : String(error);
}

function extractWebsiteTerms(text: string): ExtractedWebsiteTerms {
  return {
    productTerms: matchTerms(text, productRules),
    customerIntentTerms: matchTerms(text, customerIntentRules),
    scenarioTerms: matchTerms(text, scenarioRules),
    brandTerms: matchTerms(text, brandRules)
  };
}

function extractEvidenceSnippets(text: string, terms: ExtractedWebsiteTerms) {
  const wanted = new Set(
    [...terms.productTerms, ...terms.customerIntentTerms, ...terms.scenarioTerms, ...terms.brandTerms]
      .map((term) => term.toLowerCase())
      .slice(0, 16)
  );
  if (!wanted.size) {
    return text ? [text.slice(0, 220)] : [];
  }

  const snippets: string[] = [];
  for (const sentence of splitSentences(text)) {
    const lower = sentence.toLowerCase();
    if ([...wanted].some((term) => lower.includes(term.toLowerCase()))) {
      snippets.push(sentence.slice(0, 260));
    }
    if (snippets.length >= 6) {
      break;
    }
  }

  return unique(snippets);
}

function matchTerms(text: string, rules: Array<{ term: string; pattern: RegExp }>) {
  return unique(rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.term));
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 24);
}

function htmlToText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim().slice(0, 180) : undefined;
}

function extractProductNames(html: string) {
  const names = matchHtmlGroups(
    html,
    /<h2[^>]*class=["'][^"']*woocommerce-loop-product__title[^"']*["'][^>]*>([\s\S]*?)<\/h2>/gi
  );
  const fallbackNames = names.length
    ? []
    : matchHtmlGroups(html, /<a[^>]*class=["'][^"']*woocommerce-loop-product__link[^"']*["'][^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/gi);

  return [...names, ...fallbackNames]
    .map((name) => cleanupProductName(name))
    .filter((name) => name.length >= 2 && !genericProductNameTerms.has(name.toLowerCase()));
}

function discoverProductCatalogPageUrls(baseUrl: string, html: string) {
  const urls = new Set<string>();
  const linkedPages = matchHtmlGroups(html, /href\s*=\s*["']([^"']*\/page\/\d+\/?[^"']*)["']/gi);
  for (const href of linkedPages) {
    try {
      const url = new URL(decodeHtmlEntities(href), baseUrl);
      url.hash = "";
      urls.add(url.toString());
    } catch {
      continue;
    }
  }

  const totalProducts = extractProductTotal(html);
  const perPage = extractProductPageSize(html);
  if (totalProducts && perPage) {
    const pageCount = Math.ceil(totalProducts / perPage);
    for (let page = 2; page <= pageCount; page += 1) {
      urls.add(productPageUrl(baseUrl, page));
    }
  }

  const currentUrl = normalizeUrl(baseUrl);
  return [...urls].filter((url) => normalizeUrl(url) !== currentUrl);
}

function extractProductTotal(html: string) {
  const text = decodeHtmlEntities(html);
  const match = text.match(/Showing\s+\d+\s*[–-]\s*\d+\s+of\s+(\d+)\s+results/i) ?? text.match(/Showing\s+all\s+(\d+)\s+results/i);
  const value = match?.[1] ? Number(match[1]) : undefined;
  return value && Number.isFinite(value) ? value : undefined;
}

function extractProductPageSize(html: string) {
  const text = decodeHtmlEntities(html);
  const range = text.match(/Showing\s+(\d+)\s*[–-]\s*(\d+)\s+of\s+\d+\s+results/i);
  if (range?.[1] && range[2]) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    const count = end - start + 1;
    return count > 0 ? count : undefined;
  }

  const productNames = extractProductNames(html);
  return productNames.length || undefined;
}

function productPageUrl(baseUrl: string, page: number) {
  const parsed = new URL(baseUrl);
  const path = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
  parsed.pathname = path.replace(/\/page\/\d+\/?$/i, "/") + `page/${page}/`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function cleanupProductName(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[),.;:]+$/g, "")
    .slice(0, 120);
}

function matchHtmlGroups(html: string, pattern: RegExp) {
  return Array.from(html.matchAll(pattern), (match) => match[1] ?? "");
}

function normalizeUrl(value: string) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ndash;|&mdash;/gi, "-")
    .replace(/&#(\d+);/g, (_match, code) => {
      const valueCode = Number(code);
      return Number.isFinite(valueCode) ? String.fromCodePoint(valueCode) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const valueCode = Number.parseInt(code, 16);
      return Number.isFinite(valueCode) ? String.fromCodePoint(valueCode) : " ";
    });
}

function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function domainFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return value.replace(/^https?:\/\//i, "").split("/")[0]?.toLowerCase() ?? value;
  }
}

function emptyTerms(): ExtractedWebsiteTerms {
  return {
    productTerms: [],
    customerIntentTerms: [],
    scenarioTerms: [],
    brandTerms: []
  };
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

const genericProductNameTerms = new Set(["products", "product", "shop", "categories", "main pages"]);

const productRules = [
  { term: "5G telecom equipment", pattern: /\b5g\b/i },
  { term: "Private 5G", pattern: /private\s+5g/i },
  { term: "RAN equipment", pattern: /\bran\b|radio access network/i },
  { term: "core network", pattern: /core network|5g core|core products/i },
  { term: "remote radio unit", pattern: /remote radio unit|\brru\b/i },
  { term: "baseband unit", pattern: /baseband unit|\bbbu\b|baseband/i },
  { term: "AAU", pattern: /\baau\b|active antenna/i },
  { term: "microwave backhaul", pattern: /microwave|backhaul/i },
  { term: "telecom power", pattern: /telecom power|rectifier|power systems?|power backup/i },
  { term: "rectifier module", pattern: /rectifier/i },
  { term: "optical module", pattern: /optical module|sfp|xfp|transceiver/i },
  { term: "OLT", pattern: /\bolt\b|gpon|epon/i },
  { term: "DWDM transmission", pattern: /\bdwdm\b|transmission network/i },
  { term: "antenna", pattern: /antenna/i },
  { term: "telecom spare parts", pattern: /spare parts?|replacement parts?|boards?/i },
  { term: "Ericsson AIR", pattern: /ericsson\s+air|\bair\s*\d{4}/i },
  { term: "Huawei WBBP", pattern: /\bwbbp\b/i },
  { term: "Huawei UMPT", pattern: /\bumpt\b/i },
  { term: "ZTE R8882", pattern: /\br8882\b/i },
  { term: "ZTE BPN2", pattern: /\bbpn2\b/i },
  { term: "Eltek rectifier", pattern: /eltek.*rectifier|rectifier.*eltek/i }
];

const customerIntentRules = [
  { term: "telecom system integrator", pattern: /system integrator|integration/i },
  { term: "telecom equipment distributor", pattern: /distributor|distribution/i },
  { term: "stockist", pattern: /stockist|stock|inventory/i },
  { term: "network solutions provider", pattern: /network solutions|telecom solutions|solution provider/i },
  { term: "managed service provider", pattern: /managed services?|operation services?/i },
  { term: "telecom contractor", pattern: /contractor|turnkey|project delivery/i },
  { term: "project procurement", pattern: /procurement|supply chain|vendor|partner/i },
  { term: "ICT solution provider", pattern: /\bict\b|information technology/i },
  { term: "mobile network operator", pattern: /mobile network operator|\bmno\b|operator/i }
];

const scenarioRules = [
  { term: "5G network rollout", pattern: /5g.*rollout|rollout.*5g|network rollout/i },
  { term: "base station maintenance", pattern: /base station|site maintenance|maintenance/i },
  { term: "RMS monitoring", pattern: /\brms\b|remote monitoring/i },
  { term: "microwave backhaul project", pattern: /microwave|backhaul/i },
  { term: "telecom power maintenance", pattern: /power.*maintenance|rectifier|battery|backup/i },
  { term: "private network deployment", pattern: /private network|private 5g|enterprise network/i },
  { term: "tower infrastructure", pattern: /tower|telecom infrastructure/i },
  { term: "managed network service", pattern: /managed services?|operations?/i }
];

const brandRules = [
  { term: "Huawei", pattern: /huawei/i },
  { term: "ZTE", pattern: /\bzte\b/i },
  { term: "Ericsson", pattern: /ericsson/i },
  { term: "Nokia", pattern: /nokia/i },
  { term: "Eltek", pattern: /eltek/i },
  { term: "Delta", pattern: /\bdelta\b/i },
  { term: "Vertiv", pattern: /vertiv/i },
  { term: "Cisco", pattern: /cisco/i },
  { term: "Cambium", pattern: /cambium/i },
  { term: "NEC", pattern: /\bnec\b/i },
  { term: "SIAE", pattern: /\bsiae\b/i }
];
