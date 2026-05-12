import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import {
  Command,
  INTERRUPT,
  MemorySaver,
  createKeywordGroups,
  createInitialWorkflowState,
  generateSearchQueries,
  countryToSearchApiCode,
  leadHuntWorkflowNodes,
  type KeywordGroups,
  type LeadHuntWorkflowNode,
  type LeadHuntWorkflowHandlers,
  type LeadHuntWorkflowState,
  type WorkflowStepStatus,
  type WorkflowStep,
  createLeadHuntWorkflowGraph,
  createInitialWorkflowSteps,
  interrupt
} from "@leadhunt/agent";
import { Prisma } from "@prisma/client";
import { LeadQualificationService, type IcpScoringCriteria } from "../leads/lead-qualification.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { BraveSearchService } from "../search/brave-search.service.js";
import type { BraveSearchResult } from "../search/brave-search.client.js";
import {
  WebsiteContentService,
  type ProfileSiteEvidence,
  type WebsiteEvidence
} from "./website-content.service.js";

type CreateTaskInput = {
  prompt: string;
  targetCount?: number;
};

type LeadTaskListRow = {
  id: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  prompt: string | null;
  lead_count: number | bigint | null;
  query_count: number | bigint | null;
};

type PlannedSearchQuery = {
  provider: string;
  operatorSource?: string | null;
  executionStatus?: string | null;
  operatorName?: string | null;
  strategyTemplate?: string | null;
  query: string;
  keywordGroups: KeywordGroups;
  country?: string | null;
  effectivenessScore?: number | null;
  templateId?: string | null;
};

type TaskExecutionContext = {
  productProfile: Record<string, unknown> | null;
  customerProfile: Record<string, unknown> | null;
  productProfileAnalysis: Record<string, unknown>;
  customerProfileAnalysis: Record<string, unknown>;
  siteEvidence: Record<string, unknown>;
  profileSignals: Record<string, unknown>;
  executionPlan: Array<Record<string, unknown>>;
  keywordGroups: KeywordGroups;
  searchQueries: PlannedSearchQuery[];
};

type SearchExecutionResult = {
  ok: boolean;
  executedQueries: number;
  successfulQueries?: number;
  failedQueries?: number;
  resultCount: number;
  createdCandidates: number;
  skippedCandidates: number;
  fallback?: boolean;
  errors?: Array<{ queryId: string; message: string }>;
  hasMore?: boolean;
  remainingQueries?: number;
};

type CandidateApprovalResult = {
  selected: Array<{
    id: string;
    companyName: string;
    website: string | null;
    country: string | null;
    contacts: Array<{ type: string; value: string }>;
    icpScore: { score: number; grade: string } | null;
  }>;
  approvedLeadIds: string[];
  approvedCount: number;
};

type LeadReviewResume = {
  leadIds?: string[];
  approvedBy?: string;
};

type EmailReviewResume = {
  approved?: boolean;
  action?: "send" | "save_draft" | "cancel";
};

const DEFAULT_SYNC_SEARCH_QUERY_LIMIT = 15;
const MAX_SYNC_SEARCH_QUERY_LIMIT = 15;
const MAX_CANDIDATE_RESULTS_PER_QUERY = 20;

@Injectable()
export class AgentWorkflowService {
  private readonly graphCheckpointer = new MemorySaver();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(BraveSearchService) private readonly braveSearchService?: BraveSearchService,
    @Optional()
    @Inject(LeadQualificationService) private readonly leadQualificationService?: LeadQualificationService,
    @Optional()
    @Inject(WebsiteContentService) private readonly websiteContentService?: WebsiteContentService
  ) {}

  async createTaskWithTimeline(userId: string, input: CreateTaskInput) {
    if (shouldPlanTaskInline()) {
      const context = await this.buildTaskContext(userId, input);
      const task = await this.prisma.leadTask.create({
        data: {
          userId,
          status: "running",
          targetCount: input.targetCount ?? 50,
          inputPayload: {
            ...input,
            ...context
          }
        }
      });
      const steps = await this.createTimeline(task.id);
      const workflow = await this.runSemiManagedWorkflowToSearchPlan(task.id, input, context);

      return { task, steps, searchQueries: context.searchQueries, workflow };
    }

    const task = await this.prisma.leadTask.create({
      data: {
        userId,
        status: "running",
        targetCount: input.targetCount ?? 50,
        inputPayload: input
      }
    });
    const steps = await this.createTimeline(task.id);

    if (!shouldPlanTaskInline()) {
      void this.planTaskSearchQueries(userId, task.id, input).catch((error) =>
        this.markPlanningWorkflowFailed(task.id, error)
      );

      return {
        task,
        steps,
        searchQueries: [],
        workflow: createInitialWorkflowState(task.id)
      };
    }

    return {
      task,
      steps,
      searchQueries: [],
      workflow: createInitialWorkflowState(task.id)
    };
  }

  private async planTaskSearchQueries(userId: string, taskId: string, input: CreateTaskInput) {
    const context = await this.buildTaskContext(userId, input);
    await this.prisma.leadTask.update({
      where: { id: taskId },
      data: {
        status: "running",
        inputPayload: {
          ...input,
          ...context
        }
      }
    });
    const workflow = await this.runSemiManagedWorkflowToSearchPlan(taskId, input, context);

    return { context, workflow };
  }

  private async markPlanningWorkflowFailed(taskId: string, error: unknown) {
    const message = searchErrorMessage(error);
    await Promise.all([
      this.markStepFailed(taskId, "plan_search_queries", message),
      this.prisma.leadTask.update({
        where: { id: taskId },
        data: { status: "failed" }
      })
    ]);
  }

  private async runSemiManagedWorkflowToSearchPlan(
    taskId: string,
    input: CreateTaskInput,
    context: TaskExecutionContext
  ) {
    const handlers: LeadHuntWorkflowHandlers = {
      load_task: () =>
        this.completeWorkflowStep(taskId, "load_task", {
          prompt: input.prompt,
          targetCount: input.targetCount ?? 50,
          hasProductProfile: Boolean(context.productProfile),
          hasCustomerProfile: Boolean(context.customerProfile)
        }),
      analyze_product_profile: () =>
        this.completeWorkflowStep(taskId, "analyze_product_profile", context.productProfileAnalysis),
      analyze_customer_profile: () =>
        this.completeWorkflowStep(taskId, "analyze_customer_profile", context.customerProfileAnalysis),
      expand_keywords: () =>
        this.completeWorkflowStep(taskId, "expand_keywords", {
          keywordGroups: context.keywordGroups,
          profileSignals: context.profileSignals
        }),
      plan_search_queries: () =>
        this.completeWorkflowStep(taskId, "plan_search_queries", async () => {
          const existingCount = await this.prisma.searchQuery.count({ where: { taskId } });
          if (existingCount === 0) {
            await this.prisma.searchQuery.createMany({
              data: context.searchQueries.map((query) => ({
                taskId,
                provider: query.provider,
                operatorSource: query.operatorSource,
                executionStatus: "pending",
                operatorName: query.operatorName,
                strategyTemplate: query.strategyTemplate,
                query: query.query,
                keywordGroups: query.keywordGroups,
                country: query.country,
                effectivenessScore: query.effectivenessScore
              }))
            });
          }

          return {
            queryCount: existingCount || context.searchQueries.length,
            createdCount: existingCount === 0 ? context.searchQueries.length : 0
          };
        })
    };
    const workflow = (await createLeadHuntWorkflowGraph({
      handlers,
      stopAfter: "plan_search_queries",
      checkpointer: this.graphCheckpointer
    }).invoke(
      createInitialWorkflowState(taskId) as Record<string, unknown>,
      this.workflowConfig(taskId, "planning")
    )) as LeadHuntWorkflowState;

    await this.updateTaskStatusFromWorkflow(taskId, workflow);
    await this.persistWorkflowSnapshot(taskId, workflow, "planning");

    return workflow;
  }

  private async runApprovalWorkflowToEmailConfirmation(
    taskId: string,
    selected: Array<{
      id: string;
      companyName: string;
      website: string | null;
      country: string | null;
      contacts: Array<{ type: string; value: string }>;
      icpScore: { score: number; grade: string } | null;
    }>,
    approvedLeadIds: string[]
  ) {
    let draftCount = 0;
    const handlers: LeadHuntWorkflowHandlers = {
      generate_email: () =>
        this.completeWorkflowStep(taskId, "generate_email", async () => {
          const existingDrafts = await this.prisma.outreachDraft.findMany({
            where: {
              leadId: { in: approvedLeadIds }
            },
            select: { leadId: true }
          });
          const existingDraftLeadIds = new Set(existingDrafts.map((draft) => draft.leadId));
          const drafts = selected
            .filter((candidate) => !existingDraftLeadIds.has(candidate.id))
            .map((candidate) => buildOutreachDraft(candidate));

          if (drafts.length) {
            await this.prisma.outreachDraft.createMany({
              data: drafts
            });
          }

          draftCount = drafts.length;

          return {
            draftCount,
            approvedLeadIds
          };
      }),
      wait_email_confirmation: async () => {
        const resume = await this.interruptWorkflowAt<EmailReviewResume>(taskId, "wait_email_confirmation", {
          type: "email_confirmation",
          taskId,
          draftCount,
          message: "Confirm the outreach email before sending or saving it."
        });
        const output = {
          approved: resume.approved ?? resume.action !== "cancel",
          action: resume.action ?? "save_draft"
        };
        await this.markStepCompleted(taskId, "wait_email_confirmation", output);

        return this.workflowStepState("wait_email_confirmation", "completed", output);
      }
    };
    const workflow = (await createLeadHuntWorkflowGraph({
      startAt: "generate_email",
      handlers,
      checkpointer: this.graphCheckpointer
    }).invoke(
      createInitialWorkflowState(taskId) as Record<string, unknown>,
      this.workflowConfig(taskId, "approval-to-email")
    )) as LeadHuntWorkflowState;

    await this.updateTaskStatusFromWorkflow(taskId, workflow);
    await this.persistWorkflowSnapshot(taskId, workflow, "approval-to-email");

    return { workflow, draftCount };
  }

  async listTasksForUser(userId: string, options: { search?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    const search = options.search?.trim();
    const searchClause = search
      ? Prisma.sql`AND COALESCE(lead_tasks.input_payload->>'prompt', '') ILIKE ${`%${escapeLikePattern(search)}%`} ESCAPE ${"\\"}`
      : Prisma.empty;

    const tasks = await this.prisma.$queryRaw<LeadTaskListRow[]>(Prisma.sql`
      SELECT
        lead_tasks.id,
        lead_tasks.status,
        lead_tasks.created_at,
        lead_tasks.updated_at,
        lead_tasks.input_payload->>'prompt' AS prompt,
        COALESCE(lead_counts.lead_count, 0)::int AS lead_count,
        COALESCE(query_counts.query_count, 0)::int AS query_count
      FROM lead_tasks
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS lead_count
        FROM lead_candidates
        WHERE lead_candidates.task_id = lead_tasks.id
      ) lead_counts ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS query_count
        FROM search_queries
        WHERE search_queries.task_id = lead_tasks.id
      ) query_counts ON true
      WHERE lead_tasks.user_id = ${userId}
      ${searchClause}
      ORDER BY lead_tasks.created_at DESC
      LIMIT ${limit}
    `);

    return {
      tasks: tasks.map((task) => {
        const prompt = task.prompt ?? "";
        return {
          id: task.id,
          status: task.status,
          createdAt: task.created_at,
          updatedAt: task.updated_at,
          prompt,
          title: prompt ? prompt.slice(0, 36) : "未命名任务",
          leadCount: toNumberCount(task.lead_count),
          queryCount: toNumberCount(task.query_count)
        };
      })
    };
  }

  async getTaskForUser(userId: string, taskId: string) {
    const task = await this.prisma.leadTask.findFirst({
      where: { id: taskId, userId },
      include: {
        agentSteps: {
          orderBy: { createdAt: "asc" }
        },
        searchQueries: {
          include: {
            searchResults: true
          },
          orderBy: { createdAt: "asc" }
        },
        leadCandidates: {
          include: {
            contacts: true,
            icpScore: true,
            crmLead: true,
            followupTasks: {
              orderBy: { dueAt: "asc" }
            },
            outreachDrafts: {
              include: {
                sendLogs: {
                  orderBy: { createdAt: "desc" }
                }
              },
              orderBy: { createdAt: "desc" }
            }
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!task) {
      throw new NotFoundException("Lead task not found");
    }

    return task;
  }

  async getTaskEventsForUser(userId: string, taskId: string) {
    await this.ensureTaskForUser(userId, taskId);

    return this.prisma.agentStep.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" }
    });
  }

  async getTaskLeadsForUser(userId: string, taskId: string) {
    await this.ensureTaskForUser(userId, taskId);

    return this.prisma.leadCandidate.findMany({
      where: { taskId },
      include: {
        contacts: true,
        icpScore: true,
        crmLead: true,
        followupTasks: {
          orderBy: { dueAt: "asc" }
        },
        outreachDrafts: {
          include: {
            sendLogs: {
              orderBy: { createdAt: "desc" }
            }
          },
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: { createdAt: "asc" }
    });
  }

  async updateTaskStatusForUser(userId: string, taskId: string, status: string) {
    await this.ensureTaskForUser(userId, taskId);

    return this.prisma.leadTask.update({
      where: { id: taskId },
      data: { status }
    });
  }

  private createSearchToEmailGraphHandlers(
    userId: string,
    taskId: string,
    input: { limit?: number } = {}
  ) {
    let searchResult: SearchExecutionResult | null = null;
    let approvalResult: CandidateApprovalResult | null = null;
    let draftCount = 0;
    const handlers: LeadHuntWorkflowHandlers = {
      brave_search: async () => {
        searchResult = await this.executeBraveSearchBatchForTask(userId, taskId, input);

        if (!searchResult.ok) {
          return this.workflowFailedState(
            "brave_search",
            searchResult.errors?.[0]?.message ?? "Brave search failed"
          );
        }

        return this.workflowStepState("brave_search", "completed", { ...searchResult });
      },
      normalize_leads: () =>
        this.completeOrReflectSearchStep(taskId, "normalize_leads", searchResult, {
          createdCandidates: searchResult?.createdCandidates ?? 0,
          skippedCandidates: searchResult?.skippedCandidates ?? 0
        }),
      extract_contacts: () =>
        this.completeOrReflectSearchStep(taskId, "extract_contacts", searchResult, {
          createdCandidates: searchResult?.createdCandidates ?? 0
        }),
      score_icp: () =>
        this.completeOrReflectSearchStep(taskId, "score_icp", searchResult, {
          createdCandidates: searchResult?.createdCandidates ?? 0
        }),
      human_approval: async () => {
        const resume = await this.interruptWorkflowAt<LeadReviewResume>(taskId, "human_approval", {
          type: "lead_review",
          taskId,
          message: "Select approved leads before generating outreach drafts."
        });
        approvalResult = await this.applyCandidateApproval(userId, taskId, {
          leadIds: resume.leadIds
        });
        const output = {
          approved: true,
          approvedBy: resume.approvedBy ?? userId,
          approvedLeadIds: approvalResult.approvedLeadIds,
          approvedCount: approvalResult.approvedCount
        };
        await this.markStepCompleted(taskId, "human_approval", output);

        return this.workflowStepState("human_approval", "completed", output);
      },
      generate_email: () =>
        this.completeWorkflowStep(taskId, "generate_email", async () => {
          if (!approvalResult) {
            approvalResult = await this.applyCandidateApproval(userId, taskId, {});
          }

          const existingDrafts = await this.prisma.outreachDraft.findMany({
            where: {
              leadId: { in: approvalResult.approvedLeadIds }
            },
            select: { leadId: true }
          });
          const existingDraftLeadIds = new Set(existingDrafts.map((draft) => draft.leadId));
          const drafts = approvalResult.selected
            .filter((candidate) => !existingDraftLeadIds.has(candidate.id))
            .map((candidate) => buildOutreachDraft(candidate));

          if (drafts.length) {
            await this.prisma.outreachDraft.createMany({
              data: drafts
            });
          }

          draftCount = drafts.length;

          return {
            draftCount,
            approvedLeadIds: approvalResult.approvedLeadIds
          };
        }),
      wait_email_confirmation: async () => {
        const resume = await this.interruptWorkflowAt<EmailReviewResume>(taskId, "wait_email_confirmation", {
          type: "email_confirmation",
          taskId,
          draftCount,
          message: "Confirm the outreach email before sending or saving it."
        });
        const output = {
          approved: resume.approved ?? resume.action !== "cancel",
          action: resume.action ?? "save_draft"
        };
        await this.markStepCompleted(taskId, "wait_email_confirmation", output);

        return this.workflowStepState("wait_email_confirmation", "completed", output);
      }
    };

    return {
      handlers,
      getSearchResult: () => searchResult,
      getApprovalResult: () => approvalResult,
      getDraftCount: () => draftCount
    };
  }

  async executeBraveSearchForTask(userId: string, taskId: string, input: { limit?: number } = {}) {
    const graphRun = this.createSearchToEmailGraphHandlers(userId, taskId, input);
    const workflow = (await createLeadHuntWorkflowGraph({
      startAt: "brave_search",
      handlers: graphRun.handlers,
      checkpointer: this.graphCheckpointer
    }).invoke(
      createInitialWorkflowState(taskId) as Record<string, unknown>,
      this.workflowConfig(taskId, "search-to-email")
    )) as LeadHuntWorkflowState;

    await this.updateTaskStatusFromWorkflow(taskId, workflow);
    await this.persistWorkflowSnapshot(taskId, workflow, "search-to-email");
    const searchResult = graphRun.getSearchResult();

    return searchResult ?? {
      ok: false,
      executedQueries: 0,
      resultCount: 0,
      createdCandidates: 0,
      skippedCandidates: 0,
      errors: [{ queryId: taskId, message: workflow.error ?? "Search workflow did not run" }],
      hasMore: false,
      remainingQueries: 0
    };
  }

  private async executeBraveSearchBatchForTask(userId: string, taskId: string, input: { limit?: number } = {}) {
    if (!this.braveSearchService || !this.leadQualificationService) {
      throw new BadRequestException("Search services are not configured");
    }

    const queryLimit = resolveSearchBatchLimit(input.limit);
    const task = await this.prisma.leadTask.findFirst({
      where: { id: taskId, userId },
      include: {
        searchQueries: {
          where: { executionStatus: "pending" },
          orderBy: { createdAt: "asc" },
          take: queryLimit
        }
      }
    });

    if (!task) {
      throw new NotFoundException("Lead task not found");
    }

    if (!task.searchQueries.length) {
      await this.markStepCompleted(taskId, "brave_search", {
        executedQueries: 0,
        resultCount: 0,
        createdCandidates: 0,
        skippedCandidates: 0,
        hasMore: false,
        remainingQueries: 0
      });

      return {
        ok: true,
        executedQueries: 0,
        resultCount: 0,
        createdCandidates: 0,
        skippedCandidates: 0,
        hasMore: false,
        remainingQueries: 0
      };
    }

    await this.markStepRunning(taskId, "brave_search");
    const payload = parseTaskPayload(task.inputPayload);
    const criteria = buildIcpCriteria(payload);
    let resultCount = 0;
    let createdCandidates = 0;
    let skippedCandidates = 0;

    let usedDevelopmentFallback = false;
    let failedQueries = 0;
    const searchErrors: Array<{ queryId: string; message: string }> = [];

    for (const query of task.searchQueries) {
      const searchParams = {
        query: query.query,
        country: countryToBraveCode(query.country),
        language: "en",
        count: 20
      };
      try {
        const search = await this.runSearchWithDevelopmentFallback(query.id, searchParams, query.country);
        const candidateResults = search.results.slice(0, MAX_CANDIDATE_RESULTS_PER_QUERY);
        const saved = await this.leadQualificationService.saveCandidates(
          taskId,
          candidateResults,
          criteria,
          query.country ?? undefined
        );
        usedDevelopmentFallback ||= search.fallback;
        resultCount += search.count;
        createdCandidates += saved.createdCount;
        skippedCandidates += saved.skippedCount;
        await this.prisma.searchQuery.update({
          where: { id: query.id },
          data: {
            executionStatus: "completed",
            resultCount: search.count,
            qualifiedCount: saved.createdCount
          }
        });
      } catch (error) {
        failedQueries += 1;
        searchErrors.push({ queryId: query.id, message: searchErrorMessage(error) });
        await this.prisma.searchQuery.update({
          where: { id: query.id },
          data: {
            executionStatus: "failed",
            resultCount: 0,
            qualifiedCount: 0
          }
        });
        continue;
      }
    }

    const remainingQueries = await this.countPendingSearchQueries(taskId);
    const hasMore = remainingQueries > 0;

    if (failedQueries === task.searchQueries.length) {
      await this.markStepFailed(taskId, "brave_search", searchErrors[0]?.message ?? "All Brave searches failed");

      return {
        ok: false,
        executedQueries: task.searchQueries.length,
        successfulQueries: 0,
        failedQueries,
        resultCount,
        createdCandidates,
        skippedCandidates,
        fallback: usedDevelopmentFallback,
        errors: searchErrors,
        hasMore,
        remainingQueries
      };
    }

    await this.markStepCompleted(taskId, "brave_search", {
      executedQueries: task.searchQueries.length,
      successfulQueries: task.searchQueries.length - failedQueries,
      failedQueries,
      resultCount,
      fallback: usedDevelopmentFallback,
      hasMore,
      remainingQueries
    });
    await this.markStepCompleted(taskId, "normalize_leads", {
      createdCandidates,
      skippedCandidates
    });
    await this.markStepCompleted(taskId, "extract_contacts", {
      createdCandidates
    });
    await this.markStepCompleted(taskId, "score_icp", {
      createdCandidates
    });

    return {
      ok: true,
      executedQueries: task.searchQueries.length,
      successfulQueries: task.searchQueries.length - failedQueries,
      failedQueries,
      resultCount,
      createdCandidates,
      skippedCandidates,
      fallback: usedDevelopmentFallback,
      errors: searchErrors,
      hasMore,
      remainingQueries
    };
  }

  private countPendingSearchQueries(taskId: string) {
    return this.prisma.searchQuery.count({
      where: {
        taskId,
        executionStatus: "pending"
      }
    });
  }

  private async runSearchWithDevelopmentFallback(
    queryId: string,
    params: { query: string; country: string; language: string; count: number },
    country: string | null
  ): Promise<{ count: number; results: BraveSearchResult[]; fallback: boolean }> {
    try {
      const search = await this.braveSearchService!.searchAndSaveResults(queryId, params);
      return { ...search, fallback: false };
    } catch (error) {
      if (params.country !== "US") {
        try {
          await wait(searchRetryDelayMs());
          const retrySearch = await this.braveSearchService!.searchAndSaveResults(queryId, {
            ...params,
            country: "US"
          });
          return { ...retrySearch, fallback: false };
        } catch {
          // Continue to the configured development fallback or return the original Brave error.
        }
      }

      if (!canUseDevelopmentSearchFallback()) {
        throw error;
      }

      const fallbackResults = buildDevelopmentSearchResults(params.query, country);
      const search = await this.braveSearchService!.saveResults(queryId, fallbackResults);
      return { ...search, fallback: true };
    }
  }

  async summarizeTaskForUser(userId: string, taskId: string) {
    const task = await this.prisma.leadTask.findFirst({
      where: { id: taskId, userId },
      include: {
        searchQueries: true,
        leadCandidates: {
          include: {
            contacts: true,
            icpScore: true,
            outreachDrafts: {
              include: {
                sendLogs: true
              }
            },
            crmLead: true,
            followupTasks: true
          }
        }
      }
    });

    if (!task) {
      throw new NotFoundException("Lead task not found");
    }

    const qualified = task.leadCandidates.filter((lead) => (lead.icpScore?.score ?? 0) >= 75);
    const approved = task.leadCandidates.filter((lead) => lead.status === "approved");
    const drafts = task.leadCandidates.flatMap((lead) => lead.outreachDrafts);
    const sent = drafts.flatMap((draft) => draft.sendLogs).filter((log) => log.status === "sent" || log.sentAt);
    const crmSynced = task.leadCandidates.filter((lead) => lead.crmLead).length;
    const followups = task.leadCandidates.flatMap((lead) => lead.followupTasks).filter((followup) => followup.status === "pending");
    const topMarkets = topValues(task.leadCandidates.map((lead) => lead.country).filter((value): value is string => Boolean(value)));
    const topCompanies = qualified.slice(0, 5).map((lead) => lead.companyName);
    const summary = {
      did: [
        `读取任务并生成 ${task.searchQueries.length} 条高级搜索策略`,
        `筛选并清洗 ${task.leadCandidates.length} 家候选公司`,
        `完成 ${qualified.length} 家高匹配客户 ICP 判断`,
        `为 ${drafts.length} 家客户生成开发信草稿`
      ],
      found: {
        totalCandidates: task.leadCandidates.length,
        qualifiedCandidates: qualified.length,
        approvedCandidates: approved.length,
        topMarkets,
        topCompanies
      },
      sent: {
        draftCount: drafts.length,
        sentCount: sent.length,
        crmSynced
      },
      next: [
        drafts.length > sent.length ? "继续检查并确认待发送开发信" : "等待客户回复并进入回复分类",
        followups.length ? `按计划处理 ${followups.length} 个待跟进提醒` : "发送后为无回复客户创建 3 天后跟进提醒",
        "将高意向回复同步到 CRM 阶段和数据看板"
      ]
    };

    await this.markStepCompleted(taskId, "task_summary", summary);
    await this.prisma.leadTask.update({
      where: { id: taskId },
      data: { status: "completed" }
    });

    return {
      ok: true,
      summary
    };
  }

  async approveCandidatesForUser(userId: string, taskId: string, input: { leadIds?: string[] } = {}) {
    const graphRun = this.createSearchToEmailGraphHandlers(userId, taskId);

    try {
      const workflow = (await createLeadHuntWorkflowGraph({
        startAt: "brave_search",
        handlers: graphRun.handlers,
        checkpointer: this.graphCheckpointer
      }).invoke(
        new Command({ resume: { leadIds: input.leadIds, approvedBy: userId } }),
        this.workflowConfig(taskId, "search-to-email")
      )) as LeadHuntWorkflowState;

      await this.updateTaskStatusFromWorkflow(taskId, workflow);
      await this.persistWorkflowSnapshot(taskId, workflow, "search-to-email");
      const approvalResult = graphRun.getApprovalResult();
      if (!approvalResult) {
        throw new Error(workflow.error ?? "Lead approval graph did not resume from a pending review");
      }

      return {
        ok: true,
        approvedLeadIds: approvalResult.approvedLeadIds,
        approvedCount: approvalResult.approvedCount,
        draftCount: graphRun.getDraftCount()
      };
    } catch {
      return this.approveCandidatesWithLegacyGraph(userId, taskId, input);
    }
  }

  private async approveCandidatesWithLegacyGraph(userId: string, taskId: string, input: { leadIds?: string[] } = {}) {
    const approval = await this.applyCandidateApproval(userId, taskId, input);
    await this.markStepCompleted(taskId, "human_approval", {
      approved: true,
      approvedBy: userId,
      approvedLeadIds: approval.approvedLeadIds,
      approvedCount: approval.approvedCount
    });
    const { draftCount } = await this.runApprovalWorkflowToEmailConfirmation(
      taskId,
      approval.selected,
      approval.approvedLeadIds
    );

    return {
      ok: true,
      approvedLeadIds: approval.approvedLeadIds,
      approvedCount: approval.approvedCount,
      draftCount
    };
  }

  private async applyCandidateApproval(
    userId: string,
    taskId: string,
    input: { leadIds?: string[] } = {}
  ): Promise<CandidateApprovalResult> {
    const task = await this.prisma.leadTask.findFirst({
      where: { id: taskId, userId },
      include: {
        leadCandidates: {
          include: {
            contacts: true,
            icpScore: true
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!task) {
      throw new NotFoundException("Lead task not found");
    }

    const requestedIds = input.leadIds ?? [];
    const selected = requestedIds.length
      ? task.leadCandidates.filter((candidate) => requestedIds.includes(candidate.id))
      : task.leadCandidates.filter((candidate) => (candidate.icpScore?.score ?? 0) >= 80).slice(0, 10);

    if (requestedIds.length && selected.length !== requestedIds.length) {
      throw new BadRequestException("Some candidates do not belong to this task");
    }

    if (!selected.length) {
      throw new BadRequestException("No candidates available for approval");
    }

    const approvedLeadIds = selected.map((candidate) => candidate.id);
    await this.prisma.leadCandidate.updateMany({
      where: {
        taskId,
        id: { in: approvedLeadIds }
      },
      data: { status: "approved" }
    });

    return {
      selected,
      approvedLeadIds,
      approvedCount: approvedLeadIds.length
    };
  }

  async createTimeline(taskId: string) {
    const steps = createInitialWorkflowSteps();
    await this.prisma.agentStep.createMany({
      data: steps.map((step) => ({
        taskId,
        nodeName: step.nodeName,
        status: step.status,
        input: { order: step.order }
      }))
    });

    return steps;
  }

  markStepRunning(taskId: string, nodeName: LeadHuntWorkflowNode) {
    return this.updateStep(taskId, nodeName, "running", {
      startedAt: new Date(),
      error: null
    });
  }

  markStepCompleted(taskId: string, nodeName: LeadHuntWorkflowNode, output: Record<string, unknown> = {}) {
    return this.updateStep(taskId, nodeName, "completed", {
      output,
      endedAt: new Date(),
      error: null
    });
  }

  pauseAtHumanApproval(taskId: string, nodeName: Extract<LeadHuntWorkflowNode, "human_approval" | "wait_email_confirmation">) {
    return this.updateStep(taskId, nodeName, "waiting", {
      output: { waitingForHuman: true },
      endedAt: null,
      error: null
    });
  }

  markStepFailed(taskId: string, nodeName: LeadHuntWorkflowNode, error: string) {
    return this.updateStep(taskId, nodeName, "failed", {
      error,
      endedAt: new Date()
    });
  }

  retryStep(taskId: string, nodeName: LeadHuntWorkflowNode) {
    return this.updateStep(taskId, nodeName, "running", {
      output: { retry: true },
      startedAt: new Date(),
      endedAt: null,
      error: null
    });
  }

  private async completeWorkflowStep(
    taskId: string,
    nodeName: LeadHuntWorkflowNode,
    output: Record<string, unknown> | (() => Record<string, unknown> | Promise<Record<string, unknown>>)
  ): Promise<Partial<LeadHuntWorkflowState>> {
    await this.markStepRunning(taskId, nodeName);

    try {
      const resolvedOutput = typeof output === "function" ? await output() : output;
      await this.markStepCompleted(taskId, nodeName, resolvedOutput);
      return this.workflowStepState(nodeName, "completed", resolvedOutput);
    } catch (error) {
      const message = searchErrorMessage(error);
      await this.markStepFailed(taskId, nodeName, message);
      return this.workflowFailedState(nodeName, message);
    }
  }

  private async completeOrReflectSearchStep(
    taskId: string,
    nodeName: Extract<LeadHuntWorkflowNode, "normalize_leads" | "extract_contacts" | "score_icp">,
    searchResult: SearchExecutionResult | null,
    output: Record<string, unknown>
  ) {
    if (searchResult) {
      return this.workflowStepState(nodeName, "completed", output);
    }

    return this.completeWorkflowStep(taskId, nodeName, {
      skipped: true,
      reason: "Search did not run"
    });
  }

  private async interruptWorkflowAt<TResume>(
    taskId: string,
    nodeName: Extract<LeadHuntWorkflowNode, "human_approval" | "wait_email_confirmation">,
    payload: Record<string, unknown>
  ): Promise<TResume> {
    await this.pauseAtHumanApproval(taskId, nodeName);
    await this.prisma.leadTask.update({
      where: { id: taskId },
      data: { status: "paused" }
    });

    const resume = interrupt(payload) as TResume;
    await this.markStepCompleted(taskId, nodeName, {
      resumed: true,
      resume: resume as unknown as Record<string, unknown>
    });

    return resume;
  }

  private async pauseWorkflowAt(
    taskId: string,
    nodeName: Extract<LeadHuntWorkflowNode, "human_approval" | "wait_email_confirmation">
  ) {
    await this.pauseAtHumanApproval(taskId, nodeName);

    return {
      status: "paused" as const,
      currentNode: nodeName,
      pausedAt: nodeName,
      steps: [this.workflowStep(nodeName, "waiting", { waitingForHuman: true })]
    };
  }

  private workflowStepState(
    nodeName: LeadHuntWorkflowNode,
    status: WorkflowStepStatus,
    output: Record<string, unknown> = {}
  ): Partial<LeadHuntWorkflowState> {
    return {
      currentNode: nodeName,
      steps: [this.workflowStep(nodeName, status, output)]
    };
  }

  private workflowFailedState(nodeName: LeadHuntWorkflowNode, error: string): Partial<LeadHuntWorkflowState> {
    return {
      status: "failed",
      currentNode: nodeName,
      error,
      steps: [
        {
          nodeName,
          order: workflowNodeOrder(nodeName),
          status: "failed",
          error
        }
      ]
    };
  }

  private workflowStep(
    nodeName: LeadHuntWorkflowNode,
    status: WorkflowStepStatus,
    output?: Record<string, unknown>
  ): WorkflowStep {
    return {
      nodeName,
      order: workflowNodeOrder(nodeName),
      status,
      ...(output ? { output } : {})
    };
  }

  private async updateTaskStatusFromWorkflow(taskId: string, workflow: LeadHuntWorkflowState) {
    if (workflow.status !== "paused" && workflow.status !== "failed" && workflow.status !== "completed") {
      return;
    }

    await this.prisma.leadTask.update({
      where: { id: taskId },
      data: { status: workflow.status }
    });
  }

  private updateStep(
    taskId: string,
    nodeName: LeadHuntWorkflowNode,
    status: WorkflowStepStatus,
    data: Record<string, unknown>
  ) {
    return this.prisma.agentStep.updateMany({
      where: { taskId, nodeName },
      data: {
        status,
        ...data
      }
    });
  }

  private workflowConfig(taskId: string, checkpointNamespace: string) {
    return {
      configurable: {
        thread_id: taskId,
        checkpoint_ns: checkpointNamespace
      }
    };
  }

  private async persistWorkflowSnapshot(taskId: string, workflow: LeadHuntWorkflowState, phase: string) {
    const task = await this.prisma.leadTask.findFirst({
      where: { id: taskId },
      select: { inputPayload: true }
    });
    const inputPayload = toPlainObject(task?.inputPayload);
    const interrupts = toJsonValue(getWorkflowInterrupts(workflow));
    const pausedAt = interrupts.length ? interruptNodeName(interrupts) : workflow.pausedAt;

    await this.prisma.leadTask.update({
      where: { id: taskId },
      data: {
        inputPayload: {
          ...inputPayload,
          graphWorkflow: {
            phase,
            status: interrupts.length ? "paused" : workflow.status,
            currentNode: workflow.currentNode,
            pausedAt,
            error: workflow.error,
            interrupts,
            updatedAt: new Date().toISOString()
          }
        } as Prisma.InputJsonValue
      }
    });
  }

  private async ensureTaskForUser(userId: string, taskId: string) {
    const task = await this.prisma.leadTask.findFirst({
      where: { id: taskId, userId },
      select: { id: true }
    });

    if (!task) {
      throw new NotFoundException("Lead task not found");
    }

    return task;
  }

  private async buildTaskContext(userId: string, input: CreateTaskInput) {
    const [productProfile, customerProfile] = await Promise.all([
      this.prisma.productProfile.findUnique({ where: { userId } }),
      this.prisma.customerProfile.findUnique({ where: { userId } })
    ]);
    const product = productProfile
      ? {
          websiteUrl: productProfile.websiteUrl,
          productPageUrl: productProfile.productPageUrl,
          documentUrls: asStringArray(productProfile.documentUrls),
          notes: productProfile.notes
        }
      : null;
    const customer = customerProfile
      ? {
          targetRegions: asStringArray(customerProfile.targetRegions),
          referenceCustomerUrls: asStringArray(customerProfile.referenceCustomerUrls),
          crmSampleIds: asStringArray(customerProfile.crmSampleIds),
          notes: customerProfile.notes
        }
      : null;
    const crmSamples = customer?.crmSampleIds?.length
      ? await this.prisma.leadCandidate.findMany({
          where: { id: { in: customer.crmSampleIds } },
          select: {
            companyName: true,
            website: true,
            country: true,
            sourceUrl: true,
            contacts: {
              select: {
                value: true
              }
            }
          },
          take: 20
        })
      : [];
    const productProfileUrls = compactStrings([product?.websiteUrl, product?.productPageUrl, ...(product?.documentUrls ?? [])]);
    const referenceCustomerUrls = customer?.referenceCustomerUrls ?? [];
    const siteEvidence =
      (await this.websiteContentService?.readProfileSites({
        productUrls: productProfileUrls,
        referenceCustomerUrls
      })) ?? emptyProfileSiteEvidence();
    const siteKeywordHints = collectSiteKeywordHints(siteEvidence);
    const productProfileAnalysis = buildProductProfileAnalysis(product, siteEvidence.productSites);
    const customerProfileAnalysis = buildCustomerProfileAnalysis(customer, siteEvidence.referenceCustomerSites);
    const profileKeywordInput = {
      taskText: input.prompt,
      productProfileUrls,
      productProfileNotes: buildEvidenceNotes(product?.notes, siteEvidence.productSites),
      referenceCustomerUrls,
      crmSampleNames: crmSamples.map((sample) =>
        compactStrings([
          sample.companyName,
          sample.website,
          sample.country,
          sample.sourceUrl,
          ...sample.contacts.map((contact) => contact.value)
        ]).join(" ")
      ),
      customerProfileNotes: buildEvidenceNotes(customer?.notes, siteEvidence.referenceCustomerSites),
      targetMarkets: resolveTargetMarkets(input.prompt, customer?.targetRegions),
      productTerms: siteKeywordHints.productTerms,
      customerIntentTerms: siteKeywordHints.customerIntentTerms,
      scenarioTerms: siteKeywordHints.scenarioTerms
    };
    const keywordGroups = createKeywordGroups({
      ...profileKeywordInput
    });
    const searchQueries = generateSearchQueries({
      ...profileKeywordInput,
      minQueryCount: 15
    });

    return {
      productProfile: product,
      customerProfile: customer,
      productProfileAnalysis,
      customerProfileAnalysis,
      siteEvidence,
      profileSignals: {
        productUrlsUsed: profileKeywordInput.productProfileUrls,
        referenceCustomerUrlsUsed: profileKeywordInput.referenceCustomerUrls ?? [],
        productUrlsRead: siteEvidence.productSites.filter((site) => site.status === "read").map((site) => site.finalUrl),
        referenceCustomerUrlsRead: siteEvidence.referenceCustomerSites
          .filter((site) => site.status === "read")
          .map((site) => site.finalUrl),
        failedUrlCount: siteEvidence.summary.failed,
        crmSampleCount: crmSamples.length
      },
      executionPlan: buildExecutionPlan(Boolean(product), Boolean(customer)),
      keywordGroups,
      searchQueries: searchQueries.map((query) => ({
        provider: query.provider,
        operatorSource: query.operatorSource,
        executionStatus: query.executionStatus,
        operatorName: query.operatorName,
        strategyTemplate: query.strategyTemplate,
        query: query.query,
        keywordGroups: query.keywordGroups,
        country: query.country,
        effectivenessScore: query.effectivenessScore,
        templateId: query.templateId
      }))
    };
  }
}

function buildExecutionPlan(hasProductProfile: boolean, hasCustomerProfile: boolean) {
  return [
    {
      step: "load_task",
      title: "读取任务和画像",
      detail: `读取自然语言任务${hasProductProfile ? "、产品画像" : ""}${hasCustomerProfile ? "、客户画像" : ""}`
    },
    {
      step: "analyze_product_profile",
      title: "分析产品能力",
      detail: hasProductProfile ? "从官网、产品页和补充说明提取产品词" : "使用任务文本和默认通信设备词库补全产品词"
    },
    {
      step: "analyze_customer_profile",
      title: "分析目标客户",
      detail: hasCustomerProfile ? "从目标地区、参考客户和 CRM 样本提取客户意图" : "使用任务文本和默认经销商画像补全客户意图"
    },
    {
      step: "plan_search_queries",
      title: "生成高级搜索策略",
      detail: "生成至少 15 条 Brave 可执行或实验性搜索 query"
    },
    {
      step: "human_approval",
      title: "人工确认候选客户",
      detail: "先展示候选客户和 ICP 分数，再进入邮件触达"
    },
    {
      step: "task_summary",
      title: "输出本次任务总结",
      detail: "说明找到了什么、准备触达什么客户以及后续跟进动作"
    }
  ];
}

function toPlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function getWorkflowInterrupts(workflow: LeadHuntWorkflowState): unknown[] {
  const value = (workflow as unknown as Record<string, unknown>)[INTERRUPT];
  return Array.isArray(value) ? value : [];
}

function toJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function interruptNodeName(interrupts: unknown[]): LeadHuntWorkflowNode | null {
  const first = interrupts[0] as { value?: { type?: string } } | undefined;
  if (first?.value?.type === "lead_review") {
    return "human_approval";
  }
  if (first?.value?.type === "email_confirmation") {
    return "wait_email_confirmation";
  }

  return null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function resolveTargetMarkets(taskText: string, profileRegions: string[] | undefined): string[] | undefined {
  const taskMarkets = detectTaskMarkets(taskText);
  return taskMarkets.length ? taskMarkets : profileRegions;
}

function detectTaskMarkets(text: string): string[] {
  const rules: Array<[RegExp, string[]]> = [
    [/\boman\b|\u963f\u66fc/i, ["Oman"]],
    [/\biran\b|\u4f0a\u6717/i, ["Iran"]],
    [/\bisrael\b|\u4ee5\u8272\u5217/i, ["Israel"]],
    [/\bunited states\b|\busa\b|\bus\b|\u7f8e\u56fd/i, ["United States"]],
    [/\u6c99\u7279|\u963f\u62c9\u4f2f/i, ["Saudi Arabia", "Riyadh", "Jeddah"]],
    [/\bgermany\b|\u5fb7\u56fd/i, ["Germany"]],
    [/\bpoland\b|\u6ce2\u5170/i, ["Poland"]],
    [/\bunited kingdom\b|\buk\b|\u82f1\u56fd/i, ["United Kingdom"]],
    [/\bfrance\b|\u6cd5\u56fd/i, ["France"]],
    [/\bitaly\b|\u610f\u5927\u5229/i, ["Italy"]],
    [/\bspain\b|\u897f\u73ed\u7259/i, ["Spain"]],
    [/\bchile\b|\u667a\u5229/i, ["Chile"]],
    [/\bcolombia\b|\u54e5\u4f26\u6bd4\u4e9a/i, ["Colombia"]],
    [/\bperu\b|\u79d8\u9c81/i, ["Peru"]],
    [/\bargentina\b|\u963f\u6839\u5ef7/i, ["Argentina"]],
    [/global|worldwide|all countries|all markets|全球/i, ["Global"]],
    [/(?:(?<!central )(?<!south )(?<!southeast )\basia\b)|apac|亚洲/i, ["Asia"]],
    [/southeast asia|asean|东南亚/i, ["Southeast Asia"]],
    [/south asia|南亚/i, ["South Asia"]],
    [/central asia|中亚/i, ["Central Asia"]],
    [/middle east|\bmena\b|中东/i, ["Middle East"]],
    [/\bgcc\b|gulf countries|海湾国家/i, ["GCC"]],
    [/\beurope\b|欧洲/i, ["Europe"]],
    [/\bafrica\b|非洲/i, ["Africa"]],
    [/north america|北美|北美洲/i, ["North America"]],
    [/latin america|\blatam\b|拉美/i, ["Latin America"]],
    [/americas|(?<!北)美洲/i, ["Americas"]],
    [/oceania|大洋洲/i, ["Oceania"]],
    [/\buae\b|united arab emirates|dubai|abu dhabi|阿联酋/i, ["UAE", "Dubai", "Abu Dhabi"]],
    [/\bsaudi\b|saudi arabia|riyadh|jeddah|沙特/i, ["Saudi Arabia", "Riyadh", "Jeddah"]],
    [/\bqatar\b|doha|卡塔尔/i, ["Qatar", "Doha"]],
    [/\bnigeria\b|lagos|尼日利亚/i, ["Nigeria", "Lagos"]],
    [/\bkenya\b|nairobi|肯尼亚/i, ["Kenya", "Nairobi"]],
    [/south africa|南非/i, ["South Africa"]],
    [/\bindonesia\b|印尼|印度尼西亚/i, ["Indonesia"]],
    [/\bbrazil\b|巴西/i, ["Brazil"]],
    [/\brussia\b|moscow|俄罗斯/i, ["Russia", "Moscow"]],
    [/\bukraine\b|kyiv|kiev|乌克兰/i, ["Ukraine", "Kyiv"]]
  ];

  const matches = rules.flatMap(([pattern, markets]) => {
    const match = text.match(pattern);
    return typeof match?.index === "number"
      ? markets.map((market, offset) => ({ market, index: match.index! + offset / 100 }))
      : [];
  });

  return Array.from(new Set(matches.sort((left, right) => left.index - right.index).map((match) => match.market)));
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
}

function emptyProfileSiteEvidence(): ProfileSiteEvidence {
  return {
    productSites: [],
    referenceCustomerSites: [],
    summary: {
      attempted: 0,
      read: 0,
      failed: 0
    }
  };
}

function collectSiteKeywordHints(siteEvidence: ProfileSiteEvidence) {
  const allSites = [...siteEvidence.productSites, ...siteEvidence.referenceCustomerSites];

  return {
    productTerms: uniqueStrings(
      siteEvidence.productSites.flatMap((site) => [
        ...(site.productNames ?? []),
        ...site.extractedTerms.productTerms,
        ...site.extractedTerms.brandTerms.map((brand) => `${brand} telecom equipment`)
      ])
    ),
    customerIntentTerms: uniqueStrings(
      siteEvidence.referenceCustomerSites.flatMap((site) => site.extractedTerms.customerIntentTerms)
    ),
    scenarioTerms: uniqueStrings(allSites.flatMap((site) => site.extractedTerms.scenarioTerms))
  };
}

function buildEvidenceNotes(notes: string | null | undefined, sites: WebsiteEvidence[]) {
  const snippets = sites
    .filter((site) => site.status === "read")
    .flatMap((site) => site.evidenceSnippets.length ? site.evidenceSnippets : [site.textSample])
    .filter(Boolean)
    .slice(0, 8);
  const combined = compactStrings([notes, ...snippets]);

  return combined.length ? combined.join("\n") : undefined;
}

function buildProductProfileAnalysis(
  product: { websiteUrl?: string | null; productPageUrl?: string | null; notes?: string | null } | null,
  sites: WebsiteEvidence[]
) {
  const readSites = sites.filter((site) => site.status === "read");
  const failedSites = sites.filter((site) => site.status === "failed");
  const productNames = uniqueStrings(readSites.flatMap((site) => site.productNames ?? []));
  const productTerms = uniqueStrings([
    ...productNames,
    ...readSites.flatMap((site) => site.extractedTerms.productTerms)
  ]);
  const brandTerms = uniqueStrings(readSites.flatMap((site) => site.extractedTerms.brandTerms));
  const evidence = readSites.flatMap((site) => site.evidenceSnippets).slice(0, 8);
  const totalProducts = readSites.reduce((max, site) => Math.max(max, site.productCatalog?.totalProducts ?? 0), 0);
  const catalogPagesRead = readSites.reduce((sum, site) => sum + (site.productCatalog?.pagesRead ?? 0), 0);

  return {
    source: readSites.length ? "website_content" : product ? "saved_profile_only" : "task_text_only",
    confidence: readSites.length ? confidenceFromEvidence(productTerms.length + brandTerms.length) : product ? 0.35 : 0.2,
    websiteUrls: uniqueStrings(compactStrings([product?.websiteUrl, product?.productPageUrl])),
    readUrls: readSites.map((site) => site.finalUrl),
    failedUrls: failedSites.map((site) => ({ url: site.url, error: site.error })),
    productCategories: productTerms.slice(0, 8),
    keyProducts: productTerms.slice(0, 12),
    productCatalog: {
      totalProducts: totalProducts || productNames.length,
      listedProducts: readSites.reduce((sum, site) => sum + (site.productCatalog?.listedProducts ?? 0), 0),
      extractedProducts: productNames.length,
      pagesRead: catalogPagesRead,
      truncated: readSites.some((site) => site.productCatalog?.truncated)
    },
    brands: brandTerms.slice(0, 8),
    searchKeywords: uniqueStrings([...productTerms, ...brandTerms]).slice(0, 16),
    evidence,
    warning: readSites.length ? null : "No website content was read; analysis uses saved notes and defaults only."
  };
}

function buildCustomerProfileAnalysis(
  customer: { targetRegions?: string[]; referenceCustomerUrls?: string[]; notes?: string | null } | null,
  sites: WebsiteEvidence[]
) {
  const readSites = sites.filter((site) => site.status === "read");
  const failedSites = sites.filter((site) => site.status === "failed");
  const customerTypes = uniqueStrings(readSites.flatMap((site) => site.extractedTerms.customerIntentTerms));
  const scenarios = uniqueStrings(readSites.flatMap((site) => site.extractedTerms.scenarioTerms));
  const evidence = readSites.flatMap((site) => site.evidenceSnippets).slice(0, 8);

  return {
    source: readSites.length ? "website_content" : customer ? "saved_profile_only" : "task_text_only",
    confidence: readSites.length ? confidenceFromEvidence(customerTypes.length + scenarios.length) : customer ? 0.35 : 0.2,
    targetRegions: customer?.targetRegions ?? [],
    referenceUrls: customer?.referenceCustomerUrls ?? [],
    readUrls: readSites.map((site) => site.finalUrl),
    failedUrls: failedSites.map((site) => ({ url: site.url, error: site.error })),
    idealCustomerTypes: customerTypes.slice(0, 10),
    buyingSignals: scenarios.slice(0, 10),
    searchKeywords: uniqueStrings([...customerTypes, ...scenarios]).slice(0, 16),
    evidence,
    warning: readSites.length ? null : "No reference customer website content was read; analysis uses saved notes and defaults only."
  };
}

function confidenceFromEvidence(signalCount: number) {
  if (signalCount >= 10) return 0.86;
  if (signalCount >= 6) return 0.76;
  if (signalCount >= 3) return 0.62;
  return 0.48;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function parseTaskPayload(value: Prisma.JsonValue | null): {
  productProfile?: { notes?: string | null } | null;
  customerProfile?: { targetRegions?: string[]; notes?: string | null } | null;
  keywordGroups?: Partial<KeywordGroups>;
} {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ReturnType<typeof parseTaskPayload>) : {};
}

function buildIcpCriteria(payload: ReturnType<typeof parseTaskPayload>): IcpScoringCriteria {
  const keywordGroups = payload.keywordGroups ?? {};
  const marketTerms = asStringArray(keywordGroups.marketTerms).slice(0, 40);
  const profileRegions = asStringArray(payload.customerProfile?.targetRegions).slice(0, 40);
  const targetRegions = Array.from(new Set([...profileRegions, ...marketTerms]));

  return {
    targetRegions: targetRegions.length ? targetRegions : profileRegions,
    productKeywords: [
      ...asStringArray(keywordGroups.productTerms).slice(0, 8),
      ...asStringArray(keywordGroups.longTailProductTerms).slice(0, 6)
    ],
    customerTypeKeywords: asStringArray(keywordGroups.customerIntentTerms).slice(0, 8),
    disqualifiers: [
      "job",
      "career",
      "training",
      "course",
      "news",
      "blog",
      "marketplace",
      "Alibaba",
      "Accio",
      "TradeWheel",
      "Made-in-China",
      "GlobalSources",
      "IndiaMART",
      "TradeIndia"
    ]
  };
}

function resolveSearchBatchLimit(limit: number | undefined) {
  const requested = typeof limit === "number" && Number.isFinite(limit) ? limit : DEFAULT_SYNC_SEARCH_QUERY_LIMIT;
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_SYNC_SEARCH_QUERY_LIMIT);
}

function countryToBraveCode(country: string | null) {
  const genericCode = countryToSearchApiCode(country);
  if (genericCode !== "ALL" || !country) {
    return genericCode;
  }

  const normalized = country?.toLowerCase();
  const codes: Record<string, string> = {
    uae: "ALL",
    "united arab emirates": "ALL",
    "阿联酋": "ALL",
    dubai: "ALL",
    "abu dhabi": "ALL",
    "saudi arabia": "SA",
    "沙特": "SA",
    riyadh: "SA",
    jeddah: "SA",
    qatar: "ALL",
    nigeria: "ALL",
    "尼日利亚": "ALL",
    kenya: "ALL",
    "肯尼亚": "ALL",
    "south africa": "ZA",
    indonesia: "ID",
    brazil: "BR",
    india: "IN",
    pakistan: "PK",
    bangladesh: "BD",
    vietnam: "VN",
    malaysia: "MY",
    philippines: "PH",
    thailand: "TH",
    singapore: "SG",
    cambodia: "KH",
    myanmar: "MM",
    laos: "LA",
    kazakhstan: "KZ",
    uzbekistan: "UZ",
    kyrgyzstan: "KG",
    tajikistan: "TJ",
    turkmenistan: "TM",
    kuwait: "KW",
    oman: "OM",
    bahrain: "BH",
    jordan: "JO",
    iraq: "IQ",
    turkey: "TR",
    egypt: "EG",
    germany: "DE",
    "united kingdom": "GB",
    france: "FR",
    italy: "IT",
    spain: "ES",
    poland: "PL",
    netherlands: "NL",
    romania: "RO",
    "united states": "US",
    usa: "US",
    canada: "CA",
    mexico: "MX",
    chile: "CL",
    colombia: "CO",
    peru: "PE",
    argentina: "AR",
    ecuador: "EC",
    "costa rica": "CR",
    australia: "AU",
    "new zealand": "NZ",
    "papua new guinea": "PG",
    morocco: "MA",
    ghana: "GH",
    ethiopia: "ET",
    tanzania: "TZ",
    uganda: "UG",
    algeria: "DZ",
    russia: "ALL",
    "俄罗斯": "ALL",
    ukraine: "ALL",
    "乌克兰": "ALL"
  };

  return normalized ? codes[normalized] ?? "ALL" : "US";
}

function canUseDevelopmentSearchFallback() {
  const flag = process.env.LEADHUNT_DEV_SEARCH_FALLBACK?.toLowerCase();

  if (flag === "true" || flag === "1") {
    return true;
  }

  return false;
}

function searchErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function searchRetryDelayMs() {
  return process.env.NODE_ENV === "test" ? 0 : 1000;
}

function buildDevelopmentSearchResults(query: string, country: string | null): BraveSearchResult[] {
  const market = normalizeFallbackMarket(country);
  const companies = fallbackCompanies[market] ?? fallbackCompanies.UAE;

  return companies.map((company) => ({
    title: `${company.name} - Telecom equipment ${company.type}`,
    url: `https://${company.domain}`,
    snippet: [
      `${company.name} is a local development fallback result for ${market}.`,
      `${company.type} focused on telecom equipment, RRU, BBU, microwave backhaul, telecom power, spare parts and network maintenance.`,
      `Query context: ${query}`,
      `Contact: sales@${company.domain}`
    ].join(" "),
    source: "web" as const
  }));
}

function normalizeFallbackMarket(country: string | null): FallbackMarket {
  const normalized = country?.toLowerCase() ?? "";
  if (normalized.includes("saudi") || normalized.includes("riyadh") || normalized.includes("jeddah")) {
    return "SAUDI";
  }

  return "UAE";
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function toNumberCount(value: number | bigint | null) {
  if (typeof value === "bigint") {
    return Number(value);
  }

  return value ?? 0;
}

function workflowNodeOrder(nodeName: LeadHuntWorkflowNode) {
  return leadHuntWorkflowNodes.indexOf(nodeName) + 1;
}

function shouldPlanTaskInline() {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
}

type FallbackMarket = "UAE" | "SAUDI";

const fallbackCompanies: Record<FallbackMarket, Array<{ name: string; domain: string; type: string }>> = {
  UAE: [
    {
      name: "Gulf Telecom Supplies FZE",
      domain: "gulf-telecom-supplies.example",
      type: "distributor and stockist"
    },
    {
      name: "Atlas Network Solutions LLC",
      domain: "atlas-network-solutions.example",
      type: "system integrator"
    },
    {
      name: "MEA Radio Systems Trading",
      domain: "mea-radio-systems.example",
      type: "RRU and BBU spare parts stockist"
    },
    {
      name: "Falcon Tower & Power Services",
      domain: "falcon-tower-power.example",
      type: "tower power maintenance company"
    }
  ],
  SAUDI: [
    {
      name: "Saudi Telecom Infrastructure Co.",
      domain: "saudi-telecom-infrastructure.example",
      type: "telecom infrastructure contractor"
    },
    {
      name: "Riyadh Network Supplies",
      domain: "riyadh-network-supplies.example",
      type: "network equipment distributor"
    },
    {
      name: "Jeddah Radio Unit Trading",
      domain: "jeddah-radio-unit-trading.example",
      type: "radio unit and microwave backhaul stockist"
    },
    {
      name: "Najd Site Power Services",
      domain: "najd-site-power-services.example",
      type: "site power service provider"
    }
  ]
};

function topValues(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([value, count]) => ({ value, count }));
}

function buildOutreachDraft(candidate: {
  id: string;
  companyName: string;
  website: string | null;
  country: string | null;
  contacts: Array<{ type: string; value: string }>;
  icpScore: { score: number; grade: string } | null;
}) {
  const email = candidate.contacts.find((contact) => contact.type === "email")?.value;
  const productFit = candidate.icpScore ? `ICP ${candidate.icpScore.score}/${candidate.icpScore.grade}` : "high-fit telecom profile";
  const countryLine = candidate.country ? ` in ${candidate.country}` : "";

  return {
    leadId: candidate.id,
    channel: "email",
    subject: `Telecom equipment supply support for ${candidate.companyName}`,
    body: [
      `Hi ${candidate.companyName} team,`,
      "",
      `I noticed your company appears to be a strong ${productFit} prospect${countryLine}.`,
      "We support telecom equipment supply, spare parts, RRU/BBU boards, microwave backhaul and power modules for distributors, stockists and system integrators.",
      "",
      "Could you let me know whether you currently source telecom spare parts or project supply items?",
      "",
      "Best regards,",
      "LeadHunt AI"
    ].join("\n"),
    status: email ? "draft" : "needs_contact"
  };
}
