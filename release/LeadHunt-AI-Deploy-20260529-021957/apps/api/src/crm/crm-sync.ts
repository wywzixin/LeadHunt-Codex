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

const approvedCrmStatuses = ["approved", "contacted", "email_sent"] as const;

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

export async function ensureApprovedCandidatesInCrm(
  prisma: PrismaService,
  userId: string,
  options: { taskId?: string } = {}
) {
  const candidates = await prisma.leadCandidate.findMany({
    where: {
      ...(options.taskId ? { taskId: options.taskId } : {}),
      task: { userId },
      crmLead: null,
      status: { in: [...approvedCrmStatuses] }
    },
    select: {
      id: true,
      status: true
    }
  });

  const syncableCandidates = candidates.filter((candidate) =>
    Boolean(candidate.id) && approvedCrmStatuses.includes(candidate.status as (typeof approvedCrmStatuses)[number])
  );

  await Promise.all(
    syncableCandidates.map((candidate) => upsertApprovedCandidateInCrm(prisma, candidate.id, candidate.status))
  );

  return {
    syncedCount: syncableCandidates.length
  };
}

export async function upsertApprovedCandidateInCrm(prisma: PrismaService, leadId: string, status: string | null) {
  const stage = crmStageFromCandidateStatus(status);
  const tags = uniqueTags(["AI 外贸员", "已加入CRM", stage === "contacted" ? "已触达" : "已确认"]);

  return prisma.crmLead.upsert({
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

function crmStageFromCandidateStatus(status: string | null) {
  return status === "contacted" || status === "email_sent" ? "contacted" : "qualified";
}
