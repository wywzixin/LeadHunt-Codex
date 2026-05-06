import { Module } from "@nestjs/common";
import { BraveSearchClient } from "./brave-search.client.js";
import { BraveSearchService } from "./brave-search.service.js";
import { SearchStrategyService } from "./search-strategy.service.js";

@Module({
  providers: [SearchStrategyService, BraveSearchClient, BraveSearchService],
  exports: [SearchStrategyService, BraveSearchService]
})
export class SearchModule {}
