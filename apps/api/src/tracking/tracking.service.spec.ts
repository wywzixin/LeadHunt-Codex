import { describe, expect, it, vi } from "vitest";
import { TrackingService } from "./tracking.service.js";

const sendLogId = "33333333-3333-4333-8333-333333333333";

function createPrismaMock() {
  return {
    sendLog: {
      findUnique: vi.fn().mockResolvedValue({ id: sendLogId })
    },
    engagementEvent: {
      create: vi.fn().mockResolvedValue({ id: "engagement-1" })
    }
  };
}

describe("TrackingService", () => {
  it("records a tracking-pixel open event for a valid send log", async () => {
    const prisma = createPrismaMock();
    const service = new TrackingService(prisma as any);

    const result = await service.recordOpen(sendLogId, {
      userAgent: "Mozilla/5.0",
      ipAddress: "203.0.113.10"
    });

    expect(result).toEqual({ recorded: true });
    expect(prisma.sendLog.findUnique).toHaveBeenCalledWith({
      where: { id: sendLogId },
      select: { id: true }
    });
    expect(prisma.engagementEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sendLogId,
        eventType: "open",
        provider: "tracking_pixel",
        metadata: expect.objectContaining({
          userAgent: "Mozilla/5.0",
          ipAddress: "203.0.113.10"
        }),
        occurredAt: expect.any(Date)
      })
    });
  });

  it("ignores invalid tracking identifiers without writing events", async () => {
    const prisma = createPrismaMock();
    const service = new TrackingService(prisma as any);

    const result = await service.recordOpen("not-a-uuid");

    expect(result).toEqual({ recorded: false, reason: "invalid_send_log_id" });
    expect(prisma.sendLog.findUnique).not.toHaveBeenCalled();
    expect(prisma.engagementEvent.create).not.toHaveBeenCalled();
  });

  it("ignores missing send logs without writing events", async () => {
    const prisma = createPrismaMock();
    prisma.sendLog.findUnique.mockResolvedValue(null);
    const service = new TrackingService(prisma as any);

    const result = await service.recordOpen(sendLogId);

    expect(result).toEqual({ recorded: false, reason: "send_log_not_found" });
    expect(prisma.engagementEvent.create).not.toHaveBeenCalled();
  });
});
