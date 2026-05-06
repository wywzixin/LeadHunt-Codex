import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AuthService } from "../auth/auth.service.js";
import { readSessionCookie } from "../auth/session-cookie.js";
import { CrmService } from "./crm.service.js";

const listQuerySchema = z.object({
  view: z.enum(["companies", "contacts", "favorites"]).default("companies"),
  group: z.enum(["all", "potential", "contacted_7_days", "uncontacted"]).default("all")
});

const analyticsQuerySchema = z.object({
  range: z.enum(["all", "month", "week", "day"]).default("all")
});

const syncLeadSchema = z.object({
  leadId: z.string().uuid(),
  stage: z.string().trim().min(2).max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  reason: z.string().trim().min(2).max(300).optional(),
  createFollowup: z.boolean().optional()
});

const crmContactSchema = z.object({
  type: z.string().trim().min(2).max(40),
  value: z.string().trim().min(2).max(200),
  sourceUrl: z.string().trim().url().optional().nullable()
});

const crmLeadPayloadSchema = z.object({
  companyName: z.string().trim().min(2).max(160),
  website: z.string().trim().url().optional().nullable(),
  country: z.string().trim().min(2).max(80).optional().nullable(),
  sourceUrl: z.string().trim().url().optional().nullable(),
  stage: z.string().trim().min(2).max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  contacts: z.array(crmContactSchema).max(20).optional()
});

const crmLeadUpdatePayloadSchema = crmLeadPayloadSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required"
});

@Controller("api/crm")
export class CrmController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(CrmService)
    private readonly crmService: CrmService
  ) {}

  @Get("leads")
  async list(@Req() request: Request, @Query() query: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const parsed = listQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException("Invalid CRM list query");
    }

    return this.crmService.listCustomers(user.id, parsed.data);
  }

  @Get("analytics")
  async analytics(@Req() request: Request, @Query() query: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const parsed = analyticsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException("Invalid CRM analytics query");
    }

    return this.crmService.getAnalytics(user.id, parsed.data.range);
  }

  @Get("leads/:id")
  async getLead(@Req() request: Request, @Param("id") id: string) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const parsed = z.string().uuid().safeParse(id);
    if (!parsed.success) {
      throw new BadRequestException("Invalid CRM lead id");
    }

    return this.crmService.getLead(user.id, parsed.data);
  }

  @Post("leads")
  async createLead(@Req() request: Request, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const parsed = crmLeadPayloadSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid CRM lead payload");
    }

    return this.crmService.createLead(user.id, parsed.data);
  }

  @Patch("leads/:id")
  async updateLead(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const idParsed = z.string().uuid().safeParse(id);
    if (!idParsed.success) {
      throw new BadRequestException("Invalid CRM lead id");
    }
    const bodyParsed = crmLeadUpdatePayloadSchema.safeParse(body);
    if (!bodyParsed.success) {
      throw new BadRequestException("Invalid CRM lead payload");
    }

    return this.crmService.updateLead(user.id, idParsed.data, bodyParsed.data);
  }

  @Post("leads/sync")
  async sync(@Req() request: Request, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const parsed = syncLeadSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid CRM sync payload");
    }

    return this.crmService.syncLead(user.id, parsed.data);
  }
}
