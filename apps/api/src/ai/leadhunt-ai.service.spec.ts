import { describe, expect, it, vi } from "vitest";
import type { Gpt55Client } from "./gpt55.client.js";
import {
  Gpt55OutputValidationError,
  LeadHuntAiService,
  safeParseModelJson
} from "./leadhunt-ai.service.js";

function serviceWithResponses(responses: string[]) {
  const complete = vi.fn();
  for (const response of responses) {
    complete.mockResolvedValueOnce(response);
  }

  return {
    service: new LeadHuntAiService({ complete } as unknown as Gpt55Client),
    complete
  };
}

describe("LeadHuntAiService", () => {
  it("parses structured product profile analysis", async () => {
    const { service, complete } = serviceWithResponses([
      JSON.stringify({
        brandName: "TeleCoreNet",
        websiteUrl: "https://telecorenet.com/",
        productCategories: ["Telecom equipment"],
        keyProducts: ["RRU", "BBU", "AAU", "telecom power"],
        targetUseCases: ["4G/5G network maintenance"],
        buyerPainPoints: ["Need reliable spare parts"],
        supplyCapabilities: ["Huawei and ZTE spare parts"],
        searchKeywords: [
          "telecom equipment distributor",
          "RRU stockist",
          "BBU supplier",
          "AAU spare parts",
          "telecom power distributor"
        ],
        negativeKeywords: ["job", "training"],
        confidence: 0.82,
        evidence: ["Provided website and notes"]
      })
    ]);

    const result = await service.analyzeProductProfile({
      websiteUrl: "https://telecorenet.com/",
      notes: "Telecom equipment supplier"
    });

    expect(result.brandName).toBe("TeleCoreNet");
    expect(result.searchKeywords).toContain("RRU stockist");
    expect(complete.mock.calls[0]?.[0][0].content).toContain("Return valid JSON only");
  });

  it("parses structured customer profile analysis", async () => {
    const { service } = serviceWithResponses([
      JSON.stringify({
        targetRegions: ["UAE", "Qatar"],
        idealCustomerTypes: ["telecom equipment distributor", "system integrator"],
        buyingSignals: ["mentions Huawei or ZTE", "offers network maintenance"],
        referenceCompanies: ["Spectrum MEA", "High Cloud"],
        industries: ["telecommunications", "network infrastructure"],
        searchKeywords: [
          "telecom distributor UAE",
          "system integrator Qatar",
          "Huawei spare parts UAE",
          "ZTE distributor",
          "telecom contractor"
        ],
        disqualifiers: ["training center"],
        confidence: 0.79,
        evidence: ["Reference customer URLs"]
      })
    ]);

    const result = await service.analyzeCustomerProfile({
      targetRegions: ["UAE", "Qatar"],
      referenceCustomerUrls: ["https://spectrummea.com/", "http://highcloud.ae/"]
    });

    expect(result.idealCustomerTypes).toContain("system integrator");
  });

  it("parses keyword expansion output", async () => {
    const { service } = serviceWithResponses([
      JSON.stringify({
        primaryProducts: ["telecom equipment"],
        relatedProducts: ["RRU", "BBU", "AAU"],
        longTailProducts: ["Huawei ZTE spare parts"],
        upstreamDownstreamTerms: ["tower maintenance", "IBS service"],
        purchaseIntentTerms: ["distributor", "stockist", "system integrator"],
        targetMarketTerms: ["UAE", "Dubai"],
        industryScenarioTerms: ["4G network", "5G rollout"],
        exclusionTerms: ["job", "training", "news"]
      })
    ]);

    const result = await service.expandKeywords({ userTask: "找 UAE 通信设备经销商" });

    expect(result.targetMarketTerms).toContain("UAE");
    expect(result.exclusionTerms).toContain("job");
  });

  it("parses search strategy plans with at least 15 queries", async () => {
    const queries = Array.from({ length: 15 }, (_, index) => ({
      query: `"telecom equipment" "distributor" UAE ${index}`,
      country: "ae",
      language: "en",
      operatorSource: "brave_official",
      executionStatus: "experimental",
      rationale: "Targets telecom distributors",
      priority: 1
    }));
    const { service } = serviceWithResponses([JSON.stringify({ queries })]);

    const result = await service.generateSearchStrategy({
      keywordGroups: {
        primaryProducts: ["telecom equipment"],
        relatedProducts: ["RRU"],
        longTailProducts: ["Huawei spare parts"],
        upstreamDownstreamTerms: ["tower maintenance"],
        purchaseIntentTerms: ["distributor"],
        targetMarketTerms: ["UAE"],
        industryScenarioTerms: ["4G"],
        exclusionTerms: ["job"]
      },
      targetMarkets: ["UAE"],
      operatorLibrary: {}
    });

    expect(result.queries).toHaveLength(15);
  });

  it("parses ICP scoring output", async () => {
    const { service } = serviceWithResponses([
      JSON.stringify({
        companyName: "Spectrum MEA",
        websiteUrl: "https://spectrummea.com/",
        score: 87,
        fitLevel: "high",
        reasons: ["Telecom infrastructure focus"],
        risks: [],
        recommendedAction: "approve",
        extractedContacts: {
          emails: ["sales@example.com"],
          phones: [],
          socialProfiles: []
        }
      })
    ]);

    const result = await service.scoreIcp({
      candidate: {
        companyName: "Spectrum MEA",
        websiteUrl: "https://spectrummea.com/",
        snippet: "Telecom infrastructure solutions"
      },
      productProfile: { websiteUrl: "https://telecorenet.com/" },
      customerProfile: {
        targetRegions: ["UAE"],
        referenceCustomerUrls: ["https://spectrummea.com/"]
      }
    });

    expect(result.score).toBe(87);
    expect(result.recommendedAction).toBe("approve");
  });

  it("parses candidate buyer evaluation output", async () => {
    const { service } = serviceWithResponses([
      JSON.stringify({
        companyName: "TowerCo Gulf",
        websiteUrl: "https://towerco.example/",
        resultType: "possible_buyer",
        buyerType: "tower maintenance company",
        fitScore: 82,
        confidence: 0.78,
        decision: "review",
        matchedSignals: ["telecom infrastructure", "site maintenance"],
        risks: ["No explicit spare parts purchasing signal"]
      })
    ]);

    const result = await service.evaluateCandidateBuyer({
      candidate: {
        companyName: "TowerCo Gulf",
        websiteUrl: "https://towerco.example/",
        snippet: "Telecom tower site maintenance and infrastructure operations"
      },
      productProfile: { keyProducts: ["RRU", "BBU"] },
      customerProfile: { idealCustomerTypes: ["tower maintenance company"] },
      targetRegions: ["UAE"]
    });

    expect(result.resultType).toBe("possible_buyer");
    expect(result.fitScore).toBe(82);
  });

  it("parses outreach, rewrite, reply classification, and task summary outputs", async () => {
    const { service } = serviceWithResponses([
      JSON.stringify({
        subject: "Telecom spare parts support",
        body: "Hello, we can support your RRU and BBU spare parts needs.",
        language: "English",
        tone: "professional",
        personalizationNotes: ["Mentions telecom infrastructure"],
        complianceNotes: ["Human review required"]
      }),
      JSON.stringify({
        subject: "Updated subject",
        body: "Rewritten body",
        changes: ["Shortened opening"]
      }),
      JSON.stringify({
        category: "request_quote",
        sentiment: "positive",
        confidence: 0.91,
        summary: "Prospect asked for pricing.",
        nextAction: "Prepare quote"
      }),
      JSON.stringify({
        completedActions: ["Generated queries", "Scored leads"],
        foundCompanies: 20,
        qualifiedCompanies: 6,
        keyFindings: ["UAE distributors found"],
        nextSteps: ["Review qualified leads"],
        risks: ["Some contacts missing"]
      })
    ]);

    await expect(
      service.generateOutreachEmail({
        candidate: { companyName: "Spectrum MEA", websiteUrl: "https://spectrummea.com/" },
        productProfile: { websiteUrl: "https://telecorenet.com/" },
        icpScore: {
          companyName: "Spectrum MEA",
          websiteUrl: "https://spectrummea.com/",
          score: 87,
          fitLevel: "high",
          reasons: ["match"],
          risks: [],
          recommendedAction: "approve",
          extractedContacts: { emails: [], phones: [], socialProfiles: [] }
        }
      })
    ).resolves.toMatchObject({ subject: "Telecom spare parts support" });
    await expect(
      service.rewriteEmail({
        subject: "Old",
        body: "Old body",
        outputLanguage: "English",
        tone: "friendly",
        instruction: "Make it shorter"
      })
    ).resolves.toMatchObject({ body: "Rewritten body" });
    await expect(
      service.classifyReply({ body: "Please send quotation." })
    ).resolves.toMatchObject({ category: "request_quote" });
    await expect(
      service.summarizeTask({
        taskTitle: "Find UAE telecom distributors",
        steps: [{ name: "search", status: "completed" }],
        foundCompanies: 20,
        qualifiedCompanies: 6
      })
    ).resolves.toMatchObject({ qualifiedCompanies: 6 });
  });

  it("strips JSON code fences and surrounding text", () => {
    expect(safeParseModelJson("```json\n{\"ok\":true}\n```")).toMatchObject({
      ok: true,
      value: { ok: true }
    });
    expect(safeParseModelJson("Here is JSON:\n{\"ok\":true}")).toMatchObject({
      ok: true,
      value: { ok: true }
    });
  });

  it("retries once when JSON schema validation fails", async () => {
    const valid = {
      primaryProducts: ["telecom equipment"],
      relatedProducts: ["RRU"],
      longTailProducts: ["Huawei spare parts"],
      upstreamDownstreamTerms: ["tower maintenance"],
      purchaseIntentTerms: ["distributor"],
      targetMarketTerms: ["UAE"],
      industryScenarioTerms: ["4G"],
      exclusionTerms: ["job"]
    };
    const { service, complete } = serviceWithResponses([
      JSON.stringify({ primaryProducts: [] }),
      JSON.stringify(valid)
    ]);

    await expect(service.expandKeywords({ userTask: "find distributors" })).resolves.toEqual(valid);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0][2].content).toContain("failed JSON validation");
  });

  it("throws a readable validation error after retry fails", async () => {
    const { service } = serviceWithResponses([
      JSON.stringify({ primaryProducts: [] }),
      JSON.stringify({ primaryProducts: [] })
    ]);

    await expect(service.expandKeywords({ userTask: "find distributors" })).rejects.toThrow(
      Gpt55OutputValidationError
    );
  });
});
