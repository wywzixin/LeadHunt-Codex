import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { TrackingController } from "./tracking.controller.js";
import { TrackingService } from "./tracking.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [TrackingController],
  providers: [TrackingService],
  exports: [TrackingService]
})
export class TrackingModule {}
