import { Body, Controller, Get, Inject, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../auth/auth.service.js";
import { readSessionCookie } from "../auth/session-cookie.js";
import { CustomerProfileService } from "./customer-profile.service.js";

@Controller(["api/profiles/customer", "api/customer-profile"])
export class CustomerProfileController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(CustomerProfileService)
    private readonly customerProfileService: CustomerProfileService
  ) {}

  @Get()
  async get(@Req() request: Request) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.customerProfileService.get(user.id);
  }

  @Put()
  async save(@Req() request: Request, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.customerProfileService.save(user.id, body);
  }
}
