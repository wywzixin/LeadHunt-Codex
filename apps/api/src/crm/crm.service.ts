import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { normalizeTags, syncLeadToCrm, type SyncLeadToCrmInput } from "./crm-sync.js";

const crmLeadInclude = {
  lead: {
    include: {
      contacts: true,
      icpScore: true,
      followupTasks: {
        orderBy: { dueAt: "asc" },
        take: 3
      },
      stageEvents: {
        orderBy: { createdAt: "desc" },
        take: 3
      },
      outreachDrafts: {
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          sendLogs: {
            orderBy: { createdAt: "desc" },
            take: 3
          }
        }
      },
      task: {
        select: {
          id: true,
          user: {
            select: {
              email: true,
              name: true
            }
          }
        }
      }
    }
  }
} satisfies Prisma.CrmLeadInclude;

type CrmRecord = Prisma.CrmLeadGetPayload<{ include: typeof crmLeadInclude }>;
type CrmView = "companies" | "contacts" | "favorites";
type CrmGroup = "all" | "potential" | "contacted_7_days" | "uncontacted";
type AnalyticsRange = "all" | "month" | "week" | "day";

export type CrmContactInput = {
  type: string;
  value: string;
  sourceUrl?: string | null;
};

export type CrmLeadInput = {
  companyName: string;
  website?: string | null;
  country?: string | null;
  sourceUrl?: string | null;
  stage?: string;
  tags?: string[];
  contacts?: CrmContactInput[];
};

export type CrmLeadUpdateInput = Partial<CrmLeadInput>;

@Injectable()
export class CrmService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listCustomers(userId: string, options: { view: CrmView; group: CrmGroup }) {
    const records = await this.prisma.crmLead.findMany({
      where: {
        lead: {
          task: { userId }
        }
      },
      include: crmLeadInclude,
      orderBy: { updatedAt: "desc" }
    });
    const companies = records.map((record) => toCompany(record));
    const filteredCompanies = filterByGroup(companies, options.group);
    const contacts = filteredCompanies.flatMap((company) =>
      company.contacts.map((contact) => ({
        id: contact.id,
        companyId: company.id,
        companyName: company.companyName,
        country: company.country,
        type: contact.type,
        value: contact.value,
        sourceUrl: contact.sourceUrl,
        stage: company.stage,
        stageLabel: company.stageLabel,
        owner: company.owner,
        recentFollowup: company.recentFollowup
      }))
    );
    const favorites = filteredCompanies.filter((company) =>
      company.tags.some((tag) => ["favorite", "收藏", "重点客户"].includes(tag))
    );

    return {
      view: options.view,
      group: options.group,
      stats: buildStats(companies),
      groups: buildGroups(companies),
      companies: options.view === "favorites" ? favorites : filteredCompanies,
      contacts: options.view === "contacts" ? contacts : []
    };
  }

  async syncLead(userId: string, input: SyncLeadToCrmInput & { leadId: string }) {
    const crmLead = await syncLeadToCrm(this.prisma, userId, input.leadId, input);

    return {
      ok: true,
      crmLead
    };
  }

  async getLead(userId: string, id: string) {
    const record = await this.prisma.crmLead.findFirst({
      where: {
        id,
        lead: {
          task: { userId }
        }
      },
      include: crmLeadInclude
    });

    if (!record) {
      throw new NotFoundException("CRM lead not found");
    }

    return {
      ok: true,
      company: toCompany(record)
    };
  }

  async createLead(userId: string, input: CrmLeadInput) {
    const task = await this.prisma.leadTask.create({
      data: {
        userId,
        mode: "manual_crm",
        status: "completed",
        targetCount: 1,
        inputPayload: {
          source: "manual_crm_create"
        }
      }
    });
    const lead = await this.prisma.leadCandidate.create({
      data: {
        taskId: task.id,
        companyName: input.companyName,
        website: input.website || null,
        country: input.country || null,
        sourceUrl: input.sourceUrl || null,
        status: input.stage ?? "new",
        contacts: {
          create: normalizeContactInputs(input.contacts)
        }
      }
    });
    const crmLead = await this.prisma.crmLead.create({
      data: {
        leadId: lead.id,
        stage: input.stage ?? "new",
        tags: uniqueTags(input.tags ?? ["手动创建"])
      }
    });

    await this.prisma.leadStageEvent.create({
      data: {
        leadId: lead.id,
        fromStage: null,
        toStage: input.stage ?? "new",
        reason: "Manual CRM lead created"
      }
    });

    return this.getLead(userId, crmLead.id);
  }

  async updateLead(userId: string, id: string, input: CrmLeadUpdateInput) {
    const existing = await this.prisma.crmLead.findFirst({
      where: {
        id,
        lead: {
          task: { userId }
        }
      },
      include: {
        lead: true
      }
    });

    if (!existing) {
      throw new NotFoundException("CRM lead not found");
    }

    const nextStage = input.stage ?? existing.stage;
    const leadUpdate: Prisma.LeadCandidateUpdateInput = {};
    if (input.companyName !== undefined) leadUpdate.companyName = input.companyName;
    if (input.website !== undefined) leadUpdate.website = input.website || null;
    if (input.country !== undefined) leadUpdate.country = input.country || null;
    if (input.sourceUrl !== undefined) leadUpdate.sourceUrl = input.sourceUrl || null;
    if (input.stage !== undefined) leadUpdate.status = nextStage;

    if (Object.keys(leadUpdate).length > 0) {
      await this.prisma.leadCandidate.update({
        where: { id: existing.leadId },
        data: leadUpdate
      });
    }

    if (input.contacts) {
      await this.prisma.leadContact.deleteMany({
        where: { leadId: existing.leadId }
      });
      if (input.contacts.length > 0) {
        await this.prisma.leadContact.createMany({
          data: normalizeContactInputs(input.contacts).map((contact) => ({
            ...contact,
            leadId: existing.leadId
          }))
        });
      }
    }

    await this.prisma.crmLead.update({
      where: { id },
      data: {
        stage: nextStage,
        ...(input.tags ? { tags: uniqueTags(input.tags) } : {})
      }
    });

    if (existing.stage !== nextStage) {
      await this.prisma.leadStageEvent.create({
        data: {
          leadId: existing.leadId,
          fromStage: existing.stage,
          toStage: nextStage,
          reason: "Manual CRM lead updated"
        }
      });
    }

    return this.getLead(userId, id);
  }

  async getAnalytics(userId: string, range: AnalyticsRange) {
    const now = new Date();
    const rangeStart = getRangeStart(range, now);
    const dateFilter = rangeStart ? { gte: rangeStart } : undefined;

    const [searchQueries, sendLogs, replies, openEvents, crmLeads] = await Promise.all([
      this.prisma.searchQuery.findMany({
        where: {
          task: { userId },
          ...(dateFilter ? { createdAt: dateFilter } : {})
        },
        select: {
          id: true,
          query: true,
          operatorSource: true,
          operatorName: true,
          keywordGroups: true,
          createdAt: true
        }
      }),
      this.prisma.sendLog.findMany({
        where: {
          draft: {
            lead: {
              task: { userId }
            }
          },
          ...(dateFilter ? { createdAt: dateFilter } : {})
        },
        select: {
          id: true,
          status: true,
          channel: true,
          sentAt: true,
          createdAt: true
        }
      }),
      this.prisma.inboundMessage.findMany({
        where: {
          thread: {
            draft: {
              lead: {
                task: { userId }
              }
            }
          },
          ...(dateFilter ? { receivedAt: dateFilter } : {})
        },
        select: {
          id: true,
          receivedAt: true
        }
      }),
      this.prisma.engagementEvent.findMany({
        where: {
          eventType: "open",
          sendLog: {
            draft: {
              lead: {
                task: { userId }
              }
            }
          },
          ...(dateFilter ? { occurredAt: dateFilter } : {})
        },
        select: {
          id: true,
          sendLogId: true,
          occurredAt: true
        }
      }),
      this.prisma.crmLead.findMany({
        where: {
          lead: {
            task: { userId }
          },
          ...(dateFilter ? { updatedAt: dateFilter } : {})
        },
        select: {
          id: true,
          tags: true,
          updatedAt: true,
          lead: {
            select: {
              contacts: {
                select: {
                  id: true,
                  type: true
                }
              }
            }
          }
        }
      })
    ]);

    const emailLogs = sendLogs.filter((log) => log.channel === "email");
    const sentEmailLogs = emailLogs.filter((log) => log.sentAt || ["sent", "delivered"].includes(log.status));
    const openedSendLogIds = new Set(openEvents.map((event) => event.sendLogId));
    const openedEmailCount = sentEmailLogs.filter((log) => openedSendLogIds.has(log.id)).length;
    const favoriteCompanies = crmLeads.filter((lead) => hasFavoriteTag(normalizeTags(lead.tags))).length;
    const favoritePeople = crmLeads.reduce(
      (total, lead) => total + lead.lead.contacts.filter((contact) => contact.type === "favorite_person").length,
      0
    );

    return {
      range,
      overview: {
        emailTasks: emailLogs.length,
        emailMessages: emailLogs.length,
        smsTasks: 0,
        smsMessages: 0,
        favoriteCompanies,
        favoritePeople
      },
      reach: {
        email: {
          delivered: sentEmailLogs.length,
          total: emailLogs.length,
          rate: percentage(sentEmailLogs.length, emailLogs.length),
          opened: openedEmailCount,
          openRate: percentage(openedEmailCount, sentEmailLogs.length),
          openTrendNote: "Tracking-pixel opens are trend signals only because email clients and image proxies can distort counts."
        },
        sms: {
          delivered: 0,
          total: 0,
          rate: 0
        }
      },
      searchPreference: buildSearchPreference(searchQueries),
      searchTimes: buildSearchTimes(searchQueries),
      series: buildSeries(now, {
        searches: searchQueries.map((query) => query.createdAt),
        outreach: sendLogs.map((log) => log.sentAt ?? log.createdAt),
        opens: openEvents.map((event) => event.occurredAt),
        replies: replies.map((reply) => reply.receivedAt),
        favorites: crmLeads.filter((lead) => hasFavoriteTag(normalizeTags(lead.tags))).map((lead) => lead.updatedAt)
      })
    };
  }
}

function toCompany(record: CrmRecord) {
  const contacts = record.lead.contacts.map((contact) => ({
    id: contact.id,
    type: contact.type,
    value: contact.value,
    sourceUrl: contact.sourceUrl
  }));
  const sentAt = findLastSentAt(record);
  const nextFollowup = record.lead.followupTasks.find((task) => task.status === "pending");
  const tags = normalizeTags(record.tags);

  return {
    id: record.id,
    leadId: record.leadId,
    companyName: record.lead.companyName,
    website: record.lead.website,
    country: record.lead.country ?? "未知地区",
    industry: inferIndustry(tags),
    stage: record.stage,
    stageLabel: stageLabel(record.stage),
    owner: record.lead.task.user.name ?? record.lead.task.user.email,
    recentFollowup: nextFollowup ? formatDate(nextFollowup.dueAt) : sentAt ? formatDate(sentAt) : "暂无跟进",
    lastContactedAt: sentAt?.toISOString() ?? null,
    tags,
    icpScore: record.lead.icpScore
      ? {
          score: record.lead.icpScore.score,
          grade: record.lead.icpScore.grade,
          reasons: record.lead.icpScore.reasons
        }
      : null,
    contacts,
    sourceUrl: record.lead.sourceUrl,
    updatedAt: record.updatedAt
  };
}

function findLastSentAt(record: CrmRecord) {
  const sentDates = record.lead.outreachDrafts
    .flatMap((draft) => draft.sendLogs)
    .map((log) => log.sentAt)
    .filter((value): value is Date => Boolean(value));

  return sentDates.sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
}

function filterByGroup(companies: ReturnType<typeof toCompany>[], group: CrmGroup) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  if (group === "contacted_7_days") {
    return companies.filter((company) => company.lastContactedAt && new Date(company.lastContactedAt).getTime() >= sevenDaysAgo);
  }

  if (group === "uncontacted") {
    return companies.filter((company) => !company.lastContactedAt);
  }

  if (group === "potential") {
    return companies.filter((company) => ["new", "potential", "qualified"].includes(company.stage));
  }

  return companies;
}

function buildStats(companies: ReturnType<typeof toCompany>[]) {
  const contacts = companies.reduce((total, company) => total + company.contacts.length, 0);
  const favorites = companies.filter((company) => company.tags.some((tag) => ["favorite", "收藏", "重点客户"].includes(tag))).length;
  const contacted7 = filterByGroup(companies, "contacted_7_days").length;
  const uncontacted = filterByGroup(companies, "uncontacted").length;

  return {
    companies: companies.length,
    contacts,
    favorites,
    contacted7,
    uncontacted
  };
}

function buildGroups(companies: ReturnType<typeof toCompany>[]) {
  return {
    all: companies.length,
    potential: filterByGroup(companies, "potential").length,
    contacted7: filterByGroup(companies, "contacted_7_days").length,
    uncontacted: filterByGroup(companies, "uncontacted").length
  };
}

function getRangeStart(range: AnalyticsRange, now: Date) {
  if (range === "all") {
    return null;
  }

  if (range === "day") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  if (range === "week") {
    return new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  }

  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function hasFavoriteTag(tags: string[]) {
  return tags.some((tag) => ["favorite", "收藏", "重点客户"].includes(tag));
}

function percentage(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function buildSearchPreference(
  queries: Array<{
    query: string;
    operatorName: string | null;
    keywordGroups: Prisma.JsonValue | null;
  }>
) {
  const counts = new Map<string, number>();

  for (const query of queries) {
    const keyword = extractKeyword(query);
    counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
  }

  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([keyword, count], index) => ({
      rank: index + 1,
      keyword,
      count
    }));

  return rows.length > 0 ? rows : [{ rank: 1, keyword: "通信5G", count: 0 }];
}

function extractKeyword(query: { query: string; operatorName: string | null; keywordGroups: Prisma.JsonValue | null }) {
  const fromGroups = extractKeywordGroupValue(query.keywordGroups);
  if (fromGroups) {
    return fromGroups;
  }

  if (query.operatorName?.trim()) {
    return query.operatorName.trim();
  }

  const tokens = query.query.match(/[\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9-]*/gu) ?? [];
  return tokens.slice(0, 2).join(" ") || "通信5G";
}

function extractKeywordGroupValue(value: Prisma.JsonValue | null): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractKeywordGroupValue(item);
      if (nested) {
        return nested;
      }
    }
  }

  if (typeof value === "object") {
    const record = value as Record<string, Prisma.JsonValue>;
    for (const key of ["keyword", "label", "name", "value"]) {
      const nested = extractKeywordGroupValue(record[key] ?? null);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function buildSearchTimes(queries: Array<{ operatorSource: string | null }>) {
  const sourceCount = (source: string) => queries.filter((query) => query.operatorSource === source).length;
  const knownSources = sourceCount("global_database") + sourceCount("maps") + sourceCount("customs");
  const globalCount = sourceCount("global_database") + Math.max(0, queries.length - knownSources);

  return [
    { key: "global_database", label: "全球企业库", count: globalCount },
    { key: "maps", label: "地图获客", count: sourceCount("maps") },
    { key: "customs", label: "海关数据", count: sourceCount("customs") }
  ];
}

function buildSeries(
  now: Date,
  values: {
    searches: Date[];
    outreach: Date[];
    opens: Date[];
    replies: Date[];
    favorites: Date[];
  }
) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    return date;
  });

  return days.map((day) => {
    const key = dayKey(day);
    return {
      date: formatShortDate(day),
      search: countByDay(values.searches, key),
      outreach: countByDay(values.outreach, key),
      open: countByDay(values.opens, key),
      reply: countByDay(values.replies, key),
      favorite: countByDay(values.favorites, key)
    };
  });
}

function countByDay(values: Date[], key: string) {
  return values.filter((value) => dayKey(value) === key).length;
}

function dayKey(date: Date) {
  const local = new Date(date);
  return `${local.getFullYear()}-${local.getMonth() + 1}-${local.getDate()}`;
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  })
    .format(date)
    .replace(/\//g, "-");
}

function inferIndustry(tags: string[]) {
  return tags.find((tag) => /telecom|通信|设备|基站|RRU|BBU/i.test(tag)) ?? "通信设备";
}

function normalizeContactInputs(contacts: CrmContactInput[] = []) {
  const seen = new Set<string>();
  return contacts
    .map((contact) => ({
      type: contact.type.trim(),
      value: contact.value.trim(),
      sourceUrl: contact.sourceUrl?.trim() || null
    }))
    .filter((contact) => {
      const key = `${contact.type}:${contact.value}`.toLowerCase();
      if (!contact.type || !contact.value || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function uniqueTags(tags: string[]) {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    new: "潜在客户",
    potential: "潜在客户",
    qualified: "已确认",
    contacted: "已触达",
    interested: "感兴趣",
    quoting: "报价中",
    closed: "已成交"
  };

  return labels[stage] ?? stage;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
