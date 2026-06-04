import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service.js";

const sendLogIdSchema = z.string().uuid();

export type TrackingOpenContext = {
  userAgent?: string;
  ipAddress?: string;
};

@Injectable()
export class TrackingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recordOpen(sendLogId: string, context: TrackingOpenContext = {}) {
    const parsed = sendLogIdSchema.safeParse(sendLogId);
    if (!parsed.success) {
      return { recorded: false, reason: "invalid_send_log_id" };
    }

    const sendLog = await this.prisma.sendLog.findUnique({
      where: { id: parsed.data },
      select: { id: true }
    });
    if (!sendLog) {
      return { recorded: false, reason: "send_log_not_found" };
    }

    await this.prisma.engagementEvent.create({
      data: {
        sendLogId: sendLog.id,
        eventType: "open",
        provider: "tracking_pixel",
        metadata: {
          userAgent: context.userAgent ?? null,
          ipAddress: context.ipAddress ?? null,
          note: "Open tracking is a trend signal only. Email clients and image proxies can undercount or overcount."
        },
        occurredAt: new Date()
      }
    });

    return { recorded: true };
  }
}
