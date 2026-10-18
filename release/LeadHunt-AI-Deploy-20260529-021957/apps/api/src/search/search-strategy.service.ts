import { Inject, Injectable } from "@nestjs/common";
import {
  type GeneratedSearchQuery,
  type SearchStrategyInput,
  generateSearchQueries
} from "@leadhunt/agent";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class SearchStrategyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  planQueries(input: SearchStrategyInput = {}) {
    return generateSearchQueries(input);
  }

  async savePlannedQueries(taskId: string, input: SearchStrategyInput = {}) {
    const queries = this.planQueries(input);
    await this.prisma.searchQuery.createMany({
      data: queries.map((query) => toSearchQueryRecord(taskId, query))
    });

    return {
      count: queries.length,
      queries
    };
  }
}

function toSearchQueryRecord(taskId: string, query: GeneratedSearchQuery) {
  return {
    taskId,
    provider: query.provider,
    operatorSource: query.operatorSource,
    executionStatus: "planned",
    operatorName: query.operatorName,
    strategyTemplate: query.strategyTemplate,
    query: query.query,
    keywordGroups: query.keywordGroups,
    country: query.country,
    effectivenessScore: query.effectivenessScore
  };
}
