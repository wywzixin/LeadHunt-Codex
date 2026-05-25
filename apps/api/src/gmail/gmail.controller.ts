import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Redirect,
  Req
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { LeadHuntAiService } from "../ai/leadhunt-ai.service.js";
import { AuthService } from "../auth/auth.service.js";
import { readSessionCookie } from "../auth/session-cookie.js";
import { GmailMessageService } from "./gmail-message.service.js";
import { GmailOAuthService } from "./gmail-oauth.service.js";

const emailAddressSchema = z.string().trim().email();
const optionalEmailAddressSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .pipe(z.string().email().optional());

const gmailMessageSchema = z.object({
  leadId: z.string().uuid().optional(),
  to: emailAddressSchema,
  replyTo: optionalEmailAddressSchema,
  subject: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(20000)
});

const gmailSendSchema = gmailMessageSchema.extend({
  confirm: z.literal(true),
  scheduledAt: z.coerce.date().optional()
});

const gmailBatchSendSchema = gmailMessageSchema.omit({ leadId: true, to: true }).extend({
  confirm: z.literal(true),
  scheduledAt: z.coerce.date().optional(),
  recipients: z
    .array(
      z.object({
        leadId: z.string().uuid().optional(),
        to: emailAddressSchema
      })
    )
    .min(1)
    .max(50)
});

const gmailRewriteSchema = z.object({
  subject: z.string().trim().max(180).optional(),
  body: z.string().trim().min(1).max(20000),
  outputLanguage: z.string().trim().min(2).max(40),
  tone: z.string().trim().min(2).max(40),
  instruction: z.string().trim().min(2).max(1000)
});

const gmailSyncSchema = z
  .object({
    threadId: z.string().trim().min(1).max(200).optional()
  })
  .optional()
  .transform((value) => value ?? {});

const gmailMessagesQuerySchema = z.object({
  folder: z.enum(["inbox", "sent"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  pageToken: z.string().trim().min(1).max(200).optional(),
  q: z.string().trim().min(1).max(200).optional()
});

@Controller("api/gmail")
export class GmailController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
    @Inject(GmailOAuthService)
    private readonly gmailOAuthService: GmailOAuthService,
    @Inject(GmailMessageService)
    private readonly gmailMessageService: GmailMessageService,
    @Inject(LeadHuntAiService)
    private readonly leadHuntAiService: LeadHuntAiService
  ) {}

  @Get("oauth/start")
  async start(@Req() request: Request) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return { url: this.gmailOAuthService.buildAuthorizationUrl(user.id) };
  }

  @Get("oauth/callback")
  @Redirect()
  async callback(@Query("code") code?: string, @Query("state") state?: string) {
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    try {
      await this.gmailOAuthService.handleCallback(code, state);
    } catch (error) {
      return {
        url: `${frontendUrl}/mailbox?gmail=error&reason=${toGmailOAuthErrorReason(error)}`,
        statusCode: 302
      };
    }

    return {
      url: `${frontendUrl}/mailbox?gmail=connected`,
      statusCode: 302
    };
  }

  @Get("account")
  async account(@Req() request: Request) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.gmailOAuthService.getAccount(user.id);
  }

  @Delete("account")
  async deleteAccount(@Req() request: Request) {
    const { user } = await this.authService.me(readSessionCookie(request));
    return this.gmailOAuthService.revokeAccount(user.id);
  }

  @Post("drafts")
  async createDraft(@Req() request: Request, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const data = parseOrBadRequest(gmailMessageSchema, body);
    return this.gmailMessageService.createDraft(user.id, data);
  }

  @Post("send")
  async send(@Req() request: Request, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const data = parseOrBadRequest(gmailSendSchema, body);
    if (data.scheduledAt) {
      return this.gmailMessageService.scheduleEmail(user.id, {
        ...data,
        scheduledAt: data.scheduledAt
      });
    }
    return this.gmailMessageService.sendEmail(user.id, data);
  }

  @Post("send-batch")
  async sendBatch(@Req() request: Request, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const data = parseOrBadRequest(gmailBatchSendSchema, body);
    if (data.scheduledAt) {
      return this.gmailMessageService.scheduleEmailBatch(user.id, {
        ...data,
        scheduledAt: data.scheduledAt
      });
    }
    return this.gmailMessageService.sendEmailBatch(user.id, data);
  }

  @Post("rewrite")
  async rewrite(@Req() request: Request, @Body() body: unknown) {
    await this.authService.me(readSessionCookie(request));
    const data = parseOrBadRequest(gmailRewriteSchema, body);
    return this.leadHuntAiService.rewriteEmail(data);
  }

  @Get("messages")
  async listMessages(@Req() request: Request, @Query() query: Record<string, string>) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const parsed = gmailMessagesQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException("Invalid Gmail messages query");
    }

    return this.gmailMessageService.listMailboxMessages(user.id, parsed.data);
  }

  @Get("messages/:messageId")
  async getMessage(@Req() request: Request, @Param("messageId") messageId: string) {
    const { user } = await this.authService.me(readSessionCookie(request));
    if (!messageId || messageId.length > 200) {
      throw new BadRequestException("Invalid Gmail message id");
    }

    return this.gmailMessageService.getMailboxMessage(user.id, messageId);
  }

  @Post("sync")
  async sync(@Req() request: Request, @Body() body: unknown) {
    const { user } = await this.authService.me(readSessionCookie(request));
    const data = parseOrBadRequest(gmailSyncSchema, body);
    return this.gmailMessageService.syncReplies(user.id, data);
  }
}

function parseOrBadRequest<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException("Invalid Gmail request payload");
  }

  return result.data;
}

function toGmailOAuthErrorReason(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("expired")) {
    return "expired";
  }
  if (message.includes("state")) {
    return "invalid_state";
  }

  return "failed";
}
