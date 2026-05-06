import { describe, expect, it, vi } from "vitest";
import { BraveSearchClient, BraveSearchError } from "./brave-search.client.js";

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
    text: vi.fn().mockResolvedValue(JSON.stringify(payload))
  };
}

describe("BraveSearchClient", () => {
  it("searches Brave Web Search and normalizes title, URL, and snippet", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        web: {
          results: [
            {
              title: "Telecom Distributor",
              url: "https://example.com/",
              description: "Distributor profile",
              extra_snippets: ["RRU and BBU stock"]
            }
          ]
        }
      })
    );
    const client = new BraveSearchClient({
      apiKey: "test-key",
      fetchImpl,
      minIntervalMs: 0
    });

    const results = await client.searchWeb({
      query: "telecom equipment distributor",
      country: "ae",
      language: "en",
      count: 10
    });

    expect(results).toEqual([
      {
        title: "Telecom Distributor",
        url: "https://example.com/",
        snippet: "Distributor profile\nRRU and BBU stock",
        source: "web"
      }
    ]);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("/web/search?");
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("country=ae");
  });

  it("searches Brave LLM Context and normalizes grounding snippets", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        grounding: {
          generic: [
            {
              title: "Context Result",
              url: "https://context.example.com",
              snippets: ["First snippet", "Second snippet"]
            }
          ]
        }
      })
    );
    const client = new BraveSearchClient({ apiKey: "test-key", fetchImpl, minIntervalMs: 0 });

    const results = await client.searchLlmContext({ query: "RRU stockist", country: "ae" });

    expect(results[0]).toEqual({
      title: "Context Result",
      url: "https://context.example.com",
      snippet: "First snippet\nSecond snippet",
      source: "llm_context"
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("/llm/context?");
  });

  it("returns a readable error when the Brave key is missing", async () => {
    const client = new BraveSearchClient({
      apiKey: "",
      fetchImpl: vi.fn(),
      minIntervalMs: 0
    });

    await expect(client.searchWeb({ query: "telecom" })).rejects.toThrow(BraveSearchError);
    await expect(client.searchWeb({ query: "telecom" })).rejects.toThrow(
      "BRAVE_SEARCH_API_KEY is required"
    );
  });

  it("retries transient Brave failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "busy" }, 500))
      .mockResolvedValueOnce(jsonResponse({ web: { results: [] } }));
    const client = new BraveSearchClient({
      apiKey: "test-key",
      fetchImpl,
      minIntervalMs: 0,
      retryDelayMs: 0,
      maxRetries: 1
    });

    await expect(client.searchWeb({ query: "telecom" })).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caches identical requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ web: { results: [] } }));
    const client = new BraveSearchClient({
      apiKey: "test-key",
      fetchImpl,
      minIntervalMs: 0,
      cacheTtlMs: 60_000
    });

    await client.searchWeb({ query: "telecom", country: "ae" });
    await client.searchWeb({ query: "telecom", country: "ae" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
