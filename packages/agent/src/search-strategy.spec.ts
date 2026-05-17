import { describe, expect, it } from "vitest";
import {
  generateSearchQueries,
  getExecutableSearchStrategyTemplates,
  getSearchStrategyLibrary
} from "./search-strategy.js";

describe("search strategy library", () => {
  it("generates at least fifteen buyer-led B2B lead queries", () => {
    const queries = generateSearchQueries({
      targetMarkets: ["UAE", "Saudi Arabia"],
      minQueryCount: 15
    });

    expect(queries).toHaveLength(15);
    expect(
      queries.every((item) => /equipment|component|spare parts|network|maintenance|contractor|integrator|operator|procurement|RFQ|telecom|RRU|BBU|5G/i.test(item.query))
    ).toBe(true);
    expect(new Set(queries.map((item) => item.country))).not.toContain("Nigeria");
    expect(queries[0]?.templateId).toBe("maintenance_company_contact");
    expect(queries[0]?.query).toContain("-job");
    expect(queries[0]?.query).toContain("-marketplace");
    expect(queries[0]?.query).toContain('-"yellow pages"');
    expect(queries[0]?.query).toContain('-"supplier directory"');
    expect(queries[0]?.query).not.toContain("-phone");
    expect(queries.map((item) => item.query).join("\n")).not.toMatch(/\binpage:|\bloc:|\blang:/);
    expect(queries.map((item) => item.query).join("\n")).not.toMatch(/\bsite:/);
    expect(queries.map((item) => item.query).join("\n")).not.toMatch(/\{exclude(?:_terms)?\}/);
    expect(queries[0]?.keywordGroups.customerIntentTerms.join(" ")).not.toMatch(
      /\b(supplier|distributor|stockist|reseller|wholesale)\b/i
    );
  });

  it("keeps channel-customer templates out of the default buyer-led query mix", () => {
    const queries = generateSearchQueries({
      taskText: "Find 5G telecom equipment customers",
      targetMarkets: ["UAE"],
      minQueryCount: 20
    });
    const templateIds = new Set(queries.map((query) => query.templateId));

    expect(templateIds.has("direct_distributor_country")).toBe(false);
    expect(templateIds.has("distributor_exact_scenario")).toBe(false);
    expect(queries[0]?.keywordGroups.customerIntentTerms).toEqual(
      expect.arrayContaining([
        "network maintenance company",
        "telecom system integrator",
        "mobile network operator",
        "ISP network operations",
        "FTTH operator",
        "procurement"
      ])
    );
    expect(queries[0]?.keywordGroups.customerIntentTerms.join(" ")).not.toMatch(
      /\b(supplier|distributor|stockist|reseller|wholesale)\b/i
    );
  });

  it("enables channel-customer templates only when the task explicitly asks for channels", () => {
    const queries = generateSearchQueries({
      taskText: "Find telecom distributors and stockists in UAE",
      targetMarkets: ["UAE"],
      minQueryCount: 20
    });
    const templateIds = new Set(queries.map((query) => query.templateId));

    expect(templateIds.has("direct_distributor_country")).toBe(true);
    expect(templateIds.has("distributor_exact_scenario")).toBe(true);
    expect(queries[0]?.keywordGroups.customerIntentTerms).toEqual(
      expect.arrayContaining(["distributor", "stockist"])
    );
  });

  it("uses product and reference customer profile URLs to create similar-customer queries", () => {
    const queries = generateSearchQueries({
      taskText: "帮我找5G通信设备相关的客户",
      productProfileUrls: ["https://telecorenet.com/", "https://telecorenet.com/products"],
      referenceCustomerUrls: ["https://spectrummea.com/", "https://highcloud.ae/"],
      targetMarkets: ["UAE"],
      minQueryCount: 3
    });

    const queryText = queries.map((query) => query.query).join("\n");

    expect(queries[0]?.query).toMatch(/maintenance|RAN|cell site/i);
    expect(queryText).toMatch(/5G|RRU|BBU|microwave backhaul|telecom power/i);
    expect(queryText).not.toMatch(/\binpage:|\bloc:|\blang:/);
    expect(queries[0]?.keywordGroups.customerIntentTerms).toEqual(
      expect.arrayContaining(["telecom system integrator", "network maintenance company", "base station maintenance company"])
    );
    expect(queries[0]?.keywordGroups.excludeTerms).toEqual(
      expect.arrayContaining(["Accio", "TradeWheel", "Alibaba", "directory", "yellow pages"])
    );
  });

  it("uses product catalog model names in executable search queries", () => {
    const queries = generateSearchQueries({
      taskText: "帮我找通信设备现货商",
      productTerms: ["Huawei RRU3959 02311BPD", "Ericsson 2212 B3 KRC161496/2", "ZTE BPN2 board"],
      targetMarkets: ["Nigeria"],
      minQueryCount: 4
    });

    const modelQuery = queries.find((query) => query.templateId === "specific_model_stockist");
    expect(modelQuery?.query).toContain("Huawei RRU3959 02311BPD");
    expect(modelQuery?.query).toContain("Ericsson 2212 B3 KRC161496/2");
    expect(modelQuery?.query).toContain("spare parts");
    expect(modelQuery?.query).toContain("maintenance");
  });

  it("adds additional catalog model queries when a product site has many product names", () => {
    const queries = generateSearchQueries({
      productTerms: [
        "AAU5271 02311TPK",
        "Alcatel-Lucent 3HE04823AA",
        "Ericsson 2212 B3 KRC161496/2",
        "Huawei RRU3959 02311BPD",
        "Huawei RRU5301 02312GUW",
        "Huawei UMPTB1 Board",
        "Huawei WBBPf4 board",
        "ZTE R8862A S9000 PID:A6A",
        "ZTE UBBP board"
      ],
      targetMarkets: ["Nigeria"],
      minQueryCount: 4
    });

    const modelQueries = queries.filter((query) => query.templateId === "specific_model_stockist");
    const modelQueryText = modelQueries.map((query) => query.query).join("\n");

    expect(modelQueries).toHaveLength(3);
    expect(modelQueryText).toContain("AAU5271 02311TPK");
    expect(modelQueryText).toContain("Huawei RRU5301 02312GUW");
    expect(modelQueryText).toContain("ZTE UBBP board");
  });

  it("covers catalog product chunks before repeating the same chunk across many markets", () => {
    const queries = generateSearchQueries({
      productTerms: [
        "AAU5271 02311TPK",
        "Alcatel-Lucent 3HE04823AA",
        "Ericsson 2212 B3 KRC161496/2",
        "Huawei RRU3959 02311BPD",
        "Huawei RRU5301 02312GUW",
        "Huawei UMPTB1 Board",
        "Huawei WBBPf4 board",
        "KJ-Waterproof insulating tape",
        "ZTE R8862A S9000 PID:A6A",
        "ZTE UBBP board",
        "ZTE ZXSDR B8200",
        "ZTE ZXSDR R8882"
      ],
      targetMarkets: ["UAE", "Saudi Arabia", "Qatar", "Oman", "Nigeria", "Germany", "Brazil", "Kenya"],
      minQueryCount: 8
    });

    const modelQueryText = queries
      .filter((query) => query.templateId === "specific_model_stockist")
      .map((query) => query.query)
      .join("\n");

    expect(modelQueryText).toContain("AAU5271 02311TPK");
    expect(modelQueryText).toContain("KJ-Waterproof insulating tape");
    expect(modelQueryText).toContain("ZTE ZXSDR R8882");
  });

  it("keeps explicit task target markets ahead of reference profile market hints", () => {
    const queries = generateSearchQueries({
      taskText: "目标 UAE / Saudi，找同类型通信设备客户",
      productProfileUrls: ["https://telecorenet.com/"],
      referenceCustomerUrls: ["https://spectrummea.com/", "https://highcloud.ae/"],
      targetMarkets: ["UAE", "Dubai", "Abu Dhabi", "Saudi Arabia", "Riyadh", "Jeddah"],
      minQueryCount: 12
    });
    const countries = new Set(queries.map((query) => query.country));

    expect(countries).toEqual(new Set(["UAE", "Dubai", "Abu Dhabi", "Saudi Arabia", "Riyadh", "Jeddah"]));
  });

  it("expands selected macro regions so large market selections are not silently truncated", () => {
    const queries = generateSearchQueries({
      targetMarkets: ["Middle East", "Europe", "Latin America", "Africa"],
      minQueryCount: 15
    });
    const countries = new Set(queries.map((query) => query.country));

    expect(queries.length).toBeGreaterThan(15);
    expect(countries.size).toBeGreaterThan(15);
    expect(countries.has("UAE")).toBe(true);
    expect(countries.has("Germany")).toBe(true);
    expect(countries.has("Brazil")).toBe(true);
    expect(countries.has("Nigeria")).toBe(true);
  });

  it("records operator source, execution status, template, keyword groups, and score", () => {
    const [query] = generateSearchQueries({ targetMarkets: ["UAE"], minQueryCount: 1 });

    expect(query).toEqual(
      expect.objectContaining({
        operatorSource: expect.any(String),
        executionStatus: expect.stringMatching(/supported|experimental/),
        operatorName: expect.any(String),
        strategyTemplate: expect.any(String),
        keywordGroups: expect.objectContaining({
          productTerms: expect.arrayContaining(["telecom equipment"]),
          customerIntentTerms: expect.arrayContaining([
            "network maintenance company",
            "telecom system integrator",
            "mobile network operator",
            "ISP network operations",
            "procurement"
          ]),
          excludeTerms: expect.arrayContaining(["job", "directory", "yellow pages"])
        }),
        effectivenessScore: expect.any(Number)
      })
    );
    expect(query?.query).toContain("-job");
    expect(query?.query).toContain("-directory");
  });

  it("keeps common SEO manual-only and disabled templates out of automatic Brave execution", () => {
    const library = getSearchStrategyLibrary();

    expect(library.templates.some((item) => item.executionStatus === "manual_only")).toBe(true);
    expect(library.templates.some((item) => item.executionStatus === "disabled")).toBe(true);
    expect(getExecutableSearchStrategyTemplates(library)).not.toContainEqual(
      expect.objectContaining({ executionStatus: "manual_only" })
    );
    expect(getExecutableSearchStrategyTemplates(library)).not.toContainEqual(
      expect.objectContaining({ executionStatus: "disabled" })
    );
  });

  it("contains Brave, Google, and common SEO source metadata", () => {
    const sources = new Set(getSearchStrategyLibrary().operators.map((item) => item.operatorSource));

    expect(sources.has("brave_official")).toBe(true);
    expect(sources.has("google_official")).toBe(true);
    expect(sources.has("common_seo")).toBe(true);
  });
});
