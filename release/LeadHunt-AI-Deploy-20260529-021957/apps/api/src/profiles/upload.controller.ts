import { Body, Controller, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../auth/auth.service.js";
import { readSessionCookie } from "../auth/session-cookie.js";
import { UploadService } from "./upload.service.js";

@Controller("api/uploads")
export class UploadController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(UploadService)
    private readonly uploadService: UploadService
  ) {}

  @Post()
  async save(@Req() request: Request, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.uploadService.save(user.id, body);
  }
}
