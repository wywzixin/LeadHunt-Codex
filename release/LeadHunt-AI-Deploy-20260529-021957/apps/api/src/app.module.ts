import { Module } from "@nestjs/common";
import { AgentModule } from "./agent/agent.module.js";
import { AiModule } from "./ai/ai.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CrmModule } from "./crm/crm.module.js";
import { GmailModule } from "./gmail/gmail.module.js";
import { HealthModule } from "./health/health.module.js";
import { LeadsModule } from "./leads/leads.module.js";
import { PostcardModule } from "./postcard/postcard.module.js";
import { ProfilesModule } from "./profiles/profiles.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { SearchModule } from "./search/search.module.js";
import { TrackingModule } from "./tracking/tracking.module.js";

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    ProfilesModule,
    SearchModule,
    AgentModule,
    AiModule,
    LeadsModule,
    PostcardModule,
    CrmModule,
    GmailModule,
    TrackingModule
  ]
})
export class AppModule {}
