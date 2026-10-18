import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { LeadsModule } from "../leads/leads.module.js";
import { SearchModule } from "../search/search.module.js";
import { AgentWorkflowService } from "./agent-workflow.service.js";
import { LeadTaskController } from "./lead-task.controller.js";
import { WebsiteContentService } from "./website-content.service.js";

@Module({
  imports: [AiModule, AuthModule, SearchModule, LeadsModule],
  controllers: [LeadTaskController],
  providers: [AgentWorkflowService, WebsiteContentService],
  exports: [AgentWorkflowService]
})
export class AgentModule {}
