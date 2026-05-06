import { NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";

export type SyncLeadToCrmInput = {
  stage?: string;
  tags?: string[];
  reason?: string;
  createFollowup?: boolean;
  now?: Date;
};

export async function syncLeadToCrm(prisma: PrismaService, userId: string, leadId: string, input: SyncLeadToCrmInput = {}) {
  const lead = await prisma.leadCandidate.findFirst({
    where: {
      id: leadId,
      task: { userId }
    },
    include: {
      crmLead: true
    }
  });

  if (!lead) {
    throw new NotFoundException("Lead candidate not found");
  }

  const now = input.now ?? new Date();
  const stage = input.stage ?? "contacted";
  const previousStage = lead.crmLead?.stage ?? null;
  const tags = uniqueTags([
    ...normalizeTags(lead.crmLead?.tags),
    ...(input.tags ?? ["已触达", "Gmail", "AI 外贸员"])
  ]);

  const crmLead = await prisma.crmLead.upsert({
    where: { leadId },
    create: {
      leadId,
      stage,
      tags
    },
    update: {
      stage,
      tags
    }
  });

  await prisma.leadCandidate.update({
    where: { id: leadId },
    data: { status: stage }
  });

  if (previousStage !== stage) {
    await prisma.leadStageEvent.create({
      data: {
        leadId,
        fromStage: previousStage,
        toStage: stage,
        reason: input.reason ?? "Synced to CRM"
      }
    });
  }

  if (input.createFollowup ?? stage === "contacted") {
    const existingFollowup = await prisma.followupTask.findFirst({
      where: {
        leadId,
        type: "email_followup",
        status: "pending"
      }
    });

    if (!existingFollowup) {
      await prisma.followupTask.create({
        data: {
          leadId,
          type: "email_followup",
          status: "pending",
          dueAt: addDays(now, 3),
          note: "Gmail 触达后 3 天检查是否需要二次跟进"
        }
      });
    }
  }

  return crmLead;
}

export function normalizeTags(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function uniqueTags(tags: string[]) {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
