import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import {
  Command,
  INTERRUPT,
  MemorySaver,
  createKeywordGroups,
  createInitialWorkflowState,
  getSearchStrategyLibrary,
  countryToSearchApiCode,
  countryToSite as marketToSite,
  resolveCountry,
  leadHuntWorkflowNodes,
  type KeywordGroups,
  type LeadHuntWorkflowNode,
  type LeadHuntWorkflowHandlers,
  type LeadHuntWorkflowState,
  type WorkflowStepStatus,
  type WorkflowStep,
  type OperatorSource,
  createLeadHuntWorkflowGraph,
  createInitialWorkflowSteps,
  interrupt
} from "@leadhunt/agent";
import { Prisma } from "@prisma/client";
import { LeadHuntAiService, type SearchStrategyInput } from "../ai/leadhunt-ai.service.js";
import type {
  CandidateBuyerEvaluationResult,
  CustomerProfileAnalysis,
  KeywordExpansionResult,
  ProductProfileAnalysis,
  SearchStrategyPlan
} from "../ai/leadhunt-ai.schemas.js";
import {
  LeadQualificationService,
  type IcpScoringCriteria
} from "../leads/lead-qualification.service.js";
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
  strategyType?: string | null;
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

const MAX_SYNC_SEARCH_QUERY_LIMIT = 500;
const MAX_CANDIDATE_RESULTS_PER_QUERY = 20;
const DEFAULT_SEARCH_QUERY_COUNT = 30;
const SEARCH_STRATEGY_INITIAL_QUERY_COUNT = 15;
const MIN_EXECUTABLE_GPT_SEARCH_QUERY_COUNT = SEARCH_STRATEGY_INITIAL_QUERY_COUNT;
const SEARCH_STRATEGY_MAX_REFILL_ATTEMPTS = 2;
const PRODUCT_PROFILE_TIMEOUT_MS = 75_000;
const CUSTOMER_PROFILE_TIMEOUT_MS = 75_000;
const KEYWORD_EXPANSION_TIMEOUT_MS = 90_000;
const SEARCH_STRATEGY_TIMEOUT_MS = 90_000;
const SEARCH_STRATEGY_REFILL_TIMEOUT_MS = 30_000;
const FIRST_STAGE_SEARCH_QUERY_LIMIT = 15;
const RUNNING_TASK_RECOVERY_LIMIT = 5;
const RUNNING_TASK_RECOVERY_WINDOW_HOURS = 24;
const LANGGRAPH_CHECKPOINT_STORE_VALUES = ["memory", "postgres"] as const;
const knownQueryMarkets = [
  "Canada",
  "Australia",
  "UAE",
  "United Arab Emirates",
  "Saudi Arabia",
  "Qatar",
  "Oman",
  "Kuwait",
  "Bahrain",
  "Jordan",
  "Iraq",
  "Iran",
  "Russia",
  "Ukraine",
  "Middle East",
  "Africa",
  "Brazil",
  "Nigeria",
  "Kenya",
  "South Africa",
  "Egypt",
  "Morocco",
  "Ghana",
  "Tanzania",
  "United States",
  "United Kingdom",
  "Germany",
  "Poland",
  "India",
  "Indonesia",
  "Philippines",
  "Mexico",
  "Chile",
  "Colombia",
  "Peru",
  "Argentina",
  "Italy",
  "Ireland",
  "Bulgaria"
];

const searchTargetMarketExpansions: Record<string, string[]> = {
  "middle east": [
    "UAE",
    "Saudi Arabia",
    "Qatar",
    "Oman",
    "Kuwait",
    "Bahrain",
    "Jordan",
    "Iraq",
    "Iran"
  ],
  mena: [
    "UAE",
    "Saudi Arabia",
    "Qatar",
    "Oman",
    "Kuwait",
    "Bahrain",
    "Jordan",
    "Iraq",
    "Iran",
    "Egypt",
    "Morocco"
  ],
  gcc: ["UAE", "Saudi Arabia", "Qatar", "Oman", "Kuwait", "Bahrain"],
  africa: ["Nigeria", "Kenya", "South Africa", "Egypt", "Morocco", "Ghana", "Tanzania"],
  "north africa": ["Egypt", "Morocco", "Algeria", "Tunisia"],
  europe: [
    "Germany",
    "United Kingdom",
    "France",
    "Italy",
    "Spain",
    "Poland",
    "Netherlands",
    "Romania",
    "Ukraine"
  ],
  "latin america": [
    "Brazil",
    "Mexico",
    "Chile",
    "Colombia",
    "Peru",
    "Argentina",
    "Ecuador",
    "Costa Rica"
  ],
  latam: ["Brazil", "Mexico", "Chile", "Colombia", "Peru", "Argentina", "Ecuador", "Costa Rica"],
  americas: [
    "United States",
    "Canada",
    "Mexico",
    "Brazil",
    "Chile",
    "Colombia",
    "Peru",
    "Argentina"
  ],
  "north america": ["United States", "Canada", "Mexico"],
  asia: [
    "UAE",
    "Saudi Arabia",
    "Qatar",
    "India",
    "Pakistan",
    "Bangladesh",
    "Indonesia",
    "Vietnam",
    "Malaysia",
    "Philippines",
    "Thailand",
    "Kazakhstan",
    "Uzbekistan"
  ],
  "southeast asia": [
    "Indonesia",
    "Vietnam",
    "Malaysia",
    "Philippines",
    "Thailand",
    "Singapore",
    "Cambodia"
  ],
  "south asia": ["India", "Pakistan", "Bangladesh", "Sri Lanka", "Nepal"],
  "central asia": ["Kazakhstan", "Uzbekistan", "Kyrgyzstan", "Tajikistan", "Turkmenistan"],
  oceania: ["Australia", "New Zealand", "Papua New Guinea"]
};

type LangGraphCheckpointStore = (typeof LANGGRAPH_CHECKPOINT_STORE_VALUES)[number];
type LangGraphCheckpointer = MemorySaver | PostgresSaver;

function resolveLangGraphCheckpointStore(): LangGraphCheckpointStore {
  const configured = process.env.LANGGRAPH_CHECKPOINT_STORE?.trim().toLowerCase();
  if (configured) {
    if (LANGGRAPH_CHECKPOINT_STORE_VALUES.includes(configured as LangGraphCheckpointStore)) {
      return configured as LangGraphCheckpointStore;
    }

    throw new Error(
      `LANGGRAPH_CHECKPOINT_STORE must be one of: ${LANGGRAPH_CHECKPOINT_STORE_VALUES.join(", ")}`
    );
  }

  return process.env.NODE_ENV === "test" ? "memory" : "postgres";
}

function createLangGraphCheckpointer(store: LangGraphCheckpointStore): LangGraphCheckpointer {
  if (store === "memory") {
    return new MemorySaver();
  }

  const { connectionString, schema } = resolvePostgresCheckpointSettings();
  return PostgresSaver.fromConnString(connectionString, { schema });
}

function resolvePostgresCheckpointSettings() {
  const rawConnectionString =
    process.env.LANGGRAPH_CHECKPOINT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!rawConnectionString) {
    throw new Error("DATABASE_URL is required when LANGGRAPH_CHECKPOINT_STORE=postgres");
  }

  const url = new URL(rawConnectionString);
  const schema =
    process.env.LANGGRAPH_CHECKPOINT_SCHEMA ?? url.searchParams.get("schema") ?? "public";
  url.searchParams.delete("schema");

  return {
    connectionString: url.toString(),
    schema
  };
}

@Injectable()
export class AgentWorkflowService implements OnModuleInit, OnModuleDestroy {
  private readonly graphCheckpointStore = resolveLangGraphCheckpointStore();
  private readonly graphCheckpointer = createLangGraphCheckpointer(this.graphCheckpointStore);
  private graphCheckpointerSetup?: Promise<void>;
  private readonly autonomousTaskIds = new Set<string>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(BraveSearchService)
    private readonly braveSearchService?: BraveSearchService,
    @Optional()
    @Inject(LeadQualificationService)
    private readonly leadQualificationService?: LeadQualificationService,
    @Optional()
    @Inject(WebsiteContentService)
    private readonly websiteContentService?: WebsiteContentService,
    @Optional()
    @Inject(LeadHuntAiService)
    private readonly leadHuntAiService?: LeadHuntAiService
  ) {}

  async onModuleInit() {
    await this.ensureGraphCheckpointerReady();
    if (!shouldPlanTaskInline()) {
      void this.recoverRunningLeadDiscoveryTasks().catch((error) => {
        console.warn("LeadHunt running task recovery failed", searchErrorMessage(error));
      });
    }
  }

  async onModuleDestroy() {
    await this.closeGraphCheckpointer();
  }

  private async getGraphCheckpointer() {
    await this.ensureGraphCheckpointerReady();

    return this.graphCheckpointer;
  }

  private async ensureGraphCheckpointerReady() {
    if (this.graphCheckpointStore === "memory") {
      return;
    }

    const checkpointer = this.graphCheckpointer as PostgresSaver;
    this.graphCheckpointerSetup ??= checkpointer.setup().catch((error) => {
      this.graphCheckpointerSetup = undefined;
      throw error;
    });

    await this.graphCheckpointerSetup;
  }

  private async closeGraphCheckpointer() {
    if ("end" in this.graphCheckpointer && typeof this.graphCheckpointer.end === "function") {
      await this.graphCheckpointer.end();
    }
  }

  async createTaskWithTimeline(userId: string, input: CreateTaskInput) {
    if (shouldPlanTaskInline()) {
      const context = await this.buildTaskContext(userId, input);
      const task = await this.prisma.leadTask.create({
        data: {
          userId,
          status: "running",
          targetCount: input.targetCount ?? DEFAULT_SEARCH_QUERY_COUNT,
          inputPayload: toJsonValue({
            ...input,
            ...context
          }) as Prisma.InputJsonValue
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
        targetCount: input.targetCount ?? DEFAULT_SEARCH_QUERY_COUNT,
        inputPayload: input
      }
    });
    const steps = await this.createTimeline(task.id);

    if (!shouldPlanTaskInline()) {
      this.startAutonomousLeadDiscovery(userId, task.id, input);

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
    await this.markStepRunning(taskId, "load_task");
    const context = await this.buildTaskContext(userId, input, taskId);
    await this.prisma.leadTask.update({
      where: { id: taskId },
      data: {
        status: "running",
        inputPayload: toJsonValue({
          ...input,
          ...context
        }) as Prisma.InputJsonValue
      }
    });
    const workflow = await this.runSemiManagedWorkflowToSearchPlan(taskId, input, context);

    return { context, workflow };
  }

  private startAutonomousLeadDiscovery(
    userId: string,
    taskId: string,
    input: CreateTaskInput,
    options: { skipPlanning?: boolean } = {}
  ) {
    if (this.autonomousTaskIds.has(taskId)) {
      return;
    }

    this.autonomousTaskIds.add(taskId);
    void this.runAutonomousLeadDiscovery(userId, taskId, input, options)
      .catch(async (error) => {
        const hasQueries = await this.prisma.searchQuery
          .count({ where: { taskId } })
          .then((count) => count > 0)
          .catch(() => false);
        if (hasQueries) {
          await this.markAutonomousDiscoveryFailed(taskId, error, "brave_search");
        } else {
          await this.markPlanningWorkflowFailed(taskId, error);
        }
      })
      .finally(() => {
        this.autonomousTaskIds.delete(taskId);
      });
  }

  private async recoverRunningLeadDiscoveryTasks() {
    if (!this.braveSearchService || !this.leadQualificationService) {
      return;
    }

    const updatedAfter = new Date(Date.now() - RUNNING_TASK_RECOVERY_WINDOW_HOURS * 60 * 60 * 1000);
    const tasks = await this.prisma.leadTask.findMany({
      where: {
        status: "running",
        updatedAt: { gte: updatedAfter }
      },
      select: {
        id: true,
        userId: true,
        targetCount: true,
        inputPayload: true,
        _count: {
          select: {
            searchQueries: true
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: RUNNING_TASK_RECOVERY_LIMIT
    });

    for (const task of tasks) {
      const input = createTaskInputFromPayload(task.inputPayload, task.targetCount ?? undefined);
      if (!input) {
        await this.markAutonomousDiscoveryFailed(
          task.id,
          "Cannot recover task without prompt",
          "plan_search_queries"
        );
        continue;
      }

      this.startAutonomousLeadDiscovery(task.userId, task.id, input, {
        skipPlanning: task._count.searchQueries > 0
      });
    }
  }

  private async runAutonomousLeadDiscovery(
    userId: string,
    taskId: string,
    input: CreateTaskInput,
    options: { skipPlanning?: boolean } = {}
  ) {
    let hasSearchPlan = Boolean(options.skipPlanning);

    try {
      if (options.skipPlanning) {
        const queryCount = await this.prisma.searchQuery.count({ where: { taskId } });
        await this.markStepCompleted(taskId, "plan_search_queries", {
          recovered: true,
          queryCount
        });
      } else {
        const { workflow } = await this.planTaskSearchQueries(userId, taskId, input);
        if (workflow.status === "failed") {
          return;
        }
        hasSearchPlan = true;
      }

      await this.resetStaleRunningSearchQueries(taskId);
      let searchResult = await this.executeBraveSearchBatchForTask(userId, taskId, {
        limit: FIRST_STAGE_SEARCH_QUERY_LIMIT
      });
      let qualityGateOutput: Record<string, unknown> | null = null;
      if (!searchResult.ok) {
        await this.prisma.leadTask.update({
          where: { id: taskId },
          data: { status: "failed" }
        });
        return;
      }

      const qualityGate = await this.evaluateFirstStageSearchQuality(taskId);
      if (qualityGate.shouldStop) {
        const qualityGatePreservation = await this.preservePendingQueriesAfterQualityGate(
          taskId,
          qualityGate
        );
        searchResult = {
          ...searchResult,
          hasMore: qualityGatePreservation.remainingQueries > 0,
          remainingQueries: qualityGatePreservation.remainingQueries
        };
        qualityGateOutput = {
          ...qualityGate,
          action: qualityGatePreservation.action,
          qualityGatePreservation
        };
        await this.markStepCompleted(taskId, "brave_search", {
          ...searchResult,
          qualityGate: qualityGateOutput
        });
      }

      while (searchResult.hasMore) {
        searchResult = await this.executeBraveSearchBatchForTask(userId, taskId, {
          limit: FIRST_STAGE_SEARCH_QUERY_LIMIT
        });
        if (!searchResult.ok) {
          await this.prisma.leadTask.update({
            where: { id: taskId },
            data: { status: "failed" }
          });
          return;
        }
      }
      if (qualityGateOutput) {
        await this.markStepCompleted(taskId, "brave_search", {
          ...searchResult,
          qualityGate: qualityGateOutput
        });
      }

      const pausedWorkflow = await this.pauseWorkflowAt(taskId, "human_approval");
      await this.prisma.leadTask.update({
        where: { id: taskId },
        data: { status: "paused" }
      });
      await this.persistWorkflowSnapshot(taskId, pausedWorkflow, "search-to-email");
    } catch (error) {
      if (!hasSearchPlan) {
        await this.markPlanningWorkflowFailed(taskId, error);
        return;
      }

      await this.markAutonomousDiscoveryFailed(taskId, error, "brave_search");
    }
  }

  private resetStaleRunningSearchQueries(taskId: string) {
    return this.prisma.searchQuery.updateMany({
      where: {
        taskId,
        executionStatus: "running"
      },
      data: {
        executionStatus: "pending"
      }
    });
  }

  private async markPlanningWorkflowFailed(taskId: string, error: unknown) {
    const message = searchErrorMessage(error);
    const results = await Promise.allSettled([
      this.markStepFailed(taskId, "plan_search_queries", message),
      this.prisma.leadTask.update({
        where: { id: taskId },
        data: { status: "failed" }
      })
    ]);
    await this.persistWorkflowSnapshot(
      taskId,
      this.workflowFailedState("plan_search_queries", message) as LeadHuntWorkflowState,
      "planning"
    ).catch((snapshotError) => {
      console.warn(
        "LeadHunt planning failure snapshot update failed",
        searchErrorMessage(snapshotError)
      );
    });
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      console.warn(
        "LeadHunt planning failure status update failed",
        searchErrorMessage(failed.reason),
        "original:",
        message
      );
    }
  }

  private async markAutonomousDiscoveryFailed(
    taskId: string,
    error: unknown,
    nodeName: Extract<LeadHuntWorkflowNode, "plan_search_queries" | "brave_search">
  ) {
    const message = searchErrorMessage(error);
    await Promise.all([
      this.markStepFailed(taskId, nodeName, message),
      this.prisma.leadTask.update({
        where: { id: taskId },
        data: { status: "failed" }
      })
    ]);
    await this.persistWorkflowSnapshot(
      taskId,
      this.workflowFailedState(nodeName, message) as LeadHuntWorkflowState,
      nodeName === "plan_search_queries" ? "planning" : "search-to-email"
    ).catch((snapshotError) => {
      console.warn(
        "LeadHunt discovery failure snapshot update failed",
        searchErrorMessage(snapshotError)
      );
    });
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
          targetCount: input.targetCount ?? DEFAULT_SEARCH_QUERY_COUNT,
          hasProductProfile: Boolean(context.productProfile),
          hasCustomerProfile: Boolean(context.customerProfile)
        }),
      analyze_product_profile: () =>
        this.completeWorkflowStep(
          taskId,
          "analyze_product_profile",
          context.productProfileAnalysis
        ),
      analyze_customer_profile: () =>
        this.completeWorkflowStep(
          taskId,
          "analyze_customer_profile",
          context.customerProfileAnalysis
        ),
      expand_keywords: () =>
        this.completeWorkflowStep(taskId, "expand_keywords", {
          keywordGroups: context.keywordGroups,
          profileSignals: context.profileSignals
        }),
      plan_search_queries: () =>
        this.completeWorkflowStep(taskId, "plan_search_queries", async () => {
          const existingCount = await this.prisma.searchQuery.count({ where: { taskId } });
          if (existingCount === 0) {
            if (context.searchQueries.length < MIN_EXECUTABLE_GPT_SEARCH_QUERY_COUNT) {
              throw new Error(
                `GPT-5.5 search plan produced ${context.searchQueries.length} executable queries; at least ${MIN_EXECUTABLE_GPT_SEARCH_QUERY_COUNT} are required. No deterministic fallback queries were added.`
              );
            }
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
            createdCount: existingCount === 0 ? context.searchQueries.length : 0,
            aiPlanning: context.profileSignals.aiPlanning ?? null
          };
        })
    };
    const workflow = (await createLeadHuntWorkflowGraph({
      handlers,
      stopAfter: "plan_search_queries",
      checkpointer: await this.getGraphCheckpointer()
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
        const resume = await this.interruptWorkflowAt<EmailReviewResume>(
          taskId,
          "wait_email_confirmation",
          {
            type: "email_confirmation",
            taskId,
            draftCount,
            message: "Confirm the outreach email before sending or saving it."
          }
        );
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
      checkpointer: await this.getGraphCheckpointer()
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
          AND lead_candidates.status IN ('review', 'qualified', 'approved', 'contacted', 'email_sent')
          AND lead_candidates.country_confidence IN ('high', 'medium')
          AND lead_candidates.country_conflict = false
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
      select: {
        id: true,
        userId: true,
        mode: true,
        status: true,
        targetCount: true,
        inputPayload: true,
        createdAt: true,
        updatedAt: true,
        agentSteps: {
          select: {
            id: true,
            taskId: true,
            nodeName: true,
            status: true,
            input: true,
            output: true,
            error: true,
            startedAt: true,
            endedAt: true,
            createdAt: true
          },
          orderBy: { createdAt: "asc" }
        },
        searchQueries: {
          select: {
            id: true,
            taskId: true,
            provider: true,
            operatorSource: true,
            executionStatus: true,
            operatorName: true,
            strategyTemplate: true,
            query: true,
            keywordGroups: true,
            country: true,
            resultCount: true,
            qualifiedCount: true,
            effectivenessScore: true,
            createdAt: true,
            searchResults: {
              select: {
                id: true,
                title: true,
                url: true,
                snippet: true,
                domain: true,
                createdAt: true
              },
              orderBy: { createdAt: "asc" },
              take: 8
            }
          },
          orderBy: { createdAt: "asc" }
        },
        leadCandidates: {
          select: {
            id: true,
            taskId: true,
            companyName: true,
            website: true,
            country: true,
            queryCountry: true,
            inferredCountry: true,
            countryEvidence: true,
            countryConfidence: true,
            countryConflict: true,
            sourceUrl: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            contacts: {
              select: {
                id: true,
                type: true,
                value: true,
                sourceUrl: true,
                createdAt: true
              },
              orderBy: { createdAt: "asc" },
              take: 24
            },
            icpScore: {
              select: {
                id: true,
                score: true,
                grade: true,
                reasons: true,
                createdAt: true
              }
            },
            crmLead: {
              select: {
                id: true,
                stage: true
              }
            },
            followupTasks: {
              select: {
                id: true,
                type: true,
                status: true,
                dueAt: true,
                note: true
              },
              orderBy: { dueAt: "asc" },
              take: 5
            },
            outreachDrafts: {
              select: {
                id: true,
                status: true,
                subject: true,
                createdAt: true,
                updatedAt: true,
                sendLogs: {
                  select: {
                    id: true,
                    status: true,
                    sentAt: true,
                    createdAt: true
                  },
                  orderBy: { createdAt: "desc" },
                  take: 3
                }
              },
              orderBy: { createdAt: "desc" },
              take: 3
            }
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!task) {
      throw new NotFoundException("Lead task not found");
    }

    return compactTaskForClient(task);
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
        const resume = await this.interruptWorkflowAt<EmailReviewResume>(
          taskId,
          "wait_email_confirmation",
          {
            type: "email_confirmation",
            taskId,
            draftCount,
            message: "Confirm the outreach email before sending or saving it."
          }
        );
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
      checkpointer: await this.getGraphCheckpointer()
    }).invoke(
      createInitialWorkflowState(taskId) as Record<string, unknown>,
      this.workflowConfig(taskId, "search-to-email")
    )) as LeadHuntWorkflowState;

    await this.updateTaskStatusFromWorkflow(taskId, workflow);
    await this.persistWorkflowSnapshot(taskId, workflow, "search-to-email");
    const searchResult = graphRun.getSearchResult();

    return (
      searchResult ?? {
        ok: false,
        executedQueries: 0,
        resultCount: 0,
        createdCandidates: 0,
        skippedCandidates: 0,
        errors: [{ queryId: taskId, message: workflow.error ?? "Search workflow did not run" }],
        hasMore: false,
        remainingQueries: 0
      }
    );
  }

  private async executeBraveSearchBatchForTask(
    userId: string,
    taskId: string,
    input: { limit?: number } = {}
  ) {
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
          ...(queryLimit ? { take: queryLimit } : {})
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
    await this.touchRunningTask(taskId);
    const payload = parseTaskPayload(task.inputPayload);
    const criteria = buildIcpCriteria(payload);
    const candidateAiEvaluator = this.createCandidateAiEvaluator(payload);
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
        await this.prisma.searchQuery.update({
          where: { id: query.id },
          data: {
            executionStatus: "running",
            resultCount: 0,
            qualifiedCount: 0
          }
        });
        const search = await this.runSearchWithDevelopmentFallback(
          query.id,
          searchParams,
          query.country
        );
        await this.prisma.searchQuery.update({
          where: { id: query.id },
          data: {
            resultCount: search.count
          }
        });
        const candidateResults = search.results.slice(0, MAX_CANDIDATE_RESULTS_PER_QUERY);
        const saved = candidateAiEvaluator
          ? await this.leadQualificationService.saveCandidates(
              taskId,
              candidateResults,
              criteria,
              query.country ?? undefined,
              candidateAiEvaluator
            )
          : await this.leadQualificationService.saveCandidates(
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
        await this.touchRunningTask(taskId);
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
        await this.touchRunningTask(taskId);
        continue;
      }
    }

    const remainingQueries = await this.countPendingSearchQueries(taskId);
    const hasMore = remainingQueries > 0;

    if (failedQueries === task.searchQueries.length) {
      await this.markStepFailed(
        taskId,
        "brave_search",
        searchErrors[0]?.message ?? "All Brave searches failed"
      );

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

    const queryStats = await this.aggregateSearchQueryStats(taskId, {
      executedQueries: task.searchQueries.length,
      successfulQueries: task.searchQueries.length - failedQueries,
      failedQueries,
      resultCount,
      hasMore,
      remainingQueries
    });

    await this.markStepCompleted(taskId, "brave_search", {
      executedQueries: queryStats.executedQueries,
      successfulQueries: queryStats.successfulQueries,
      failedQueries: queryStats.failedQueries,
      resultCount: queryStats.resultCount,
      fallback: usedDevelopmentFallback,
      hasMore: queryStats.hasMore,
      remainingQueries: queryStats.remainingQueries
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
      executedQueries: queryStats.executedQueries,
      successfulQueries: queryStats.successfulQueries,
      failedQueries: queryStats.failedQueries,
      resultCount: queryStats.resultCount,
      createdCandidates,
      skippedCandidates,
      fallback: usedDevelopmentFallback,
      errors: searchErrors,
      hasMore: queryStats.hasMore,
      remainingQueries: queryStats.remainingQueries
    };
  }

  private async aggregateSearchQueryStats(
    taskId: string,
    fallback: {
      executedQueries: number;
      successfulQueries: number;
      failedQueries: number;
      resultCount: number;
      hasMore: boolean;
      remainingQueries: number;
    }
  ) {
    const queries = await this.prisma.searchQuery.findMany({
      where: { taskId },
      select: {
        executionStatus: true,
        resultCount: true
      }
    });

    if (!queries.length) {
      return fallback;
    }

    const completedQueries = queries.filter((query) => query.executionStatus === "completed");
    const failedQueries = queries.filter((query) => query.executionStatus === "failed");
    const remainingQueries = queries.filter(
      (query) => query.executionStatus === "pending" || query.executionStatus === "running"
    );

    return {
      executedQueries: completedQueries.length + failedQueries.length,
      successfulQueries: completedQueries.length,
      failedQueries: failedQueries.length,
      resultCount: Math.max(
        queries.reduce((sum, query) => sum + (query.resultCount ?? 0), 0),
        fallback.resultCount
      ),
      hasMore: remainingQueries.length > 0,
      remainingQueries: remainingQueries.length
    };
  }

  private async evaluateFirstStageSearchQuality(taskId: string) {
    const [task, candidates, executedQueryCount] = await Promise.all([
      this.prisma.leadTask.findUnique({
        where: { id: taskId },
        select: { inputPayload: true }
      }),
      this.prisma.leadCandidate.findMany({
        where: { taskId },
        select: {
          status: true,
          country: true,
          countryConfidence: true,
          countryConflict: true
        }
      }),
      this.prisma.searchQuery.count({
        where: {
          taskId,
          executionStatus: { in: ["completed", "failed"] }
        }
      })
    ]);
    const criteria = buildIcpCriteria(parseTaskPayload(task?.inputPayload ?? null));
    const targetRegions = criteria.targetRegions;
    const totalCandidates = candidates.length;
    const mainCandidates = candidates.filter((candidate) =>
      isMainCandidateStatus(candidate.status)
    ).length;
    const rejectedCandidates = candidates.filter(
      (candidate) => candidate.status === "rejected"
    ).length;
    const countryIssueCandidates = candidates.filter(
      (candidate) =>
        candidate.status === "needs_country_review" ||
        candidate.status === "country_conflict_review" ||
        candidate.countryConflict ||
        !candidate.country ||
        candidate.countryConfidence === "low" ||
        candidate.countryConfidence === "unknown" ||
        (targetRegions.length > 0 &&
          candidate.country &&
          !countryMatchesAnyTarget(candidate.country, targetRegions))
    ).length;
    const rejectedRatio = ratio(rejectedCandidates, totalCandidates);
    const countryIssueRatio = ratio(countryIssueCandidates, totalCandidates);
    const shouldStop =
      executedQueryCount >= FIRST_STAGE_SEARCH_QUERY_LIMIT &&
      totalCandidates >= 10 &&
      ((mainCandidates < 1 && rejectedRatio >= 0.85) ||
        countryIssueRatio >= 0.4 ||
        rejectedRatio >= 0.9);
    const reasons = [
      ...(mainCandidates < 1 && rejectedRatio >= 0.85
        ? ["review_plus_under_1_and_rejected_ratio_high"]
        : []),
      ...(countryIssueRatio >= 0.4 ? ["country_issue_ratio_high"] : []),
      ...(rejectedRatio >= 0.9 ? ["rejected_ratio_high"] : [])
    ];

    return {
      phase: "first_15_queries",
      shouldStop,
      executedQueryCount,
      totalCandidates,
      mainCandidates,
      rejectedCandidates,
      countryIssueCandidates,
      rejectedRatio,
      countryIssueRatio,
      reasons
    };
  }

  private async preservePendingQueriesAfterQualityGate(
    taskId: string,
    qualityGate: { reasons: string[]; executedQueryCount: number }
  ) {
    const task = await this.prisma.leadTask.findUnique({
      where: { id: taskId },
      select: {
        inputPayload: true,
        searchQueries: {
          select: {
            query: true,
            provider: true,
            operatorSource: true,
            executionStatus: true,
            operatorName: true,
            strategyTemplate: true,
            keywordGroups: true,
            country: true,
            effectivenessScore: true
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!task) {
      throw new NotFoundException("Lead task not found");
    }

    const pendingQueries = task.searchQueries.filter(
      (query) => query.executionStatus === "pending"
    );
    const remainingQueries = await this.countPendingSearchQueries(taskId);
    await this.updateTaskPayloadAfterQualityGatePreservation(taskId, task.inputPayload, {
      pendingQueries: pendingQueries.map((query) => ({
        query: query.query,
        country: query.country,
        strategyTemplate: query.strategyTemplate,
        operatorName: query.operatorName
      })),
      qualityGate,
      remainingQueries
    });

    return {
      action: "preserved_pending_queries_after_quality_gate",
      rewrittenCount: 0,
      removedPendingCount: 0,
      preservedPendingCount: pendingQueries.length,
      remainingQueries,
      reasons: qualityGate.reasons,
      countries: uniqueStrings(pendingQueries.map((query) => query.country ?? "").filter(Boolean)),
      sampleQueries: pendingQueries.slice(0, 5).map((query) => query.query)
    };
  }

  private async updateTaskPayloadAfterQualityGatePreservation(
    taskId: string,
    inputPayload: Prisma.JsonValue | null,
    fallback: {
      pendingQueries: Array<{
        query: string;
        country: string | null;
        strategyTemplate: string | null;
        operatorName: string | null;
      }>;
      qualityGate: { reasons: string[]; executedQueryCount: number };
      remainingQueries: number;
    }
  ) {
    const payloadObject = toPlainObject(inputPayload);
    const profileSignals = toPlainObject(payloadObject.profileSignals);

    await this.prisma.leadTask.update({
      where: { id: taskId },
      data: {
        inputPayload: toJsonValue({
          ...payloadObject,
          profileSignals: {
            ...profileSignals,
            qualityGate: {
              action: "preserved_pending_queries_after_quality_gate",
              reasons: fallback.qualityGate.reasons,
              executedQueryCount: fallback.qualityGate.executedQueryCount,
              pendingQueryCount: fallback.pendingQueries.length,
              remainingQueries: fallback.remainingQueries,
              samplePendingQueries: fallback.pendingQueries.slice(0, 10)
            },
            qualityFallbackSuggestion: null
          }
        }) as Prisma.InputJsonValue
      }
    });
  }

  private countPendingSearchQueries(taskId: string) {
    return this.prisma.searchQuery.count({
      where: {
        taskId,
        executionStatus: "pending"
      }
    });
  }

  private async touchRunningTask(taskId: string) {
    await this.prisma.leadTask.update({
      where: { id: taskId },
      data: { status: "running" }
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
    const sent = drafts
      .flatMap((draft) => draft.sendLogs)
      .filter((log) => log.status === "sent" || log.sentAt);
    const crmSynced = task.leadCandidates.filter((lead) => lead.crmLead).length;
    const followups = task.leadCandidates
      .flatMap((lead) => lead.followupTasks)
      .filter((followup) => followup.status === "pending");
    const topMarkets = topValues(
      task.leadCandidates
        .map((lead) => lead.country)
        .filter((value): value is string => Boolean(value))
    );
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
        followups.length
          ? `按计划处理 ${followups.length} 个待跟进提醒`
          : "发送后为无回复客户创建 3 天后跟进提醒",
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

  async approveCandidatesForUser(
    userId: string,
    taskId: string,
    input: { leadIds?: string[] } = {}
  ) {
    const graphRun = this.createSearchToEmailGraphHandlers(userId, taskId);

    try {
      const workflow = (await createLeadHuntWorkflowGraph({
        startAt: "brave_search",
        handlers: graphRun.handlers,
        checkpointer: await this.getGraphCheckpointer()
      }).invoke(
        new Command({ resume: { leadIds: input.leadIds, approvedBy: userId } }),
        this.workflowConfig(taskId, "search-to-email")
      )) as LeadHuntWorkflowState;

      await this.updateTaskStatusFromWorkflow(taskId, workflow);
      await this.persistWorkflowSnapshot(taskId, workflow, "search-to-email");
      const approvalResult = graphRun.getApprovalResult();
      if (!approvalResult) {
        throw new Error(
          workflow.error ?? "Lead approval graph did not resume from a pending review"
        );
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

  private async approveCandidatesWithLegacyGraph(
    userId: string,
    taskId: string,
    input: { leadIds?: string[] } = {}
  ) {
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
    const eligibleCandidates = task.leadCandidates.filter(
      (candidate) =>
        isMainCandidateStatus(candidate.status) &&
        (candidate.icpScore?.score ?? 0) >= 50 &&
        (candidate.countryConfidence === "high" || candidate.countryConfidence === "medium") &&
        !candidate.countryConflict
    );
    const selected = requestedIds.length
      ? task.leadCandidates.filter((candidate) => requestedIds.includes(candidate.id))
      : eligibleCandidates
          .filter((candidate) => (candidate.icpScore?.score ?? 0) >= 80)
          .slice(0, 10);

    if (requestedIds.length && selected.length !== requestedIds.length) {
      throw new BadRequestException("Some candidates do not belong to this task");
    }

    if (
      selected.some(
        (candidate) => !eligibleCandidates.some((eligible) => eligible.id === candidate.id)
      )
    ) {
      throw new BadRequestException(
        "Only country-verified review or qualified candidates can be approved"
      );
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

  markStepCompleted(
    taskId: string,
    nodeName: LeadHuntWorkflowNode,
    output: Record<string, unknown> = {}
  ) {
    return this.updateStep(taskId, nodeName, "completed", {
      output,
      endedAt: new Date(),
      error: null
    });
  }

  pauseAtHumanApproval(
    taskId: string,
    nodeName: Extract<LeadHuntWorkflowNode, "human_approval" | "wait_email_confirmation">
  ) {
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
    output:
      | Record<string, unknown>
      | (() => Record<string, unknown> | Promise<Record<string, unknown>>)
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
      taskId,
      status: "paused" as const,
      currentNode: nodeName,
      pausedAt: nodeName,
      steps: [this.workflowStep(nodeName, "waiting", { waitingForHuman: true })],
      error: null
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

  private workflowFailedState(
    nodeName: LeadHuntWorkflowNode,
    error: string
  ): Partial<LeadHuntWorkflowState> {
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
    if (
      workflow.status !== "paused" &&
      workflow.status !== "failed" &&
      workflow.status !== "completed"
    ) {
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

  private async persistWorkflowSnapshot(
    taskId: string,
    workflow: LeadHuntWorkflowState,
    phase: string
  ) {
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

  private async buildTaskContext(userId: string, input: CreateTaskInput, taskId?: string) {
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
    const productProfileUrls = compactStrings([
      product?.websiteUrl,
      product?.productPageUrl,
      ...(product?.documentUrls ?? [])
    ]);
    const referenceCustomerUrls = customer?.referenceCustomerUrls ?? [];
    const siteEvidence =
      (await this.websiteContentService?.readProfileSites({
        productUrls: productProfileUrls,
        referenceCustomerUrls
      })) ?? emptyProfileSiteEvidence();
    const siteKeywordHints = collectSiteKeywordHints(siteEvidence);
    const ruleProductProfileAnalysis = buildProductProfileAnalysis(
      product,
      siteEvidence.productSites
    );
    const ruleCustomerProfileAnalysis = buildCustomerProfileAnalysis(
      customer,
      siteEvidence.referenceCustomerSites
    );
    const marketSelection = resolveTargetMarketSelection(input.prompt, customer?.targetRegions);
    const targetMarkets = marketSelection.targetMarkets;
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
      customerProfileNotes: buildEvidenceNotes(
        customer?.notes,
        siteEvidence.referenceCustomerSites
      ),
      targetMarkets,
      productTerms: siteKeywordHints.productTerms,
      customerIntentTerms: siteKeywordHints.customerIntentTerms,
      scenarioTerms: siteKeywordHints.scenarioTerms
    };
    const ruleKeywordGroups = createKeywordGroups({
      ...profileKeywordInput
    });
    const aiPlanning = await this.buildAiPlanningContext({
      taskId,
      input,
      product,
      customer,
      siteEvidence,
      profileKeywordInput,
      ruleProductProfileAnalysis,
      ruleCustomerProfileAnalysis,
      ruleKeywordGroups,
      targetMarkets
    });
    const productProfileAnalysis = aiPlanning.productProfileAnalysis;
    const customerProfileAnalysis = aiPlanning.customerProfileAnalysis;
    const keywordGroups = aiPlanning.keywordGroups;
    const searchQueries = aiPlanning.searchQueries;

    return {
      productProfile: product,
      customerProfile: customer,
      productProfileAnalysis,
      customerProfileAnalysis,
      siteEvidence,
      profileSignals: {
        productUrlsUsed: profileKeywordInput.productProfileUrls,
        referenceCustomerUrlsUsed: profileKeywordInput.referenceCustomerUrls ?? [],
        productUrlsRead: siteEvidence.productSites
          .filter((site) => site.status === "read")
          .map((site) => site.finalUrl),
        referenceCustomerUrlsRead: siteEvidence.referenceCustomerSites
          .filter((site) => site.status === "read")
          .map((site) => site.finalUrl),
        failedUrlCount: siteEvidence.summary.failed,
        crmSampleCount: crmSamples.length,
        marketSelection,
        aiPlanning: aiPlanning.profileSignals
      },
      executionPlan: buildExecutionPlan(Boolean(product), Boolean(customer)),
      keywordGroups,
      searchQueries
    };
  }

  private async buildAiPlanningContext(input: {
    taskId?: string;
    input: CreateTaskInput;
    product: {
      websiteUrl?: string | null;
      productPageUrl?: string | null;
      documentUrls?: string[];
      notes?: string | null;
    } | null;
    customer: {
      targetRegions?: string[];
      referenceCustomerUrls?: string[];
      crmSampleIds?: string[];
      notes?: string | null;
    } | null;
    siteEvidence: ProfileSiteEvidence;
    profileKeywordInput: {
      taskText: string;
      productProfileUrls: string[];
      productProfileNotes?: string;
      referenceCustomerUrls: string[];
      crmSampleNames: string[];
      customerProfileNotes?: string;
      targetMarkets?: string[];
      productTerms: string[];
      customerIntentTerms: string[];
      scenarioTerms: string[];
    };
    ruleProductProfileAnalysis: Record<string, unknown>;
    ruleCustomerProfileAnalysis: Record<string, unknown>;
    ruleKeywordGroups: KeywordGroups;
    targetMarkets?: string[];
  }) {
    const fallbackReasons: string[] = [];
    let productProfileAnalysis = input.ruleProductProfileAnalysis;
    let customerProfileAnalysis = input.ruleCustomerProfileAnalysis;
    const channelCustomersRequested = isChannelCustomerRequest(input.input.prompt);
    let keywordGroups = prioritizeKeywordGroupCustomerIntentTerms(
      input.ruleKeywordGroups,
      channelCustomersRequested
    );
    let searchQueries: PlannedSearchQuery[] = [];
    let aiKeywordExpansion: KeywordExpansionResult | null = null;
    let aiQueryCount = 0;
    let gptRefillAttempts = 0;
    let gptRefillAcceptedCount = 0;
    let rejectedAiQueries: Array<{ query: string; country: string; reason: string }> = [];

    if (!this.leadHuntAiService) {
      return {
        productProfileAnalysis,
        customerProfileAnalysis,
        keywordGroups,
        searchQueries,
        profileSignals: {
          enabled: false,
          querySource: "gpt55_unavailable",
          fallbackQueryCount: 0,
          fallbackReasons: ["LeadHuntAiService is required for search planning"]
        }
      };
    }

    const productEvidenceNotes = buildEvidenceNotes(
      input.product?.notes,
      input.siteEvidence.productSites
    );
    const customerEvidenceNotes = buildEvidenceNotes(
      input.customer?.notes,
      input.siteEvidence.referenceCustomerSites
    );

    try {
      await this.markOptionalPlanningStepRunning(input.taskId, "analyze_product_profile");
      if (input.product?.websiteUrl) {
        productProfileAnalysis = await withTimeout(
          this.leadHuntAiService.analyzeProductProfile({
            websiteUrl: input.product.websiteUrl,
            productPageUrl: input.product.productPageUrl,
            documentUrls: input.product.documentUrls ?? [],
            notes: productEvidenceNotes
          }),
          PRODUCT_PROFILE_TIMEOUT_MS,
          "GPT-5.5 product profile analysis"
        );
      } else {
        fallbackReasons.push(
          "No product website URL was saved; product analysis used deterministic evidence."
        );
      }
    } catch (error) {
      fallbackReasons.push(`GPT product analysis failed: ${searchErrorMessage(error)}`);
    } finally {
      await this.markOptionalPlanningStepCompleted(
        input.taskId,
        "analyze_product_profile",
        productProfileAnalysis as Record<string, unknown>
      );
    }

    try {
      await this.markOptionalPlanningStepRunning(input.taskId, "analyze_customer_profile");
      if (
        input.customer?.targetRegions?.length ||
        input.customer?.referenceCustomerUrls?.length ||
        input.customer?.notes
      ) {
        customerProfileAnalysis = await withTimeout(
          this.leadHuntAiService.analyzeCustomerProfile({
            targetRegions: input.targetMarkets?.length
              ? input.targetMarkets
              : (input.customer?.targetRegions ?? ["Global"]),
            referenceCustomerUrls: input.customer?.referenceCustomerUrls ?? [],
            crmSampleIds: input.customer?.crmSampleIds ?? [],
            notes: customerEvidenceNotes
          }),
          CUSTOMER_PROFILE_TIMEOUT_MS,
          "GPT-5.5 customer profile analysis"
        );
      } else {
        fallbackReasons.push(
          "No customer profile was saved; customer analysis used deterministic defaults."
        );
      }
    } catch (error) {
      fallbackReasons.push(`GPT customer analysis failed: ${searchErrorMessage(error)}`);
    } finally {
      await this.markOptionalPlanningStepCompleted(
        input.taskId,
        "analyze_customer_profile",
        customerProfileAnalysis as Record<string, unknown>
      );
    }

    try {
      await this.markOptionalPlanningStepRunning(input.taskId, "expand_keywords");
      aiKeywordExpansion = await withTimeout(
        this.leadHuntAiService.expandKeywords({
          userTask: input.input.prompt,
          productProfile: productProfileAnalysis as ProductProfileAnalysis,
          customerProfile: customerProfileAnalysis as CustomerProfileAnalysis
        }),
        KEYWORD_EXPANSION_TIMEOUT_MS,
        "GPT-5.5 keyword expansion"
      );
      keywordGroups = mergeKeywordGroups(
        keywordGroupsFromAiExpansion(aiKeywordExpansion, input.targetMarkets),
        input.ruleKeywordGroups
      );
      keywordGroups = prioritizeKeywordGroupCustomerIntentTerms(
        keywordGroups,
        channelCustomersRequested
      );
      keywordGroups = constrainKeywordGroupMarkets(keywordGroups, input.targetMarkets);
    } catch (error) {
      fallbackReasons.push(`GPT keyword expansion failed: ${searchErrorMessage(error)}`);
    } finally {
      await this.markOptionalPlanningStepCompleted(input.taskId, "expand_keywords", {
        keywordGroups
      });
    }

    try {
      await this.markOptionalPlanningStepRunning(input.taskId, "plan_search_queries");
      const searchTargetMarkets = input.targetMarkets?.length
        ? input.targetMarkets
        : keywordGroups.marketTerms;
      const searchStrategyInput = buildSearchStrategyInput({
        keywordGroups,
        aiKeywordExpansion,
        productProfileAnalysis: productProfileAnalysis as ProductProfileAnalysis,
        customerProfileAnalysis: customerProfileAnalysis as CustomerProfileAnalysis,
        targetMarkets: searchTargetMarkets,
        operatorLibrary: compactOperatorLibrary(),
        minQueryCount: SEARCH_STRATEGY_INITIAL_QUERY_COUNT
      });
      const searchPlan = await withTimeout(
        this.leadHuntAiService.generateSearchStrategy(searchStrategyInput),
        SEARCH_STRATEGY_TIMEOUT_MS,
        "GPT-5.5 search strategy generation"
      );
      let normalization = normalizeAiSearchPlan(
        searchPlan,
        keywordGroups,
        DEFAULT_SEARCH_QUERY_COUNT,
        searchTargetMarkets,
        channelCustomersRequested
      );
      let aiQueries = limitPlannedSearchQueries(normalization.queries);
      rejectedAiQueries = normalization.rejected;

      while (
        aiQueries.length > 0 &&
        aiQueries.length < DEFAULT_SEARCH_QUERY_COUNT &&
        gptRefillAttempts < SEARCH_STRATEGY_MAX_REFILL_ATTEMPTS
      ) {
        const queryCountBeforeRefill = aiQueries.length;
        gptRefillAttempts += 1;
        try {
          const requiredAdditionalQueries = DEFAULT_SEARCH_QUERY_COUNT - aiQueries.length;
          const refillPlan = await withTimeout(
            this.leadHuntAiService.generateSearchStrategy({
              ...searchStrategyInput,
              minQueryCount: Math.max(
                10,
                Math.min(SEARCH_STRATEGY_INITIAL_QUERY_COUNT, requiredAdditionalQueries)
              ),
              refillContext: {
                requiredAdditionalQueries,
                acceptedQueries: aiQueries.map((query) => ({
                  query: query.query,
                  country: query.country,
                  strategyType: query.strategyType
                })),
                rejectedQueries: rejectedAiQueries
              }
            }),
            SEARCH_STRATEGY_REFILL_TIMEOUT_MS,
            "GPT-5.5 search strategy refill"
          );
          normalization = normalizeAiSearchPlan(
            refillPlan,
            keywordGroups,
            DEFAULT_SEARCH_QUERY_COUNT,
            searchTargetMarkets,
            channelCustomersRequested,
            aiQueries
          );
          aiQueries = limitPlannedSearchQueries(normalization.queries);
          gptRefillAcceptedCount += Math.max(0, aiQueries.length - queryCountBeforeRefill);
          rejectedAiQueries = uniqueRejectedAiQueries([
            ...rejectedAiQueries,
            ...normalization.rejected
          ]);
          if (aiQueries.length <= queryCountBeforeRefill) {
            break;
          }
        } catch (error) {
          fallbackReasons.push(`GPT search refill failed: ${searchErrorMessage(error)}`);
          break;
        }
      }

      aiQueryCount = aiQueries.filter(
        (query) => query.templateId === "gpt55_search_strategy"
      ).length;
      searchQueries = aiQueries;
    } catch (error) {
      fallbackReasons.push(`GPT search strategy failed: ${searchErrorMessage(error)}`);
      searchQueries = [];
    }

    return {
      productProfileAnalysis,
      customerProfileAnalysis,
      keywordGroups,
      searchQueries,
      profileSignals: {
        enabled: true,
        querySource: aiQueryCount ? "gpt55_only" : "gpt55_failed_or_rejected",
        gptSearchQueryCount: aiQueryCount,
        gptRefillAttempts,
        gptRefillAcceptedCount,
        fallbackQueryCount: 0,
        rejectedQueryCount: rejectedAiQueries.length,
        rejectedQueries: rejectedAiQueries,
        fallbackReasons
      }
    };
  }

  private async markOptionalPlanningStepRunning(
    taskId: string | undefined,
    nodeName: LeadHuntWorkflowNode
  ) {
    if (!taskId) {
      return;
    }

    await this.markStepRunning(taskId, nodeName);
  }

  private async markOptionalPlanningStepCompleted(
    taskId: string | undefined,
    nodeName: LeadHuntWorkflowNode,
    output: Record<string, unknown>
  ) {
    if (!taskId) {
      return;
    }

    await this.markStepCompleted(taskId, nodeName, output);
  }

  private createCandidateAiEvaluator(payload: ReturnType<typeof parseTaskPayload>) {
    if (!this.leadHuntAiService) {
      return undefined;
    }

    return async (candidate: {
      companyName: string;
      website: string | null;
      country: string | null;
      sourceUrl: string;
      summary: string | null;
      contacts: Array<{ type: string; value: string }>;
    }): Promise<CandidateBuyerEvaluationResult | null> => {
      try {
        return await this.leadHuntAiService!.evaluateCandidateBuyer({
          candidate: {
            companyName: candidate.companyName,
            websiteUrl: candidate.website ?? candidate.sourceUrl,
            country: candidate.country,
            snippet: candidate.summary,
            sourceUrl: candidate.sourceUrl,
            contacts: {
              emails: candidate.contacts
                .filter((contact) => contact.type === "email")
                .map((contact) => contact.value),
              phones: candidate.contacts
                .filter((contact) => contact.type === "phone")
                .map((contact) => contact.value),
              socialProfiles: candidate.contacts
                .filter((contact) => contact.type === "social")
                .map((contact) => contact.value)
            }
          },
          productProfile: payload.productProfileAnalysis ?? payload.productProfile ?? {},
          customerProfile: payload.customerProfileAnalysis ?? payload.customerProfile ?? {},
          targetRegions: buildIcpCriteria(payload).targetRegions,
          taskContext: typeof payload.prompt === "string" ? payload.prompt : undefined
        });
      } catch {
        return null;
      }
    };
  }
}

function limitPlannedSearchQueries(queries: PlannedSearchQuery[]) {
  return queries.slice(0, DEFAULT_SEARCH_QUERY_COUNT);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function keywordGroupsFromAiExpansion(
  input: KeywordExpansionResult,
  targetMarkets: string[] | undefined
): KeywordGroups {
  const brandTerms = extractKnownBrandTerms([
    ...input.primaryProducts,
    ...input.relatedProducts,
    ...input.longTailProducts
  ]);

  return {
    brandTerms,
    productTerms: uniqueStrings([...input.primaryProducts, ...input.relatedProducts]),
    longTailProductTerms: uniqueStrings(input.longTailProducts),
    customerIntentTerms: uniqueStrings([
      ...input.purchaseIntentTerms,
      ...input.upstreamDownstreamTerms
    ]),
    marketTerms: uniqueStrings([...(targetMarkets ?? []), ...input.targetMarketTerms]),
    scenarioTerms: uniqueStrings(input.industryScenarioTerms),
    excludeTerms: uniqueStrings(input.exclusionTerms)
  };
}

function keywordExpansionFromKeywordGroups(keywordGroups: KeywordGroups): KeywordExpansionResult {
  return {
    primaryProducts: keywordGroups.productTerms.slice(0, 8),
    relatedProducts: keywordGroups.productTerms.slice(8, 24).length
      ? keywordGroups.productTerms.slice(8, 24)
      : keywordGroups.productTerms.slice(0, 8),
    longTailProducts: keywordGroups.longTailProductTerms.slice(0, 20),
    upstreamDownstreamTerms: keywordGroups.scenarioTerms.slice(0, 12),
    purchaseIntentTerms: keywordGroups.customerIntentTerms.slice(0, 20),
    targetMarketTerms: keywordGroups.marketTerms.slice(0, 20),
    industryScenarioTerms: keywordGroups.scenarioTerms.slice(0, 20),
    exclusionTerms: keywordGroups.excludeTerms.slice(0, 20)
  };
}

function buildSearchStrategyInput(input: {
  keywordGroups: KeywordGroups;
  aiKeywordExpansion: KeywordExpansionResult | null;
  productProfileAnalysis: ProductProfileAnalysis;
  customerProfileAnalysis: CustomerProfileAnalysis;
  targetMarkets: string[];
  operatorLibrary: unknown;
  minQueryCount: number;
}): SearchStrategyInput {
  const compactKeywordGroups = compactKeywordExpansionForSearchStrategy(
    input.aiKeywordExpansion ?? keywordExpansionFromKeywordGroups(input.keywordGroups),
    input.keywordGroups
  );

  return {
    keywordGroups: compactKeywordGroups,
    productProfile: compactProductProfileForSearchStrategy(
      input.productProfileAnalysis,
      compactKeywordGroups
    ),
    customerProfile: compactCustomerProfileForSearchStrategy(
      input.customerProfileAnalysis,
      compactKeywordGroups
    ),
    targetMarkets: input.targetMarkets,
    operatorLibrary: input.operatorLibrary,
    minQueryCount: input.minQueryCount
  };
}

function compactKeywordExpansionForSearchStrategy(
  expansion: KeywordExpansionResult,
  keywordGroups: KeywordGroups
): KeywordExpansionResult {
  const productGroups = selectSearchPlanningProductGroups(expansion, keywordGroups);
  const modelTerms = selectSearchPlanningModelTerms(expansion, keywordGroups);
  const scenarioTerms = selectSearchPlanningScenarioTerms(expansion, keywordGroups);
  const buyerTerms = selectSearchPlanningBuyerTerms(expansion, keywordGroups);

  return {
    primaryProducts: ensureNonEmpty(productGroups.slice(0, 8), expansion.primaryProducts),
    relatedProducts: ensureNonEmpty(
      uniqueStrings([...productGroups.slice(8, 14), ...modelTerms.slice(0, 6)]),
      expansion.relatedProducts
    ).slice(0, 14),
    longTailProducts: ensureNonEmpty(modelTerms, expansion.longTailProducts).slice(0, 16),
    upstreamDownstreamTerms: ensureNonEmpty(scenarioTerms, expansion.upstreamDownstreamTerms).slice(
      0,
      12
    ),
    purchaseIntentTerms: ensureNonEmpty(buyerTerms, expansion.purchaseIntentTerms).slice(0, 14),
    targetMarketTerms: ensureNonEmpty(
      uniqueStrings([...keywordGroups.marketTerms, ...expansion.targetMarketTerms]),
      ["UAE"]
    ).slice(0, 8),
    industryScenarioTerms: ensureNonEmpty(scenarioTerms, expansion.industryScenarioTerms).slice(
      0,
      12
    ),
    exclusionTerms: uniqueStrings(expansion.exclusionTerms)
      .filter((term) => isSafeQueryNegativeTerm(term))
      .filter((term) => !isMainCustomerIntelligenceQuery(term))
      .slice(0, 12)
  };
}

function compactProductProfileForSearchStrategy(
  profile: ProductProfileAnalysis,
  keywordGroups: KeywordExpansionResult
): ProductProfileAnalysis {
  return {
    ...profile,
    productCategories: compactStringList(asStringArray(profile.productCategories), 8),
    keyProducts: compactStringList(
      uniqueStrings([
        ...keywordGroups.primaryProducts,
        ...keywordGroups.relatedProducts,
        ...keywordGroups.longTailProducts,
        ...asStringArray(profile.keyProducts)
      ]),
      24
    ),
    targetUseCases: compactStringList(asStringArray(profile.targetUseCases), 10),
    buyerPainPoints: compactStringList(asStringArray(profile.buyerPainPoints), 8),
    supplyCapabilities: compactStringList(asStringArray(profile.supplyCapabilities), 8),
    searchKeywords: compactStringList(
      uniqueStrings([...keywordGroups.primaryProducts, ...keywordGroups.relatedProducts]),
      20
    ),
    negativeKeywords: compactStringList(
      asStringArray(profile.negativeKeywords).filter((term) => isSafeQueryNegativeTerm(term)),
      10
    ),
    evidence: compactStringList(asStringArray(profile.evidence), 6, 180)
  };
}

function compactCustomerProfileForSearchStrategy(
  profile: CustomerProfileAnalysis,
  keywordGroups: KeywordExpansionResult
): CustomerProfileAnalysis {
  return {
    ...profile,
    targetRegions: compactStringList(asStringArray(profile.targetRegions), 8),
    idealCustomerTypes: compactStringList(asStringArray(profile.idealCustomerTypes), 12),
    buyingSignals: compactStringList(asStringArray(profile.buyingSignals), 10, 180),
    referenceCompanies: compactStringList(asStringArray(profile.referenceCompanies), 6),
    industries: compactStringList(asStringArray(profile.industries), 10),
    searchKeywords: compactStringList(
      uniqueStrings([
        ...keywordGroups.purchaseIntentTerms,
        ...keywordGroups.upstreamDownstreamTerms,
        ...asStringArray(profile.searchKeywords)
      ]).filter((term) => !isMainCustomerIntelligenceQuery(term)),
      18
    ),
    disqualifiers: compactStringList(asStringArray(profile.disqualifiers), 10),
    evidence: compactStringList(asStringArray(profile.evidence), 6, 180)
  };
}

function selectSearchPlanningProductGroups(
  expansion: KeywordExpansionResult,
  keywordGroups: KeywordGroups
) {
  const preferred = [
    "5G telecom equipment",
    "RAN equipment",
    "base station equipment",
    "RRU radio unit",
    "remote radio unit",
    "BBU baseband unit",
    "baseband unit",
    "AAU active antenna unit",
    "OLT equipment",
    "rectifier module",
    "telecom power module",
    "SFP optical module",
    "microwave backhaul equipment",
    "DAS equipment",
    "small cell equipment",
    "private 5G equipment",
    "communication cables",
    "telecom boards"
  ];
  const values = uniqueStrings([
    ...preferred,
    ...expansion.primaryProducts,
    ...expansion.relatedProducts,
    ...keywordGroups.productTerms
  ]);

  return values
    .filter((term) => isSearchPlanningProductGroup(term))
    .filter((term) => !isChannelCustomerTerm(term))
    .slice(0, 18);
}

function selectSearchPlanningModelTerms(
  expansion: KeywordExpansionResult,
  keywordGroups: KeywordGroups
) {
  return uniqueStrings([
    ...expansion.longTailProducts,
    ...keywordGroups.longTailProductTerms,
    ...keywordGroups.productTerms
  ])
    .filter((term) => hasSpecificModelOrSkuSignal(term) || /\b(?:huawei|zte|ericsson|nokia|eltek|alcatel-lucent)\b/i.test(term))
    .filter((term) => !isMainCustomerIntelligenceQuery(term))
    .slice(0, 16);
}

function selectSearchPlanningScenarioTerms(
  expansion: KeywordExpansionResult,
  keywordGroups: KeywordGroups
) {
  return uniqueStrings([
    ...expansion.upstreamDownstreamTerms,
    ...expansion.industryScenarioTerms,
    ...keywordGroups.scenarioTerms
  ])
    .filter((term) => !isMainCustomerIntelligenceQuery(term))
    .filter((term) => !/\b(?:procurement|rfq|tender|vendor registration)\b/i.test(term))
    .slice(0, 14);
}

function selectSearchPlanningBuyerTerms(
  expansion: KeywordExpansionResult,
  keywordGroups: KeywordGroups
) {
  return uniqueStrings([...expansion.purchaseIntentTerms, ...keywordGroups.customerIntentTerms])
    .filter((term) => !isMainCustomerIntelligenceQuery(term))
    .filter((term) => !isChannelCustomerTerm(term))
    .filter((term) => !/\b(?:procurement|purchasing|rfq|tender|vendor registration|supplier registration)\b/i.test(term))
    .slice(0, 14);
}

function isSearchPlanningProductGroup(term: string) {
  const normalized = term.trim().toLowerCase();
  if (!normalized || normalized.length > 70 || isMainCustomerIntelligenceQuery(normalized)) {
    return false;
  }

  return (
    hasSpecificIndustryQueryContext(normalized) ||
    /\b(?:huawei|zte|ericsson|nokia|eltek|alcatel-lucent)\b/i.test(normalized)
  );
}

function compactStringList(values: string[], limit: number, maxLength = 90) {
  return uniqueStrings(values)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((value) => (value.length > maxLength ? `${value.slice(0, maxLength).trim()}...` : value))
    .slice(0, limit);
}

function ensureNonEmpty(values: string[], fallback: string[]) {
  return values.length ? values : fallback.slice(0, 1);
}

function mergeKeywordGroups(primary: KeywordGroups, fallback: KeywordGroups): KeywordGroups {
  return {
    brandTerms: uniqueStrings([...primary.brandTerms, ...fallback.brandTerms]),
    productTerms: uniqueStrings([...primary.productTerms, ...fallback.productTerms]),
    longTailProductTerms: uniqueStrings([
      ...primary.longTailProductTerms,
      ...fallback.longTailProductTerms
    ]),
    customerIntentTerms: uniqueStrings([
      ...primary.customerIntentTerms,
      ...fallback.customerIntentTerms
    ]),
    marketTerms: primary.marketTerms.length
      ? uniqueStrings(primary.marketTerms)
      : fallback.marketTerms,
    scenarioTerms: uniqueStrings([...primary.scenarioTerms, ...fallback.scenarioTerms]),
    excludeTerms: uniqueStrings([...primary.excludeTerms, ...fallback.excludeTerms])
  };
}

function prioritizeKeywordGroupCustomerIntentTerms(
  keywordGroups: KeywordGroups,
  channelCustomersRequested: boolean
): KeywordGroups {
  return {
    ...keywordGroups,
    customerIntentTerms: prioritizeCustomerIntentTerms(
      keywordGroups.customerIntentTerms,
      channelCustomersRequested
    )
  };
}

function prioritizeCustomerIntentTerms(terms: string[], channelCustomersRequested: boolean) {
  const uniqueTerms = uniqueStrings(terms);
  if (channelCustomersRequested) {
    return uniqueTerms;
  }

  const primary: string[] = [];
  for (const term of uniqueTerms) {
    if (!isChannelCustomerTerm(term)) {
      primary.push(term);
    }
  }

  return primary;
}

const channelCustomerPattern =
  /\b(channels?|channel partners?|suppliers?|distributors?|stockists?|resellers?|dealers?|wholesale|wholesalers?|importers?)\b|\u7ecf\u9500|\u5206\u9500|\u6e20\u9053|\u5e93\u5b58\u5546|\u4ee3\u7406\u5546|\u8fdb\u53e3\u5546|\u6279\u53d1/i;

function isChannelCustomerRequest(prompt: string) {
  return channelCustomerPattern.test(prompt);
}

function isChannelCustomerTerm(term: string) {
  return channelCustomerPattern.test(term);
}

function isChannelOnlyQuery(query: string) {
  const lower = query.toLowerCase();
  const hasChannel =
    /\b(suppliers?|distributors?|stockists?|resellers?|dealers?|wholesale|wholesalers?|importers?)\b/i.test(
      lower
    );
  if (!hasChannel) {
    return false;
  }

  return !/\b(maintenance|repair|replacement|operation|operations|operator|carrier|isp|wisp|ftth|contractor|integrator|procurement|purchasing|rfq|tender|bid|vendor registration|supplier registration|field services|managed services|o&m)\b/i.test(
    lower
  );
}

function constrainKeywordGroupMarkets(
  keywordGroups: KeywordGroups,
  targetMarkets: string[] | undefined
): KeywordGroups {
  const markets = normalizeTargetMarkets(targetMarkets);
  if (!markets?.length) {
    return keywordGroups;
  }

  return {
    ...keywordGroups,
    marketTerms: markets
  };
}

function compactOperatorLibrary() {
  const library = getSearchStrategyLibrary();
  return {
    version: library.version,
    operators: library.operators
      .filter(
        (operator) =>
          operator.executionStatus === "supported" || operator.executionStatus === "experimental"
      )
      .map(compactStrategyTemplate),
    templates: []
  };
}

function compactStrategyTemplate(template: {
  id: string;
  operatorSource: string;
  executionStatus: string;
  operatorName: string;
  strategyTemplate: string;
  effectivenessScore: number;
}) {
  return {
    id: template.id,
    operatorSource: template.operatorSource,
    executionStatus: template.executionStatus,
    operatorName: template.operatorName,
    strategyTemplate: template.strategyTemplate,
    effectivenessScore: template.effectivenessScore
  };
}

function normalizeAiSearchPlan(
  plan: SearchStrategyPlan,
  keywordGroups: KeywordGroups,
  minQueryCount: number,
  targetMarkets: string[] | undefined,
  channelCustomersRequested = false,
  existingQueries: PlannedSearchQuery[] = []
): {
  queries: PlannedSearchQuery[];
  rejected: Array<{ query: string; country: string; reason: string }>;
} {
  const countryPool = normalizeTargetMarkets(targetMarkets) ??
    normalizeTargetMarkets(keywordGroups.marketTerms) ?? ["UAE"];
  const supportedStatuses = new Set(["supported", "experimental"]);
  const seen = new Set<string>(existingQueries.map((query) => query.query.toLowerCase()));
  const output: PlannedSearchQuery[] = [...existingQueries];
  const rejected: Array<{ query: string; country: string; reason: string }> = [];

  for (const query of [...plan.queries].sort(compareAiSearchQueries)) {
    if (!supportedStatuses.has(query.executionStatus)) {
      rejected.push({
        query: query.query,
        country: query.country,
        reason: `unsupported_execution_status:${query.executionStatus}`
      });
      continue;
    }

    if (!isStrategyTypeWithinBudget(output, query.strategyType, channelCustomersRequested)) {
      rejected.push({
        query: query.query,
        country: query.country,
        reason: `strategy_budget_exceeded:${query.strategyType ?? "unknown"}`
      });
      continue;
    }

    const countryResolution = resolveAiQueryCountry(
      query.country,
      query.query,
      countryPool,
      output.length
    );
    if (!countryResolution.country) {
      rejected.push({
        query: query.query,
        country: query.country,
        reason: countryResolution.reason
      });
      continue;
    }

    const country = countryResolution.country;
    const queryNormalization = normalizeAiQueryText(
      query.query,
      country,
      keywordGroups,
      countryPool
    );
    if (!queryNormalization.query) {
      rejected.push({
        query: query.query,
        country: query.country,
        reason: queryNormalization.reason
      });
      continue;
    }

    const queryText = queryNormalization.query;
    if (!queryText || seen.has(queryText.toLowerCase())) {
      continue;
    }

    if (isMainCustomerIntelligenceQuery(queryText)) {
      rejected.push({
        query: query.query,
        country: query.country,
        reason: "intelligence_query_not_main_customer_search"
      });
      continue;
    }

    if (!hasEnoughQuerySignals(queryText, keywordGroups, country)) {
      rejected.push({
        query: query.query,
        country: query.country,
        reason: "missing_product_customer_or_market_signal"
      });
      continue;
    }

    if (!channelCustomersRequested && isChannelOnlyQuery(queryText)) {
      rejected.push({
        query: query.query,
        country: query.country,
        reason: "channel_query_without_user_request"
      });
      continue;
    }

    seen.add(queryText.toLowerCase());
    output.push({
      provider: "brave",
      operatorSource: query.operatorSource as OperatorSource,
      executionStatus: query.executionStatus as "supported" | "experimental",
      operatorName: "GPT-5.5 buyer-led search",
      strategyTemplate: query.rationale,
      strategyType: query.strategyType ?? null,
      query: queryText,
      keywordGroups,
      country,
      effectivenessScore: Math.max(0.2, 1 - (query.priority - 1) * 0.12),
      templateId: "gpt55_search_strategy"
    });

    if (output.length >= minQueryCount) {
      break;
    }
  }

  return { queries: output, rejected };
}

function uniqueRejectedAiQueries(
  rejected: Array<{ query: string; country: string; reason: string }>
) {
  const seen = new Set<string>();
  const output: Array<{ query: string; country: string; reason: string }> = [];
  for (const item of rejected) {
    const key = `${item.query.toLowerCase()}|${item.country.toLowerCase()}|${item.reason}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
  }
  return output;
}

function compareAiSearchQueries(
  left: SearchStrategyPlan["queries"][number],
  right: SearchStrategyPlan["queries"][number]
) {
  const strategyRank =
    aiSearchStrategyRank(left.strategyType) - aiSearchStrategyRank(right.strategyType);
  if (strategyRank !== 0) {
    return strategyRank;
  }

  return left.priority - right.priority;
}

function aiSearchStrategyRank(strategyType: string | undefined) {
  switch (strategyType) {
    case "buyer_scenario":
      return 0;
    case "product_group":
      return 1;
    case "brand_ecosystem":
      return 2;
    case "model_specific":
      return 3;
    case "procurement_event":
      return 4;
    case "channel":
      return 5;
    default:
      return 2;
  }
}

function isStrategyTypeWithinBudget(
  existingQueries: PlannedSearchQuery[],
  strategyType: SearchStrategyPlan["queries"][number]["strategyType"],
  channelCustomersRequested: boolean
) {
  if (strategyType === "channel" && !channelCustomersRequested) {
    return false;
  }

  const normalizedType = strategyType ?? "unknown";
  const limits: Record<string, number> = {
    buyer_scenario: 12,
    product_group: 9,
    brand_ecosystem: 3,
    model_specific: 6,
    procurement_event: 0,
    channel: channelCustomersRequested ? 4 : 0,
    unknown: 6
  };
  const limit = limits[normalizedType] ?? limits.unknown ?? 6;
  const used = existingQueries.filter(
    (query) => (query.strategyType ?? "unknown") === normalizedType
  ).length;
  return used < limit;
}

function resolveAiQueryCountry(
  rawCountry: string,
  queryText: string,
  countryPool: string[],
  index: number
): { country: string | null; reason: string } {
  const normalizedRaw = normalizeCountryAlias(rawCountry);
  const direct = countryPool.find((country) => marketMatches(country, normalizedRaw));
  if (direct && isValidSearchCountry(rawCountry)) {
    return { country: direct, reason: "direct" };
  }

  const combinedText = `${rawCountry} ${queryText}`;
  const mentionedKnown = findMentionedKnownMarkets(combinedText);
  const mentionedOffTarget = mentionedKnown.filter(
    (market) => !countryPool.some((country) => marketMatches(country, market))
  );
  const mentioned = findMentionedMarkets(combinedText, countryPool);
  if (mentionedOffTarget.length && !mentioned.length) {
    return {
      country: null,
      reason: `off_target_market:${mentionedOffTarget.slice(0, 3).join(",")}`
    };
  }

  if (mentioned.length === 1) {
    return { country: mentioned[0]!, reason: "extracted_from_query" };
  }

  const fallback = countryPool[index % countryPool.length] ?? countryPool[0] ?? null;
  return fallback
    ? { country: fallback, reason: "round_robin_target_market" }
    : { country: null, reason: "no_target_market_available" };
}

function keywordGroupsFromPayload(
  payload: ReturnType<typeof parseTaskPayload>,
  marketTerms: string[]
): KeywordGroups {
  const groups = payload.keywordGroups ?? {};

  return {
    brandTerms: asStringArray(groups.brandTerms),
    productTerms: asStringArray(groups.productTerms),
    longTailProductTerms: asStringArray(groups.longTailProductTerms),
    customerIntentTerms: prioritizeCustomerIntentTerms(
      asStringArray(groups.customerIntentTerms),
      false
    ),
    marketTerms,
    scenarioTerms: asStringArray(groups.scenarioTerms),
    excludeTerms: asStringArray(groups.excludeTerms)
  };
}

function normalizeCountryAlias(value: string) {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    ae: "UAE",
    uae: "UAE",
    "united arab emirates": "UAE",
    sa: "Saudi Arabia",
    ksa: "Saudi Arabia",
    "saudi arabia": "Saudi Arabia",
    qa: "Qatar",
    om: "Oman",
    us: "United States",
    usa: "United States",
    uk: "United Kingdom",
    ca: "Canada",
    canada: "Canada",
    au: "Australia",
    australia: "Australia",
    加拿大: "Canada",
    澳大利亚: "Australia",
    澳洲: "Australia"
  };

  return aliases[normalized] ?? value.trim();
}

function normalizeAiQueryText(
  query: string,
  country: string,
  keywordGroups: KeywordGroups,
  targetMarkets: string[]
): { query: string; reason: string } {
  const cleaned = query.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return { query: "", reason: "empty_query" };
  }

  let sanitized = stripEvidenceNegativeTerms(removeQuotedMarketPhrases(cleaned, targetMarkets));
  const conflicts = findMentionedKnownMarkets(sanitized).filter(
    (market) => !marketMatches(country, market)
  );
  if (conflicts.length) {
    sanitized = removeConflictingMarketMentions(sanitized, country, conflicts);
  }

  const siteConflict = siteCountryConflict(sanitized, country);
  if (siteConflict) {
    sanitized = sanitized
      .replace(/\bsite:[^\s)]+/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  sanitized = reduceQueryComplexity(sanitized);
  const withCountry = queryMentionsCountry(sanitized, country)
    ? sanitized
    : `${sanitized} ${country}`;
  const withNegatives = appendSafeNegativeTerms(withCountry, keywordGroups.excludeTerms);
  const compacted = reduceQueryComplexity(withNegatives).replace(/\s+$/, "");

  const remainingConflicts = findMentionedKnownMarkets(compacted).filter(
    (market) => !marketMatches(country, market)
  );
  if (remainingConflicts.length) {
    return { query: "", reason: `market_conflict:${remainingConflicts.slice(0, 3).join(",")}` };
  }

  return { query: compacted, reason: "ok" };
}

function queryMentionsCountry(query: string, country: string) {
  const lower = query.toLowerCase();
  return (
    lower.includes(country.toLowerCase()) ||
    lower.includes(normalizeCountryAlias(country).toLowerCase())
  );
}

function isValidSearchCountry(value: string) {
  const normalized = normalizeCountryAlias(value);
  return (
    Boolean(resolveCountry(normalized)) ||
    ["UAE", "Dubai", "Abu Dhabi"].some((market) => marketMatches(market, normalized))
  );
}

function marketMatches(left: string, right: string) {
  const leftAlias = normalizeCountryAlias(left);
  const rightAlias = normalizeCountryAlias(right);
  const leftCountry = resolveCountry(leftAlias);
  const rightCountry = resolveCountry(rightAlias);
  if (leftCountry && rightCountry) {
    return leftCountry.code === rightCountry.code;
  }

  return leftAlias.toLowerCase() === rightAlias.toLowerCase();
}

function findMentionedMarkets(text: string, marketPool: string[]) {
  return marketPool.filter((market) => queryMentionsMarket(text, market));
}

function findMentionedKnownMarkets(text: string) {
  return knownQueryMarkets.filter((market) => queryMentionsMarket(text, market));
}

function queryMentionsMarket(text: string, market: string) {
  const normalized = normalizeCountryAlias(market);
  const aliases = queryMarketAliases(normalized);
  return aliases.some((alias) =>
    new RegExp(`(^|[^a-z0-9])${quoteRegExp(alias)}([^a-z0-9]|$)`, "i").test(text)
  );
}

function queryMarketAliases(market: string) {
  const aliases = new Set<string>([market, normalizeCountryAlias(market)]);
  const resolved = resolveCountry(market);
  if (resolved) {
    aliases.add(resolved.name);
    aliases.add(resolved.code);
  }
  const lower = market.toLowerCase();
  if (lower === "uae" || lower === "united arab emirates") {
    aliases.add("UAE");
    aliases.add("United Arab Emirates");
    aliases.add("Dubai");
    aliases.add("Abu Dhabi");
  }
  if (lower === "saudi arabia") {
    aliases.add("Saudi Arabia");
    aliases.add("Saudi");
    aliases.add("Riyadh");
    aliases.add("Jeddah");
  }
  return [...aliases].filter((alias) => alias.length >= 2);
}

function removeQuotedMarketPhrases(query: string, targetMarkets: string[]) {
  return query
    .replace(/"([^"]{20,})"/g, (match, phrase: string) => {
      const phraseLower = phrase.toLowerCase();
      const mentionsMarket = Boolean(
        findMentionedKnownMarkets(phrase).length ||
        targetMarkets.some((market) => queryMentionsMarket(phrase, market))
      );
      const looksLikeSegment =
        mentionsMarket &&
        /\b(telecom|equipment|distributor|supplier|stockist|maintenance|operator|network|tower|ftth|isp|buyer|company)\b/i.test(
          phraseLower
        );
      return looksLikeSegment ? "" : match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function removeConflictingMarketMentions(query: string, country: string, conflicts: string[]) {
  let output = query;
  for (const conflict of conflicts) {
    for (const alias of queryMarketAliases(conflict)) {
      if (marketMatches(country, alias)) {
        continue;
      }
      output = output.replace(new RegExp(`"[^"]*${quoteRegExp(alias)}[^"]*"`, "gi"), " ");
      output = output.replace(
        new RegExp(`(^|[^a-z0-9])${quoteRegExp(alias)}([^a-z0-9]|$)`, "gi"),
        " "
      );
    }
  }
  return output.replace(/\s+/g, " ").trim();
}

function siteCountryConflict(query: string, country: string) {
  const siteMatches = query.match(/\bsite:([^\s)]+)/gi) ?? [];
  const expectedSite = marketToSite(country).toLowerCase();
  if (!siteMatches.length || expectedSite === ".com") {
    return false;
  }

  return siteMatches.some((match) => {
    const site = match.replace(/^site:/i, "").toLowerCase();
    return site.startsWith(".") && site !== expectedSite;
  });
}

function reduceQueryComplexity(query: string) {
  let output = query.replace(/\s+/g, " ").trim();
  output = compactOrGroups(output);
  output = limitNegativeTerms(output, 3);
  while (output.length > 160) {
    const shortened = output
      .replace(/\s+-[^\s]+(?=(?:\s+-[^\s]+)*$)/, "")
      .trim();
    if (!shortened || shortened === output) {
      break;
    }
    output = shortened;
  }

  return output.length > 180
    ? output
        .slice(0, 180)
        .replace(/\s+\S*$/, "")
        .trim()
    : output;
}

function compactOrGroups(query: string) {
  return query
    .replace(/\(([^()]*\bOR\b[^()]*)\)/gi, (match, group: string) => {
      const terms = group
        .split(/\s+OR\s+/i)
        .map((term) => term.trim())
        .filter(Boolean)
        .slice(0, 3);
      return terms.length > 1 ? `(${terms.join(" OR ")})` : (terms[0] ?? "");
    })
    .replace(/\s+/g, " ")
    .trim();
}

function limitNegativeTerms(query: string, maxTerms: number) {
  const tokens = query.split(/\s+/);
  const output: string[] = [];
  const seen = new Set<string>();
  let negatives = 0;
  for (const token of tokens) {
    if (token.startsWith("-")) {
      const key = token.toLowerCase().replace(/^-+/, "").replace(/^"|"$/g, "");
      if (seen.has(key) || negatives >= maxTerms) {
        continue;
      }
      seen.add(key);
      negatives += 1;
    }
    output.push(token);
  }
  return output.join(" ").replace(/\s+/g, " ").trim();
}

function appendSafeNegativeTerms(query: string, excludeTerms: string[]) {
  const safeTerms = ["jobs", "careers", "training", "course", "forum", "wikipedia"];
  const configuredSafeTerms = excludeTerms.filter((term) => isSafeQueryNegativeTerm(term));
  const terms = uniqueStrings([...safeTerms.slice(0, 5), ...configuredSafeTerms]).slice(0, 5);
  const missingTerms = terms
    .filter((term) => !new RegExp(`-${quoteRegExp(term)}\\b`, "i").test(query))
    .map((term) => `-${term}`);

  return stripEvidenceNegativeTerms([query, ...missingTerms].join(" "));
}

function stripEvidenceNegativeTerms(query: string) {
  return query
    .replace(
      /\s-(?:"(?:pdf|news|blog|blogs|article|articles|report|reports|phone|contact|tel|email|mail|fax|address|mobile|whatsapp)"|(?:pdf|news|blog|blogs|article|articles|report|reports|phone|contact|tel|email|mail|fax|address|mobile|whatsapp)\b)/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

function isSafeQueryNegativeTerm(term: string) {
  return /^(?:jobs?|careers?|hiring|recruitment|training|course|courses|forum|forums|wikipedia)$/i.test(
    term.trim()
  );
}

function hasEnoughQuerySignals(query: string, keywordGroups: KeywordGroups, country: string) {
  const lower = query.toLowerCase();
  const hasCountry = queryMentionsCountry(query, country);
  const productSignalTerms = uniqueStrings([
    ...keywordGroups.productTerms,
    ...keywordGroups.longTailProductTerms
  ]);
  const hasProduct = productSignalTerms.some(
    (term) => isConcreteQueryProductTerm(term) && lower.includes(term.toLowerCase())
  );
  const hasModelOrSku = hasSpecificModelOrSkuSignal(query);
  const hasCustomer = keywordGroups.customerIntentTerms.some((term) =>
    lower.includes(term.toLowerCase())
  );
  const hasScenario = keywordGroups.scenarioTerms.some((term) =>
    lower.includes(term.toLowerCase())
  );
  const hasBuyerRole =
    hasCustomer || hasScenario || queryBuyerRoleTerms.some((term) => lower.includes(term));
  const hasEntryPoint = queryEntryPointTerms.some((term) => lower.includes(term));
  const hasSellerOnlyTrap =
    querySellerOnlyTerms.some((term) => lower.includes(term)) && !hasBuyerRole;
  const hasProductOrIndustryContext =
    hasProduct || hasModelOrSku || hasSpecificIndustryQueryContext(lower);

  return (
    hasCountry &&
    !hasSellerOnlyTrap &&
    hasProductOrIndustryContext &&
    hasBuyerRole &&
    hasEntryPoint
  );
}

function isConcreteQueryProductTerm(term: string) {
  const normalized = term.trim().toLowerCase();
  if (!normalized || genericQueryProductTerms.has(normalized)) {
    return false;
  }

  return (
    normalized.length >= 4 ||
    /\b(?:rru|bbu|aau|olt|sfp|das)\b/i.test(normalized)
  );
}

function extractKnownBrandTerms(values: string[]) {
  const brands = [
    "Huawei",
    "ZTE",
    "Ericsson",
    "Nokia",
    "Eltek",
    "Alcatel-Lucent",
    "Delta",
    "Vertiv"
  ];
  const text = values.join(" ").toLowerCase();
  return brands.filter((brand) => text.includes(brand.toLowerCase()));
}

function quoteRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSpecificIndustryQueryContext(query: string) {
  return /\b(telecom equipment|telecom network|telecom power|telecom site|telecommunications?|5g|4g|ran|open ran|radio access|radio unit|remote radio|rru|bbu|baseband|aau|olt|onu|ont|sfp|das|small cell|private 5g|microwave|backhaul|cell site|base station|towerco|tower company|fiber|ftth|wisp|isp|power module|rectifier|telecom boards?|boards? and cards?|communication cables?|telecom cables?|cable labels?|metal labels?|waterproof insulating tape|insulating tape|industrial network)\b/i.test(
    query
  );
}

function hasSpecificModelOrSkuSignal(query: string) {
  return /\b(?:huawei|zte|ericsson|nokia|alcatel-lucent|eltek)\b.{0,45}\b(?:[a-z]{0,5}\d{2,}[a-z0-9./-]*|\d{4,}[a-z0-9./-]*)\b|\b(?:r\d{4,}[a-z0-9./-]*|r4850n6|ma\d{4}[a-z0-9-]*|air\s*\d{4}|baseband\s*\d{4}|fbbc\s*\d*[a-z]?|aheb\s*\d*[a-z]?|ahca\s*\d*[a-z]?|aeqn\s*\d*[a-z]?|abio\s*\d*[a-z]?|r8882|r8862a?|cce1|cc16b|bpn2|bpl1|umptg?\d?|umpte?\d?|upba\d|wbbp[a-z0-9]*|\d{6}\.\d{3})\b/i.test(
    query
  );
}

function isMainCustomerIntelligenceQuery(query: string) {
  const positiveQuery = query
    .replace(/\s-"[^"]+"/g, " ")
    .replace(/\s-\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /\b(?:rfq|request for quotation|tender|bid|procurement notice|procurement portal|vendor registration|supplier registration|government procurement|filetype:pdf|filetype:doc|filetype:xls|linkedin\.com|yellow pages|directory|b2b marketplace|buyer board|buying lead|globalsources|indiamart|alibaba|tradeindia|ec21|exporthub|made-in-china|trademap|market report|industry report|research report|whitepaper|glossary|encyclopedia|wikipedia|news|press release|blog|article|case study|conference|exhibition|exhibitor list|whatsapp|wa\.me)\b/i.test(
    positiveQuery
  );
}

const genericQueryProductTerms = new Set([
  "equipment",
  "components",
  "parts",
  "spare parts",
  "maintenance parts",
  "replacement parts",
  "network",
  "service",
  "services",
  "infrastructure",
  "industrial equipment",
  "product"
]);

const queryEntryPointTerms = [
  "contact",
  "contact us",
  "about us",
  "services",
  "solutions",
  "projects",
  "locations",
  "offices",
  "company",
  "inquiry",
  "enquiry"
];

const queryBuyerRoleTerms = [
  "maintenance",
  "maintenance company",
  "replacement",
  "replace",
  "repair",
  "deployment",
  "rollout",
  "installation",
  "install",
  "integration",
  "integrate",
  "implementation",
  "telecom site",
  "cell site",
  "site installation",
  "spare parts replenishment",
  "replenishment",
  "o&m",
  "network operations",
  "operator",
  "service provider",
  "field service",
  "field services",
  "tower",
  "towerco",
  "isp",
  "wisp",
  "ftth",
  "contractor",
  "engineering contractor",
  "integrator",
  "field services",
  "repair service",
  "distributor",
  "stockist",
  "reseller",
  "importer"
];

const querySellerOnlyTerms = [
  "supplier",
  "manufacturer",
  "wholesale",
  "price",
  "datasheet",
  "buy now",
  "for sale",
  "showroom",
  "ebay",
  "alibaba",
  "pdfcoffee",
  "router-switch"
];

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
      detail: hasProductProfile
        ? "从官网、产品页和补充说明提取产品词"
        : "使用任务文本和通用 B2B 词库补全产品词"
    },
    {
      step: "analyze_customer_profile",
      title: "分析目标客户",
      detail: hasCustomerProfile
        ? "从目标地区、参考客户和 CRM 样本提取客户意图"
        : "使用任务文本和通用买家画像补全客户意图"
    },
    {
      step: "plan_search_queries",
      title: "生成高级搜索策略",
      detail: "生成 30 条 Brave 可执行或实验性搜索 query"
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
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function getWorkflowInterrupts(workflow: LeadHuntWorkflowState): unknown[] {
  const value = (workflow as unknown as Record<string, unknown>)[INTERRUPT];
  return Array.isArray(value) ? value : [];
}

function toJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function compactTaskForClient<T extends Record<string, unknown>>(task: T): T {
  return {
    ...task,
    inputPayload: compactTaskInputPayloadForClient(task),
    agentSteps: compactAgentStepsForClient(task.agentSteps),
    searchQueries: compactSearchQueriesForClient(task.searchQueries),
    leadCandidates: compactLeadCandidatesForClient(task.leadCandidates)
  };
}

function compactTaskInputPayloadForClient(task: Record<string, unknown>) {
  const originalPayload = task.inputPayload;
  const payload = toPlainObject(originalPayload);
  const graphWorkflow = normalizeGraphWorkflowForClient(payload.graphWorkflow, task);
  const compacted: Record<string, unknown> = {
    ...payload,
    searchQueries: compactPayloadSearchQueriesForClient(payload.searchQueries),
    ...(graphWorkflow ? { graphWorkflow } : {})
  };

  if (payload.siteEvidence) {
    compacted.siteEvidence = compactSiteEvidenceForClient(payload.siteEvidence);
  }

  return originalPayload === null ? null : compacted;
}

function compactAgentStepsForClient(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((step) => {
    const row = toPlainObject(step);
    return {
      ...row,
      output: compactStepOutputForClient(row.output)
    };
  });
}

function compactStepOutputForClient(value: unknown) {
  const output = toPlainObject(value);
  if (!Object.keys(output).length) {
    return value;
  }

  return {
    ...output,
    samplePendingQueries: Array.isArray(output.samplePendingQueries)
      ? output.samplePendingQueries.slice(0, 5)
      : output.samplePendingQueries,
    qualityGate: compactQualityGateForClient(output.qualityGate)
  };
}

function compactQualityGateForClient(value: unknown) {
  const gate = toPlainObject(value);
  if (!Object.keys(gate).length) {
    return value;
  }

  const preservation = toPlainObject(gate.qualityGatePreservation);

  return {
    ...gate,
    samplePendingQueries: Array.isArray(gate.samplePendingQueries)
      ? gate.samplePendingQueries.slice(0, 5)
      : gate.samplePendingQueries,
    qualityGatePreservation: Object.keys(preservation).length
      ? {
          ...preservation,
          samplePendingQueries: Array.isArray(preservation.samplePendingQueries)
            ? preservation.samplePendingQueries.slice(0, 5)
            : preservation.samplePendingQueries
        }
      : gate.qualityGatePreservation
  };
}

function compactSearchQueriesForClient(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((query) => {
    const row = toPlainObject(query);
    return {
      ...row,
      keywordGroups: undefined,
      searchResults: compactSearchResultsForClient(row.searchResults)
    };
  });
}

function compactPayloadSearchQueriesForClient(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((query) => {
    const row = toPlainObject(query);
    return {
      provider: row.provider,
      operatorSource: row.operatorSource,
      executionStatus: row.executionStatus,
      operatorName: row.operatorName,
      strategyTemplate: row.strategyTemplate,
      query: row.query,
      country: row.country,
      resultCount: row.resultCount,
      qualifiedCount: row.qualifiedCount,
      effectivenessScore: row.effectivenessScore
    };
  });
}

function compactSearchResultsForClient(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.slice(0, 8).map((result) => {
    const row = toPlainObject(result);
    return {
      id: row.id,
      title: compactString(row.title, 140),
      url: compactString(row.url, 320),
      domain: row.domain,
      snippet: compactString(row.snippet, 260),
      createdAt: row.createdAt
    };
  });
}

function compactLeadCandidatesForClient(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((lead) => {
    const row = toPlainObject(lead);
    return {
      ...row,
      countryEvidence: compactCountryEvidenceForClient(row.countryEvidence),
      contacts: compactContactsForClient(row.contacts),
      icpScore: compactIcpScoreForClient(row.icpScore),
      outreachDrafts: compactOutreachDraftsForClient(row.outreachDrafts)
    };
  });
}

function compactIcpScoreForClient(value: unknown) {
  const score = toPlainObject(value);
  if (!Object.keys(score).length) {
    return value;
  }

  return {
    ...score,
    reasons: compactIcpReasonsForClient(score.reasons)
  };
}

function compactIcpReasonsForClient(value: unknown) {
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((reason) => compactString(reason, 220));
  }

  const payload = toPlainObject(value);
  if (!Object.keys(payload).length) {
    return value;
  }

  const aiEvaluation = toPlainObject(payload.aiEvaluation);

  return {
    ...payload,
    reasons: Array.isArray(payload.reasons)
      ? payload.reasons.slice(0, 8).map((reason) => compactString(reason, 220))
      : payload.reasons,
    risks: Array.isArray(payload.risks)
      ? payload.risks.slice(0, 6).map((risk) => compactString(risk, 220))
      : payload.risks,
    summary: compactString(payload.summary, 500),
    extractableCompanies: Array.isArray(payload.extractableCompanies)
      ? payload.extractableCompanies.slice(0, 12).map((company) => compactString(company, 160))
      : payload.extractableCompanies,
    aiEvaluation: Object.keys(aiEvaluation).length
      ? {
          ...aiEvaluation,
          matchedSignals: Array.isArray(aiEvaluation.matchedSignals)
            ? aiEvaluation.matchedSignals.slice(0, 8).map((signal) => compactString(signal, 180))
            : aiEvaluation.matchedSignals,
          risks: Array.isArray(aiEvaluation.risks)
            ? aiEvaluation.risks.slice(0, 6).map((risk) => compactString(risk, 180))
            : aiEvaluation.risks
        }
      : payload.aiEvaluation
  };
}

function compactContactsForClient(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  const priority: Record<string, number> = { email: 0, phone: 1, social: 2 };
  const seen = new Set<string>();

  return [...value]
    .map((contact) => toPlainObject(contact))
    .sort((left, right) => {
      const leftType = typeof left.type === "string" ? left.type : "";
      const rightType = typeof right.type === "string" ? right.type : "";
      return (priority[leftType] ?? 9) - (priority[rightType] ?? 9);
    })
    .filter((contact) => {
      const key = `${contact.type ?? ""}:${String(contact.value ?? "").toLowerCase()}`;
      if (!String(contact.value ?? "").trim() || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 12)
    .map((contact) => ({
      id: contact.id,
      type: contact.type,
      value: compactString(contact.value, 160),
      sourceUrl: compactString(contact.sourceUrl, 320),
      createdAt: contact.createdAt
    }));
}

function compactCountryEvidenceForClient(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  const confidencePriority: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const typePriority: Record<string, number> = {
    phone: 0,
    website_domain: 1,
    email_domain: 2,
    service_area: 3,
    official_text: 4
  };

  return [...value]
    .map((item) => toPlainObject(item))
    .sort((left, right) => {
      const leftConfidence = typeof left.confidence === "string" ? left.confidence : "";
      const rightConfidence = typeof right.confidence === "string" ? right.confidence : "";
      const confidenceDelta =
        (confidencePriority[leftConfidence] ?? 9) - (confidencePriority[rightConfidence] ?? 9);
      if (confidenceDelta !== 0) return confidenceDelta;
      const leftType = typeof left.type === "string" ? left.type : "";
      const rightType = typeof right.type === "string" ? right.type : "";
      return (typePriority[leftType] ?? 9) - (typePriority[rightType] ?? 9);
    })
    .slice(0, 8)
    .map((item) => ({
      ...item,
      value: compactString(item.value, 180),
      sourceUrl: compactString(item.sourceUrl, 320)
    }));
}

function compactOutreachDraftsForClient(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.slice(0, 3).map((draft) => {
    const row = toPlainObject(draft);
    return {
      id: row.id,
      status: row.status,
      subject: compactString(row.subject, 180),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      sendLogs: Array.isArray(row.sendLogs) ? row.sendLogs.slice(0, 3) : row.sendLogs
    };
  });
}

function compactSiteEvidenceForClient(value: unknown) {
  const payload = toPlainObject(value);
  if (!Object.keys(payload).length) {
    return value;
  }

  return {
    ...payload,
    productSites: compactSiteEvidenceRows(payload.productSites),
    referenceCustomerSites: compactSiteEvidenceRows(payload.referenceCustomerSites)
  };
}

function compactSiteEvidenceRows(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.slice(0, 8).map((site) => {
    const row = toPlainObject(site);
    return {
      ...row,
      textSample: compactString(row.textSample, 500),
      evidenceSnippets: Array.isArray(row.evidenceSnippets)
        ? row.evidenceSnippets.slice(0, 5).map((snippet) => compactString(snippet, 240))
        : row.evidenceSnippets
    };
  });
}

function normalizeGraphWorkflowForClient(value: unknown, task: Record<string, unknown>) {
  const workflow = toPlainObject(value);
  if (!Object.keys(workflow).length) {
    return value;
  }

  const waitingStep = findAgentStep(task.agentSteps, "waiting");
  if (task.status === "paused" && waitingStep?.nodeName) {
    return {
      ...workflow,
      phase: workflow.phase === "planning" ? "search-to-email" : (workflow.phase ?? "search-to-email"),
      status: "paused",
      currentNode: waitingStep.nodeName,
      pausedAt: waitingStep.nodeName,
      error: null,
      updatedAt: taskUpdatedAtIso(task)
    };
  }

  const failedStep = findAgentStep(task.agentSteps, "failed");
  if (task.status === "failed" && failedStep?.nodeName) {
    return {
      ...workflow,
      status: "failed",
      currentNode: failedStep.nodeName,
      error: failedStep.error ?? workflow.error,
      updatedAt: taskUpdatedAtIso(task)
    };
  }

  return workflow;
}

function findAgentStep(value: unknown, status: string) {
  if (!Array.isArray(value)) {
    return null;
  }

  return (
    value
      .map((step) => toPlainObject(step))
      .find((step) => step.status === status && typeof step.nodeName === "string") ?? null
  );
}

function taskUpdatedAtIso(task: Record<string, unknown>) {
  const updatedAt = task.updatedAt;
  return updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt ?? new Date().toISOString());
}

function compactString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return value;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
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
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function resolveTargetMarketSelection(taskText: string, profileRegions: string[] | undefined) {
  const detectedPromptMarkets = detectTaskMarkets(taskText);
  const promptMarketBuckets = splitTargetMarkets(detectedPromptMarkets);
  const profileMarketBuckets = splitTargetMarkets(profileRegions);
  const promptMarkets = promptMarketBuckets.primaryMarkets;
  const profileMarkets = profileMarketBuckets.primaryMarkets;
  const promptHasGlobal = detectedPromptMarkets.some(
    (market) => normalizeMarketKey(market) === "global"
  );
  const promptSpecificMarkets = promptMarkets.filter((market) => market.toLowerCase() !== "global");

  if (promptSpecificMarkets.length) {
    return {
      targetMarkets: promptSpecificMarkets,
      secondaryMarkets: promptMarketBuckets.secondaryMarkets,
      promptMarkets,
      profileMarkets,
      marketSource: "prompt" as const
    };
  }

  if (promptHasGlobal && profileMarkets.length) {
    return {
      targetMarkets: profileMarkets,
      secondaryMarkets: profileMarketBuckets.secondaryMarkets,
      promptMarkets,
      profileMarkets,
      marketSource: "profile" as const
    };
  }

  if (profileMarkets.length) {
    return {
      targetMarkets: profileMarkets,
      secondaryMarkets: profileMarketBuckets.secondaryMarkets,
      promptMarkets,
      profileMarkets,
      marketSource: "profile" as const
    };
  }

  return {
    targetMarkets: promptMarkets.length ? promptMarkets : undefined,
    secondaryMarkets: promptMarketBuckets.secondaryMarkets,
    promptMarkets,
    profileMarkets,
    marketSource: promptMarkets.length ? ("prompt" as const) : ("none" as const)
  };
}

function splitTargetMarkets(markets: string[] | undefined, maxPrimaryMarkets = 5) {
  const rawMarkets = uniqueStrings(markets ?? [])
    .map((market) => market.trim())
    .filter(Boolean);
  const orderedMarkets = uniqueStrings(
    rawMarkets.flatMap(expandSearchTargetMarket).map(normalizeSearchTargetCountry)
  );

  return {
    primaryMarkets: orderedMarkets.slice(0, maxPrimaryMarkets),
    secondaryMarkets: orderedMarkets.slice(maxPrimaryMarkets)
  };
}

function normalizeTargetMarkets(markets: string[] | undefined) {
  const uniqueMarkets = uniqueStrings(markets ?? []);
  const filteredMarkets =
    uniqueMarkets.length > 1
      ? uniqueMarkets.filter((market) => normalizeMarketKey(market) !== "global")
      : uniqueMarkets;
  const expandedMarkets = uniqueStrings(
    filteredMarkets.flatMap(expandSearchTargetMarket).map(normalizeSearchTargetCountry)
  );

  return expandedMarkets.length ? expandedMarkets : undefined;
}

function expandSearchTargetMarket(market: string) {
  const key = normalizeMarketKey(market);
  const expansion = searchTargetMarketExpansions[key];
  return expansion ?? [market];
}

function normalizeSearchTargetCountry(market: string) {
  const key = normalizeMarketKey(market);
  const aliases: Record<string, string> = {
    ae: "UAE",
    uae: "UAE",
    "united arab emirates": "UAE",
    dubai: "UAE",
    "abu dhabi": "UAE",
    ksa: "Saudi Arabia",
    saudi: "Saudi Arabia",
    "saudi arabia": "Saudi Arabia",
    riyadh: "Saudi Arabia",
    jeddah: "Saudi Arabia",
    doha: "Qatar",
    lagos: "Nigeria",
    nairobi: "Kenya",
    moscow: "Russia",
    kyiv: "Ukraine",
    kiev: "Ukraine"
  };
  const alias = aliases[key];
  if (alias) {
    return alias;
  }

  return resolveCountry(market)?.name ?? market.trim();
}

function normalizeMarketKey(market: string) {
  return market.trim().toLowerCase();
}

function detectTaskMarkets(text: string): string[] {
  const rules: Array<[RegExp, string[]]> = [
    [/\boman\b|\u963f\u66fc/i, ["Oman"]],
    [/\biran\b|\u4f0a\u6717/i, ["Iran"]],
    [/\bisrael\b|\u4ee5\u8272\u5217/i, ["Israel"]],
    [/\bunited states\b|\busa\b|\bus\b|\u7f8e\u56fd/i, ["United States"]],
    [/\bcanada\b|\u52a0\u62ff\u5927/i, ["Canada"]],
    [/\baustralia\b|\u6fb3\u5927\u5229\u4e9a|\u6fb3\u6d32/i, ["Australia"]],
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

  return Array.from(
    new Set(matches.sort((left, right) => left.index - right.index).map((match) => match.market))
  );
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
        ...site.extractedTerms.brandTerms.map((brand) => `${brand} equipment`)
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
    .flatMap((site) => (site.evidenceSnippets.length ? site.evidenceSnippets : [site.textSample]))
    .filter(Boolean)
    .slice(0, 8);
  const combined = compactStrings([notes, ...snippets]);

  return combined.length ? combined.join("\n") : undefined;
}

function buildProductProfileAnalysis(
  product: {
    websiteUrl?: string | null;
    productPageUrl?: string | null;
    notes?: string | null;
  } | null,
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
  const totalProducts = readSites.reduce(
    (max, site) => Math.max(max, site.productCatalog?.totalProducts ?? 0),
    0
  );
  const catalogPagesRead = readSites.reduce(
    (sum, site) => sum + (site.productCatalog?.pagesRead ?? 0),
    0
  );

  return {
    source: readSites.length
      ? "website_content"
      : product
        ? "saved_profile_only"
        : "task_text_only",
    confidence: readSites.length
      ? confidenceFromEvidence(productTerms.length + brandTerms.length)
      : product
        ? 0.35
        : 0.2,
    websiteUrls: uniqueStrings(compactStrings([product?.websiteUrl, product?.productPageUrl])),
    readUrls: readSites.map((site) => site.finalUrl),
    failedUrls: failedSites.map((site) => ({ url: site.url, error: site.error })),
    productCategories: productTerms.slice(0, 8),
    keyProducts: productTerms.slice(0, 12),
    productCatalog: {
      totalProducts: totalProducts || productNames.length,
      listedProducts: readSites.reduce(
        (sum, site) => sum + (site.productCatalog?.listedProducts ?? 0),
        0
      ),
      extractedProducts: productNames.length,
      pagesRead: catalogPagesRead,
      truncated: readSites.some((site) => site.productCatalog?.truncated)
    },
    brands: brandTerms.slice(0, 8),
    searchKeywords: uniqueStrings([...productTerms, ...brandTerms]).slice(0, 16),
    evidence,
    warning: readSites.length
      ? null
      : "No website content was read; analysis uses saved notes and defaults only."
  };
}

function buildCustomerProfileAnalysis(
  customer: {
    targetRegions?: string[];
    referenceCustomerUrls?: string[];
    notes?: string | null;
  } | null,
  sites: WebsiteEvidence[]
) {
  const readSites = sites.filter((site) => site.status === "read");
  const failedSites = sites.filter((site) => site.status === "failed");
  const customerTypes = prioritizeCustomerIntentTerms(
    uniqueStrings(readSites.flatMap((site) => site.extractedTerms.customerIntentTerms)),
    false
  );
  const scenarios = uniqueStrings(readSites.flatMap((site) => site.extractedTerms.scenarioTerms));
  const evidence = readSites.flatMap((site) => site.evidenceSnippets).slice(0, 8);

  return {
    source: readSites.length
      ? "website_content"
      : customer
        ? "saved_profile_only"
        : "task_text_only",
    confidence: readSites.length
      ? confidenceFromEvidence(customerTypes.length + scenarios.length)
      : customer
        ? 0.35
        : 0.2,
    targetRegions: customer?.targetRegions ?? [],
    referenceUrls: customer?.referenceCustomerUrls ?? [],
    readUrls: readSites.map((site) => site.finalUrl),
    failedUrls: failedSites.map((site) => ({ url: site.url, error: site.error })),
    idealCustomerTypes: customerTypes.slice(0, 10),
    buyingSignals: scenarios.slice(0, 10),
    searchKeywords: uniqueStrings([...customerTypes, ...scenarios]).slice(0, 16),
    evidence,
    warning: readSites.length
      ? null
      : "No reference customer website content was read; analysis uses saved notes and defaults only."
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
  prompt?: string | null;
  productProfile?: {
    websiteUrl?: string | null;
    productPageUrl?: string | null;
    documentUrls?: string[];
    notes?: string | null;
  } | null;
  productProfileAnalysis?: Record<string, unknown> | null;
  customerProfile?: { targetRegions?: string[]; notes?: string | null } | null;
  customerProfileAnalysis?: Record<string, unknown> | null;
  keywordGroups?: Partial<KeywordGroups>;
} {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ReturnType<typeof parseTaskPayload>)
    : {};
}

function createTaskInputFromPayload(
  value: Prisma.JsonValue | null,
  targetCount?: number
): CreateTaskInput | null {
  const payload = parseTaskPayload(value);
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!prompt) {
    return null;
  }

  return {
    prompt,
    ...(targetCount ? { targetCount } : {})
  };
}

function buildIcpCriteria(payload: ReturnType<typeof parseTaskPayload>): IcpScoringCriteria {
  const keywordGroups = payload.keywordGroups ?? {};
  const marketTerms = asStringArray(keywordGroups.marketTerms).slice(0, 40);
  const profileRegions = asStringArray(payload.customerProfile?.targetRegions).slice(0, 40);
  const targetRegions = mergeQualificationTargetRegions(marketTerms, profileRegions);
  const productProfile = payload.productProfile;
  const ownDomains = domainsFromUrls([
    productProfile?.websiteUrl,
    productProfile?.productPageUrl,
    ...asStringArray(productProfile?.documentUrls)
  ]);

  return {
    targetRegions: targetRegions.length ? targetRegions : profileRegions,
    productKeywords: [
      ...asStringArray(keywordGroups.productTerms).slice(0, 8),
      ...asStringArray(keywordGroups.longTailProductTerms).slice(0, 6)
    ],
    customerTypeKeywords: asStringArray(keywordGroups.customerIntentTerms).slice(0, 8),
    ownDomains,
    brandTerms: asStringArray(keywordGroups.brandTerms).slice(0, 12),
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

function mergeQualificationTargetRegions(marketTerms: string[], profileRegions: string[]) {
  const combinedRegions = uniqueStrings([...marketTerms, ...profileRegions]);
  const constrainedRegions = combinedRegions.filter(
    (region) => !isGlobalQualificationMarket(region)
  );

  return constrainedRegions.length ? constrainedRegions : combinedRegions;
}

function isGlobalQualificationMarket(region: string) {
  return ["global", "worldwide", "all", "all countries", "all markets"].includes(
    normalizeMarketKey(region)
  );
}

function domainsFromUrls(urls: Array<string | null | undefined>) {
  return uniqueStrings(
    urls
      .map((url) => {
        if (!url) {
          return "";
        }
        try {
          return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
        } catch {
          return "";
        }
      })
      .filter(Boolean)
  );
}

function resolveSearchBatchLimit(limit: number | undefined) {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return undefined;
  }

  const requested = limit;
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_SYNC_SEARCH_QUERY_LIMIT);
}

function countryToBraveCode(country: string | null) {
  if (!country) {
    return "US";
  }

  const genericCode = countryToSearchApiCode(country);
  if (genericCode !== "ALL" && (resolveCountry(country) || genericCode !== "US")) {
    return genericCode;
  }

  const normalized = country?.toLowerCase();
  const codes: Record<string, string> = {
    uae: "ALL",
    "united arab emirates": "ALL",
    阿联酋: "ALL",
    dubai: "ALL",
    "abu dhabi": "ALL",
    "saudi arabia": "SA",
    沙特: "SA",
    riyadh: "SA",
    jeddah: "SA",
    qatar: "ALL",
    nigeria: "ALL",
    尼日利亚: "ALL",
    kenya: "ALL",
    肯尼亚: "ALL",
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
    俄罗斯: "ALL",
    ukraine: "ALL",
    乌克兰: "ALL"
  };

  return normalized ? (codes[normalized] ?? "ALL") : "US";
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
    title: `${company.name} - B2B ${company.type}`,
    url: `https://${company.domain}`,
    snippet: [
      `${company.name} is a local development fallback result for ${market}.`,
      `${company.type} focused on equipment, spare parts, maintenance, project delivery and network services.`,
      `Query context: ${query}`,
      `Contact: sales@${company.domain}`
    ].join(" "),
    source: "web" as const
  }));
}

function normalizeFallbackMarket(country: string | null): FallbackMarket {
  const normalized = country?.toLowerCase() ?? "";
  if (
    normalized.includes("saudi") ||
    normalized.includes("riyadh") ||
    normalized.includes("jeddah")
  ) {
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

function ratio(value: number, total: number) {
  return total > 0 ? value / total : 0;
}

function isMainCandidateStatus(status: string | null | undefined) {
  return ["review", "qualified", "approved", "contacted", "email_sent"].includes(status ?? "");
}

function countryMatchesAnyTarget(country: string, targetRegions: string[]) {
  const countryCode = resolveCountry(country)?.code;
  if (!countryCode) {
    return false;
  }

  return targetRegions.some((target) => {
    const normalized = target.trim().toLowerCase();
    if (!normalized || ["global", "worldwide", "all"].includes(normalized)) {
      return true;
    }

    return expandSearchTargetMarket(target)
      .map(normalizeSearchTargetCountry)
      .some((market) => resolveCountry(market)?.code === countryCode);
  });
}

function workflowNodeOrder(nodeName: LeadHuntWorkflowNode) {
  return leadHuntWorkflowNodes.indexOf(nodeName) + 1;
}

function shouldPlanTaskInline() {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
}

type FallbackMarket = "UAE" | "SAUDI";

const fallbackCompanies: Record<
  FallbackMarket,
  Array<{ name: string; domain: string; type: string }>
> = {
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
  const productFit = candidate.icpScore
    ? `ICP ${candidate.icpScore.score}/${candidate.icpScore.grade}`
    : "high-fit B2B profile";
  const countryLine = candidate.country ? ` in ${candidate.country}` : "";

  return {
    leadId: candidate.id,
    channel: "email",
    subject: `Supply support for ${candidate.companyName}`,
    body: [
      `Hi ${candidate.companyName} team,`,
      "",
      `I noticed your company appears to be a strong ${productFit} prospect${countryLine}.`,
      "We support equipment supply, spare parts, maintenance support and project delivery for buyers, integrators and operators.",
      "",
      "Could you let me know whether you currently source spare parts or project supply items?",
      "",
      "Best regards,",
      "LeadHunt AI"
    ].join("\n"),
    status: email ? "draft" : "needs_contact"
  };
}
