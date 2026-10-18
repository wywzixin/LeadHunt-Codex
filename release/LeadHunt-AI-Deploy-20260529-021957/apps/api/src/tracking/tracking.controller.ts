import { Controller, Get, Inject, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { TrackingService } from "./tracking.service.js";

const transparentGif = Buffer.from("R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

@Controller("api/tracking")
export class TrackingController {
  constructor(@Inject(TrackingService) private readonly trackingService: TrackingService) {}

  @Get("open/:sendLogId.gif")
  async open(@Param("sendLogId") sendLogId: string, @Req() request: Request, @Res() response: Response) {
    await this.trackingService.recordOpen(sendLogId, {
      userAgent: headerToString(request.headers["user-agent"]),
      ipAddress: request.ip || request.socket.remoteAddress
    });

    response.setHeader("Content-Type", "image/gif");
    response.setHeader("Content-Length", String(transparentGif.length));
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Expires", "0");
    return response.end(transparentGif);
  }
}

function headerToString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value;
}
