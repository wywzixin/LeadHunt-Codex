import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AuthService } from "../auth/auth.service.js";
import { readSessionCookie } from "../auth/session-cookie.js";
import { PostcardService } from "./postcard.service.js";

const recipientSchema = z.object({
  id: z.string().trim().min(1).max(120),
  companyName: z.string().trim().min(1).max(160),
  contactName: z.string().trim().min(1).max(120),
  country: z.string().trim().min(1).max(80),
  city: z.string().trim().min(1).max(80),
  addressLine1: z.string().trim().min(1).max(240),
  addressLine2: z.string().trim().max(240).optional(),
  postalCode: z.string().trim().min(1).max(40),
  phone: z.string().trim().max(80).optional(),
  website: z.string().trim().max(200).optional(),
  addressStatus: z.enum(["unchecked", "valid", "warning"]).default("unchecked")
});

const validateAddressesSchema = z.object({
  recipients: z.array(recipientSchema).min(1).max(100)
});

const createTaskSchema = z.object({
  taskName: z.string().trim().min(2).max(160),
  product: z.string().trim().min(1).max(120),
  countryGroup: z.string().trim().min(1).max(120),
  templateId: z.string().trim().min(1).max(120),
  recipients: z.array(recipientSchema).min(1).max(100),
  realSend: z.boolean().optional()
});

const sendTaskSchema = z.object({
  confirmRealSend: z.boolean().optional()
});

@Controller("api/postcard-mailings")
export class PostcardController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(PostcardService)
    private readonly postcardService: PostcardService
  ) {}

  @Get()
  async list(@Req() request: Request) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.postcardService.list(user.id);
  }

  @Post("validate-addresses")
  async validateAddresses(@Req() request: Request, @Body() body: unknown) {
    await this.authService.me(readSessionCookie(request));
    const parsed = validateAddressesSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid address validation payload");
    }

    return this.postcardService.validateAddresses(parsed.data.recipients);
  }

  @Post()
  async create(@Req() request: Request, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid postcard mailing payload");
    }

    return this.postcardService.createTask(user.id, parsed.data);
  }

  @Post(":taskId/send")
  async send(@Req() request: Request, @Param("taskId") taskId: string, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const parsed = sendTaskSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException("Invalid postcard send payload");
    }

    return this.postcardService.sendTask(user.id, taskId, Boolean(parsed.data.confirmRealSend));
  }
}
