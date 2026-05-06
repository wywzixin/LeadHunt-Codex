import { Body, Controller, Get, Inject, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../auth/auth.service.js";
import { readSessionCookie } from "../auth/session-cookie.js";
import { ProductProfileService } from "./product-profile.service.js";

@Controller(["api/profiles/product", "api/product-profile"])
export class ProductProfileController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(ProductProfileService)
    private readonly productProfileService: ProductProfileService
  ) {}

  @Get()
  async get(@Req() request: Request) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.productProfileService.get(user.id);
  }

  @Put()
  async save(@Req() request: Request, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.productProfileService.save(user.id, body);
  }
}
