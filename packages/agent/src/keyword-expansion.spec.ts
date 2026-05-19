import { describe, expect, it } from "vitest";
import { expandLeadKeywords, generateSearchQueries } from "./index.js";

describe("keyword expansion", () => {
  it("expands an explicit UAE telecom distributor task into optional channel terms", () => {
    const keywords = expandLeadKeywords({
      taskText: "Find UAE telecom equipment distributors and stockists"
    });

    // 2026-05: telecom-specific static defaults removed. The detect
    // functions still emit telecom product terms when the prompt
    // mentions "telecom equipment" directly.
    expect(keywords.mainProductTerms).toContain("telecom equipment");
    expect(keywords.customerIntentTerms).toEqual(
      expect.arrayContaining(["distributor", "stockist"])
    );
    expect(keywords.marketTerms).toEqual(expect.arrayContaining(["UAE", "Dubai"]));
    expect(keywords.marketTerms).not.toEqual(
      expect.arrayContaining(["Nigeria", "South Africa", "Indonesia", "Brazil"])
    );
    expect(keywords.excludeTerms).toEqual(
      expect.arrayContaining(["job", "training", "consumer phone", "course", "forum"])
    );
    expect(keywords.excludeTerms).not.toContain("news");
    expect(keywords.excludeTerms).not.toContain("blog");
    expect(keywords.excludeTerms).not.toEqual(expect.arrayContaining(["directory", "yellow pages"]));
    expect(keywords.excludeTerms).not.toContain("phone");
  });

  it("emits telecom buyer-side customer intents when the prompt mentions maintenance", () => {
    // 2026-05: with telecom static defaults removed, telecom intent
    // terms only appear when the prompt actually mentions a telecom
    // signal that triggers detectCustomerIntentTerms (maintenance,
    // operator, base station, RAN, tower, ISP, FTTH, etc.).
    const keywords = expandLeadKeywords({
      taskText: "Find 5G base station maintenance customers and operators"
    });

    expect(keywords.customerIntentTerms).toEqual(
      expect.arrayContaining([
        "network maintenance company",
        "base station maintenance company",
        "RAN maintenance",
        "mobile network operator"
      ])
    );
    expect(keywords.customerIntentTerms.join(" ")).not.toMatch(
      /\b(supplier|distributor|stockist|reseller|wholesale)\b/i
    );
  });

  it("only expands Chinese channel words when the user explicitly asks for channel customers", () => {
    const buyerKeywords = expandLeadKeywords({
      taskText: "\u5e2e\u6211\u627e5G\u901a\u4fe1\u8bbe\u5907\u76f8\u5173\u7684\u5ba2\u6237"
    });
    const channelKeywords = expandLeadKeywords({
      taskText:
        "\u5e2e\u6211\u627e5G\u901a\u4fe1\u8bbe\u5907\u7ecf\u9500\u5546\u548c\u5e93\u5b58\u5546"
    });

    expect(buyerKeywords.customerIntentTerms.join(" ")).not.toMatch(
      /\b(supplier|distributor|stockist|reseller|wholesale)\b/i
    );
    expect(channelKeywords.customerIntentTerms).toEqual(
      expect.arrayContaining(["distributor", "stockist"])
    );
  });

  it("does not include telecom defaults when the prompt has no telecom signal", () => {
    // 2026-05: the system is now a generic foreign-trade lead generator.
    // With telecom-specific static defaults removed, an empty prompt no
    // longer produces telecom vocabulary. Telecom keywords only appear
    // when the prompt explicitly mentions telecom signals (5G, RAN, RRU,
    // BBU, base station, etc.).
    const keywords = expandLeadKeywords();

    expect(keywords.relatedProductTerms).not.toEqual(
      expect.arrayContaining(["RRU", "BBU", "AAU", "microwave backhaul", "telecom power"])
    );
    expect(keywords.longTailProductTerms).not.toEqual(
      expect.arrayContaining(["Huawei ZTE spare parts", "tower power IBS service"])
    );
    expect(keywords.relatedProductTerms).toHaveLength(0);
    expect(keywords.longTailProductTerms).toHaveLength(0);
  });

  it("returns a stable JSON-ready structure", () => {
    const keywords = expandLeadKeywords({ taskText: "Saudi system integrator telecom power" });

    expect(Object.keys(keywords).sort()).toEqual([
      "customerIntentTerms",
      "excludeTerms",
      "longTailProductTerms",
      "mainProductTerms",
      "marketTerms",
      "relatedProductTerms",
      "scenarioTerms",
      "upstreamDownstreamTerms"
    ]);
    expect(Object.values(keywords).every((value) => Array.isArray(value))).toBe(true);
  });

  it("feeds expanded keywords into Brave query generation", () => {
    const queries = generateSearchQueries({
      taskText: "Find UAE telecom equipment distributors and stockists",
      minQueryCount: 15
    });

    expect(queries).toHaveLength(15);
    expect(queries[0]?.keywordGroups.marketTerms).toEqual(expect.arrayContaining(["UAE"]));
    expect(queries[0]?.query).toContain("UAE");
    expect(queries[0]?.query).toContain("-job");
    expect(queries[0]?.query).not.toContain("-marketplace");
    expect(queries[0]?.query).not.toContain("-phone");
  });

  it("normalizes Chinese saved target regions into English search markets", () => {
    const queries = generateSearchQueries({
      targetMarkets: ["\u963f\u8054\u914b", "\u6c99\u7279", "\u5c3c\u65e5\u5229\u4e9a"],
      minQueryCount: 3
    });

    expect(queries.map((query) => query.country)).toEqual(["UAE", "Saudi Arabia", "Nigeria"]);
    expect(queries[0]?.query).toContain("UAE");
    expect(queries[1]?.query).toContain("Saudi Arabia");
  });

  it("expands selected macro regions into concrete search countries", () => {
    const queries = generateSearchQueries({
      targetMarkets: ["\u4e2d\u4e9a"],
      minQueryCount: 5
    });

    expect(queries.map((query) => query.country)).toEqual([
      "Kazakhstan",
      "Uzbekistan",
      "Kyrgyzstan",
      "Tajikistan",
      "Turkmenistan"
    ]);
    expect(queries[0]?.query).toContain("Kazakhstan");
  });

  it("keeps manually selected countries as the search market instead of falling back to Global", () => {
    const queries = generateSearchQueries({
      targetMarkets: ["Germany", "Poland", "Oman"],
      minQueryCount: 9
    });

    expect(queries.map((query) => query.country)).toEqual([
      "Germany",
      "Poland",
      "Oman",
      "Germany",
      "Poland",
      "Oman",
      "Germany",
      "Poland",
      "Oman"
    ]);
    expect(queries.map((query) => query.country)).not.toContain("Global");
    expect(queries[2]?.query).toContain("Oman");
    expect(queries[2]?.query).not.toContain("site:");
    expect(queries[8]?.query).toContain("Oman");
    expect(queries[8]?.query).not.toContain("loc:om");
  });
});
