import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { GmailMessageService, buildMimeMessage } from "./gmail-message.service.js";
import { encryptToken } from "./token-encryption.js";

function setEnv() {
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
  process.env.TOKEN_ENCRYPTION_KEY = "token-secret";
  process.env.GMAIL_DAILY_SEND_LIMIT = "100";
  process.env.GMAIL_MIN_SEND_INTERVAL_MS = "0";
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload)
  };
}

function encodedBody(body: string) {
  return Buffer.from(body, "utf8").toString("base64url");
}

function gmailThreadPayload(body = "Please send quotation for RRU.") {
  return {
    id: "thread-1",
    messages: [
      {
        id: "gmail-message-1",
        threadId: "thread-1",
        internalDate: "1777507200000",
        payload: {
          headers: [
            { name: "From", value: "sender@gmail.com" },
            { name: "Subject", value: "Telecom equipment availability" }
          ],
          body: { data: encodedBody("Original sent email") },
          mimeType: "text/plain"
        }
      },
      {
        id: "gmail-message-2",
        threadId: "thread-1",
        internalDate: "1777510800000",
        payload: {
          headers: [
            { name: "From", value: "Prospect <prospect@example.com>" },
            { name: "Subject", value: "Re: Telecom equipment availability" }
          ],
          body: { data: encodedBody(body) },
          mimeType: "text/plain"
        },
        snippet: body
      }
    ]
  };
}

function createDraftRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    leadId: "11111111-1111-4111-8111-111111111111",
    channel: "email",
    subject: "Telecom equipment availability",
    body: "Hello",
    status: "draft",
    createdAt: new Date("2026-04-30T00:00:00.000Z"),
    updatedAt: new Date("2026-04-30T00:00:00.000Z"),
    ...overrides
  };
}

const sendLogId = "33333333-3333-4333-8333-333333333333";
const followupDueAt = new Date("2026-05-03T00:00:00.000Z");

function createPrismaMock() {
  return {
    gmailAccount: {
      findFirst: vi.fn().mockResolvedValue({
        id: "gmail-1",
        userId: "user-1",
        email: "sender@gmail.com",
        refreshTokenEncrypted: encryptToken("refresh-token"),
        connectedAt: new Date("2026-04-30T00:00:00.000Z"),
        revokedAt: null
      }),
      findMany: vi.fn().mockResolvedValue([{ userId: "user-1" }])
    },
    leadCandidate: {
      findFirst: vi.fn().mockResolvedValue({
        id: "11111111-1111-4111-8111-111111111111",
        taskId: "22222222-2222-4222-8222-222222222222",
        status: "contacted"
      }),
      update: vi.fn().mockResolvedValue({
        id: "11111111-1111-4111-8111-111111111111",
        status: "contacted"
      })
    },
    crmLead: {
      upsert: vi.fn().mockResolvedValue({
        id: "crm-1",
        leadId: "11111111-1111-4111-8111-111111111111",
        stage: "contacted",
        tags: ["已触达", "Gmail"],
        createdAt: new Date("2026-04-30T00:00:00.000Z"),
        updatedAt: new Date("2026-04-30T00:00:00.000Z")
      })
    },
    leadStageEvent: {
      create: vi.fn().mockResolvedValue({ id: "stage-event-1" })
    },
    followupTask: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "followup-1", dueAt: followupDueAt }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    agentStep: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    leadTask: {
      update: vi
        .fn()
        .mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222", status: "email_sent" })
    },
    outreachDraft: {
      create: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve(
          createDraftRecord({
            leadId: data.leadId,
            subject: data.subject,
            body: data.body,
            status: data.status
          })
        )
      ),
      update: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve(
          createDraftRecord({
            status: data.status
          })
        )
      )
    },
    sendLog: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({ id: sendLogId }),
      create: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: sendLogId,
          draftId: data.draftId,
          recipientEmail: data.recipientEmail ?? null,
          replyTo: data.replyTo ?? null,
          status: data.status,
          providerMessageId: null,
          scheduledAt: data.scheduledAt ?? null,
          sentAt: null,
          createdAt: new Date("2026-04-30T00:00:00.000Z")
        })
      ),
      update: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: sendLogId,
          draftId: "draft-1",
          status: data.status,
          providerMessageId: data.providerMessageId ?? null,
          sentAt: data.sentAt ?? null,
          createdAt: new Date("2026-04-30T00:00:00.000Z")
        })
      )
    },
    engagementEvent: {
      create: vi.fn().mockResolvedValue({
        id: "engagement-1",
        sendLogId,
        eventType: "open",
        provider: "tracking_pixel",
        occurredAt: new Date("2026-04-30T00:00:00.000Z")
      })
    },
    inboxThread: {
      upsert: vi.fn().mockResolvedValue({
        id: "thread-local-1",
        draftId: "draft-1",
        provider: "gmail",
        threadId: "thread-1",
        status: "open",
        lastSyncedAt: null,
        createdAt: new Date("2026-04-30T00:00:00.000Z")
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: "thread-local-1",
          draftId: "draft-1",
          provider: "gmail",
          threadId: "thread-1",
          status: "open",
          lastSyncedAt: null,
          createdAt: new Date("2026-04-30T00:00:00.000Z"),
          draft: {
            id: "draft-1",
            leadId: "11111111-1111-4111-8111-111111111111",
            lead: {
              id: "11111111-1111-4111-8111-111111111111",
              taskId: "22222222-2222-4222-8222-222222222222",
              status: "contacted"
            }
          }
        }
      ]),
      update: vi.fn().mockResolvedValue({ id: "thread-local-1" })
    },
    inboundMessage: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: "inbound-1",
        threadId: "thread-local-1",
        fromEmail: "prospect@example.com",
        subject: "Re: Telecom equipment availability",
        bodyPreview: "Please send quotation for RRU.",
        receivedAt: new Date("2026-04-30T01:00:00.000Z"),
        createdAt: new Date("2026-04-30T01:00:00.000Z")
      })
    },
    replyClassification: {
      create: vi.fn().mockResolvedValue({ id: "classification-1" })
    },
    campaignAnalytic: {
      upsert: vi.fn().mockResolvedValue({ id: "analytics-1" })
    }
  };
}

describe("GmailMessageService", () => {
  it("builds a base64url MIME message", () => {
    const raw = buildMimeMessage({
      from: "sender@gmail.com",
      to: "prospect@example.com",
      replyTo: "sender@gmail.com",
      subject: "通信设备合作",
      body: "Hello"
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");

    expect(decoded).toContain("From: sender@gmail.com");
    expect(decoded).toContain("To: prospect@example.com");
    expect(decoded).toContain("Reply-To: sender@gmail.com");
    expect(decoded).toContain("Subject: =?UTF-8?B?");
    expect(decoded).toContain("Hello");
  });

  it("builds tracked multipart MIME when a tracking pixel is provided", () => {
    const raw = buildMimeMessage({
      from: "sender@gmail.com",
      to: "prospect@example.com",
      replyTo: "sender@gmail.com",
      subject: "Telecom equipment availability",
      body: "Hello\n<quoted>",
      trackingPixelUrl: `https://api.example.com/api/tracking/open/${sendLogId}.gif`
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");

    expect(decoded).toContain('Content-Type: multipart/alternative; boundary="leadhunt-boundary"');
    expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(decoded).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(decoded).toContain("Hello<br>&lt;quoted&gt;");
    expect(decoded).toContain(`/api/tracking/open/${sendLogId}.gif`);
  });

  it("creates a Gmail draft and a local outreach draft", async () => {
    setEnv();
    const prisma = createPrismaMock();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-token" }))
      .mockResolvedValueOnce(
        jsonResponse({ id: "gmail-draft-1", message: { id: "gmail-message-1" } })
      );
    const service = new GmailMessageService(prisma as any, { fetchImpl });

    const result = await service.createDraft("user-1", {
      leadId: "11111111-1111-4111-8111-111111111111",
      to: "prospect@example.com",
      replyTo: "reply@example.com",
      subject: "Telecom equipment availability",
      body: "Hello"
    });

    expect(result.providerDraftId).toBe("gmail-draft-1");
    expect(result.draft?.status).toBe("gmail_draft");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer access-token" })
      })
    );
    expect(prisma.outreachDraft.create).toHaveBeenCalledWith({
      data: {
        leadId: "11111111-1111-4111-8111-111111111111",
        subject: "Telecom equipment availability",
        body: "Hello",
        status: "gmail_draft"
      }
    });
  });

  it("sends only after explicit confirmation and records a send log", async () => {
    setEnv();
    const prisma = createPrismaMock();
    prisma.followupTask.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "followup-1",
      leadId: "11111111-1111-4111-8111-111111111111",
      type: "email_followup",
      status: "pending",
      dueAt: followupDueAt,
      note: "Gmail 触达后 3 天检查是否需要二次跟进"
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-token" }))
      .mockResolvedValueOnce(jsonResponse({ id: "gmail-message-1", threadId: "thread-1" }));
    const mxLookup = vi.fn().mockResolvedValue([{ exchange: "mx.example.com", priority: 10 }]);
    const service = new GmailMessageService(prisma as any, { fetchImpl, mxLookup });

    const result = await service.sendEmail("user-1", {
      leadId: "11111111-1111-4111-8111-111111111111",
      to: "prospect@example.com",
      subject: "Telecom equipment availability",
      body: "Hello",
      confirm: true
    });

    expect(result.providerMessageId).toBe("gmail-message-1");
    expect(mxLookup).toHaveBeenCalledWith("example.com");
    expect(result.threadId).toBe("thread-1");
    expect(result.sendLog?.status).toBe("sent");
    expect(result.inboxThread?.threadId).toBe("thread-1");
    expect(result.crmLead?.stage).toBe("contacted");
    expect(result.followupTask?.type).toBe("email_followup");
    expect(prisma.sendLog.create).toHaveBeenCalledWith({
      data: {
        draftId: "draft-1",
        recipientEmail: "prospect@example.com",
        replyTo: "sender@gmail.com",
        status: "pending"
      }
    });
    expect(prisma.outreachDraft.update).toHaveBeenCalledWith({
      where: { id: "draft-1" },
      data: { status: "sent" }
    });
    expect(prisma.sendLog.update).toHaveBeenCalledWith({
      where: { id: sendLogId },
      data: {
        status: "sent",
        providerMessageId: "gmail-message-1",
        lastError: null,
        sentAt: expect.any(Date)
      }
    });
    const gmailSendInit = fetchImpl.mock.calls[1]?.[1];
    expect(gmailSendInit).toBeDefined();
    const sendRequestBody = JSON.parse(gmailSendInit?.body ?? "{}") as { raw: string };
    const decodedMime = Buffer.from(sendRequestBody.raw, "base64url").toString("utf8");
    expect(decodedMime).toContain(`/api/tracking/open/${sendLogId}.gif`);
    expect(prisma.followupTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: "11111111-1111-4111-8111-111111111111",
        type: "email_followup",
        status: "pending"
      })
    });
    expect(prisma.agentStep.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "22222222-2222-4222-8222-222222222222", nodeName: "send_gmail" },
        data: expect.objectContaining({ status: "completed" })
      })
    );
    expect(prisma.agentStep.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "22222222-2222-4222-8222-222222222222", nodeName: "sync_crm" },
        data: expect.objectContaining({ status: "completed" })
      })
    );
    expect(prisma.agentStep.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "22222222-2222-4222-8222-222222222222", nodeName: "schedule_followup" },
        data: expect.objectContaining({ status: "completed" })
      })
    );
    expect(prisma.leadTask.update).toHaveBeenCalledWith({
      where: { id: "22222222-2222-4222-8222-222222222222" },
      data: { status: "email_sent" }
    });
    expect(prisma.inboxThread.upsert).toHaveBeenCalledWith({
      where: {
        provider_threadId: {
          provider: "gmail",
          threadId: "thread-1"
        }
      },
      create: {
        draftId: "draft-1",
        provider: "gmail",
        threadId: "thread-1",
        status: "open"
      },
      update: {
        draftId: "draft-1",
        status: "open"
      }
    });
  });

  it("sends every recipient in a valid Gmail batch", async () => {
    setEnv();
    process.env.GMAIL_MIN_SEND_INTERVAL_MS = "60000";
    const prisma = createPrismaMock();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-token-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "gmail-message-1", threadId: "thread-1" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-token-2" }))
      .mockResolvedValueOnce(jsonResponse({ id: "gmail-message-2", threadId: "thread-2" }));
    const mxLookup = vi.fn().mockResolvedValue([{ exchange: "mx.example.com", priority: 10 }]);
    const service = new GmailMessageService(prisma as any, { fetchImpl, mxLookup });

    const result = await service.sendEmailBatch("user-1", {
      recipients: [
        { leadId: "11111111-1111-4111-8111-111111111111", to: "sales@ultrastream.ae" },
        { leadId: "11111111-1111-4111-8111-111111111111", to: "sales@example.com" }
      ],
      subject: "Telecom equipment availability",
      body: "Hello",
      confirm: true
    });

    expect(result).toMatchObject({
      ok: true,
      successCount: 2,
      totalCount: 2,
      failureCount: 0
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(mxLookup).toHaveBeenCalledTimes(2);
    expect(prisma.sendLog.create).toHaveBeenCalledTimes(2);
  });

  it("validates every batch recipient before sending Gmail messages", async () => {
    setEnv();
    const prisma = createPrismaMock();
    const fetchImpl = vi.fn();
    const mxLookup = vi.fn().mockImplementation((domain: string) => {
      if (domain === "ultrastream.ae") {
        return Promise.resolve([
          { exchange: "ultrastream-ae.mail.protection.outlook.com", priority: 1 }
        ]);
      }

      return Promise.reject(Object.assign(new Error("queryMx ENOTFOUND"), { code: "ENOTFOUND" }));
    });
    const service = new GmailMessageService(prisma as any, { fetchImpl, mxLookup });

    await expect(
      service.sendEmailBatch("user-1", {
        recipients: [
          { leadId: "11111111-1111-4111-8111-111111111111", to: "sales@ultrastream.ae" },
          { leadId: "11111111-1111-4111-8111-111111111111", to: "sales@spectrum-gcc.com" }
        ],
        subject: "Telecom equipment availability",
        body: "Hello",
        confirm: true
      })
    ).rejects.toThrow(/已取消本次批量发送.*spectrum-gcc\.com/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prisma.outreachDraft.create).not.toHaveBeenCalled();
    expect(prisma.sendLog.create).not.toHaveBeenCalled();
  });

  it("blocks a Gmail batch when daily capacity cannot cover every recipient", async () => {
    setEnv();
    process.env.GMAIL_DAILY_SEND_LIMIT = "1";
    const prisma = createPrismaMock();
    const fetchImpl = vi.fn();
    const mxLookup = vi.fn().mockResolvedValue([{ exchange: "mx.example.com", priority: 10 }]);
    const service = new GmailMessageService(prisma as any, { fetchImpl, mxLookup });

    await expect(
      service.sendEmailBatch("user-1", {
        recipients: [
          { leadId: "11111111-1111-4111-8111-111111111111", to: "sales@ultrastream.ae" },
          { leadId: "11111111-1111-4111-8111-111111111111", to: "sales@example.com" }
        ],
        subject: "Telecom equipment availability",
        body: "Hello",
        confirm: true
      })
    ).rejects.toThrow("daily send limit would be exceeded");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prisma.outreachDraft.create).not.toHaveBeenCalled();
    expect(prisma.sendLog.create).not.toHaveBeenCalled();
  });

  it("schedules a confirmed Gmail message without sending immediately", async () => {
    setEnv();
    const prisma = createPrismaMock();
    const fetchImpl = vi.fn();
    const mxLookup = vi.fn().mockResolvedValue([{ exchange: "mx.example.com", priority: 10 }]);
    const service = new GmailMessageService(prisma as any, { fetchImpl, mxLookup });
    const scheduledAt = new Date(Date.now() + 30 * 60 * 1000);

    const result = await service.scheduleEmail("user-1", {
      leadId: "11111111-1111-4111-8111-111111111111",
      to: "prospect@example.com",
      subject: "Telecom equipment availability",
      body: "Hello",
      confirm: true,
      scheduledAt
    });

    expect(result).toMatchObject({
      ok: true,
      scheduled: true,
      scheduledAt,
      providerMessageId: null
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prisma.outreachDraft.create).toHaveBeenCalledWith({
      data: {
        leadId: "11111111-1111-4111-8111-111111111111",
        subject: "Telecom equipment availability",
        body: "Hello",
        status: "scheduled"
      }
    });
    expect(prisma.sendLog.create).toHaveBeenCalledWith({
      data: {
        draftId: "draft-1",
        recipientEmail: "prospect@example.com",
        replyTo: "sender@gmail.com",
        scheduledAt,
        status: "scheduled"
      }
    });
    expect(prisma.agentStep.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: "22222222-2222-4222-8222-222222222222", nodeName: "send_gmail" },
        data: expect.objectContaining({ status: "pending" })
      })
    );
  });

  it("blocks Gmail sending when the recipient domain has no MX record", async () => {
    setEnv();
    const prisma = createPrismaMock();
    const fetchImpl = vi.fn();
    const mxLookup = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("queryMx ENOTFOUND"), { code: "ENOTFOUND" }));
    const service = new GmailMessageService(prisma as any, { fetchImpl, mxLookup });

    await expect(
      service.sendEmail("user-1", {
        to: "procurement@gulftelecom.ae",
        subject: "Telecom equipment availability",
        body: "Hello",
        confirm: true
      })
    ).rejects.toThrow("Recipient domain gulftelecom.ae has no valid MX record");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prisma.sendLog.create).not.toHaveBeenCalled();
  });

  it("blocks Gmail sending after the daily limit is reached", async () => {
    setEnv();
    process.env.GMAIL_DAILY_SEND_LIMIT = "2";
    const prisma = createPrismaMock();
    prisma.sendLog.count.mockResolvedValue(2);
    const fetchImpl = vi.fn();
    const service = new GmailMessageService(prisma as any, { fetchImpl });

    await expect(
      service.sendEmail("user-1", {
        leadId: "11111111-1111-4111-8111-111111111111",
        to: "prospect@example.com",
        subject: "Telecom equipment availability",
        body: "Hello",
        confirm: true
      })
    ).rejects.toThrow("Gmail daily send limit reached");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prisma.sendLog.create).not.toHaveBeenCalled();
  });

  it("blocks Gmail sending inside the minimum send interval", async () => {
    setEnv();
    process.env.GMAIL_MIN_SEND_INTERVAL_MS = "60000";
    const prisma = createPrismaMock();
    prisma.sendLog.findFirst.mockResolvedValue({ sentAt: new Date() });
    const fetchImpl = vi.fn();
    const service = new GmailMessageService(prisma as any, { fetchImpl });

    await expect(
      service.sendEmail("user-1", {
        leadId: "11111111-1111-4111-8111-111111111111",
        to: "prospect@example.com",
        subject: "Telecom equipment availability",
        body: "Hello",
        confirm: true
      })
    ).rejects.toThrow("Gmail send is rate limited");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prisma.sendLog.create).not.toHaveBeenCalled();
  });

  it("syncs Gmail replies, classifies quote requests, updates CRM, and writes analytics", async () => {
    setEnv();
    const prisma = createPrismaMock();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-token" }))
      .mockResolvedValueOnce(
        jsonResponse(gmailThreadPayload("Please send quotation for RRU and BBU spare parts."))
      );
    const aiService = {
      classifyReply: vi.fn().mockResolvedValue({
        category: "request_quote",
        sentiment: "positive",
        confidence: 0.91,
        summary: "Prospect asked for pricing.",
        nextAction: "Prepare quotation"
      })
    };
    const service = new GmailMessageService(prisma as any, { fetchImpl, aiService });

    const result = await service.syncReplies("user-1");

    expect(result).toMatchObject({
      threads: 1,
      scannedMessages: 2,
      newReplies: 1,
      classifiedReplies: 1,
      followupsCreated: 1,
      stageEventsWritten: 1,
      analyticsWritten: 1
    });
    expect(prisma.inboundMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        threadId: "thread-local-1",
        fromEmail: "prospect@example.com",
        subject: "Re: Telecom equipment availability",
        bodyPreview: "Please send quotation for RRU and BBU spare parts."
      })
    });
    expect(prisma.replyClassification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        messageId: "inbound-1",
        intent: "request_quote",
        confidence: 91,
        summary: "Prospect asked for pricing."
      })
    });
    expect(prisma.followupTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: "11111111-1111-4111-8111-111111111111",
        type: "prepare_quote",
        status: "pending"
      })
    });
    expect(prisma.campaignAnalytic.upsert).toHaveBeenCalledWith({
      where: {
        taskId_dimension_dimensionValue: {
          taskId: "22222222-2222-4222-8222-222222222222",
          dimension: "reply_intent",
          dimensionValue: "request_quote"
        }
      },
      create: expect.objectContaining({
        replyCount: 1,
        qualifiedCount: 1
      }),
      update: {
        replyCount: { increment: 1 },
        qualifiedCount: { increment: 1 }
      }
    });
    expect(prisma.inboxThread.update).toHaveBeenCalledWith({
      where: { id: "thread-local-1" },
      data: { lastSyncedAt: new Date("2026-04-30T01:00:00.000Z") }
    });
  });

  it.each([
    ["interested", "reply_interested", "We are interested in your telecom equipment.", 1, 0],
    ["request_catalog", "send_catalog", "Please send your product catalogue.", 1, 0],
    ["auto_reply", "auto_reply_check", "Automatic reply: I am out of office.", 1, 0],
    ["rejection", undefined, "Not interested, thank you.", 0, 1],
    ["unsubscribe", undefined, "Please unsubscribe me from your list.", 0, 1]
  ] as const)(
    "routes %s replies to the right follow-up policy",
    async (category, followupType, body, expectedFollowups, expectedCanceled) => {
      setEnv();
      const prisma = createPrismaMock();
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ access_token: "access-token" }))
        .mockResolvedValueOnce(jsonResponse(gmailThreadPayload(body)));
      const aiService = {
        classifyReply: vi.fn().mockResolvedValue({
          category,
          sentiment:
            category === "rejection" || category === "unsubscribe" ? "negative" : "positive",
          confidence: 0.82,
          summary: `Classified as ${category}`,
          nextAction: "Route reply"
        })
      };
      const service = new GmailMessageService(prisma as any, { fetchImpl, aiService });

      const result = await service.syncReplies("user-1");

      expect(result.followupsCreated).toBe(expectedFollowups);
      if (followupType) {
        expect(prisma.followupTask.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ type: followupType })
        });
      }
      expect(prisma.followupTask.updateMany).toHaveBeenCalledTimes(expectedCanceled);
      expect(prisma.replyClassification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ intent: category })
      });
    }
  );

  it("can aggregate scheduled sync results for all authorized users", async () => {
    setEnv();
    const prisma = createPrismaMock();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-token" }))
      .mockResolvedValueOnce(jsonResponse(gmailThreadPayload("We are interested in RRU modules.")));
    const service = new GmailMessageService(prisma as any, { fetchImpl, aiService: null });

    const result = await service.syncAllUsers();

    expect(result).toMatchObject({
      users: 1,
      threads: 1,
      newReplies: 1,
      classifiedReplies: 1,
      failedUsers: 0
    });
    expect(prisma.gmailAccount.findMany).toHaveBeenCalledWith({
      where: { revokedAt: null },
      distinct: ["userId"],
      select: { userId: true }
    });
  });

  it("blocks sending without user confirmation", async () => {
    setEnv();
    const service = new GmailMessageService(createPrismaMock() as any, { fetchImpl: vi.fn() });

    await expect(
      service.sendEmail("user-1", {
        to: "prospect@example.com",
        subject: "Telecom equipment availability",
        body: "Hello",
        confirm: false
      })
    ).rejects.toThrow(BadRequestException);
  });

  it("blocks Gmail actions when the user has no active Gmail account", async () => {
    setEnv();
    const prisma = createPrismaMock();
    prisma.gmailAccount.findFirst.mockResolvedValue(null);
    const service = new GmailMessageService(prisma as any, { fetchImpl: vi.fn() });

    await expect(
      service.createDraft("user-1", {
        to: "prospect@example.com",
        subject: "Telecom equipment availability",
        body: "Hello"
      })
    ).rejects.toThrow(BadRequestException);
  });

  it("does not write a draft for leads owned by another user", async () => {
    setEnv();
    const prisma = createPrismaMock();
    prisma.leadCandidate.findFirst.mockResolvedValue(null);
    const service = new GmailMessageService(prisma as any, { fetchImpl: vi.fn() });

    await expect(
      service.createDraft("user-1", {
        leadId: "11111111-1111-4111-8111-111111111111",
        to: "prospect@example.com",
        subject: "Telecom equipment availability",
        body: "Hello"
      })
    ).rejects.toThrow(NotFoundException);
    expect(prisma.outreachDraft.create).not.toHaveBeenCalled();
  });
});
