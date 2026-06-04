import { Module } from "@nestjs/common";
import { Gpt55Client } from "./gpt55.client.js";
import { LeadHuntAiService } from "./leadhunt-ai.service.js";

@Module({
  providers: [Gpt55Client, LeadHuntAiService],
  exports: [Gpt55Client, LeadHuntAiService]
})
export class AiModule {}
