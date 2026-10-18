import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { ensureApprovedCandidatesInCrm, normalizeTags, syncLeadToCrm, type SyncLeadToCrmInput } from "./crm-sync.js";

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

type AnalyticsSearchQueryRow = {
  id: string;
  query: string;
  operatorSource: string | null;
  operatorName: string | null;
  keywordGroups: Prisma.JsonValue | null;
  createdAt: Date | string;
};

type AnalyticsSendLogRow = {
  id: string;
  status: string;
  channel: string;
  sentAt: Date | string | null;
  createdAt: Date | string;
};

type AnalyticsReplyRow = {
  id: string;
  receivedAt: Date | string;
};

type AnalyticsOpenEventRow = {
  id: string;
  sendLogId: string;
  occurredAt: Date | string;
};

type AnalyticsCrmLeadRow = {
  id: string;
  tags: Prisma.JsonValue | null;
  updatedAt: Date | string;
  favoritePersonCount: number | bigint | null;
};

type AnalyticsPayloadRow = {
  searchQueries: unknown;
  sendLogs: unknown;
  replies: unknown;
  openEvents: unknown;
  crmLeads: unknown;
};

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
    await ensureApprovedCandidatesInCrm(this.prisma, userId);

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
    const searchDateFilter = rangeStart ? Prisma.sql`AND search_queries.created_at >= ${rangeStart}` : Prisma.empty;
    const sendDateFilter = rangeStart ? Prisma.sql`AND send_logs.created_at >= ${rangeStart}` : Prisma.empty;
    const replyDateFilter = rangeStart ? Prisma.sql`AND inbound_messages.received_at >= ${rangeStart}` : Prisma.empty;
    const openDateFilter = rangeStart ? Prisma.sql`AND engagement_events.occurred_at >= ${rangeStart}` : Prisma.empty;
    const crmDateFilter = rangeStart ? Prisma.sql`AND crm_leads.updated_at >= ${rangeStart}` : Prisma.empty;

    const [analyticsPayload] = await this.prisma.$queryRaw<AnalyticsPayloadRow[]>(Prisma.sql`
      WITH filtered_search_queries AS (
        SELECT
          search_queries.id,
          search_queries.query,
          search_queries.operator_source,
          search_queries.operator_name,
          search_queries.created_at
        FROM search_queries
        INNER JOIN lead_tasks ON lead_tasks.id = search_queries.task_id
        WHERE lead_tasks.user_id = ${userId}
        ${searchDateFilter}
      ),
      filtered_send_logs AS (
        SELECT
          send_logs.id,
          send_logs.status,
          send_logs.channel,
          send_logs.sent_at,
          send_logs.created_at
        FROM send_logs
        INNER JOIN outreach_drafts ON outreach_drafts.id = send_logs.draft_id
        INNER JOIN lead_candidates ON lead_candidates.id = outreach_drafts.lead_id
        INNER JOIN lead_tasks ON lead_tasks.id = lead_candidates.task_id
        WHERE lead_tasks.user_id = ${userId}
        ${sendDateFilter}
      ),
      filtered_replies AS (
        SELECT
          inbound_messages.id,
          inbound_messages.received_at
        FROM inbound_messages
        INNER JOIN inbox_threads ON inbox_threads.id = inbound_messages.thread_id
        INNER JOIN outreach_drafts ON outreach_drafts.id = inbox_threads.draft_id
        INNER JOIN lead_candidates ON lead_candidates.id = outreach_drafts.lead_id
        INNER JOIN lead_tasks ON lead_tasks.id = lead_candidates.task_id
        WHERE lead_tasks.user_id = ${userId}
        ${replyDateFilter}
      ),
      filtered_open_events AS (
        SELECT
          engagement_events.id,
          engagement_events.send_log_id,
          engagement_events.occurred_at
        FROM engagement_events
        INNER JOIN send_logs ON send_logs.id = engagement_events.send_log_id
        INNER JOIN outreach_drafts ON outreach_drafts.id = send_logs.draft_id
        INNER JOIN lead_candidates ON lead_candidates.id = outreach_drafts.lead_id
        INNER JOIN lead_tasks ON lead_tasks.id = lead_candidates.task_id
        WHERE lead_tasks.user_id = ${userId}
          AND engagement_events.event_type = 'open'
        ${openDateFilter}
      ),
      filtered_crm_leads AS (
        SELECT
          crm_leads.id,
          crm_leads.tags,
          crm_leads.updated_at,
          COALESCE(count(lead_contacts.id) FILTER (WHERE lead_contacts.type = 'favorite_person'), 0)::int AS favorite_person_count
        FROM crm_leads
        INNER JOIN lead_candidates ON lead_candidates.id = crm_leads.lead_id
        INNER JOIN lead_tasks ON lead_tasks.id = lead_candidates.task_id
        LEFT JOIN lead_contacts ON lead_contacts.lead_id = lead_candidates.id
        WHERE lead_tasks.user_id = ${userId}
        ${crmDateFilter}
        GROUP BY crm_leads.id, crm_leads.tags, crm_leads.updated_at
      )
      SELECT
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
            'id', id,
            'query', query,
            'operatorSource', operator_source,
            'operatorName', operator_name,
            'keywordGroups', NULL,
            'createdAt', created_at
          )) FROM filtered_search_queries),
          '[]'::jsonb
        ) AS "searchQueries",
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
            'id', id,
            'status', status,
            'channel', channel,
            'sentAt', sent_at,
            'createdAt', created_at
          )) FROM filtered_send_logs),
          '[]'::jsonb
        ) AS "sendLogs",
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
            'id', id,
            'receivedAt', received_at
          )) FROM filtered_replies),
          '[]'::jsonb
        ) AS "replies",
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
            'id', id,
            'sendLogId', send_log_id,
            'occurredAt', occurred_at
          )) FROM filtered_open_events),
          '[]'::jsonb
        ) AS "openEvents",
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
            'id', id,
            'tags', tags,
            'updatedAt', updated_at,
            'favoritePersonCount', favorite_person_count
          )) FROM filtered_crm_leads),
          '[]'::jsonb
        ) AS "crmLeads"
    `);

    const searchQueries = analyticsRows<AnalyticsSearchQueryRow>(analyticsPayload?.searchQueries).map((query) => ({
      ...query,
      createdAt: toDate(query.createdAt)
    }));
    const sendLogs = analyticsRows<AnalyticsSendLogRow>(analyticsPayload?.sendLogs).map((log) => ({
      ...log,
      sentAt: log.sentAt ? toDate(log.sentAt) : null,
      createdAt: toDate(log.createdAt)
    }));
    const replies = analyticsRows<AnalyticsReplyRow>(analyticsPayload?.replies).map((reply) => ({
      ...reply,
      receivedAt: toDate(reply.receivedAt)
    }));
    const openEvents = analyticsRows<AnalyticsOpenEventRow>(analyticsPayload?.openEvents).map((event) => ({
      ...event,
      occurredAt: toDate(event.occurredAt)
    }));
    const crmLeads = analyticsRows<AnalyticsCrmLeadRow>(analyticsPayload?.crmLeads).map((lead) => ({
      ...lead,
      updatedAt: toDate(lead.updatedAt)
    }));

    const emailLogs = sendLogs.filter((log) => log.channel === "email");
    const sentEmailLogs = emailLogs.filter((log) => log.sentAt || ["sent", "delivered"].includes(log.status));
    const openedSendLogIds = new Set(openEvents.map((event) => event.sendLogId));
    const openedEmailCount = sentEmailLogs.filter((log) => openedSendLogIds.has(log.id)).length;
    const favoriteCompanies = crmLeads.filter((lead) => hasFavoriteTag(normalizeTags(lead.tags))).length;
    const favoritePeople = crmLeads.reduce((total, lead) => total + toNumberCount(lead.favoritePersonCount), 0);

    return {
      range,
      overview: {
        emailTasks: emailLogs.length,
        emailMessages: emailLogs.length,
        replyMessages: replies.length,
        openMessages: openedEmailCount,
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

function analyticsRows<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  return [];
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function toNumberCount(value: number | bigint | null) {
  if (typeof value === "bigint") {
    return Number(value);
  }

  return value ?? 0;
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

  return rows;
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
