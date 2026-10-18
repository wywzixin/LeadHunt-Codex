import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { GmailController } from "./gmail.controller.js";
import { GmailMessageService } from "./gmail-message.service.js";
import { GmailOAuthService } from "./gmail-oauth.service.js";

@Module({
  imports: [AiModule, AuthModule, PrismaModule],
  controllers: [GmailController],
  providers: [GmailOAuthService, GmailMessageService],
  exports: [GmailOAuthService, GmailMessageService]
})
export class GmailModule {}
