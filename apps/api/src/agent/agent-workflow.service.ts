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
const DEFAULT_SEARCH_QUERY_COUNT = 20;
const SEARCH_STRATEGY_INITIAL_QUERY_COUNT = 15;
const DEFAULT_MAIN_CUSTOMER_QUERY_COUNT = 24;
const DEFAULT_CHANNEL_CUSTOMER_QUERY_COUNT = 6;
const MIN_EXECUTABLE_GPT_SEARCH_QUERY_COUNT = DEFAULT_SEARCH_QUERY_COUNT;
const SEARCH_STRATEGY_MAX_REFILL_ATTEMPTS = 2;
const PRODUCT_PROFILE_TIMEOUT_MS = 75_000;
const CUSTOMER_PROFILE_TIMEOUT_MS = 75_000;
const KEYWORD_EXPANSION_TIMEOUT_MS = 90_000;
const SEARCH_STRATEGY_TIMEOUT_MS = 90_000;
const SEARCH_STRATEGY_REFILL_TIMEOUT_MS = 90_000;
// 2026-05 P1: per-query outer timeouts. Without these the Brave HTTP
// request, candidate-page contact probes, or saveCandidates can stall
// indefinitely and freeze the entire for-loop, leaving the task in
// "running" state forever (we observed 34 zombie tasks, the oldest
// 15 days old). With these timeouts the offending query gets marked
// failed and the loop continues to the next one.
const PER_QUERY_BRAVE_SEARCH_TIMEOUT_MS = 30_000;
// 2026-05 P0: bumped back from 60s to 120s. Lane K queries return
// 20 results per call, each going through contact-page probe (8s × 8
// pages worst case) + AI candidate evaluation + DB writes. 60s was
// too aggressive — observed 9/16 Lane K queries timing out on
// saveCandidates while their Brave hits had already been saved to
// search_results. This caused state-machine confusion: query was
// marked "failed" with resultCount=0 even though Brave returned 20
// hits successfully.
const PER_QUERY_SAVE_CANDIDATES_TIMEOUT_MS = 120_000;
// 2026-05 P1: stale running-task cutoff. Tasks that sit in "running"
// status without an updatedAt heartbeat for more than this many hours
// are considered orphaned (process crashed / OOM / lost websocket) and
// auto-marked failed during recovery so they don't accumulate forever.
const STALE_RUNNING_TASK_HOURS = 24;
const FIRST_STAGE_SEARCH_QUERY_LIMIT = 15;
// 2026-05: Lane K default query count. First batch targets 16-18 Lane K
// queries; continue-search batches can increase this to 24-28.
const LANE_K_DEFAULT_QUERY_COUNT = 20;
const RUNNING_TASK_RECOVERY_LIMIT = 5;
const RUNNING_TASK_RECOVERY_WINDOW_HOURS = 24;
const LANGGRAPH_CHECKPOINT_STORE_VALUES = ["memory", "postgres"] as const;
const CUSTOMER_LIST_HIDDEN_LEAD_STATUSES = [
  // New simplified statuses we hide from the main customer list:
  "intelligence",
  "rejected",
  // Legacy statuses kept for back-compat with historical task rows.
  "intelligence_review",
  "evidence_review"
] as const;
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

    // 2026-05 P1: First clean up zombie running tasks. A task counts as
    // a zombie when it sits in "running" status without an updatedAt
    // heartbeat for more than STALE_RUNNING_TASK_HOURS. These are
    // process-crash / OOM / lost-websocket leftovers that the recovery
    // window (also 24h) deliberately won't touch — without this cleanup
    // they accumulate forever (we observed 34 such tasks, oldest 15
    // days). Mark them failed so the UI shows a final state instead of
    // a perpetual spinner.
    await this.markStaleRunningTasksFailed();

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
      // 2026-05 P1: also reset any "running" search queries on the
      // recovered task back to "pending" so the next loop iteration
      // can pick them up. A query stuck on "running" before the crash
      // would otherwise be skipped by countPendingSearchQueries.
      await this.resetStuckRunningSearchQueries(task.id);

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

  private async markStaleRunningTasksFailed() {
    const staleCutoff = new Date(Date.now() - STALE_RUNNING_TASK_HOURS * 60 * 60 * 1000);
    const stale = await this.prisma.leadTask.findMany({
      where: {
        status: "running",
        updatedAt: { lt: staleCutoff }
      },
      select: { id: true }
    });
    if (!stale.length) {
      return;
    }
    await this.prisma.leadTask.updateMany({
      where: { id: { in: stale.map((t) => t.id) } },
      data: { status: "failed" }
    });
    // Also clear the running flag on any orphaned search queries so the
    // task page doesn't keep showing them in a stuck "running" state.
    await this.prisma.searchQuery.updateMany({
      where: {
        taskId: { in: stale.map((t) => t.id) },
        executionStatus: "running"
      },
      data: { executionStatus: "failed" }
    });
  }

  private async resetStuckRunningSearchQueries(taskId: string) {
    await this.prisma.searchQuery.updateMany({
      where: {
        taskId,
        executionStatus: "running"
      },
      data: { executionStatus: "pending" }
    });
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
            // 2026-05: count GPT-emitted queries against the minimum
            // threshold. Reverse-network injection adds 0-cost extras
            // on top, but those are not a substitute for a complete
            // GPT plan. We accept the plan when GPT itself produced
            // at least MIN_EXECUTABLE_GPT_SEARCH_QUERY_COUNT queries,
            // OR when GPT produced at least 80% of that target AND the
            // total (GPT + reverse-network) reaches the target. This
            // protects against the previous mode where one missing
            // GPT query failed the whole task even though the reverse
            // network had already padded the plan to 32+.
            const gptQueryCount = context.searchQueries.filter(
              (query) => query.templateId === "gpt55_search_strategy"
            ).length;
            const totalQueryCount = context.searchQueries.length;
            const gptSoftFloor = Math.ceil(MIN_EXECUTABLE_GPT_SEARCH_QUERY_COUNT * 0.8);
            const acceptable =
              gptQueryCount >= MIN_EXECUTABLE_GPT_SEARCH_QUERY_COUNT ||
              (gptQueryCount >= gptSoftFloor &&
                totalQueryCount >= MIN_EXECUTABLE_GPT_SEARCH_QUERY_COUNT);
            if (!acceptable) {
              throw new Error(
                `GPT-5.5 search plan produced ${gptQueryCount} executable queries (total ${totalQueryCount}); at least ${MIN_EXECUTABLE_GPT_SEARCH_QUERY_COUNT} GPT queries (or ${gptSoftFloor} GPT plus reverse-network reaching ${MIN_EXECUTABLE_GPT_SEARCH_QUERY_COUNT}) are required. No deterministic fallback queries were added.`
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
          where: {
            status: {
              notIn: [...CUSTOMER_LIST_HIDDEN_LEAD_STATUSES]
            }
          },
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
      where: {
        taskId,
        status: {
          notIn: [...CUSTOMER_LIST_HIDDEN_LEAD_STATUSES]
        }
      },
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
    input: { limit?: number; slowPlanningPromise?: Promise<unknown> } = {}
  ) {
    if (!this.braveSearchService || !this.leadQualificationService) {
      throw new BadRequestException("Search services are not configured");
    }

    const queryLimit = resolveSearchBatchLimit(input.limit);
    // 2026-05 V1-MVP Step 4: brave_search runner is now a polling loop.
    // Instead of reading task.searchQueries once at the start (and being
    // blind to queries appended later by the slow GPT planning phase),
    // each iteration re-queries the DB for pending queries and atomically
    // claims one via updateMany WHERE id+pending → running. This lets the
    // runner consume queries that arrive mid-execution while still
    // preserving the existing batch-limit behavior (when limit is set).
    const task = await this.prisma.leadTask.findFirst({
      where: { id: taskId, userId },
      select: { id: true, inputPayload: true }
    });

    if (!task) {
      throw new NotFoundException("Lead task not found");
    }

    const slowPlanningPromise = input.slowPlanningPromise;
    let slowPlanningSettled = !slowPlanningPromise;
    if (slowPlanningPromise) {
      void slowPlanningPromise.finally(() => {
        slowPlanningSettled = true;
      });
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
    let processedQueries = 0;
    const searchErrors: Array<{ queryId: string; message: string }> = [];

    // Hard timeout to prevent the polling loop from running forever if
    // slowPlanning never settles or the DB lock-claim contention is
    // pathological. 10 minutes is well above the worst-case observed
    // batch time (~7 minutes for 15 Lane K queries).
    const HARD_TIMEOUT_MS = 10 * 60 * 1000;
    const POLL_IDLE_INTERVAL_MS = 2_000;
    const startedAt = Date.now();

    while (true) {
      if (queryLimit !== undefined && processedQueries >= queryLimit) {
        break;
      }
      if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
        break;
      }

      // 1) Find next pending candidate (ordered by createdAt to preserve
      //    the Lane K → GPT → reverse merge order set up at planning time).
      const candidate = await this.prisma.searchQuery.findFirst({
        where: { taskId, executionStatus: "pending" },
        orderBy: { createdAt: "asc" }
      });

      if (!candidate) {
        // No pending query right now. If slow planning is still running,
        // wait a bit and re-poll — new queries may arrive shortly.
        if (!slowPlanningSettled) {
          await new Promise((resolve) => setTimeout(resolve, POLL_IDLE_INTERVAL_MS));
          continue;
        }
        // Slow planning settled and no pending queries — we're done.
        break;
      }

      // 2) Atomic claim. updateMany returns count=1 only if the row was
      //    still pending; if a parallel worker (future scaling) won the
      //    race, count=0 and we move on to the next candidate.
      const claimed = await this.prisma.searchQuery.updateMany({
        where: { id: candidate.id, executionStatus: "pending" },
        data: {
          executionStatus: "running",
          resultCount: 0,
          qualifiedCount: 0
        }
      });
      if (claimed.count === 0) {
        continue;
      }

      const query = candidate;
      processedQueries += 1;
      {
      const searchParams = {
        query: query.query,
        country: countryToBraveCode(),
        language: "en",
        count: 20
      };

      // 2026-05 P0: state machine decoupling. Brave search and
      // saveCandidates are now tracked separately:
      //   - Brave failure → query.executionStatus = "failed", resultCount = 0
      //   - Brave success + saveCandidates failure → query.executionStatus = "completed"
      //     with resultCount preserved (Brave hits are still useful evidence
      //     and were already saved to search_results table). Only the
      //     candidate enrichment step failed, which we record as a soft
      //     warning rather than a query-level failure.
      // Previously a single try/catch around both calls would mark the
      // query failed and clear resultCount, hiding 240+ Brave hits per
      // task as if Brave had failed when it had actually succeeded.
      let searchSucceeded = false;
      let searchCount = 0;
      let braveFallback = false;
      let candidateResults: BraveSearchResult[] = [];

      try {
        const search = await withTimeout(
          this.runSearchWithDevelopmentFallback(query.id, searchParams, query.country),
          PER_QUERY_BRAVE_SEARCH_TIMEOUT_MS,
          `Brave search query ${query.id.slice(0, 8)}`
        );
        searchSucceeded = true;
        searchCount = search.count;
        braveFallback = search.fallback;
        candidateResults = search.results.slice(0, MAX_CANDIDATE_RESULTS_PER_QUERY);
        // Brave search succeeded — persist resultCount immediately so
        // the value is preserved even if saveCandidates blows up later.
        await this.prisma.searchQuery.update({
          where: { id: query.id },
          data: { resultCount: searchCount }
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
        await this.touchRunningTask(taskId);
        continue;
      }

      // Brave succeeded — now try saveCandidates. Failure here does NOT
      // mark the query as failed; it stays "completed" with the Brave
      // resultCount preserved.
      try {
        const saved = candidateAiEvaluator
          ? await withTimeout(
              this.leadQualificationService.saveCandidates(
                taskId,
                candidateResults,
                criteria,
                query.country ?? undefined,
                candidateAiEvaluator
              ),
              PER_QUERY_SAVE_CANDIDATES_TIMEOUT_MS,
              `Save candidates for query ${query.id.slice(0, 8)}`
            )
          : await withTimeout(
              this.leadQualificationService.saveCandidates(
                taskId,
                candidateResults,
                criteria,
                query.country ?? undefined
              ),
              PER_QUERY_SAVE_CANDIDATES_TIMEOUT_MS,
              `Save candidates for query ${query.id.slice(0, 8)}`
            );
        usedDevelopmentFallback ||= braveFallback;
        resultCount += searchCount;
        createdCandidates += saved.createdCount;
        skippedCandidates += saved.skippedCount;
        // 2026-05 P0: qualifiedCount semantics fixed. Previously this
        // field stored saved.createdCount (count of NEWLY created
        // candidates, regardless of their qualification status), which
        // misled the UI and self-improvement signals. Now it stores
        // the count of candidates that actually reached qualified
        // status — which is what the UI label and the agent's
        // axis-rotation feedback loop should learn from.
        const qualifiedFromThisQuery = saved.candidates.filter(
          (c: { status?: string | null }) => c.status === "qualified"
        ).length;
        await this.prisma.searchQuery.update({
          where: { id: query.id },
          data: {
            executionStatus: "completed",
            resultCount: searchCount,
            qualifiedCount: qualifiedFromThisQuery
          }
        });
      } catch (saveError) {
        // Brave succeeded; saveCandidates failed (timeout, DB error,
        // or contact-probe stall). Keep the query as completed with
        // resultCount preserved so downstream lane analytics can still
        // see Brave hit it. Surface the error to searchErrors but do
        // NOT increment failedQueries (we don't want this to count
        // toward "all Brave failed" task abort logic).
        searchErrors.push({
          queryId: query.id,
          message: `saveCandidates failed: ${searchErrorMessage(saveError)}`
        });
        await this.prisma.searchQuery.update({
          where: { id: query.id },
          data: {
            executionStatus: "completed",
            resultCount: searchCount,
            qualifiedCount: 0
          }
        });
      }
      await this.touchRunningTask(taskId);
      } // end while-iteration block (was inner for-body)
    } // end while polling loop

    const remainingQueries = await this.countPendingSearchQueries(taskId);
    const hasMore = remainingQueries > 0;

    if (processedQueries > 0 && failedQueries === processedQueries) {
      await this.markStepFailed(
        taskId,
        "brave_search",
        searchErrors[0]?.message ?? "All Brave searches failed"
      );

      return {
        ok: false,
        executedQueries: processedQueries,
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
      executedQueries: processedQueries,
      successfulQueries: processedQueries - failedQueries,
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
    // Country-issue ratio is no longer a stop condition. The new product
    // policy keeps "country unconfirmed" candidates flowing through to the
    // main review list (we do not exist needs_country_review anymore), so
    // the only remaining stop signal is "everything came back rejected" —
    // which usually means a Brave outage or upstream filter break, not a
    // genuine quality issue. We require near-total rejection before
    // freezing pending queries, so legitimate noisy first batches do not
    // strand the rest of the plan.
    const shouldStop =
      executedQueryCount >= FIRST_STAGE_SEARCH_QUERY_LIMIT &&
      totalCandidates >= 10 &&
      rejectedRatio >= 0.95;
    const reasons = shouldStop ? ["rejected_ratio_critical"] : [];

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
      // We deliberately do NOT retry with country="US" anymore. After the
      // 2026-05 country-validation rework, geographic anchoring is in the
      // query text (country names, cities, local TLD site: filters,
      // reference-customer domains), not in Brave's country parameter, so
      // a US-locale retry can never improve relevance. If the first call
      // fails, fall through to either the development fallback or surface
      // the upstream error.
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
    // 2026-05: country verification is no longer required to send. The
    // user's policy is "country unconfirmed → still let it through; one
    // more customer is fine, treat it as opening a new market." We keep
    // status + score gates but drop the country-confidence filter so
    // .com domains without phone-extracted country can still be sent
    // after the human review step.
    const eligibleCandidates = task.leadCandidates.filter(
      (candidate) =>
        isMainCandidateStatus(candidate.status) && (candidate.icpScore?.score ?? 0) >= 50
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
        "Only review or qualified candidates with sufficient ICP score can be approved"
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
    const baseSearchQueries = aiPlanning.searchQueries;

    // 2026-05: reverse-customer-network injection (Lane D safety net).
    // The prompt asks GPT to emit at least 2 reverse-mining queries per
    // task when reference customers are present. GPT compliance is not
    // guaranteed, and these queries are 0-cost on Brave (no extra
    // generation, no extra GPT round trip). We inject them directly so
    // every task with reference customers gets the lookalike-buyer
    // surface area regardless of GPT's mood.
    const reverseNetworkQueries = buildReverseCustomerNetworkQueries({
      siteEvidence,
      customerProfileAnalysis,
      keywordGroups,
      targetMarkets
    });

    // 2026-05: Lane K keyword-combination queries (backend-assembled).
    // GPT outputs a keywordPool (product terms, buyer roles, scenario
    // terms) alongside its structured queries. The backend assembles
    // short, high-hit-rate Brave queries via cartesian product. This
    // reduces GPT time (fewer queries to write) and improves hit rate
    // (short natural phrases vs complex operator queries).
    const keywordPool = aiPlanning.keywordPool;
    const laneKTargetCount = Math.max(
      0,
      LANE_K_DEFAULT_QUERY_COUNT - reverseNetworkQueries.length
    );
    const laneKQueries = buildLaneKQueriesFromKeywordGroups({
      keywordGroups,
      productProfileAnalysis,
      customerProfileAnalysis,
      targetMarkets: targetMarkets ?? [],
      maxQueries: laneKTargetCount,
      keywordPool
    });

    // 2026-05 P1: Lane K front-loaded. The user experience is "keywords
    // search fast, advanced queries fill in later". We put the first 12
    // Lane K queries at the front of the execution queue so the user
    // sees results within 1-2 minutes. GPT precision queries and
    // reverse-network queries follow. Any remaining Lane K queries
    // (long-tail) go at the end.
    const LANE_K_FRONT_LOAD_COUNT = 12;
    const laneKFront = laneKQueries.slice(0, LANE_K_FRONT_LOAD_COUNT);
    const laneKTail = laneKQueries.slice(LANE_K_FRONT_LOAD_COUNT);
    const searchQueries: PlannedSearchQuery[] = [
      ...laneKFront,
      ...baseSearchQueries.filter(
        (q) => !laneKFront.some((k) => k.query.toLowerCase() === q.query.toLowerCase())
      ),
      ...reverseNetworkQueries.filter(
        (q) =>
          !laneKFront.some((k) => k.query.toLowerCase() === q.query.toLowerCase()) &&
          !baseSearchQueries.some((b) => b.query.toLowerCase() === q.query.toLowerCase())
      ),
      ...laneKTail
    ].slice(0, DEFAULT_SEARCH_QUERY_COUNT + LANE_K_DEFAULT_QUERY_COUNT + 10);

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

  // 2026-05 V1-MVP Step 2: split planning into fast and slow phases.
  // Fast phase = product profile + customer profile + expand_keywords.
  //   These are the inputs Lane K needs. Once fast phase completes,
  //   we have enough to assemble keyword-combination queries and start
  //   Brave search immediately.
  // Slow phase = plan_search_queries (GPT search-strategy generation).
  //   This is the slowest part (60-180s with refills). It runs in
  //   parallel with the first batch of Brave searches in the V1-MVP
  //   concurrent path.
  // Backwards compatible: buildAiPlanningContext still exists and
  // produces the same shape as before by calling fast + slow in
  // series. New code paths can call runFastPlanning + runSlowPlanning
  // independently.

  private async runFastPlanning(input: {
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
  }): Promise<{
    productProfileAnalysis: Record<string, unknown>;
    customerProfileAnalysis: Record<string, unknown>;
    keywordGroups: KeywordGroups;
    aiKeywordExpansion: KeywordExpansionResult | null;
    fallbackReasons: string[];
    channelCustomersRequested: boolean;
    serviceAvailable: boolean;
  }> {
    const fallbackReasons: string[] = [];
    let productProfileAnalysis = input.ruleProductProfileAnalysis;
    let customerProfileAnalysis = input.ruleCustomerProfileAnalysis;
    const channelCustomersRequested =
      isChannelCustomerRequest(input.input.prompt) || DEFAULT_CHANNEL_CUSTOMER_QUERY_COUNT > 0;
    let keywordGroups = prioritizeKeywordGroupCustomerIntentTerms(
      input.ruleKeywordGroups,
      channelCustomersRequested
    );
    let aiKeywordExpansion: KeywordExpansionResult | null = null;

    if (!this.leadHuntAiService) {
      return {
        productProfileAnalysis,
        customerProfileAnalysis,
        keywordGroups,
        aiKeywordExpansion,
        fallbackReasons: ["LeadHuntAiService is required for search planning"],
        channelCustomersRequested,
        serviceAvailable: false
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

    return {
      productProfileAnalysis,
      customerProfileAnalysis,
      keywordGroups,
      aiKeywordExpansion,
      fallbackReasons,
      channelCustomersRequested,
      serviceAvailable: true
    };
  }

  private async runSlowPlanning(input: {
    taskId?: string;
    fastResult: {
      productProfileAnalysis: Record<string, unknown>;
      customerProfileAnalysis: Record<string, unknown>;
      keywordGroups: KeywordGroups;
      aiKeywordExpansion: KeywordExpansionResult | null;
      channelCustomersRequested: boolean;
    };
    targetMarkets?: string[];
  }): Promise<{
    searchQueries: PlannedSearchQuery[];
    keywordPool?: {
      productTerms: string[];
      buyerRoles: string[];
      scenarioTerms: string[];
      excludeFromKeywords: string[];
    };
    fallbackReasons: string[];
    aiQueryCount: number;
    gptRefillAttempts: number;
    gptRefillAcceptedCount: number;
    rejectedAiQueries: Array<{ query: string; country: string; reason: string }>;
  }> {
    const fallbackReasons: string[] = [];
    let searchQueries: PlannedSearchQuery[] = [];
    let keywordPool: {
      productTerms: string[];
      buyerRoles: string[];
      scenarioTerms: string[];
      excludeFromKeywords: string[];
    } | undefined;
    let aiQueryCount = 0;
    let gptRefillAttempts = 0;
    let gptRefillAcceptedCount = 0;
    let rejectedAiQueries: Array<{ query: string; country: string; reason: string }> = [];

    if (!this.leadHuntAiService) {
      return {
        searchQueries,
        keywordPool,
        fallbackReasons: ["LeadHuntAiService is required for search-strategy planning"],
        aiQueryCount,
        gptRefillAttempts,
        gptRefillAcceptedCount,
        rejectedAiQueries
      };
    }

    const { productProfileAnalysis, customerProfileAnalysis, keywordGroups, aiKeywordExpansion, channelCustomersRequested } = input.fastResult;

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
      if (searchPlan.keywordPool) {
        keywordPool = {
          productTerms: searchPlan.keywordPool.productTerms ?? [],
          buyerRoles: searchPlan.keywordPool.buyerRoles ?? [],
          scenarioTerms: searchPlan.keywordPool.scenarioTerms ?? [],
          excludeFromKeywords: searchPlan.keywordPool.excludeFromKeywords ?? []
        };
      }
      let normalization = normalizeAiSearchPlan(
        searchPlan,
        keywordGroups,
        SEARCH_STRATEGY_INITIAL_QUERY_COUNT,
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
      if (aiQueries.length > 0 && aiQueries.length < DEFAULT_SEARCH_QUERY_COUNT) {
        fallbackReasons.push(
          `GPT search plan incomplete: ${aiQueries.length}/${DEFAULT_SEARCH_QUERY_COUNT} executable queries accepted. No deterministic fallback queries were added.`
        );
      }
      searchQueries = aiQueries;
    } catch (error) {
      fallbackReasons.push(`GPT search strategy failed: ${searchErrorMessage(error)}`);
      searchQueries = [];
    }

    return {
      searchQueries,
      keywordPool,
      fallbackReasons,
      aiQueryCount,
      gptRefillAttempts,
      gptRefillAcceptedCount,
      rejectedAiQueries
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
    // 2026-05 V1-MVP Step 2: thin wrapper around runFastPlanning +
    // runSlowPlanning. Behavior is identical to the pre-refactor
    // single-method implementation. The two phases are now separable
    // for the V1-MVP concurrent execution path (see Step 3).
    const fastResult = await this.runFastPlanning(input);

    if (!fastResult.serviceAvailable) {
      return {
        productProfileAnalysis: fastResult.productProfileAnalysis,
        customerProfileAnalysis: fastResult.customerProfileAnalysis,
        keywordGroups: fastResult.keywordGroups,
        searchQueries: [] as PlannedSearchQuery[],
        keywordPool: undefined,
        profileSignals: {
          enabled: false,
          querySource: "gpt55_unavailable",
          fallbackQueryCount: 0,
          fallbackReasons: fastResult.fallbackReasons
        }
      };
    }

    const slowResult = await this.runSlowPlanning({
      taskId: input.taskId,
      fastResult: {
        productProfileAnalysis: fastResult.productProfileAnalysis,
        customerProfileAnalysis: fastResult.customerProfileAnalysis,
        keywordGroups: fastResult.keywordGroups,
        aiKeywordExpansion: fastResult.aiKeywordExpansion,
        channelCustomersRequested: fastResult.channelCustomersRequested
      },
      targetMarkets: input.targetMarkets
    });

    const fallbackReasons = [...fastResult.fallbackReasons, ...slowResult.fallbackReasons];

    return {
      productProfileAnalysis: fastResult.productProfileAnalysis,
      customerProfileAnalysis: fastResult.customerProfileAnalysis,
      keywordGroups: fastResult.keywordGroups,
      searchQueries: slowResult.searchQueries,
      keywordPool: slowResult.keywordPool,
      profileSignals: {
        enabled: true,
        querySource: slowResult.aiQueryCount ? "gpt55_only" : "gpt55_failed_or_rejected",
        gptSearchQueryCount: slowResult.aiQueryCount,
        gptRefillAttempts: slowResult.gptRefillAttempts,
        gptRefillAcceptedCount: slowResult.gptRefillAcceptedCount,
        fallbackQueryCount: 0,
        rejectedQueryCount: slowResult.rejectedAiQueries.length,
        rejectedQueries: slowResult.rejectedAiQueries,
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
    targetMarketProfiles: buildTargetMarketProfiles(input.targetMarkets),
    operatorLibrary: input.operatorLibrary,
    minQueryCount: input.minQueryCount
  };
}

function buildTargetMarketProfiles(targetMarkets: string[]) {
  return targetMarkets.map((market, index) => {
    const countryName = normalizeSearchTargetCountry(market);
    const resolved = resolveCountry(countryName) ?? resolveCountry(market);
    const phoneCode = countryToPhoneCode(countryName);
    const tld = marketToSite(countryName);
    const anchors = uniqueStrings([
      countryName,
      resolved?.name ?? "",
      resolved?.code ?? "",
      ...queryMarketAliases(countryName),
      phoneCode ?? "",
      tld
    ]).filter(Boolean);

    return {
      country: resolved?.code ?? countryName.slice(0, 2).toUpperCase(),
      countryName,
      tier: index < 5 ? 1 : 2,
      language: "en",
      anchors,
      phoneCode,
      tlds: tld === ".com" ? [] : [tld]
    };
  });
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
  const values = uniqueStrings([
    ...expansion.primaryProducts,
    ...expansion.relatedProducts,
    ...expansion.industryScenarioTerms,
    ...expansion.upstreamDownstreamTerms,
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
    .filter(
      (term) =>
        hasSpecificModelOrSkuSignal(term) ||
        keywordGroups.brandTerms.some((brand) =>
          new RegExp(`\\b${quoteRegExp(brand)}\\b`, "i").test(term)
        )
    )
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
    hasSpecificModelOrSkuSignal(normalized) ||
    normalized.length >= 4
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
    const rawQueryText = searchPlanQueryText(query);
    const executionStatus = query.executionStatus ?? query.engineCompatibility;
    const strategyType = normalizeAiSearchStrategyType(query.strategyType);
    const rawCountry = [query.country, query.countryName].filter(Boolean).join(" ");

    if (!rawQueryText) {
      rejected.push({
        query: "",
        country: rawCountry,
        reason: "empty_query"
      });
      continue;
    }

    if (!supportedStatuses.has(executionStatus)) {
      rejected.push({
        query: rawQueryText,
        country: rawCountry,
        reason: `unsupported_execution_status:${executionStatus}`
      });
      continue;
    }

    if (isAiIntelligenceSearchQuery(query, rawQueryText)) {
      rejected.push({
        query: rawQueryText,
        country: rawCountry,
        reason: "intelligence_query_not_customer_search"
      });
      continue;
    }

    if (!isStrategyTypeWithinBudget(output, strategyType, channelCustomersRequested, minQueryCount)) {
      rejected.push({
        query: rawQueryText,
        country: rawCountry,
        reason: `strategy_budget_exceeded:${strategyType ?? "unknown"}`
      });
      continue;
    }

    const countryResolution = resolveAiQueryCountry(
      rawCountry,
      rawQueryText,
      countryPool,
      output.length
    );
    if (!countryResolution.country) {
      rejected.push({
        query: rawQueryText,
        country: rawCountry,
        reason: countryResolution.reason
      });
      continue;
    }

    const country = countryResolution.country;
    const queryNormalization = normalizeAiQueryText(
      rawQueryText,
      country,
      keywordGroups,
      countryPool
    );
    if (!queryNormalization.query) {
      rejected.push({
        query: rawQueryText,
        country: rawCountry,
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
        query: rawQueryText,
        country: rawCountry,
        reason: "intelligence_query_not_main_customer_search"
      });
      continue;
    }

    if (!hasEnoughQuerySignals(queryText, keywordGroups, country)) {
      rejected.push({
        query: rawQueryText,
        country: rawCountry,
        reason: "missing_product_customer_or_market_signal"
      });
      continue;
    }

    seen.add(queryText.toLowerCase());
    output.push({
      provider: "brave",
      operatorSource: query.operatorSource as OperatorSource,
      executionStatus: executionStatus as "supported" | "experimental",
      operatorName:
        strategyType === "channel_customer"
          ? "GPT-5.5 channel buyer search"
          : "GPT-5.5 main buyer search",
      strategyTemplate: query.rationale,
      strategyType,
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

function searchPlanQueryText(query: SearchStrategyPlan["queries"][number]) {
  return (query.coreQuery ?? query.query ?? "").replace(/\s+/g, " ").trim();
}

function normalizeAiSearchStrategyType(
  strategyType: SearchStrategyPlan["queries"][number]["strategyType"]
) {
  switch (strategyType) {
    case "channel_customer":
    case "channel":
      return "channel_customer";
    case "main_customer":
    case "buyer_scenario":
    case "product_group":
    case "brand_ecosystem":
    case "model_specific":
      return "main_customer";
    case "intelligence":
    case "procurement_event":
      return "intelligence";
    default:
      return "main_customer";
  }
}

function isAiIntelligenceSearchQuery(
  query: SearchStrategyPlan["queries"][number],
  rawQueryText: string
) {
  return (
    normalizeAiSearchStrategyType(query.strategyType) === "intelligence" ||
    (query.intelligenceType ?? "none") !== "none" ||
    (query.expectedResultType ?? "company_site") !== "company_site" ||
    /\b(?:rfq|request for quotation|tender|bid|procurement notice|vendor registration|supplier registration|filetype:|linkedin\.com|yellow pages|directory|buyer inquiry|buying lead|exhibitor list|participant list)\b/i.test(
      rawQueryText
    )
  );
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
  const normalizedType = normalizeAiSearchStrategyType(
    strategyType as SearchStrategyPlan["queries"][number]["strategyType"]
  );
  switch (normalizedType) {
    case "main_customer":
      return 0;
    case "channel_customer":
      return 1;
    case "intelligence":
      return 9;
    default:
      return 0;
  }
}

function isStrategyTypeWithinBudget(
  existingQueries: PlannedSearchQuery[],
  strategyType: SearchStrategyPlan["queries"][number]["strategyType"],
  channelCustomersRequested: boolean,
  targetQueryCount: number
) {
  const normalizedType = normalizeAiSearchStrategyType(strategyType);
  if (normalizedType === "intelligence") {
    return false;
  }

  if (normalizedType === "channel_customer" && !channelCustomersRequested) {
    return false;
  }

  const channelLimit = Math.max(
    0,
    Math.round(
      (targetQueryCount / DEFAULT_SEARCH_QUERY_COUNT) * DEFAULT_CHANNEL_CUSTOMER_QUERY_COUNT
    )
  );
  const limits: Record<string, number> = {
    main_customer: targetQueryCount || DEFAULT_MAIN_CUSTOMER_QUERY_COUNT,
    channel_customer: channelCustomersRequested
      ? channelLimit || DEFAULT_CHANNEL_CUSTOMER_QUERY_COUNT
      : 0,
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
  _keywordGroups: KeywordGroups,
  targetMarkets: string[]
): { query: string; reason: string } {
  const cleaned = query.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return { query: "", reason: "empty_query" };
  }

  let sanitized = stripGeneratedNegativeTerms(
    stripEvidenceNegativeTerms(removeQuotedMarketPhrases(cleaned, targetMarkets))
  );

  // 2026-05 P1: GPT frequently generates quoted phrases with 4-5 words
  // (e.g. "mobile network base station deployment") which produce 0
  // Brave results because exact-match on that many words is too narrow
  // for niche B2B markets. Shorten any quoted phrase longer than 3 words
  // by keeping only the first 3 words and removing the quotes, turning
  // it into a fuzzy match. Phrases inside OR groups are left alone
  // because they are typically brand names (1-2 words).
  sanitized = shortenLongQuotedPhrases(sanitized);
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
  const compactedCore = reduceQueryComplexity(withCountry).replace(/\s+$/, "");
  const compacted = appendBackendSearchExclusions(compactedCore);

  const remainingConflicts = findMentionedKnownMarkets(
    stripGeneratedNegativeTerms(compacted)
  ).filter((market) => !marketMatches(country, market));
  if (remainingConflicts.length) {
    return { query: "", reason: `market_conflict:${remainingConflicts.slice(0, 3).join(",")}` };
  }

  return { query: compacted, reason: "ok" };
}

function queryMentionsCountry(query: string, country: string) {
  const lower = query.toLowerCase();
  const phoneCode = countryToPhoneCode(country);
  const countrySite = marketToSite(country);
  return (
    lower.includes(country.toLowerCase()) ||
    lower.includes(normalizeCountryAlias(country).toLowerCase()) ||
    Boolean(phoneCode && lower.includes(phoneCode.toLowerCase())) ||
    (countrySite !== ".com" && lower.includes(countrySite.toLowerCase()))
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

function stripGeneratedNegativeTerms(query: string) {
  return query
    .replace(/(^|\s)-[a-z]+:"[^"]*"/gi, " ")
    .replace(/(^|\s)-(?:"[^"]+"|\S+)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 2026-05 (P0 fix): Backend exclusions are now actually appended to the
// Brave query. The previous no-op design was wrong: while Brave does not
// reliably honor `-site:alibaba.com` against marketplace giants, it DOES
// reliably honor `-site:` against single-domain OEM / encyclopedia /
// trade-media filters. The previous design left Lane B brand-OR queries
// (e.g. `("Flowserve" OR "Emerson") UAE pumps`) returning 80%+ OEM-self
// pages in the top 20 results, crowding out real buyer companies.
//
// Strategy:
//  1. Always exclude Wikipedia (industry-agnostic, 100% noise).
//  2. For Lane B queries with a brand OR group, parse brand names out of
//     the OR group and exclude each brand's likely official domain. This
//     applies to ANY industry (Flowserve, KSB, Sulzer, Schneider, etc.)
//     because the rule is structural (OR group with quoted brand names),
//     not a hard-coded telecom brand list.
//  3. Skip exclusion when the query already uses site:.tld (Lane A) or
//     site:reference_customer (Lane D) — those lanes are already locked
//     to the target country / reference network.
//  4. Hard cap: at most 3 -site: terms per query, total length <= 180.
//
// The post-search hard-reject filter (lead-qualification.service) is
// kept as the second line of defense for marketplaces, news sites, and
// directory pages where -site: would consume too many query slots.

// Industry-agnostic exclusions appended to every applicable query.
// Wikipedia is always noise; trade-media domains return news, not buyer
// pages. Kept to 1 entry to minimize query budget — the rest are caught
// by the post-search hard-reject filter.
const universalNegativeSiteExclusions: string[] = ["wikipedia.org"];

// Brand-name -> official-domain hint. When a brand name appears in a
// query OR group AND its mapped domain is a known OEM/manufacturer
// official site, we add `-site:<domain>` so the OEM's own product /
// about / contact pages do not flood the top-20 result slots.
//
// Each brand maps to ONE primary domain so that an OR group of N
// brands can be excluded with exactly N -site: terms. Listing multiple
// domains per brand wastes budget and would hide the most-recognized
// canonical site for users who could understand the result.
const brandNameToOfficialDomain: Record<string, string> = {
  // Telecom OEMs
  huawei: "huawei.com",
  zte: "zte.com.cn",
  ericsson: "ericsson.com",
  nokia: "nokia.com",
  "alcatel-lucent": "alcatel-lucent.com",
  // Industrial pumps / valves / flow control
  flowserve: "flowserve.com",
  emerson: "emerson.com",
  ksb: "ksb.com",
  sulzer: "sulzer.com",
  grundfos: "grundfos.com",
  pentair: "pentair.com",
  weir: "global.weir",
  itt: "itt.com",
  rotork: "rotork.com",
  metso: "metso.com",
  fisher: "fisher.com",
  tyco: "tycoflowcontrol.com",
  // Industrial automation / electrical
  abb: "abb.com",
  siemens: "siemens.com",
  schneider: "se.com",
  honeywell: "honeywell.com",
  yokogawa: "yokogawa.com",
  rockwell: "rockwellautomation.com",
  // HVAC / mechanical
  daikin: "daikin.com",
  trane: "trane.com",
  carrier: "carrier.com",
  york: "johnsoncontrols.com",
  mitsubishi: "mitsubishielectric.com"
};

function extractQuotedOrGroupBrands(query: string): string[] {
  // Match a parenthesized OR group with at least one quoted phrase, e.g.
  //   ("Flowserve" OR "Emerson")  or  ("Flowserve" OR "KSB" OR "Sulzer")
  const orGroupMatch = query.match(/\(\s*(?:"[^"]+"\s+OR\s+)+"[^"]+"\s*\)/i);
  if (!orGroupMatch) {
    return [];
  }
  const phrases = Array.from(orGroupMatch[0].matchAll(/"([^"]+)"/g)).map((m) =>
    (m[1] ?? "").trim().toLowerCase()
  );
  return phrases.filter(Boolean);
}

function brandsToExcludedDomains(brands: string[]): string[] {
  const domains = new Set<string>();
  for (const brand of brands) {
    const key = brand.toLowerCase().trim();
    const mapped = brandNameToOfficialDomain[key];
    if (mapped) {
      domains.add(mapped);
    }
  }
  return Array.from(domains);
}

function queryAlreadyAnchoredToTargetSite(query: string): boolean {
  // Lane A: site:.{tld} (.ae, .sa, .qa, etc.) — already locked to the
  // target country, no need for OEM exclusions which would only shrink
  // the result pool further.
  if (/site:\.[a-z]{2,4}(?:\s|$)/i.test(query)) {
    return true;
  }
  // Lane D: site:reference_customer_domain — query is intentionally
  // narrowed to one specific company's own site, so OEM exclusions
  // would do nothing useful.
  if (/site:[a-z0-9.-]+\.[a-z]{2,}\b/i.test(query) && !/site:\.[a-z]{2,4}\b/i.test(query)) {
    return true;
  }
  return false;
}

function appendBackendSearchExclusions(query: string) {
  const cleaned = query.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return cleaned;
  }

  // Skip exclusion injection for queries that are already site-anchored.
  // For Lane A (site:.ae) and Lane D (site:reference.com) the result
  // pool is intentionally narrow; adding -site: would only erode it.
  if (queryAlreadyAnchoredToTargetSite(cleaned)) {
    return cleaned;
  }

  const exclusionsToAdd: string[] = [];

  // 1. Universal exclusions (Wikipedia, etc.).
  for (const domain of universalNegativeSiteExclusions) {
    exclusionsToAdd.push(`-site:${domain}`);
  }

  // 2. Brand OR-group -> OEM official domains.
  const brands = extractQuotedOrGroupBrands(cleaned);
  const brandDomains = brandsToExcludedDomains(brands);
  const hasRecognizedBrandGroup = brandDomains.length > 0;
  for (const domain of brandDomains) {
    if (exclusionsToAdd.length >= 5) {
      break; // budget: max 5 -site: terms incl. universals + linkedin
    }
    exclusionsToAdd.push(`-site:${domain}`);
  }

  // 3. Lane B branded OR-group queries: LinkedIn brand pages and
  // Thomasnet directory consistently flood the top 20 results because
  // Brave indexes them as the "official" social/aggregator presence
  // for big OEMs. We only add these when a recognized brand group is
  // present so non-brand queries can still surface real LinkedIn
  // company pages of buyer prospects.
  if (hasRecognizedBrandGroup && exclusionsToAdd.length < 5) {
    exclusionsToAdd.push("-site:linkedin.com");
  }

  if (exclusionsToAdd.length === 0) {
    return cleaned;
  }

  // Compose, then trim while respecting the 180-char hard cap. We append
  // exclusions from highest to lowest priority (universal first, then
  // brand). If the composed string exceeds 180 chars, drop the lowest-
  // priority exclusions one at a time until it fits.
  let composed = `${cleaned} ${exclusionsToAdd.join(" ")}`.replace(/\s+/g, " ").trim();
  while (composed.length > 180 && exclusionsToAdd.length > 0) {
    exclusionsToAdd.pop();
    composed = `${cleaned}${exclusionsToAdd.length ? " " + exclusionsToAdd.join(" ") : ""}`
      .replace(/\s+/g, " ")
      .trim();
  }

  return composed;
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

// 2026-05 P1: Shorten quoted phrases that are too long for Brave exact-
// match. In niche B2B markets (telecom, industrial, GCC), a 4-5 word
// exact phrase like "mobile network base station deployment" returns 0
// results because no page contains that exact string. We keep the first
// 3 words as bare (unquoted) text so Brave can fuzzy-match them.
//
// Exception: phrases inside parenthesized OR groups are left alone
// because they are typically short brand names or 2-word buyer roles.
function shortenLongQuotedPhrases(query: string) {
  // First, identify OR-group regions so we can skip them.
  const orGroupRanges: Array<[number, number]> = [];
  for (const match of query.matchAll(/\([^)]*\bOR\b[^)]*\)/gi)) {
    orGroupRanges.push([match.index!, match.index! + match[0].length]);
  }

  function isInsideOrGroup(index: number) {
    return orGroupRanges.some(([start, end]) => index >= start && index < end);
  }

  return query.replace(/"([^"]+)"/g, (match, phrase: string, offset: number) => {
    if (isInsideOrGroup(offset)) {
      return match; // leave OR-group phrases alone
    }
    const words = phrase.trim().split(/\s+/);
    if (words.length <= 3) {
      return match; // short enough, keep quoted
    }
    // Keep first 3 words unquoted for fuzzy matching
    return words.slice(0, 3).join(" ");
  });
}

// 2026-05 P1: A reference company name may come back from GPT as a
// slash-joined alias bundle (e.g. "HCT Group / High Cloud Technologies"
// or "stc / Saudi Telecom Company"). Brave exact-matches the full quoted
// string and returns 0 results. We pick the SHORTEST alias from the
// slash split, which is usually the canonical short brand name. As a
// secondary safeguard, we also drop trailing legal-entity suffixes that
// hurt exact match (LLC, FZE, FZCO, etc.).
function trimReferenceCompanyName(name: string): string {
  const aliases = name
    .split(/\s*[\/|,]\s*/)
    .map((alias) => alias.trim())
    .filter(Boolean);
  if (aliases.length === 0) {
    return name.trim();
  }
  // Prefer the alias that has 2-3 words (most searchable). Fall back to
  // the shortest alias by word count.
  const sortedByWordCount = [...aliases].sort(
    (a, b) => a.split(/\s+/).length - b.split(/\s+/).length
  );
  const idealAlias = sortedByWordCount.find((a) => {
    const wc = a.split(/\s+/).length;
    return wc >= 1 && wc <= 4;
  });
  return (idealAlias ?? sortedByWordCount[0] ?? name).trim();
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
  // 2026-05: Lane A (`site:.{tld} ...`) and Lane B (`("Brand" OR
  // "Brand") "{role}" {country}`) and Lane D (`site:{ref_domain}` /
  // `"{ref_company}" ...`) queries do not need an explicit entry-point
  // word like "contact" or "services" — they already carry strong
  // geographic / brand / reference anchoring. Treat the structural
  // anchor as a substitute entry point so the validator doesn't reject
  // perfectly good Lane-A/B/D queries.
  const hasLocalTldAnchor = /\bsite:\.[a-z]{2,3}(?:\.[a-z]{2})?\b/i.test(query);
  const hasReferenceSiteAnchor = /\bsite:[a-z0-9.-]+\.(?:com|co|io|net|ae|sa|qa|om|kw|ng|br|ru|de|fr|it|es|nl|in)\b/i.test(query);
  const hasBrandOrGroupAnchor =
    /\(\s*"[^"]+"(?:\s+OR\s+"[^"]+")+\s*\)/i.test(query) &&
    extractKnownBrandTerms([query]).length >= 2;
  const hasStructuralEntryPointSubstitute =
    hasLocalTldAnchor || hasReferenceSiteAnchor || hasBrandOrGroupAnchor;
  // 2026-05: Lane D name-pivot queries pivot off a reference customer
  // name (in quotes) and use "client" / "partner" / "case study" /
  // "deployment" as the verb. The reference name IS the customer
  // signal; we should not also demand a separate buyer-role word in
  // the same query. Detect this pattern and treat it as buyer-role
  // satisfied.
  const referenceNamePivot =
    /"[^"]{2,80}"\s*(?:\(\s*"?(?:client|clients|partner|partners|case stud(?:y|ies)|deployment|deployments|reference|references)"?(?:\s+OR\s+"?(?:client|clients|partner|partners|case stud(?:y|ies)|deployment|deployments|reference|references)"?)*\s*\)|"(?:client|clients|partner|partners|case stud(?:y|ies)|deployment|deployments|reference|references)")/i.test(
      query
    );
  // 2026-05: Lane F catalog/inventory queries already carry buying
  // intent in the catalog vocabulary. Treat catalog vocabulary as a
  // buyer-role substitute for this lane.
  const inventoryIntentPivot = /(?:"in stock"|"available stock"|"ready stock"|"spot stock"|"spare parts list"|"product catalog"|"product catalogue"|"stock list"|"available inventory")/i.test(
    query
  );
  const hasBuyerRoleSubstitute = referenceNamePivot || inventoryIntentPivot;
  const hasSellerOnlyTrap =
    querySellerOnlyTerms.some((term) => lower.includes(term)) && !hasBuyerRole;
  const hasProductOrIndustryContext =
    hasProduct || hasModelOrSku || hasSpecificIndustryQueryContext(lower);

  return (
    hasCountry &&
    !hasSellerOnlyTrap &&
    hasProductOrIndustryContext &&
    (hasBuyerRole || hasBuyerRoleSubstitute) &&
    (hasEntryPoint || hasStructuralEntryPointSubstitute)
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
  "about",
  "services",
  "solutions",
  "projects",
  "locations",
  "offices",
  "company",
  "inquiry",
  "enquiry",
  "team",
  "our team",
  "who we are",
  "imprint",
  // 2026-05: Lane D (reference-customer reverse network) queries hunt
  // for pages that mention the reference company as a client / partner
  // / deployment. These words are themselves valid entry points.
  "client",
  "clients",
  "partner",
  "partners",
  "case study",
  "case studies",
  "deployment",
  "deployments",
  "reference",
  "references",
  // 2026-05: Lane F (catalog / inventory) queries anchor on a buyer's
  // sourcing intent. Inventory and catalog vocabulary IS the entry
  // point — these queries land directly on a stockist's product page
  // or a distributor's catalog, so the validator should treat them as
  // valid entry points without also demanding a contact / about word.
  "in stock",
  "available stock",
  "ready stock",
  "spot stock",
  "spare parts list",
  "product catalog",
  "product catalogue",
  "stock list",
  "available inventory"
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
  "private 5g",
  "private 5g solutions",
  "private 5g integrator",
  "telecom power systems",
  "telecom power service",
  "telecom power services",
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
  "field engineering",
  "engineering",
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

// 2026-05: reverse-customer-network query injection.
//
// We turn each successfully-read reference customer (the "look-alike
// model" the user provided) into 0-cost extra Brave queries:
//   1. site:{ref_domain} ("clients" OR "partners" OR "case studies"
//      OR "deployments")     — mines the reference's published client
//      / partner / case-study lists.
//   2. "{ref_company_name}" ("client" OR "partner" OR "deployment")
//      {region}                — finds OTHER companies whose own pages
//      mention the reference (often their integration partners or
// 2026-05 V1-MVP: Extract Lane K builder so it can be called from the
// fast planning phase (after expand_keywords) BEFORE GPT search-strategy
// runs. The fast path uses keywordGroups + product/customer profile
// analysis as the source. The slow path can later refine with
// keywordPool from GPT search-strategy if it produces one.
function buildLaneKQueriesFromKeywordGroups(input: {
  keywordGroups: KeywordGroups;
  productProfileAnalysis: Record<string, unknown>;
  customerProfileAnalysis: Record<string, unknown>;
  targetMarkets: string[];
  maxQueries: number;
  keywordPool?: {
    productTerms?: string[];
    buyerRoles?: string[];
    scenarioTerms?: string[];
    excludeFromKeywords?: string[];
  };
}): PlannedSearchQuery[] {
  const {
    keywordGroups,
    productProfileAnalysis,
    customerProfileAnalysis,
    targetMarkets,
    maxQueries,
    keywordPool
  } = input;

  const productProfile = productProfileAnalysis as ProductProfileAnalysis;
  const customerProfile = customerProfileAnalysis as CustomerProfileAnalysis;

  const fallbackProductTerms = uniqueStrings([
    ...asStringArray(productProfile?.keyProducts).slice(0, 6),
    ...asStringArray(productProfile?.productCategories).slice(0, 4),
    ...keywordGroups.productTerms.slice(0, 6)
  ])
    .filter((term) => isConcreteQueryProductTerm(term))
    .slice(0, 8);
  const fallbackBuyerRoles = uniqueStrings([
    ...asStringArray(customerProfile?.idealCustomerTypes).slice(0, 6),
    ...keywordGroups.customerIntentTerms.slice(0, 6)
  ]).slice(0, 6);
  const fallbackScenarioTerms = uniqueStrings([
    ...asStringArray(productProfile?.targetUseCases).slice(0, 4),
    ...keywordGroups.scenarioTerms.slice(0, 4)
  ]).slice(0, 6);

  return buildLaneKQueries({
    productTerms:
      keywordPool?.productTerms?.length && keywordPool.productTerms.length > 0
        ? keywordPool.productTerms
        : fallbackProductTerms.length > 0
          ? fallbackProductTerms
          : keywordGroups.productTerms.slice(0, 8),
    buyerRoles:
      keywordPool?.buyerRoles?.length && keywordPool.buyerRoles.length > 0
        ? keywordPool.buyerRoles
        : fallbackBuyerRoles.length > 0
          ? fallbackBuyerRoles
          : ["distributor", "stockist", "maintenance company", "contractor"],
    scenarioTerms:
      keywordPool?.scenarioTerms?.length && keywordPool.scenarioTerms.length > 0
        ? keywordPool.scenarioTerms
        : fallbackScenarioTerms,
    countries: (targetMarkets ?? []).filter(
      (market) => market && !isMacroMarket(market)
    ),
    keywordGroups,
    maxQueries,
    excludeTerms: keywordPool?.excludeFromKeywords
  });
}


//
// 2026-05: Instead of asking GPT to write 30+ complex search queries
// (which takes 7-8 minutes and produces 35-50% zero-hit queries), we
// let GPT output a keyword pool (product terms, buyer roles, scenario
// terms) and the backend assembles short, high-hit-rate Brave queries
// via cartesian product. This approach:
//   - Reduces GPT time from 7-8 min to ~1.5 min (GPT only writes
//     keyword pool + 12-20 Lane B/C/D queries)
//   - Produces queries with <15% zero-hit rate (short natural phrases)
//   - Scales easily for "continue search" batches (just add more combos)
//
// Three tiers:
//   K1: productTerm + country (widest, highest hit rate, most noise)
//   K2: productTerm + buyerRole + country (balanced)
//   K3: scenarioTerm + buyerRole + country (most precise)

type LaneKInput = {
  productTerms: string[];
  buyerRoles: string[];
  scenarioTerms: string[];
  countries: string[];
  keywordGroups: KeywordGroups;
  maxQueries: number;
  excludeTerms?: string[];
};

function buildLaneKQueries(input: LaneKInput): PlannedSearchQuery[] {
  const {
    productTerms,
    buyerRoles,
    scenarioTerms,
    countries,
    keywordGroups,
    maxQueries,
    excludeTerms = []
  } = input;

  if (!productTerms.length || !countries.length) {
    return [];
  }

  const queries: PlannedSearchQuery[] = [];
  const seen = new Set<string>();

  function addQuery(text: string, country: string, tier: string) {
    const key = text.toLowerCase().trim();
    if (seen.has(key) || queries.length >= maxQueries) {
      return;
    }
    // Skip if query contains an excluded term
    const lower = key;
    if (excludeTerms.some((term) => lower.includes(term.toLowerCase()))) {
      return;
    }
    seen.add(key);
    queries.push({
      provider: "brave",
      operatorSource: "brave_official",
      executionStatus: "supported",
      operatorName: `Lane K ${tier} keyword combination`,
      strategyTemplate: `lane-K-${tier}`,
      strategyType: "main_customer",
      query: text.trim(),
      keywordGroups,
      country,
      effectivenessScore: tier === "K2" ? 0.75 : tier === "K3" ? 0.7 : 0.65,
      templateId: `lane_k_${tier.toLowerCase()}`
    });
  }

  // Distribute queries across countries round-robin style.
  // 2026-05: Country is the OUTERMOST loop axis so each country gets
  // at least one product+role combo before any country gets a second.
  // Previously we iterated product × role inside the country loop,
  // which meant a single country could exhaust the maxQueries budget
  // before other countries got any Lane K queries at all.
  const countryPool = countries.length ? countries : ["UAE"];

  // K2 true round-robin: rotate (product, role, country) using modular
  // indexing so all 3 axes get coverage even at low maxQueries.
  // For maxQueries=20 with 8 products × 4 roles × 5 countries:
  //   slot 0: product[0] role[0] country[0]
  //   slot 1: product[1] role[0] country[1]
  //   slot 2: product[2] role[0] country[2]
  //   slot 3: product[3] role[0] country[3]
  //   slot 4: product[4] role[0] country[4]
  //   slot 5: product[5] role[1] country[0]
  //   ... (each slot rotates all axes by 1)
  const k2Cap = Math.min(maxQueries, productTerms.length * buyerRoles.length * countryPool.length);
  for (let slot = 0; slot < k2Cap * 3 && queries.length < k2Cap; slot++) {
    const product = productTerms[slot % productTerms.length]!;
    const role = buyerRoles[Math.floor(slot / productTerms.length) % buyerRoles.length]!;
    const country = countryPool[slot % countryPool.length]!;
    addQuery(`${product} ${role} ${country}`, country, "K2");
  }

  // K3 round-robin: same pattern with scenario × role × country
  if (scenarioTerms.length > 0) {
    const k3Combos: Array<{ scenario: string; role: string }> = [];
    for (const scenario of scenarioTerms) {
      for (const role of buyerRoles.slice(0, 3)) {
        k3Combos.push({ scenario, role });
      }
    }
    for (const combo of k3Combos) {
      for (const country of countryPool) {
        if (queries.length >= maxQueries) break;
        addQuery(`${combo.scenario} ${combo.role} ${country}`, country, "K3");
      }
      if (queries.length >= maxQueries) break;
    }
  }

  // K1 fill: product + country (no role) — used to fill remaining slots
  for (const product of productTerms) {
    for (const country of countryPool) {
      if (queries.length >= maxQueries) break;
      addQuery(`${product} ${country}`, country, "K1");
    }
    if (queries.length >= maxQueries) break;
  }

  return queries;
}

// ---- End Lane K ----

//      adjacent vendors who will buy similar products).
//
// This Lane D safety net runs regardless of whether GPT generated any
// reference-customer queries on its own. The two patterns mirror the
// LANE D guidance in the search-strategy prompt and are intentionally
// kept short so they survive Brave's query-length budget.
function buildReverseCustomerNetworkQueries(input: {
  siteEvidence: ProfileSiteEvidence;
  customerProfileAnalysis: Record<string, unknown>;
  keywordGroups: KeywordGroups;
  targetMarkets?: string[];
}): PlannedSearchQuery[] {
  const readReferenceSites = (input.siteEvidence.referenceCustomerSites ?? []).filter(
    (site: WebsiteEvidence) => site.status === "read" && Boolean(site.finalUrl)
  );
  if (readReferenceSites.length === 0) {
    return [];
  }

  const referenceCompanies = asStringArray(input.customerProfileAnalysis.referenceCompanies);
  const targetMarkets = (input.targetMarkets ?? []).filter(
    (market) => market && !isMacroMarket(market)
  );
  const primaryMarket = targetMarkets[0] ?? "";
  const secondaryMarket = targetMarkets[1] ?? primaryMarket;
  const queries: PlannedSearchQuery[] = [];

  for (let index = 0; index < readReferenceSites.length; index += 1) {
    const site = readReferenceSites[index]!;
    const domain = referenceSiteDomain(site);
    if (!domain) {
      continue;
    }

    // Pattern A: mine the reference's own client / partner pages.
    queries.push({
      provider: "brave",
      operatorSource: "brave_official",
      executionStatus: "supported",
      operatorName: "Reverse customer network mining",
      strategyTemplate: "lane-D reference-customer reverse network",
      strategyType: "main_customer",
      query:
        `site:${domain} ("clients" OR "partners" OR "case studies" OR "deployments")`.slice(0, 140),
      keywordGroups: input.keywordGroups,
      country: primaryMarket || null,
      effectivenessScore: 0.9,
      templateId: "reverse_network_site"
    });

    // Pattern B: pivot off the reference COMPANY name to find buyers
    // whose own pages talk about the reference.
    const referenceName = referenceCompanies[index] ?? referenceCompanyFromDomain(domain);
    if (referenceName) {
      const market = secondaryMarket || primaryMarket;
      const trailingMarket = market ? ` ${market}` : "";
      // 2026-05 P1: GPT may emit referenceCompanies entries that combine
      // two names with "/" (e.g. "HCT Group / High Cloud Technologies"),
      // producing a 6-word quoted phrase that returns 0 Brave results.
      // Pick the first short alternative if the slash form is too long.
      const safeName = trimReferenceCompanyName(referenceName);
      queries.push({
        provider: "brave",
        operatorSource: "brave_official",
        executionStatus: "supported",
        operatorName: "Reverse customer network mining",
        strategyTemplate: "lane-D reference-customer name pivot",
        strategyType: "main_customer",
        query: `"${safeName}" ("client" OR "partner" OR "deployment")${trailingMarket}`.slice(
          0,
          140
        ),
        keywordGroups: input.keywordGroups,
        country: market || null,
        effectivenessScore: 0.85,
        templateId: "reverse_network_name"
      });
    }
  }

  return queries;
}

function mergeSearchQueriesPreservingOrder(
  base: PlannedSearchQuery[],
  injected: PlannedSearchQuery[]
): PlannedSearchQuery[] {
  if (injected.length === 0) {
    return base;
  }
  const seen = new Set(base.map((query) => normalizeForDedup(query.query)));
  const merged = [...base];
  for (const query of injected) {
    const key = normalizeForDedup(query.query);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(query);
  }
  return merged;
}

function normalizeForDedup(query: string) {
  return query.replace(/\s+/g, " ").trim().toLowerCase();
}

function referenceSiteDomain(site: WebsiteEvidence) {
  const url = site.finalUrl ?? site.url;
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function referenceCompanyFromDomain(domain: string) {
  const stripped = domain.replace(/\.[a-z]{2,}(?:\.[a-z]{2})?$/i, "");
  if (!stripped) {
    return null;
  }
  return stripped
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isMacroMarket(market: string) {
  const normalized = market.trim().toLowerCase();
  return [
    "global",
    "worldwide",
    "international",
    "middle east",
    "mena",
    "gcc",
    "africa",
    "north africa",
    "europe",
    "latin america",
    "latam",
    "americas",
    "north america",
    "asia",
    "southeast asia",
    "south asia",
    "central asia",
    "oceania"
  ].includes(normalized);
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

  return value.filter(isCustomerListLeadVisible).map((lead) => {
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

function isCustomerListLeadVisible(lead: unknown) {
  const row = toPlainObject(lead);
  const status = typeof row.status === "string" ? row.status : "";
  return !CUSTOMER_LIST_HIDDEN_LEAD_STATUSES.includes(
    status as (typeof CUSTOMER_LIST_HIDDEN_LEAD_STATUSES)[number]
  );
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
    kuwait: "Kuwait",
    kw: "Kuwait",
    "kuwait city": "Kuwait",
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
    [/\bkuwait\b|\bkw\b|\u79d1\u5a01\u7279/i, ["Kuwait"]],
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
  customerProfile?: {
    targetRegions?: string[];
    referenceCustomerUrls?: string[];
    notes?: string | null;
  } | null;
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
  // 2026-05 P1+: extract reference-customer domains. These are
  // companies the seller gave us as look-alike evidence; they should
  // never be classified as new buyer leads. Lane D Pattern A
  // (site:reference.com) queries call them out explicitly, and
  // shouldHardRejectCandidate uses this list to drop the reference's
  // own pages from the candidate table.
  const referenceCustomerDomains = domainsFromUrls(
    asStringArray(payload.customerProfile?.referenceCustomerUrls)
  );

  return {
    targetRegions: targetRegions.length ? targetRegions : profileRegions,
    productKeywords: [
      ...asStringArray(keywordGroups.productTerms).slice(0, 8),
      ...asStringArray(keywordGroups.longTailProductTerms).slice(0, 6)
    ],
    customerTypeKeywords: asStringArray(keywordGroups.customerIntentTerms).slice(0, 8),
    ownDomains,
    brandTerms: asStringArray(keywordGroups.brandTerms).slice(0, 12),
    referenceCustomerDomains,
    // 2026-05 P0: fuzzy company-name match for reference customers.
    // Extracted from GPT's customerProfileAnalysis.referenceCompanies
    // (which typically contains ["HCT Group", "Spectrum MEA"]).
    referenceCustomerNames: asStringArray(
      payload.customerProfileAnalysis?.referenceCompanies
    ).slice(0, 10),
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

function countryToPhoneCode(country: string) {
  const code = resolveCountry(country)?.code;
  const phoneCodes: Record<string, string> = {
    AE: "+971",
    SA: "+966",
    QA: "+974",
    OM: "+968",
    KW: "+965",
    BH: "+973",
    JO: "+962",
    IQ: "+964",
    IR: "+98",
    NG: "+234",
    KE: "+254",
    ZA: "+27",
    EG: "+20",
    MA: "+212",
    GH: "+233",
    TZ: "+255",
    BR: "+55",
    RU: "+7",
    UA: "+380",
    CA: "+1",
    AU: "+61",
    DE: "+49",
    PL: "+48",
    US: "+1",
    GB: "+44",
    ID: "+62",
    MY: "+60",
    PH: "+63",
    TH: "+66",
    VN: "+84",
    MX: "+52",
    CO: "+57",
    CL: "+56",
    PE: "+51"
  };

  return code ? (phoneCodes[code] ?? null) : null;
}

function countryToBraveCode() {
  // Brave's `country` parameter is unreliable for our markets:
  // - It rejects long names like "Saudi Arabia" / "United Arab Emirates"
  //   and many region-style values, silently degrading to defaults.
  // - It biases the entire result set toward the chosen locale, which
  //   for US/SA pulls in irrelevant US/Alibaba content even when the
  //   query text already anchors to the target country.
  //
  // After the 2026-05 country-validation rework we drive geography
  // entirely through query text (country name, cities, local TLD
  // site: filters, reference-customer domains). Asking Brave for ALL
  // gives the broadest index and lets our text anchors do the work.
  return "ALL";
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
  // 2026-05: country verification was downgraded to a soft signal, so
  // candidates whose country is unconfirmed but otherwise look like
  // buyers now reach status="review" directly. The legacy
  // needs_country_review / country_conflict_review entries still appear
  // in historical rows, so we treat them as main candidates too — they
  // map to the same UI bucket today.
  return [
    "review",
    "qualified",
    "approved",
    "contacted",
    "email_sent",
    "needs_country_review",
    "country_conflict_review"
  ].includes(status ?? "");
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
