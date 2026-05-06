import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import { resolveMx } from "node:dns/promises";
import { LeadHuntAiService } from "../ai/leadhunt-ai.service.js";
import type { ReplyClassificationResult } from "../ai/leadhunt-ai.schemas.js";
import { syncLeadToCrm } from "../crm/crm-sync.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { createGmailFetchImpl, type GmailFetchLike } from "./gmail-fetch.js";
import { decryptToken } from "./token-encryption.js";

type GoogleRefreshResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GmailThreadResponse = {
  id?: string;
  messages?: GmailThreadMessage[];
};

type GmailThreadMessage = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayload;
};

type GmailPayload = {
  mimeType?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string };
  parts?: GmailPayload[];
};

type GmailDraftResponse = {
  id?: string;
  message?: {
    id?: string;
    threadId?: string;
  };
};

type GmailSendResponse = {
  id?: string;
  threadId?: string;
};

type OwnedLead = {
  id: string;
  taskId: string;
};

export type GmailMessageServiceOptions = {
  fetchImpl?: GmailFetchLike;
  aiService?: ReplyClassifier | null;
  mxLookup?: (domain: string) => Promise<MailExchange[]>;
};

export type GmailMessageInput = {
  leadId?: string;
  to: string;
  replyTo?: string;
  subject: string;
  body: string;
};

export type GmailSendInput = GmailMessageInput & {
  confirm: boolean;
};

type ReplyClassifier = Pick<LeadHuntAiService, "classifyReply">;
type MailExchange = {
  exchange: string;
  priority: number;
};

type ParsedGmailReply = {
  fromEmail: string;
  subject?: string;
  bodyPreview: string;
  receivedAt: Date;
};

@Injectable()
export class GmailMessageService implements OnModuleInit, OnModuleDestroy {
  private readonly fetchImpl: GmailFetchLike;
  private readonly replyClassifier: ReplyClassifier | null;
  private readonly mxLookup: (domain: string) => Promise<MailExchange[]>;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(LeadHuntAiService)
    aiServiceOrOptions: ReplyClassifier | GmailMessageServiceOptions = {}
  ) {
    const options = isServiceOptions(aiServiceOrOptions) ? aiServiceOrOptions : {};
    this.fetchImpl = options.fetchImpl ?? createGmailFetchImpl();
    this.mxLookup = options.mxLookup ?? resolveMx;
    this.replyClassifier = isServiceOptions(aiServiceOrOptions)
      ? options.aiService ?? null
      : aiServiceOrOptions;
  }

  onModuleInit() {
    const intervalMs = Number(process.env.GMAIL_SYNC_INTERVAL_MS ?? "0");
    if (!Number.isFinite(intervalMs) || intervalMs < 60_000) {
      return;
    }

    this.syncTimer = setInterval(() => {
      void this.syncAllUsers().catch(() => undefined);
    }, intervalMs);
    this.syncTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  async createDraft(userId: string, input: GmailMessageInput) {
    const account = await this.getActiveAccount(userId);
    if (input.leadId) {
      await this.ensureLeadForUser(userId, input.leadId);
    }
    await this.assertWithinSendRateLimit(userId);

    const accessToken = await this.refreshAccessToken(account.refreshTokenEncrypted);
    const raw = buildMimeMessage({
      from: account.email,
      to: input.to,
      replyTo: input.replyTo || account.email,
      subject: input.subject,
      body: input.body
    });
    const providerDraft = await this.postGmailJson<GmailDraftResponse>(
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      accessToken,
      {
        message: { raw }
      }
    );

    const localDraft = input.leadId
      ? await this.prisma.outreachDraft.create({
          data: {
            leadId: input.leadId,
            subject: input.subject,
            body: input.body,
            status: "gmail_draft"
          }
        })
      : null;

    return {
      ok: true,
      providerDraftId: providerDraft.id ?? null,
      providerMessageId: providerDraft.message?.id ?? null,
      draft: localDraft ? toSafeDraft(localDraft) : null
    };
  }

  async sendEmail(userId: string, input: GmailSendInput) {
    if (!input.confirm) {
      throw new BadRequestException("User confirmation is required before sending Gmail");
    }

    const account = await this.getActiveAccount(userId);
    const lead = input.leadId ? await this.ensureLeadForUser(userId, input.leadId) : null;
    await this.assertWithinSendRateLimit(userId);
    await this.assertRecipientDomainCanReceiveMail(input.to);

    const localDraft = input.leadId
      ? await this.prisma.outreachDraft.create({
          data: {
            leadId: input.leadId,
            subject: input.subject,
            body: input.body,
            status: "sending"
          }
        })
      : null;
    const pendingSendLog = localDraft
      ? await this.prisma.sendLog.create({
          data: {
            draftId: localDraft.id,
            status: "pending"
          }
        })
      : null;
    const accessToken = await this.refreshAccessToken(account.refreshTokenEncrypted);
    const raw = buildMimeMessage({
      from: account.email,
      to: input.to,
      replyTo: input.replyTo || account.email,
      subject: input.subject,
      body: input.body,
      trackingPixelUrl: pendingSendLog ? buildTrackingPixelUrl(pendingSendLog.id) : undefined
    });

    let providerMessage: GmailSendResponse;
    try {
      providerMessage = await this.postGmailJson<GmailSendResponse>(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        accessToken,
        { raw }
      );
    } catch (error) {
      if (pendingSendLog) {
        await this.prisma.sendLog.update({
          where: { id: pendingSendLog.id },
          data: { status: "failed" }
        });
      }
      if (localDraft) {
        await this.prisma.outreachDraft.update({
          where: { id: localDraft.id },
          data: { status: "failed" }
        });
      }
      throw error;
    }

    const sentDraft = localDraft
      ? await this.prisma.outreachDraft.update({
          where: { id: localDraft.id },
          data: { status: "sent" }
        })
      : null;
    const sendLog = pendingSendLog
      ? await this.prisma.sendLog.update({
          where: { id: pendingSendLog.id },
          data: {
            status: "sent",
            providerMessageId: providerMessage.id ?? null,
            sentAt: new Date()
          }
        })
      : null;
    const inboxThread =
      sentDraft && providerMessage.threadId
        ? await this.prisma.inboxThread.upsert({
            where: {
              provider_threadId: {
                provider: "gmail",
                threadId: providerMessage.threadId
              }
            },
            create: {
              draftId: sentDraft.id,
              provider: "gmail",
              threadId: providerMessage.threadId,
              status: "open"
            },
            update: {
              draftId: sentDraft.id,
              status: "open"
            }
          })
        : null;
    const crmLead = input.leadId
      ? await syncLeadToCrm(this.prisma, userId, input.leadId, {
          stage: "contacted",
          tags: ["已触达", "Gmail", "邮件已发送"],
          reason: "Gmail message sent",
          createFollowup: true
        })
      : null;
    const followupTask = lead ? await this.getPendingEmailFollowup(lead.id) : null;
    if (lead) {
      await this.markOutreachWorkflowCompleted(lead, {
        providerMessageId: providerMessage.id ?? null,
        threadId: providerMessage.threadId ?? null,
        sendLogId: sendLog?.id ?? null,
        crmLeadId: crmLead?.id ?? null,
        followupTaskId: followupTask?.id ?? null,
        followupDueAt: followupTask?.dueAt ?? null
      });
    }

    return {
      ok: true,
      providerMessageId: providerMessage.id ?? null,
      threadId: providerMessage.threadId ?? null,
      draft: sentDraft ? toSafeDraft(sentDraft) : null,
      sendLog: sendLog
        ? {
            id: sendLog.id,
            status: sendLog.status,
            providerMessageId: sendLog.providerMessageId,
            sentAt: sendLog.sentAt
          }
        : null,
      inboxThread: inboxThread
        ? {
            id: inboxThread.id,
            provider: inboxThread.provider,
            threadId: inboxThread.threadId,
            status: inboxThread.status
          }
        : null,
      crmLead,
      followupTask: followupTask
        ? {
            id: followupTask.id,
            type: followupTask.type,
            status: followupTask.status,
            dueAt: followupTask.dueAt,
            note: followupTask.note
          }
        : null
    };
  }

  async listMailboxMessages(
    userId: string,
    input: { folder?: "inbox" | "sent"; limit?: number; pageToken?: string; q?: string } = {}
  ) {
    const account = await this.getActiveAccount(userId);
    const accessToken = await this.refreshAccessToken(account.refreshTokenEncrypted);
    const folder = input.folder ?? "inbox";
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);

    const query = new URLSearchParams();
    query.set("maxResults", String(limit));
    const labelId = folder === "sent" ? "SENT" : "INBOX";
    query.append("labelIds", labelId);
    if (input.q) query.set("q", input.q);
    if (input.pageToken) query.set("pageToken", input.pageToken);

    const listResponse = await this.getGmailJson<{
      messages?: Array<{ id?: string; threadId?: string }>;
      nextPageToken?: string;
      resultSizeEstimate?: number;
    }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query.toString()}`, accessToken);

    const messageIds = (listResponse.messages ?? [])
      .map((message) => message.id)
      .filter((id): id is string => Boolean(id));

    const messages = await Promise.all(
      messageIds.map(async (id) => {
        try {
          const detail = await this.getGmailJson<GmailThreadMessage>(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
            accessToken
          );
          return summarizeGmailMessage(detail);
        } catch {
          return null;
        }
      })
    );

    return {
      ok: true,
      folder,
      account: { email: account.email },
      messages: messages.filter((message): message is NonNullable<typeof message> => Boolean(message)),
      nextPageToken: listResponse.nextPageToken ?? null,
      total: listResponse.resultSizeEstimate ?? messages.length
    };
  }

  async getMailboxMessage(userId: string, messageId: string) {
    const account = await this.getActiveAccount(userId);
    const accessToken = await this.refreshAccessToken(account.refreshTokenEncrypted);
    const detail = await this.getGmailJson<GmailThreadMessage>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
      accessToken
    );
    const summary = summarizeGmailMessage(detail);
    if (!summary) {
      throw new NotFoundException("Gmail message not found");
    }

    return {
      ok: true,
      account: { email: account.email },
      message: {
        ...summary,
        body: extractPayloadText(detail.payload).slice(0, 50_000),
        bodyHtml: extractPayloadHtml(detail.payload).slice(0, 200_000),
        labelIds: detail.labelIds ?? []
      }
    };
  }

  async syncReplies(userId: string, input: { threadId?: string } = {}) {
    const account = await this.getActiveAccount(userId);
    const accessToken = await this.refreshAccessToken(account.refreshTokenEncrypted);
    const threads = await this.prisma.inboxThread.findMany({
      where: {
        provider: "gmail",
        ...(input.threadId ? { threadId: input.threadId } : {}),
        draft: {
          lead: {
            task: { userId }
          }
        }
      },
      include: {
        draft: {
          include: {
            lead: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    const result = {
      ok: true,
      threads: threads.length,
      scannedMessages: 0,
      newReplies: 0,
      classifiedReplies: 0,
      followupsCreated: 0,
      stageEventsWritten: 0,
      analyticsWritten: 0
    };

    for (const thread of threads) {
      const providerThread = await this.getGmailJson<GmailThreadResponse>(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(thread.threadId)}?format=full`,
        accessToken
      );
      const messages = providerThread.messages ?? [];
      let newestMessageAt = thread.lastSyncedAt ?? null;

      for (const message of messages) {
        result.scannedMessages += 1;
        const parsed = parseGmailThreadMessage(message);
        if (!parsed || isSenderAccount(parsed.fromEmail, account.email)) {
          continue;
        }

        if (thread.lastSyncedAt && parsed.receivedAt <= thread.lastSyncedAt) {
          continue;
        }

        const duplicate = await this.prisma.inboundMessage.findFirst({
          where: {
            threadId: thread.id,
            fromEmail: parsed.fromEmail,
            subject: parsed.subject,
            receivedAt: parsed.receivedAt
          },
          select: { id: true }
        });

        if (duplicate) {
          continue;
        }

        const inboundMessage = await this.prisma.inboundMessage.create({
          data: {
            threadId: thread.id,
            fromEmail: parsed.fromEmail,
            subject: parsed.subject,
            bodyPreview: parsed.bodyPreview,
            receivedAt: parsed.receivedAt
          }
        });
        result.newReplies += 1;

        const classification = await this.classifyReply({
          subject: parsed.subject,
          body: parsed.bodyPreview,
          sender: parsed.fromEmail
        });
        await this.prisma.replyClassification.create({
          data: {
            messageId: inboundMessage.id,
            intent: classification.category,
            confidence: Math.round(classification.confidence * 100),
            extractedNeeds: {
              sentiment: classification.sentiment,
              nextAction: classification.nextAction
            },
            summary: classification.summary
          }
        });
        result.classifiedReplies += 1;

        const workflowResult = await this.applyReplyWorkflow(userId, thread.draft.lead, classification, parsed.receivedAt);
        result.followupsCreated += workflowResult.followupsCreated;
        result.stageEventsWritten += workflowResult.stageEventsWritten;
        result.analyticsWritten += workflowResult.analyticsWritten;

        if (!newestMessageAt || parsed.receivedAt > newestMessageAt) {
          newestMessageAt = parsed.receivedAt;
        }
      }

      await this.prisma.inboxThread.update({
        where: { id: thread.id },
        data: {
          lastSyncedAt: newestMessageAt ?? new Date()
        }
      });
    }

    return result;
  }

  async syncAllUsers() {
    const accounts = await this.prisma.gmailAccount.findMany({
      where: { revokedAt: null },
      distinct: ["userId"],
      select: { userId: true }
    });
    const result = {
      ok: true,
      users: accounts.length,
      threads: 0,
      scannedMessages: 0,
      newReplies: 0,
      classifiedReplies: 0,
      followupsCreated: 0,
      stageEventsWritten: 0,
      analyticsWritten: 0,
      failedUsers: 0
    };

    for (const account of accounts) {
      try {
        const userResult = await this.syncReplies(account.userId);
        result.threads += userResult.threads;
        result.scannedMessages += userResult.scannedMessages;
        result.newReplies += userResult.newReplies;
        result.classifiedReplies += userResult.classifiedReplies;
        result.followupsCreated += userResult.followupsCreated;
        result.stageEventsWritten += userResult.stageEventsWritten;
        result.analyticsWritten += userResult.analyticsWritten;
      } catch {
        result.failedUsers += 1;
      }
    }

    return result;
  }

  private async getActiveAccount(userId: string) {
    const account = await this.prisma.gmailAccount.findFirst({
      where: {
        userId,
        revokedAt: null
      },
      orderBy: { connectedAt: "desc" }
    });

    if (!account) {
      throw new BadRequestException("Gmail is not authorized");
    }

    return account;
  }

  private async ensureLeadForUser(userId: string, leadId: string) {
    const lead = await this.prisma.leadCandidate.findFirst({
      where: {
        id: leadId,
        task: { userId }
      },
      select: { id: true, taskId: true }
    });

    if (!lead) {
      throw new NotFoundException("Lead candidate not found");
    }

    return lead;
  }

  private getPendingEmailFollowup(leadId: string) {
    return this.prisma.followupTask.findFirst({
      where: {
        leadId,
        type: "email_followup",
        status: "pending"
      },
      orderBy: { dueAt: "asc" },
      select: {
        id: true,
        type: true,
        status: true,
        dueAt: true,
        note: true
      }
    });
  }

  private async markOutreachWorkflowCompleted(
    lead: OwnedLead,
    output: {
      providerMessageId: string | null;
      threadId: string | null;
      sendLogId: string | null;
      crmLeadId: string | null;
      followupTaskId: string | null;
      followupDueAt: Date | null;
    }
  ) {
    const now = new Date();
    await Promise.all([
      this.prisma.agentStep.updateMany({
        where: { taskId: lead.taskId, nodeName: "wait_email_confirmation" },
        data: {
          status: "completed",
          output: { confirmed: true, leadId: lead.id },
          endedAt: now,
          error: null
        }
      }),
      this.prisma.agentStep.updateMany({
        where: { taskId: lead.taskId, nodeName: "send_gmail" },
        data: {
          status: "completed",
          output: {
            leadId: lead.id,
            providerMessageId: output.providerMessageId,
            threadId: output.threadId,
            sendLogId: output.sendLogId
          },
          startedAt: now,
          endedAt: now,
          error: null
        }
      }),
      this.prisma.agentStep.updateMany({
        where: { taskId: lead.taskId, nodeName: "sync_crm" },
        data: {
          status: "completed",
          output: {
            leadId: lead.id,
            crmLeadId: output.crmLeadId,
            stage: "contacted"
          },
          startedAt: now,
          endedAt: now,
          error: null
        }
      }),
      this.prisma.agentStep.updateMany({
        where: { taskId: lead.taskId, nodeName: "schedule_followup" },
        data: {
          status: "completed",
          output: {
            leadId: lead.id,
            followupTaskId: output.followupTaskId,
            dueAt: output.followupDueAt?.toISOString() ?? null
          },
          startedAt: now,
          endedAt: now,
          error: null
        }
      }),
      this.prisma.leadTask.update({
        where: { id: lead.taskId },
        data: { status: "email_sent" }
      })
    ]);
  }

  private async assertWithinSendRateLimit(userId: string, now = new Date()) {
    const dailyLimit = readNonNegativeIntegerEnv("GMAIL_DAILY_SEND_LIMIT", 80);
    if (dailyLimit > 0) {
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sentInWindow = await this.prisma.sendLog.count({
        where: {
          status: "sent",
          createdAt: { gte: since },
          draft: {
            lead: {
              task: { userId }
            }
          }
        }
      });

      if (sentInWindow >= dailyLimit) {
        throw new BadRequestException(`Gmail daily send limit reached (${dailyLimit}/24h)`);
      }
    }

    const minIntervalMs = readNonNegativeIntegerEnv("GMAIL_MIN_SEND_INTERVAL_MS", 15_000);
    if (minIntervalMs <= 0) {
      return;
    }

    const latestSend = await this.prisma.sendLog.findFirst({
      where: {
        status: "sent",
        draft: {
          lead: {
            task: { userId }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true }
    });

    if (!latestSend) {
      return;
    }

    const elapsedMs = now.getTime() - latestSend.createdAt.getTime();
    if (elapsedMs < minIntervalMs) {
      const waitSeconds = Math.max(1, Math.ceil((minIntervalMs - elapsedMs) / 1000));
      throw new BadRequestException(`Gmail send is rate limited. Please wait ${waitSeconds} seconds`);
    }
  }

  private async refreshAccessToken(refreshTokenEncrypted: string) {
    const config = getGoogleTokenConfig();
    const refreshToken = decryptToken(refreshTokenEncrypted);
    const response = await this.fetchImpl(config.tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      }).toString()
    });
    const payload = (await response.json()) as GoogleRefreshResponse;

    if (!response.ok || !payload.access_token) {
      throw new BadRequestException(formatGoogleError("Google refresh token failed", response.status, payload));
    }

    return payload.access_token;
  }

  private async assertRecipientDomainCanReceiveMail(email: string) {
    const domain = email.split("@").pop()?.trim().toLowerCase();
    if (!domain) {
      throw new BadRequestException("Recipient email domain is invalid");
    }

    try {
      const records = await this.mxLookup(domain);
      const hasDeliverableMx = records.some((record) => {
        const exchange = record.exchange.trim();
        return exchange.length > 0 && exchange !== ".";
      });
      if (!hasDeliverableMx) {
        throw new BadRequestException(`Recipient domain ${domain} does not accept email`);
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(`Recipient domain ${domain} has no valid MX record`);
    }
  }

  private async postGmailJson<T>(url: string, accessToken: string, body: unknown) {
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const payload = (await response.json()) as T & { error?: { message?: string } };

    if (!response.ok) {
      const message = payload.error?.message ? `: ${payload.error.message}` : "";
      throw new BadRequestException(`Gmail API request failed with HTTP ${response.status}${message}`);
    }

    return payload;
  }

  private async getGmailJson<T>(url: string, accessToken: string) {
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    const payload = (await response.json()) as T & { error?: { message?: string } };

    if (!response.ok) {
      const message = payload.error?.message ? `: ${payload.error.message}` : "";
      throw new BadRequestException(`Gmail API request failed with HTTP ${response.status}${message}`);
    }

    return payload;
  }

  private async classifyReply(input: { subject?: string; body: string; sender?: string }) {
    if (this.replyClassifier) {
      try {
        return await this.replyClassifier.classifyReply(input);
      } catch {
        return classifyReplyLocally(input);
      }
    }

    return classifyReplyLocally(input);
  }

  private async applyReplyWorkflow(
    userId: string,
    lead: { id: string; taskId: string; status: string | null },
    classification: ReplyClassificationResult,
    now: Date
  ) {
    const workflow = replyWorkflowByCategory[classification.category];
    const result = {
      followupsCreated: 0,
      stageEventsWritten: 0,
      analyticsWritten: 0
    };

    if (workflow.cancelPendingFollowups) {
      await this.prisma.followupTask.updateMany({
        where: {
          leadId: lead.id,
          status: "pending"
        },
        data: {
          status: "canceled"
        }
      });
    }

    const previousStage = lead.status;
    await syncLeadToCrm(this.prisma, userId, lead.id, {
      stage: workflow.stage,
      tags: workflow.tags,
      reason: `Gmail reply classified as ${classification.category}: ${classification.summary}`,
      createFollowup: false,
      now
    });

    if (previousStage !== workflow.stage) {
      result.stageEventsWritten += 1;
    }

    if (workflow.followupType) {
      const existingFollowup = await this.prisma.followupTask.findFirst({
        where: {
          leadId: lead.id,
          type: workflow.followupType,
          status: "pending"
        },
        select: { id: true }
      });

      if (!existingFollowup) {
        await this.prisma.followupTask.create({
          data: {
            leadId: lead.id,
            type: workflow.followupType,
            status: "pending",
            dueAt: addMinutes(now, workflow.dueInMinutes),
            note: workflow.note
          }
        });
        result.followupsCreated += 1;
      }
    }

    await this.prisma.campaignAnalytic.upsert({
      where: {
        taskId_dimension_dimensionValue: {
          taskId: lead.taskId,
          dimension: "reply_intent",
          dimensionValue: classification.category
        }
      },
      create: {
        taskId: lead.taskId,
        dimension: "reply_intent",
        dimensionValue: classification.category,
        sentCount: 0,
        replyCount: 1,
        qualifiedCount: workflow.qualified ? 1 : 0
      },
      update: {
        replyCount: { increment: 1 },
        qualifiedCount: { increment: workflow.qualified ? 1 : 0 }
      }
    });
    result.analyticsWritten += 1;

    return result;
  }
}

const replyWorkflowByCategory: Record<
  ReplyClassificationResult["category"],
  {
    stage: string;
    tags: string[];
    followupType?: string;
    dueInMinutes: number;
    note?: string;
    qualified: boolean;
    cancelPendingFollowups?: boolean;
  }
> = {
  interested: {
    stage: "interested",
    tags: ["已回复", "感兴趣", "Gmail"],
    followupType: "reply_interested",
    dueInMinutes: 0,
    note: "客户回复感兴趣，需要人工跟进需求和下一步。",
    qualified: true
  },
  request_quote: {
    stage: "quote_requested",
    tags: ["已回复", "要报价", "Gmail"],
    followupType: "prepare_quote",
    dueInMinutes: 0,
    note: "客户要求报价，需要整理型号、数量和价格方案。",
    qualified: true
  },
  request_catalog: {
    stage: "catalog_requested",
    tags: ["已回复", "要目录", "Gmail"],
    followupType: "send_catalog",
    dueInMinutes: 0,
    note: "客户要求目录，需要发送产品目录或资料包。",
    qualified: true
  },
  rejection: {
    stage: "rejected",
    tags: ["已回复", "拒绝", "Gmail"],
    dueInMinutes: 0,
    qualified: false,
    cancelPendingFollowups: true
  },
  unsubscribe: {
    stage: "unsubscribed",
    tags: ["已回复", "退订", "Gmail", "停止触达"],
    dueInMinutes: 0,
    qualified: false,
    cancelPendingFollowups: true
  },
  auto_reply: {
    stage: "auto_reply",
    tags: ["自动回复", "Gmail"],
    followupType: "auto_reply_check",
    dueInMinutes: 60 * 24 * 3,
    note: "收到自动回复，3 天后检查是否有真人回复。",
    qualified: false
  },
  other: {
    stage: "replied",
    tags: ["已回复", "待判断", "Gmail"],
    followupType: "review_reply",
    dueInMinutes: 60,
    note: "客户回复需要人工判断。",
    qualified: false
  }
};

function isServiceOptions(value: ReplyClassifier | GmailMessageServiceOptions): value is GmailMessageServiceOptions {
  return Boolean(value && ("fetchImpl" in value || "aiService" in value));
}

function readNonNegativeIntegerEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

function parseGmailThreadMessage(message: GmailThreadMessage): ParsedGmailReply | null {
  const headers = message.payload?.headers ?? [];
  const fromEmail = extractEmailAddress(getHeader(headers, "from"));
  if (!fromEmail) {
    return null;
  }

  const subject = getHeader(headers, "subject") || undefined;
  const receivedAt = parseGmailDate(message.internalDate, getHeader(headers, "date"));
  const body = extractPayloadText(message.payload);
  const bodyPreview = normalizeWhitespace(body || message.snippet || "");

  return {
    fromEmail,
    subject,
    bodyPreview: bodyPreview.slice(0, 4000),
    receivedAt
  };
}

function getHeader(headers: Array<{ name?: string; value?: string }>, name: string) {
  return headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? "";
}

function extractEmailAddress(value: string) {
  const angleMatch = value.match(/<([^>]+)>/);
  const candidate = angleMatch?.[1] ?? value;
  const emailMatch = candidate.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return emailMatch?.[0]?.toLowerCase() ?? "";
}

function isSenderAccount(fromEmail: string, accountEmail: string) {
  return fromEmail.toLowerCase() === accountEmail.toLowerCase();
}

function parseGmailDate(internalDate?: string, dateHeader?: string) {
  if (internalDate && /^\d+$/.test(internalDate)) {
    return new Date(Number(internalDate));
  }

  const headerDate = dateHeader ? new Date(dateHeader) : null;
  return headerDate && !Number.isNaN(headerDate.getTime()) ? headerDate : new Date();
}

function extractPayloadText(payload?: GmailPayload): string {
  if (!payload) {
    return "";
  }

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts?.length) {
    const plain = payload.parts.map(extractPayloadText).find(Boolean);
    if (plain) {
      return plain;
    }
  }

  if (payload.body?.data) {
    return stripHtml(decodeBase64Url(payload.body.data));
  }

  return "";
}

function extractPayloadHtml(payload?: GmailPayload): string {
  if (!payload) {
    return "";
  }

  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts?.length) {
    const html = payload.parts.map(extractPayloadHtml).find(Boolean);
    if (html) {
      return html;
    }
  }

  return "";
}

function summarizeGmailMessage(message: GmailThreadMessage) {
  if (!message.id) {
    return null;
  }

  const headers = message.payload?.headers ?? [];
  const fromHeader = getHeader(headers, "from");
  const fromEmail = extractEmailAddress(fromHeader);
  const fromName = parseDisplayName(fromHeader) || fromEmail;
  const toHeader = getHeader(headers, "to");
  const subject = getHeader(headers, "subject") || "(无主题)";
  const receivedAt = parseGmailDate(message.internalDate, getHeader(headers, "date"));
  const snippet = message.snippet ? normalizeWhitespace(message.snippet).slice(0, 200) : "";
  const labels = message.labelIds ?? [];
  const isUnread = labels.includes("UNREAD");

  return {
    id: message.id,
    threadId: message.threadId ?? message.id,
    fromName,
    fromEmail,
    to: toHeader,
    subject,
    snippet,
    receivedAt: receivedAt.toISOString(),
    unread: isUnread
  };
}

function parseDisplayName(headerValue: string) {
  if (!headerValue) return "";
  const match = /^"?([^"<]+?)"?\s*<[^>]+>$/.exec(headerValue);
  return match?.[1]?.trim() ?? "";
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function stripHtml(value: string) {
  return value.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function classifyReplyLocally(input: { subject?: string; body: string; sender?: string }): ReplyClassificationResult {
  const text = `${input.subject ?? ""} ${input.body}`.toLowerCase();

  if (/(unsubscribe|remove me|opt out|stop email|退订|取消订阅)/i.test(text)) {
    return {
      category: "unsubscribe",
      sentiment: "negative",
      confidence: 0.92,
      summary: "Prospect asked to unsubscribe or stop receiving outreach.",
      nextAction: "Stop outreach and mark as unsubscribed."
    };
  }

  if (/(not interested|no need|do not need|reject|拒绝|不需要|没兴趣)/i.test(text)) {
    return {
      category: "rejection",
      sentiment: "negative",
      confidence: 0.86,
      summary: "Prospect rejected the offer or said they are not interested.",
      nextAction: "Stop this outreach path."
    };
  }

  if (/(out of office|automatic reply|auto.?reply|vacation|自动回复|外出)/i.test(text)) {
    return {
      category: "auto_reply",
      sentiment: "neutral",
      confidence: 0.84,
      summary: "Message appears to be an automatic reply.",
      nextAction: "Wait and check again later."
    };
  }

  if (/(quote|quotation|price|pricing|rfq|报价|价格|询价)/i.test(text)) {
    return {
      category: "request_quote",
      sentiment: "positive",
      confidence: 0.9,
      summary: "Prospect requested price or quotation information.",
      nextAction: "Prepare a quote and ask for quantity/model details if missing."
    };
  }

  if (/(catalog|catalogue|brochure|datasheet|资料|目录|手册)/i.test(text)) {
    return {
      category: "request_catalog",
      sentiment: "positive",
      confidence: 0.88,
      summary: "Prospect requested catalog, brochure, or product information.",
      nextAction: "Send catalog or product list."
    };
  }

  if (/(interested|please send|need|require|looking for|有兴趣|需要|采购)/i.test(text)) {
    return {
      category: "interested",
      sentiment: "positive",
      confidence: 0.78,
      summary: "Prospect shows buying interest or asks for more information.",
      nextAction: "Follow up manually and clarify requirements."
    };
  }

  return {
    category: "other",
    sentiment: "neutral",
    confidence: 0.62,
    summary: "Reply needs manual review.",
    nextAction: "Review the reply and decide the next action."
  };
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function buildMimeMessage(input: {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  body: string;
  trackingPixelUrl?: string;
}) {
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    input.replyTo ? `Reply-To: ${input.replyTo}` : "",
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    input.trackingPixelUrl
      ? 'Content-Type: multipart/alternative; boundary="leadhunt-boundary"'
      : 'Content-Type: text/plain; charset="UTF-8"',
    input.trackingPixelUrl ? "" : "Content-Transfer-Encoding: 8bit"
  ].filter(Boolean);
  const body = input.trackingPixelUrl
    ? buildTrackedMultipartBody(input.body, input.trackingPixelUrl)
    : input.body;
  const mime = `${headers.join("\r\n")}\r\n\r\n${body}`;

  return Buffer.from(mime, "utf8").toString("base64url");
}

function encodeHeader(value: string) {
  if (/^[\x20-\x7E]*$/.test(value)) {
    return value;
  }

  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function buildTrackedMultipartBody(body: string, trackingPixelUrl: string) {
  const html = [
    '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1D2129;">',
    escapeHtml(body).replace(/\r?\n/g, "<br>"),
    "</div>",
    `<img src="${escapeHtmlAttribute(trackingPixelUrl)}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;border:0;" />`
  ].join("");

  return [
    "--leadhunt-boundary",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
    "--leadhunt-boundary",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "--leadhunt-boundary--"
  ].join("\r\n");
}

function buildTrackingPixelUrl(sendLogId: string) {
  const baseUrl = (process.env.API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
  return `${baseUrl}/api/tracking/open/${encodeURIComponent(sendLogId)}.gif`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function getGoogleTokenConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new BadRequestException("Google OAuth is not configured");
  }

  return {
    clientId,
    clientSecret,
    tokenUri: process.env.GOOGLE_TOKEN_URI ?? "https://oauth2.googleapis.com/token"
  };
}

function formatGoogleError(prefix: string, status: number, payload: GoogleRefreshResponse) {
  return `${prefix} with HTTP ${status}${payload.error_description ? `: ${payload.error_description}` : ""}`;
}

function toSafeDraft(draft: {
  id: string;
  leadId: string;
  channel: string;
  subject: string;
  body: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: draft.id,
    leadId: draft.leadId,
    channel: draft.channel,
    subject: draft.subject,
    body: draft.body,
    status: draft.status,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt
  };
}
