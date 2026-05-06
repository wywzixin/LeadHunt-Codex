import { Inject, Injectable } from "@nestjs/common";
import {
  BraveSearchClient,
  type BraveLlmContextParams,
  type BraveSearchParams,
  type BraveSearchResult
} from "./brave-search.client.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class BraveSearchService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(BraveSearchClient)
    private readonly braveSearchClient: BraveSearchClient
  ) {}

  searchWeb(params: BraveSearchParams) {
    return this.braveSearchClient.searchWeb(params);
  }

  searchLlmContext(params: BraveLlmContextParams) {
    return this.braveSearchClient.searchLlmContext(params);
  }

  async searchAndSaveResults(queryId: string, params: BraveSearchParams) {
    const webResults = await this.searchWeb(params);
    if (webResults.length >= 5) {
      return this.saveResults(queryId, webResults);
    }

    try {
      const contextResults = await this.searchLlmContext({
        ...params,
        maximumNumberOfUrls: params.count ?? 10,
        maximumNumberOfTokens: 4096,
        contextThresholdMode: "low"
      });
      return this.saveResults(queryId, [...webResults, ...contextResults]);
    } catch {
      return this.saveResults(queryId, webResults);
    }
  }

  async saveResults(queryId: string, rawResults: BraveSearchResult[]) {
    const results = dedupeByUrl(rawResults);
    await this.prisma.searchResult.createMany({
      data: results.map((result) => ({
        queryId,
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        domain: domainFromUrl(result.url)
      }))
    });

    await this.prisma.searchQuery.update({
      where: { id: queryId },
      data: { resultCount: results.length }
    });

    return {
      count: results.length,
      results
    };
  }
}

function dedupeByUrl(results: BraveSearchResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const normalized = result.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
