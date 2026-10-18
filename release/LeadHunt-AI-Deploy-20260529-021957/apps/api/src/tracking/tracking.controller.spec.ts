import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { TrackingController } from "./tracking.controller.js";

describe("TrackingController", () => {
  it("returns a no-cache transparent gif and records the open context", async () => {
    const trackingService = {
      recordOpen: vi.fn().mockResolvedValue({ recorded: true })
    };
    const controller = new TrackingController(trackingService as any);
    const response = createResponseMock();

    await controller.open(
      "33333333-3333-4333-8333-333333333333",
      {
        headers: { "user-agent": "Mozilla/5.0" },
        ip: "203.0.113.10",
        socket: {}
      } as unknown as Request,
      response as unknown as Response
    );

    expect(trackingService.recordOpen).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333", {
      userAgent: "Mozilla/5.0",
      ipAddress: "203.0.113.10"
    });
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "image/gif");
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    expect(response.end).toHaveBeenCalledWith(expect.any(Buffer));
  });
});

function createResponseMock() {
  return {
    setHeader: vi.fn(),
    end: vi.fn()
  };
}
