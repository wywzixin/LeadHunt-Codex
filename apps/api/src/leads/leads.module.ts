import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { LeadQualificationService } from "./lead-qualification.service.js";

@Module({
  imports: [PrismaModule],
  providers: [LeadQualificationService],
  exports: [LeadQualificationService]
})
export class LeadsModule {}
