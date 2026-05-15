import { describe, expect, it } from "vitest";
import { expandLeadKeywords, generateSearchQueries } from "./index.js";

describe("keyword expansion", () => {
  it("expands a UAE telecom distributor task into product, customer, market, and exclude terms", () => {
    const keywords = expandLeadKeywords({ taskText: "找 UAE 通信设备经销商" });

    expect(keywords.mainProductTerms).toContain("telecom equipment");
    expect(keywords.customerIntentTerms).toEqual(expect.arrayContaining(["distributor"]));
    expect(keywords.marketTerms).toEqual(expect.arrayContaining(["UAE", "Dubai"]));
    expect(keywords.marketTerms).not.toEqual(expect.arrayContaining(["Nigeria", "South Africa", "Indonesia", "Brazil"]));
    expect(keywords.excludeTerms).toEqual(
      expect.arrayContaining(["job", "news", "training", "consumer phone", "course", "forum"])
    );
    expect(keywords.excludeTerms).toEqual(expect.arrayContaining(["directory", "yellow pages"]));
    expect(keywords.excludeTerms).not.toContain("phone");
  });

  it("includes telecom default related and long-tail product dictionaries", () => {
    const keywords = expandLeadKeywords();

    expect(keywords.relatedProductTerms).toEqual(
      expect.arrayContaining(["RRU", "BBU", "AAU", "microwave backhaul", "telecom power"])
    );
    expect(keywords.longTailProductTerms).toEqual(
      expect.arrayContaining(["Huawei ZTE spare parts", "tower power IBS service"])
    );
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
      taskText: "找 UAE 通信设备经销商",
      minQueryCount: 15
    });

    expect(queries).toHaveLength(15);
    expect(queries[0]?.keywordGroups.marketTerms).toEqual(expect.arrayContaining(["UAE"]));
    expect(queries[0]?.query).toContain("UAE");
    expect(queries[0]?.query).toContain("-job");
    expect(queries[0]?.query).toContain("-marketplace");
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
      targetMarkets: ["中亚"],
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
