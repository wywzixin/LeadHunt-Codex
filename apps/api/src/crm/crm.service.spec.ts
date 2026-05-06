import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CrmService } from "./crm.service.js";

const now = new Date("2026-04-30T01:00:00.000Z");

function crmRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "crm-1",
    leadId: "11111111-1111-4111-8111-111111111111",
    stage: "contacted",
    tags: ["重点客户", "通信设备"],
    createdAt: now,
    updatedAt: now,
    lead: {
      id: "11111111-1111-4111-8111-111111111111",
      taskId: "task-1",
      companyName: "Gulf Telecom",
      website: "https://gulftelecom.example",
      country: "UAE",
      sourceUrl: "https://source.example",
      status: "contacted",
      createdAt: now,
      updatedAt: now,
      contacts: [
        {
          id: "contact-1",
          leadId: "11111111-1111-4111-8111-111111111111",
          type: "email",
          value: "sales@gulftelecom.example",
          sourceUrl: "https://source.example",
          createdAt: now
        }
      ],
      icpScore: {
        id: "score-1",
        leadId: "11111111-1111-4111-8111-111111111111",
        score: 87,
        grade: "A",
        reasons: ["Distributor"],
        createdAt: now
      },
      followupTasks: [
        {
          id: "follow-1",
          leadId: "11111111-1111-4111-8111-111111111111",
          type: "email_followup",
          status: "pending",
          dueAt: new Date("2026-05-03T01:00:00.000Z"),
          note: "Follow up",
          createdAt: now
        }
      ],
      stageEvents: [],
      outreachDrafts: [
        {
          id: "draft-1",
          leadId: "11111111-1111-4111-8111-111111111111",
          channel: "email",
          subject: "Hello",
          body: "Body",
          status: "sent",
          createdAt: now,
          updatedAt: now,
          sendLogs: [
            {
              id: "send-1",
              draftId: "draft-1",
              channel: "email",
              status: "sent",
              providerMessageId: "gmail-message-1",
              sentAt: now,
              createdAt: now
            }
          ]
        }
      ],
      task: {
        id: "task-1",
        user: {
          email: "owner@example.com",
          name: "王亚伟"
        }
      }
    },
    ...overrides
  };
}

function createPrismaMock() {
  return {
    crmLead: {
      findMany: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(crmRecord()),
      create: vi.fn().mockResolvedValue({
        id: "crm-1",
        leadId: "11111111-1111-4111-8111-111111111111",
        stage: "potential",
        tags: ["手动创建"],
        createdAt: now,
        updatedAt: now
      }),
      update: vi.fn().mockResolvedValue({
        id: "crm-1",
        leadId: "11111111-1111-4111-8111-111111111111",
        stage: "interested",
        tags: ["感兴趣"],
        createdAt: now,
        updatedAt: now
      }),
      upsert: vi.fn().mockResolvedValue({
        id: "crm-1",
        leadId: "11111111-1111-4111-8111-111111111111",
        stage: "contacted",
        tags: ["已触达", "Gmail"],
        createdAt: now,
        updatedAt: now
      })
    },
    leadTask: {
      create: vi.fn().mockResolvedValue({
        id: "task-1",
        userId: "user-1"
      })
    },
    searchQuery: {
      findMany: vi.fn().mockResolvedValue([])
    },
    sendLog: {
      findMany: vi.fn().mockResolvedValue([])
    },
    inboundMessage: {
      findMany: vi.fn().mockResolvedValue([])
    },
    engagementEvent: {
      findMany: vi.fn().mockResolvedValue([])
    },
    leadCandidate: {
      findFirst: vi.fn().mockResolvedValue({
        id: "11111111-1111-4111-8111-111111111111",
        crmLead: null
      }),
      create: vi.fn().mockResolvedValue({
        id: "11111111-1111-4111-8111-111111111111",
        taskId: "task-1",
        companyName: "Manual Telecom LLC",
        status: "potential"
      }),
      update: vi.fn().mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" })
    },
    leadContact: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    leadStageEvent: {
      create: vi.fn().mockResolvedValue({ id: "event-1" })
    },
    followupTask: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "follow-1" })
    }
  };
}

describe("CrmService", () => {
  it("lists companies with stats and stage labels", async () => {
    const prisma = createPrismaMock();
    prisma.crmLead.findMany.mockResolvedValue([crmRecord()]);
    const service = new CrmService(prisma as any);

    const result = await service.listCustomers("user-1", { view: "companies", group: "all" });

    expect(result.stats.companies).toBe(1);
    expect(result.stats.contacts).toBe(1);
    expect(result.companies[0]?.companyName).toBe("Gulf Telecom");
    expect(result.companies[0]?.stageLabel).toBe("已触达");
    expect(result.companies[0]?.owner).toBe("王亚伟");
  });

  it("flattens the contacts view and supports the 7-day contacted group", async () => {
    const prisma = createPrismaMock();
    prisma.crmLead.findMany.mockResolvedValue([crmRecord()]);
    const service = new CrmService(prisma as any);

    const result = await service.listCustomers("user-1", { view: "contacts", group: "contacted_7_days" });

    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.value).toBe("sales@gulftelecom.example");
    expect(result.groups.contacted7).toBe(1);
  });

  it("syncs a lead to CRM, writes a stage event, and creates a 3-day follow-up", async () => {
    const prisma = createPrismaMock();
    const service = new CrmService(prisma as any);

    const result = await service.syncLead("user-1", {
      leadId: "11111111-1111-4111-8111-111111111111",
      stage: "contacted",
      tags: ["已触达"],
      reason: "Gmail message sent",
      createFollowup: true,
      now
    });

    expect(result.ok).toBe(true);
    expect(prisma.crmLead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leadId: "11111111-1111-4111-8111-111111111111" }
      })
    );
    expect(prisma.leadStageEvent.create).toHaveBeenCalledWith({
      data: {
        leadId: "11111111-1111-4111-8111-111111111111",
        fromStage: null,
        toStage: "contacted",
        reason: "Gmail message sent"
      }
    });
    expect(prisma.followupTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: "11111111-1111-4111-8111-111111111111",
        type: "email_followup",
        status: "pending",
        dueAt: new Date("2026-05-03T01:00:00.000Z")
      })
    });
  });

  it("builds dashboard analytics from CRM, search, send, and reply data", async () => {
    const prisma = createPrismaMock();
    prisma.searchQuery.findMany.mockResolvedValue([
      {
        id: "query-1",
        query: "通信 5G distributor",
        operatorSource: "global_database",
        operatorName: null,
        keywordGroups: [{ keyword: "通信5G" }],
        createdAt: now
      },
      {
        id: "query-2",
        query: "telecom stockist",
        operatorSource: "maps",
        operatorName: null,
        keywordGroups: null,
        createdAt: now
      }
    ]);
    prisma.sendLog.findMany.mockResolvedValue([
      {
        id: "send-1",
        status: "sent",
        channel: "email",
        sentAt: now,
        createdAt: now
      }
    ]);
    prisma.inboundMessage.findMany.mockResolvedValue([
      {
        id: "reply-1",
        receivedAt: now
      }
    ]);
    prisma.engagementEvent.findMany.mockResolvedValue([
      {
        id: "open-1",
        sendLogId: "send-1",
        occurredAt: now
      }
    ]);
    prisma.crmLead.findMany.mockResolvedValue([
      {
        id: "crm-1",
        tags: ["favorite", "通信设备"],
        updatedAt: now,
        lead: {
          contacts: [{ id: "contact-1", type: "email" }]
        }
      }
    ]);
    const service = new CrmService(prisma as any);

    const result = await service.getAnalytics("user-1", "all");

    expect(result.overview.emailTasks).toBe(1);
    expect(result.overview.favoriteCompanies).toBe(1);
    expect(result.reach.email.rate).toBe(100);
    expect(result.reach.email.opened).toBe(1);
    expect(result.reach.email.openRate).toBe(100);
    expect(result.reach.email.openTrendNote).toContain("trend signals");
    expect(result.searchPreference[0]).toEqual({ rank: 1, keyword: "通信5G", count: 1 });
    expect(result.searchTimes).toEqual([
      { key: "global_database", label: "全球企业库", count: 1 },
      { key: "maps", label: "地图获客", count: 1 },
      { key: "customs", label: "海关数据", count: 0 }
    ]);
    expect(result.series).toHaveLength(7);
    expect(result.series.some((point) => point.open === 1)).toBe(true);
  });

  it("returns a CRM lead detail scoped to the current user", async () => {
    const prisma = createPrismaMock();
    const service = new CrmService(prisma as any);

    const result = await service.getLead("user-1", "crm-1");

    expect(result.ok).toBe(true);
    expect(result.company.id).toBe("crm-1");
    expect(result.company.companyName).toBe("Gulf Telecom");
    expect(prisma.crmLead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "crm-1",
          lead: {
            task: { userId: "user-1" }
          }
        }
      })
    );
  });

  it("creates a manual CRM lead with contacts and a stage event", async () => {
    const prisma = createPrismaMock();
    const service = new CrmService(prisma as any);

    const result = await service.createLead("user-1", {
      companyName: "Manual Telecom LLC",
      website: "https://manual.example",
      country: "UAE",
      stage: "potential",
      tags: ["manual", "manual"],
      contacts: [
        { type: "email", value: "sales@manual.example" },
        { type: "email", value: "sales@manual.example" },
        { type: "phone", value: "+971500000000" }
      ]
    });

    expect(result.ok).toBe(true);
    expect(prisma.leadTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        mode: "manual_crm",
        status: "completed",
        targetCount: 1
      })
    });
    expect(prisma.leadCandidate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: "task-1",
        companyName: "Manual Telecom LLC",
        website: "https://manual.example",
        country: "UAE",
        status: "potential",
        contacts: {
          create: [
            { type: "email", value: "sales@manual.example", sourceUrl: null },
            { type: "phone", value: "+971500000000", sourceUrl: null }
          ]
        }
      })
    });
    expect(prisma.crmLead.create).toHaveBeenCalledWith({
      data: {
        leadId: "11111111-1111-4111-8111-111111111111",
        stage: "potential",
        tags: ["manual"]
      }
    });
    expect(prisma.leadStageEvent.create).toHaveBeenCalledWith({
      data: {
        leadId: "11111111-1111-4111-8111-111111111111",
        fromStage: null,
        toStage: "potential",
        reason: "Manual CRM lead created"
      }
    });
  });

  it("updates a CRM lead, replaces contacts, and writes a stage event", async () => {
    const prisma = createPrismaMock();
    const service = new CrmService(prisma as any);

    await service.updateLead("user-1", "crm-1", {
      companyName: "Updated Telecom LLC",
      website: null,
      stage: "interested",
      tags: ["hot", "vip", "hot"],
      contacts: [{ type: "email", value: "hello@updated.example" }]
    });

    expect(prisma.leadCandidate.update).toHaveBeenCalledWith({
      where: { id: "11111111-1111-4111-8111-111111111111" },
      data: {
        companyName: "Updated Telecom LLC",
        website: null,
        status: "interested"
      }
    });
    expect(prisma.leadContact.deleteMany).toHaveBeenCalledWith({
      where: { leadId: "11111111-1111-4111-8111-111111111111" }
    });
    expect(prisma.leadContact.createMany).toHaveBeenCalledWith({
      data: [
        {
          leadId: "11111111-1111-4111-8111-111111111111",
          type: "email",
          value: "hello@updated.example",
          sourceUrl: null
        }
      ]
    });
    expect(prisma.crmLead.update).toHaveBeenCalledWith({
      where: { id: "crm-1" },
      data: {
        stage: "interested",
        tags: ["hot", "vip"]
      }
    });
    expect(prisma.leadStageEvent.create).toHaveBeenCalledWith({
      data: {
        leadId: "11111111-1111-4111-8111-111111111111",
        fromStage: "contacted",
        toStage: "interested",
        reason: "Manual CRM lead updated"
      }
    });
  });

  it("rejects CRM detail and updates for another user's lead", async () => {
    const prisma = createPrismaMock();
    prisma.crmLead.findFirst.mockResolvedValueOnce(null);
    const service = new CrmService(prisma as any);

    await expect(service.getLead("user-1", "crm-1")).rejects.toThrow(NotFoundException);

    prisma.crmLead.findFirst.mockResolvedValueOnce(null);
    await expect(service.updateLead("user-1", "crm-1", { stage: "interested" })).rejects.toThrow(NotFoundException);
  });

  it("does not duplicate an existing pending follow-up", async () => {
    const prisma = createPrismaMock();
    prisma.followupTask.findFirst.mockResolvedValue({ id: "existing-followup" });
    const service = new CrmService(prisma as any);

    await service.syncLead("user-1", {
      leadId: "11111111-1111-4111-8111-111111111111",
      createFollowup: true
    });

    expect(prisma.followupTask.create).not.toHaveBeenCalled();
  });

  it("rejects CRM sync for another user's lead", async () => {
    const prisma = createPrismaMock();
    prisma.leadCandidate.findFirst.mockResolvedValue(null);
    const service = new CrmService(prisma as any);

    await expect(
      service.syncLead("user-1", {
        leadId: "11111111-1111-4111-8111-111111111111"
      })
    ).rejects.toThrow(NotFoundException);
  });
});
