import { describe, expect, it, vi } from "vitest";
import { BraveSearchService } from "./brave-search.service.js";

function createPrismaMock() {
  return {
    searchResult: {
      createMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    searchQuery: {
      update: vi.fn().mockResolvedValue({})
    }
  };
}

function createBraveClientMock() {
  return {
    searchWeb: vi.fn().mockResolvedValue([
      {
        title: "Telecom Stockist",
        url: "https://example.com/",
        snippet: "RRU stock",
        source: "web"
      },
      {
        title: "Telecom Stockist Duplicate",
        url: "https://example.com",
        snippet: "duplicate",
        source: "web"
      }
    ]),
    searchLlmContext: vi.fn().mockResolvedValue([])
  };
}

describe("BraveSearchService", () => {
  it("saves deduped Brave search results and updates the query count", async () => {
    const prisma = createPrismaMock();
    const braveClient = createBraveClientMock();
    const service = new BraveSearchService(prisma as any, braveClient as any);

    const result = await service.searchAndSaveResults("query-1", {
      query: "telecom equipment distributor",
      country: "ae",
      language: "en",
      count: 10
    });

    expect(result.count).toBe(1);
    expect(prisma.searchResult.createMany).toHaveBeenCalledWith({
      data: [
        {
          queryId: "query-1",
          title: "Telecom Stockist",
          url: "https://example.com/",
          snippet: "RRU stock",
          domain: "example.com"
        }
      ]
    });
    expect(prisma.searchQuery.update).toHaveBeenCalledWith({
      where: { id: "query-1" },
      data: { resultCount: 1 }
    });
  });

  it("adds LLM Context results when web search is sparse", async () => {
    const prisma = createPrismaMock();
    const braveClient = createBraveClientMock();
    braveClient.searchWeb.mockResolvedValueOnce([
      {
        title: "Sparse Web Result",
        url: "https://sparse.example/",
        snippet: "one web result",
        source: "web"
      }
    ]);
    braveClient.searchLlmContext.mockResolvedValueOnce([
      {
        title: "Context Telecom Stockist",
        url: "https://context.example/contact",
        snippet: "Dubai telecom equipment stockist with RRU BBU parts",
        source: "llm_context"
      }
    ]);
    const service = new BraveSearchService(prisma as any, braveClient as any);

    const result = await service.searchAndSaveResults("query-1", {
      query: "telecom equipment stockist UAE",
      country: "ALL",
      language: "en",
      count: 10
    });

    expect(result.count).toBe(2);
    expect(braveClient.searchLlmContext).toHaveBeenCalledWith(
      expect.objectContaining({
        maximumNumberOfUrls: 10,
        contextThresholdMode: "low"
      })
    );
  });

  it("filters marketplace and content noise while keeping mineable directories", async () => {
    const prisma = createPrismaMock();
    const braveClient = createBraveClientMock();
    braveClient.searchWeb.mockResolvedValueOnce([
      {
        title: "Alibaba Solar Supplier",
        url: "https://seller.en.alibaba.com/company_profile.html",
        snippet: "marketplace listing",
        source: "web"
      },
      {
        title: "Tradewheel Solar Buyers",
        url: "https://www.tradewheel.com/solar-inverter/",
        snippet: "directory listing",
        source: "web"
      },
      {
        title: "Local Solar EPC",
        url: "https://localsolar.example/contact",
        snippet: "Qatar solar EPC contractor contact",
        source: "web"
      },
      {
        title: "ENF Solar Directory",
        url: "https://www.enfsolar.com/directory/installer",
        snippet: "directory",
        source: "web"
      },
      {
        title: "PV News",
        url: "https://www.pv-tech.org/news/example",
        snippet: "news",
        source: "web"
      }
    ]);
    braveClient.searchLlmContext.mockResolvedValueOnce([]);
    const service = new BraveSearchService(prisma as any, braveClient as any);

    const result = await service.searchAndSaveResults("query-1", {
      query: "solar inverter distributor Qatar contact",
      country: "ALL",
      language: "en",
      count: 10
    });

    expect(result.count).toBe(2);
    expect(braveClient.searchLlmContext).toHaveBeenCalled();
    expect(prisma.searchResult.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          url: "https://localsolar.example/contact",
          domain: "localsolar.example"
        }),
        expect.objectContaining({
          url: "https://www.enfsolar.com/directory/installer",
          domain: "enfsolar.com"
        })
      ]
    });
    expect(prisma.searchQuery.update).toHaveBeenCalledWith({
      where: { id: "query-1" },
      data: { resultCount: 2 }
    });
  });
});
