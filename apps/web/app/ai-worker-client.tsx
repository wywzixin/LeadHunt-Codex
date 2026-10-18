"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Download,
  Factory,
  Filter,
  Globe2,
  Mail,
  MessageCircle,
  MoreHorizontal,
  PhoneCall,
  Play,
  RadioTower,
  Search,
  Send,
  Sparkles,
  Star,
  SunMedium,
  Target,
  Trash2,
  Users,
  UsersRound,
  X
} from "lucide-react";
import { useAppMessage } from "./app-message";
import { AppShell } from "./app-shell";
import { TableLoadingState } from "./table-loading-state";
import {
  MailConfirmationModal,
  type MailConfirmationLead,
  type MailConfirmationRecipient,
  type MailSendResult
} from "./mail-confirmation-modal";

const defaultTaskPrompt =
  "帮我找某类产品相关的买家客户，优先找维护商、工程商、运营商、采购方、项目方和运维客户。";

// landingShortcuts / landingExamples were the legacy AiWorkerLanding
// catalog. They were removed alongside that component in 2026-05.

const fallbackMailLead: MailConfirmationLead = {
  companyName: "Gulf Telecom Supplies FZE",
  country: "UAE",
  website: "gulftelecom.ae",
  email: "sales@gulftelecom.ae",
  score: 88
};

const leadPageSize = 10;
const crmPageSize = 5;
// 2026-05 responsive cleanup: pool library page size is a pure data
// concern, not a layout concern. Layout density (column count, card
// width) is owned by CSS grid `auto-fill minmax(...)` so the same 30
// rows look right on 13" laptops and 4K monitors. We previously had a
// JS-driven `resolveWorkbenchPoolPageSize(width, height)` that returned
// 6/9/15/18 by viewport — that coupled business state to viewport size
// and broke on ultrawide / HiDPI / window-drag. Reverted to a fixed 30
// per page so users see the same data set across devices.
const workbenchPoolPageSize = 30;
const plannedBatchQueryCount = 30;
const taskPollIntervalMs = 2500;
const maxTaskPollAttempts = 720;

type ViewState = "workbench" | "pool" | "conversation";
type StepState = "done" | "active" | "pending" | "failed";
type WorkbenchPoolStatusFilter = "all" | "active" | "completed" | "stopped";

type KeywordGroups = {
  brandTerms?: string[];
  productTerms?: string[];
  longTailProductTerms?: string[];
  customerIntentTerms?: string[];
  marketTerms?: string[];
  scenarioTerms?: string[];
  excludeTerms?: string[];
};

type ProfileSignals = {
  productUrlsUsed?: string[];
  referenceCustomerUrlsUsed?: string[];
  productUrlsRead?: string[];
  referenceCustomerUrlsRead?: string[];
  failedUrlCount?: number;
  crmSampleCount?: number;
  marketSelection?: {
    targetMarkets?: string[];
    secondaryMarkets?: string[];
    promptMarkets?: string[];
    profileMarkets?: string[];
    marketSource?: "prompt" | "profile" | "merged" | "none" | string;
  };
  profileIndustryAlignment?: {
    productProfileConflicts?: boolean;
    customerProfileConflicts?: boolean;
    action?: string;
    message?: string | null;
  };
  continuationOptimization?: {
    action?: "keep_current_markets" | "focus_high_yield_markets" | string;
    reason?: "normal_continuation" | "recent_batch_low_yield" | string;
    recentBatchQueryCount?: number;
    recentBatchMainCustomerCount?: number;
    selectedMarkets?: string[];
    avoidedMarkets?: string[];
    highYieldMarkets?: string[];
    lowYieldMarkets?: string[];
  };
  queryLearning?: {
    targetAssessment?: QueryLearningTargetAssessment;
    batchMetrics?: Record<string, number>;
  };
  aiPlanning?: {
    rejectedQueryCount?: number;
    rejectedQueries?: Array<{ query?: string; country?: string; reason?: string }>;
  };
  qualityGate?: {
    action?: string;
    reasons?: string[];
    executedQueryCount?: number;
    pendingQueryCount?: number;
    remainingQueries?: number;
    samplePendingQueries?: Array<{
      query?: string;
      country?: string | null;
      strategyTemplate?: string | null;
      operatorName?: string | null;
    }>;
  };
  qualityFallbackSuggestion?: {
    action?: string;
    status?: string;
    queryCount?: number;
    sampleQueries?: Array<{ query?: string; country?: string | null; batchType?: string }>;
  };
};

type QueryLearningTargetAssessment = {
  status?: "pass" | "near" | "fail" | "collecting" | string;
  readinessScore?: number;
  queryBasis?: number;
  normalizedMetrics?: {
    queryBatchSize?: number;
    mainCustomersPer30?: number;
    highMatchCustomersPer30?: number;
    contactCoverage?: number;
    wrongCountryRatio?: number;
    rejectedRatio?: number;
    laneCoverageScore?: number;
    coveredLaneCount?: number;
    queryQualityCoverage?: number;
    customerTrustCoverage?: number;
  };
  laneCoverage?: {
    coveredCount?: number;
    requiredLaneCount?: number;
    totalTrackedLanes?: number;
    coverageScore?: number;
    coveredLanes?: Array<{ key?: string; label?: string; count?: number }>;
    missingLanes?: Array<{ key?: string; label?: string }>;
  };
  queryQualityCoverage?: {
    completeCount?: number;
    total?: number;
    coverage?: number;
    missingCounts?: Record<string, number>;
  };
  customerTrustCoverage?: {
    completeCount?: number;
    total?: number;
    coverage?: number;
    missingCounts?: Record<string, number>;
  };
  checks?: Array<{
    key?: string;
    label?: string;
    value?: number;
    target?: string;
    status?: "pass" | "near" | "fail" | string;
    action?: string;
  }>;
  improvementActions?: string[];
};

type SiteEvidenceRow = {
  url: string;
  finalUrl?: string;
  domain?: string;
  status: "read" | "failed" | "skipped" | string;
  wordCount?: number;
  evidenceSnippets?: string[];
  error?: string;
};

type SiteEvidencePayload = {
  productSites?: SiteEvidenceRow[];
  referenceCustomerSites?: SiteEvidenceRow[];
  summary?: {
    attempted?: number;
    read?: number;
    failed?: number;
  };
};

type TaskPayload = {
  keywordGroups?: KeywordGroups;
  searchQueries?: SearchQuery[];
  profileSignals?: ProfileSignals;
  siteEvidence?: SiteEvidencePayload;
};

type AgentStep = {
  id?: string;
  nodeName: string;
  status: "pending" | "running" | "completed" | "waiting" | "failed" | string;
  output?: unknown;
  error?: string | null;
};

type SearchResult = {
  title?: string | null;
  url?: string | null;
  domain?: string | null;
  snippet?: string | null;
};

type SearchQuery = {
  id?: string;
  provider?: string | null;
  query: string;
  keywordGroups?: KeywordGroups | null;
  country?: string | null;
  operatorSource?: string | null;
  operatorName?: string | null;
  strategyTemplate?: string | null;
  templateId?: string | null;
  executionStatus?: string | null;
  resultCount?: number | null;
  qualifiedCount?: number | null;
  effectivenessScore?: number | null;
  // 2026-05 polish: ISO timestamp from Prisma. The search-run page
  // uses the earliest createdAt among the latest batch's pending /
  // running queries to compute "this batch started at T", then
  // filters the new-lead table to candidates created on or after T.
  createdAt?: string;
  searchResults?: SearchResult[];
};

type LeadContact = {
  type: string;
  value: string;
  sourceUrl?: string | null;
};

type IcpScore = {
  score: number;
  grade?: string | null;
  reasons?: unknown;
};

type CrmLeadState = {
  id: string;
  stage: string;
};

type FollowupTaskState = {
  id: string;
  type: string;
  status: string;
  dueAt?: string | null;
  note?: string | null;
};

type SendLogState = {
  id: string;
  status: string;
  sentAt?: string | null;
};

type OutreachDraftState = {
  id: string;
  status: string;
  subject?: string;
  sendLogs?: SendLogState[];
};

type LeadCandidate = {
  id: string;
  companyName: string;
  website?: string | null;
  country?: string | null;
  queryCountry?: string | null;
  inferredCountry?: string | null;
  countryEvidence?: unknown;
  countryConfidence?: "high" | "medium" | "low" | "unknown" | string | null;
  countryConflict?: boolean | null;
  sourceUrl?: string | null;
  status?: string;
  // 2026-05 polish: ISO timestamp from Prisma. Kept for diagnostics
  // and ordering when continuation searches append to the same pool.
  createdAt?: string;
  contacts?: LeadContact[];
  icpScore?: IcpScore | null;
  outreachDrafts?: OutreachDraftState[];
  crmLead?: CrmLeadState | null;
  followupTasks?: FollowupTaskState[];
};

type LeadTask = {
  id: string;
  status: string;
  targetCount?: number;
  inputPayload?: TaskPayload | null;
  agentSteps?: AgentStep[];
  searchQueries?: SearchQuery[];
  leadCandidates?: LeadCandidate[];
};

type CreateLeadTaskResponse = {
  task: LeadTask;
  steps?: AgentStep[];
  searchQueries?: SearchQuery[];
};

type LeadTaskListItem = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  prompt: string;
  title: string;
  targetMarkets?: string[];
  leadCount: number;
  queryCount: number;
  // 2026-05 Stage 3 workbench KPI aggregation. Optional for backwards
  // compatibility — older API responses without these fields fall
  // through to 0 in the workbench KPI cards.
  pendingCrmCount?: number;
  pendingEmailCount?: number;
};

type LeadTaskListResponse = {
  tasks: LeadTaskListItem[];
  totalCount?: number;
  // 2026-05 Stage 3 follow-up: workbench KPI summary computed over the
  // user's full task history, independent of the list `limit`. The
  // workbench top strip uses this so a new task can't push an old one
  // out of the listed window and make the counters drop.
  summary?: LeadTaskSummary;
};

type LeadTaskSummary = {
  taskCount: number;
  todayLeadCount: number;
  pendingCrmCount: number;
  pendingEmailCount: number;
};

type SearchRunResult = {
  ok: boolean;
  executedQueries: number;
  successfulQueries?: number;
  failedQueries?: number;
  runningQueries?: number;
  resultCount: number;
  createdCandidates: number;
  skippedCandidates: number;
  hasMore?: boolean;
  remainingQueries?: number;
};

type ApprovalResult = {
  ok: boolean;
  approvedLeadIds: string[];
  approvedCount: number;
  draftCount: number;
};

type RejectionResult = {
  ok: boolean;
  rejectedLeadIds: string[];
  rejectedCount: number;
};

type ActivityLog = {
  title: string;
  detail: string;
  state: StepState;
};

type LeadQualityCounts = {
  rawEvidence: number;
  main: number;
  needsCountryReview: number;
  intelligenceReview: number;
  evidenceReview: number;
  rejected: number;
  other: number;
};

type DisplayLead = {
  id: string;
  companyName: string;
  score: number;
  source: string;
  sourceUrl: string;
  sourceLabel: string;
  country: string;
  tag: string;
  phone: string;
  email: string;
  website: string;
  social: string;
  address: string;
  stage: string;
  actionable: boolean;
  raw: LeadCandidate;
};

type CrmRow = DisplayLead & {
  industry: string;
  owner: string;
};

type CrmSyncDialogState = {
  detail: string;
  kind: "loading" | "success";
  title: string;
};

type CurrentUser = {
  id?: string;
  email: string;
  name?: string | null;
};

export function AiWorkerClient() {
  const appMessage = useAppMessage();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [mailOpen, setMailOpen] = useState(false);
  const [crmOpen, setCrmOpen] = useState(false);
  const [crmSyncTargetIds, setCrmSyncTargetIds] = useState<string[] | null>(null);
  const [crmPage, setCrmPage] = useState(1);
  const [crmSyncDialog, setCrmSyncDialog] = useState<CrmSyncDialogState | null>(null);
  const [leadDetail, setLeadDetail] = useState<DisplayLead | null>(null);
  const [status, setStatus] = useState("等待分配任务");
  const [error, setError] = useState("");
  // 2026-05 LeadHunt 2.0: workbench is the only home view. The legacy
  // landing has been retired (kept in branch history if needed).
  const [view, setView] = useState<ViewState>("workbench");
  const [landingPrompt, setLandingPrompt] = useState("");
  // 2026-05 LeadHunt 2.0: the legacy AiWorkerLanding had a "search tasks"
  // input bound to this state and a hosting-mode toggle. Both were retired
  // along with that screen. The remaining `loadTaskHistory(taskSearch)`
  // calls always pass an empty filter today; we keep the variable as a
  // const so callers don't need to change. When the workbench grows a
  // history filter, restore useState here.
  const taskSearch = "";
  const [taskPrompt, setTaskPrompt] = useState(defaultTaskPrompt);
  const [taskHistory, setTaskHistory] = useState<LeadTaskListItem[]>([]);
  const [taskHistoryPage, setTaskHistoryPage] = useState(1);
  const [taskHistorySearch, setTaskHistorySearch] = useState("");
  const [taskHistoryStatus, setTaskHistoryStatus] = useState<WorkbenchPoolStatusFilter>("all");
  const [taskHistoryTotal, setTaskHistoryTotal] = useState(0);
  // 2026-05 responsive cleanup: page size is now a fixed business
  // constant (see workbenchPoolPageSize at the top of the file). The
  // previous viewport-driven dynamic value is gone; CSS handles density.
  // 2026-05 Stage 3 follow-up: workbench KPI summary covers the full
  // user history so new tasks pushing old ones out of the limit=30
  // listing window can't make the counters appear to drop.
  const [taskSummary, setTaskSummary] = useState<LeadTaskSummary | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [poolLoading, setPoolLoading] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [currentTask, setCurrentTask] = useState<LeadTask | null>(null);
  const [searchResult, setSearchResult] = useState<SearchRunResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchTriggerInFlightRef = useRef(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [mailLead, setMailLead] = useState<MailConfirmationLead | null>(null);
  const accountName = currentUser ? displayAiWorkerAccountName(currentUser) : "你";

  const displayLeads = useMemo(() => buildDisplayLeads(currentTask), [currentTask]);
  const actionableDisplayLeads = useMemo(
    () => displayLeads.filter(isActionableDisplayLead),
    [displayLeads]
  );
  const sentCount = useMemo(
    () => actionableDisplayLeads.filter((lead) => hasSentEmail(lead.raw)).length,
    [actionableDisplayLeads]
  );
  const crmSyncedCount = useMemo(
    () => actionableDisplayLeads.filter((lead) => Boolean(lead.raw.crmLead)).length,
    [actionableDisplayLeads]
  );
  const pendingFollowupCount = useMemo(
    () =>
      actionableDisplayLeads.reduce((total, lead) => total + pendingFollowups(lead.raw).length, 0),
    [actionableDisplayLeads]
  );
  // sentCount and leadQualityCounts kept for the CRM/mail dialogs and
  // status messages that still consume them; the search-in-progress JSX
  // no longer uses them directly. Touch them here so eslint's no-unused
  // rule stays happy.
  void sentCount;
  void summarizeLeadQualityCounts;
  const crmRows = useMemo(
    () => buildCrmRows(actionableDisplayLeads, accountName),
    [actionableDisplayLeads, accountName]
  );
  const crmModalRows = useMemo(() => {
    const baseRows = crmSyncTargetIds
      ? crmRows.filter((row) => crmSyncTargetIds.includes(row.id))
      : crmRows;
    const pendingRows = baseRows.filter((row) => !row.raw.crmLead);
    return pendingRows.length ? pendingRows : baseRows;
  }, [crmRows, crmSyncTargetIds]);
  const crmPendingRows = crmModalRows.filter((row) => !row.raw.crmLead);
  const crmAlreadySyncedRows = crmModalRows.filter((row) => Boolean(row.raw.crmLead));
  const crmPageCount = Math.max(1, Math.ceil(crmModalRows.length / crmPageSize));
  const crmPageRows = crmModalRows.slice((crmPage - 1) * crmPageSize, crmPage * crmPageSize);
  const crmModalPendingCount = crmPendingRows.length;
  const crmModalSyncedCount = crmAlreadySyncedRows.length;
  const crmModalSyncedDisplayCount = crmModalPendingCount
    ? crmModalSyncedCount
    : crmModalRows.length;
  const crmModalCountryCount = countDistinct(crmModalRows.map((row) => row.country));
  const crmModalIsPending = crmModalPendingCount > 0;
  const selectedActionableLead =
    actionableDisplayLeads.find((lead) => lead.id === selectedLeadId) ??
    actionableDisplayLeads[0] ??
    null;
  const modalLead =
    mailLead ?? (selectedActionableLead ? toMailLead(selectedActionableLead) : fallbackMailLead);
  const modalRecipients = useMemo<MailConfirmationRecipient[]>(() => {
    return actionableDisplayLeads
      .map((lead) => {
        const mailLead = toMailLead(lead);
        return {
          email: mailLead.email,
          leadId: lead.id,
          companyName: mailLead.companyName
        };
      })
      .filter((item) => item.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email));
  }, [actionableDisplayLeads]);

  useEffect(() => {
    let cancelled = false;

    async function loadCurrentUser() {
      try {
        const payload = await apiRequest<{ user?: CurrentUser }>("/api/auth/me");
        if (!cancelled && payload.user) {
          setCurrentUser(payload.user);
        }
      } catch {
        // Keep the workbench usable if the account request is temporarily unavailable.
      }
    }

    void loadCurrentUser();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // 2026-05 LeadHunt 2.0: poll while the task is active OR while we
    // optimistically marked the page as searching. The latter covers
    // the race window after firing POST /search where the backend
    // hasn't yet flipped the task row to "running".
    const taskActive = currentTask ? isBackendTaskActive(currentTask) : false;
    if (!currentTask?.id || (!taskActive && !searching && !creating)) {
      return;
    }

    let cancelled = false;

    async function pollTaskProgress() {
      for (let attempt = 0; attempt < maxTaskPollAttempts && !cancelled; attempt += 1) {
        await wait(taskPollIntervalMs);
        if (cancelled || !currentTask?.id) {
          return;
        }

        try {
          const refreshed = await refreshTask(currentTask.id);
          applyTaskProgress(refreshed);
          if (!isBackendTaskActive(refreshed)) {
            if (searchTriggerInFlightRef.current) {
              continue;
            }
            // Backend has reached a terminal state (completed / failed
            // / paused / cancelled, or has no running agentSteps left).
            // Release the optimistic flags here — applyTaskProgress
            // intentionally only lifts them — so the polling effect
            // can exit instead of looping.
            setSearching(false);
            setCreating(false);
            void loadTaskHistory(taskSearch);
            return;
          }
        } catch (requestError) {
          if (!cancelled) {
            setError(errorMessage(requestError));
            setStatus("任务状态刷新失败，后端任务可能仍在执行。");
            // Release the optimistic flags on transient failures too —
            // otherwise a single 401/network blip leaves the page
            // disabled forever ("继续搜索 30 条" stays grayed out).
            // The next user action (or a manual refresh) will re-run
            // the polling loop.
            setSearching(false);
            setCreating(false);
          }
          return;
        }
      }

      if (!cancelled) {
        setCreating(false);
        setSearching(false);
        setStatus("后台任务仍在执行，页面已停止自动轮询；可以刷新任务历史查看最新结果。");
      }
    }

    void pollTaskProgress();

    return () => {
      cancelled = true;
    };
  }, [currentTask?.id, currentTask?.status, searching, creating]);

  useEffect(() => {
    if (!displayLeads.length) {
      setSelectedLeadId(null);
      return;
    }

    if (!displayLeads.some((lead) => lead.id === selectedLeadId)) {
      setSelectedLeadId(displayLeads[0]?.id ?? null);
    }
  }, [displayLeads, selectedLeadId]);

  useEffect(() => {
    if (crmPage > crmPageCount) {
      setCrmPage(crmPageCount);
    }
  }, [crmPage, crmPageCount]);

  async function loadTaskHistory(
    input?:
      | string
      | {
          search?: string;
          status?: WorkbenchPoolStatusFilter;
          page?: number;
        }
  ) {
    setHistoryLoading(true);
    const nextSearch = typeof input === "string" ? input : (input?.search ?? taskHistorySearch);
    const nextStatus = typeof input === "string" ? "all" : (input?.status ?? taskHistoryStatus);
    const nextPage = typeof input === "string" ? 1 : Math.max(1, input?.page ?? taskHistoryPage);
    try {
      const params = new URLSearchParams();
      if (nextSearch.trim()) params.set("search", nextSearch.trim());
      if (nextStatus !== "all") params.set("status", nextStatus);
      params.set("limit", String(workbenchPoolPageSize));
      params.set("offset", String((nextPage - 1) * workbenchPoolPageSize));
      const url = `/api/lead-tasks?${params.toString()}`;
      const payload = await apiRequest<LeadTaskListResponse>(url);
      setTaskHistorySearch(nextSearch);
      setTaskHistoryStatus(nextStatus);
      setTaskHistoryPage(nextPage);
      setTaskHistory(payload.tasks);
      setTaskSummary(payload.summary ?? null);
      setTaskHistoryTotal(payload.totalCount ?? payload.summary?.taskCount ?? payload.tasks.length);
    } catch {
      setTaskHistory([]);
      setTaskSummary(null);
      setTaskHistoryTotal(0);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    void loadTaskHistory();
  }, []);

  // 2026-05 LeadHunt 2.0: workbench → pool view. Loads the task's full
  // candidate list and switches into the pool detail page (instead of
  // the legacy conversation view).
  async function openPoolFromHistory(taskId: string) {
    setCurrentTask(null);
    setView("pool");
    setPoolLoading(true);
    setStatus("正在加载客户池...");
    setError("");
    setMailLead(null);
    setLeadDetail(null);
    try {
      const refreshed = await apiRequest<LeadTask>(`/api/lead-tasks/${taskId}`);
      setCurrentTask(refreshed);
      const payload = refreshed.inputPayload as { prompt?: string } | null;
      const restoredPrompt =
        typeof payload?.prompt === "string" ? payload.prompt : defaultTaskPrompt;
      setTaskPrompt(restoredPrompt);
      applyTaskProgress(refreshed);
    } catch (requestError) {
      setError(errorMessage(requestError));
      setStatus("加载客户池失败，请检查登录状态。");
    } finally {
      setPoolLoading(false);
    }
  }

  async function openSearchRunFromHistory(taskId: string) {
    setView("conversation");
    setError("");
    setMailLead(null);
    setLeadDetail(null);
    setStatus("正在恢复搜索进度...");
    try {
      const refreshed = await refreshTask(taskId);
      const payload = refreshed.inputPayload as { prompt?: string } | null;
      setTaskPrompt(typeof payload?.prompt === "string" ? payload.prompt : defaultTaskPrompt);
      applyTaskProgress(refreshed);
      void loadTaskHistory(taskSearch);
    } catch (requestError) {
      setError(errorMessage(requestError));
      setStatus("加载搜索进度失败，请稍后重试。");
    }
  }

  async function deleteLeadTask(taskId: string) {
    if (deletingTaskId) return;

    setDeletingTaskId(taskId);
    setError("");
    setStatus("正在删除客户池...");
    try {
      await apiRequest<{ ok: boolean; taskId: string }>(`/api/lead-tasks/${taskId}`, {
        method: "DELETE"
      });
      appMessage.success("客户池已删除", {
        description: "已从工作台隐藏；已加入 CRM 的客户不会删除。",
        duration: 2500
      });
      if (currentTask?.id === taskId) {
        setCurrentTask(null);
        setView("workbench");
      }
      const nextPage =
        taskHistory.length === 1 && taskHistoryPage > 1 ? taskHistoryPage - 1 : taskHistoryPage;
      await loadTaskHistory({ page: nextPage });
      setStatus("客户池已从工作台隐藏。");
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      setStatus("删除客户池失败，请稍后重试。");
      appMessage.error("删除客户池失败", {
        description: message,
        duration: 4000
      });
    } finally {
      setDeletingTaskId(null);
    }
  }

  async function startLeadTask(prompt: string) {
    const nextPrompt = prompt.trim() || defaultTaskPrompt;
    setView("conversation");
    setTaskPrompt(nextPrompt);
    setCurrentTask(null);
    setSearchResult(null);
    setMailLead(null);
    setError("");
    setCreating(true);
    setStatus("正在创建 AI 任务，并读取产品画像 / 客户画像...");
    let taskStarted = false;

    try {
      const payload = await apiRequest<CreateLeadTaskResponse>("/api/lead-tasks", {
        method: "POST",
        body: JSON.stringify({ prompt: nextPrompt, targetCount: 30 })
      });
      const task = normalizeCreatedTask(payload);
      taskStarted = true;
      setCurrentTask(task);
      applyTaskProgress(task);
      void loadTaskHistory(taskSearch);
    } catch (requestError) {
      setError(errorMessage(requestError));
      setStatus("任务创建失败，请检查登录状态或后端 API。");
    } finally {
      if (!taskStarted) {
        setCreating(false);
      }
    }
  }

  // 2026-05 LeadHunt 2.0: real task-search trigger.
  // Calls `POST /api/lead-tasks/:taskId/search` to kick a new batch of
  // queries on the backend. Polling effect picks up status and lead
  // updates afterwards. Always switches to the conversation view so
  // the user sees the run-batch card live.
  async function runTaskSearch(taskId = currentTask?.id) {
    if (!taskId) {
      setStatus("请先创建任务，后端会自动完成本轮搜索。");
      return;
    }

    setView("conversation");
    setSearching(true);
    searchTriggerInFlightRef.current = true;
    setError("");
    setStatus("已发起新一批搜索，正在等待后端 LLM 规划与 Brave 调用...");

    // Fire-and-forget the workflow trigger. The endpoint blocks until
    // the LangGraph batch finishes, so the polling effect will keep
    // updating the page once currentTask flips to running.
    type SearchTriggerResponse = {
      ok?: boolean;
      executedQueries?: number;
      appendedQueries?: number;
      // 2026-05 Stage 2 follow-up: reason why a continuation append
      // produced (or didn't produce) new queries. Surfaced to the
      // user when N=0 so the click doesn't feel silent.
      appendReason?:
        | "appended"
        | "pending_remaining"
        | "missing_payload"
        | "ai_unavailable"
        | "ai_error"
        | "no_new_queries";
    };
    void apiRequest<SearchTriggerResponse>(`/api/lead-tasks/${taskId}/search`, {
      method: "POST",
      // 2026-05 Stage 2 follow-up: appendIfEmpty=true tells the
      // backend to generate and insert a new batch of pending
      // queries when the task has already drained its queue. Without
      // it, /search on a finished task is a no-op (returns 201 with
      // executedQueries=0) and "继续搜索 30 条" looks broken.
      body: JSON.stringify({ limit: 30, appendIfEmpty: true })
    })
      .then(async (response) => {
        // 2026-05 Stage 2 follow-up: surface a concrete reason when
        // the backend couldn't actually append — without this the
        // user sees the page flip back to a finished pool and has no
        // idea why "继续搜索 30 条" produced nothing.
        if (response?.appendReason && response.appendReason !== "appended") {
          searchTriggerInFlightRef.current = false;
          const message =
            {
              pending_remaining: "上一批 query 还在执行中，正在继续消费，无需再追加。",
              missing_payload: "该任务缺少产品/客户画像数据，无法继续生成新一批搜索指令。",
              ai_unavailable: "AI 规划服务暂不可用，未生成新的搜索指令。",
              ai_error: "生成新一批搜索指令失败，可稍后重试。",
              no_new_queries: "未生成新的搜索指令；可调整搜索方向或更换关键词后重试。"
            }[response.appendReason] ?? "未生成新的搜索指令。";
          setStatus(message);
          // Release the optimistic searching flag so the page doesn't
          // sit on "正在等待后端 LLM 规划..." forever.
          setSearching(false);
          return;
        }

        if (response?.appendReason === "appended" || (response?.appendedQueries ?? 0) > 0) {
          setSearching(true);
          const refreshed = await refreshTask(taskId);
          searchTriggerInFlightRef.current = false;
          applyTaskProgress(refreshed);
          if (!isBackendTaskActive(refreshed)) {
            setSearching(false);
            setCreating(false);
            void loadTaskHistory(taskSearch);
          }
        }
        searchTriggerInFlightRef.current = false;
      })
      .catch((requestError) => {
        searchTriggerInFlightRef.current = false;
        // We don't fail the page on a search-trigger error — the polling
        // loop will surface failed steps as they arrive. Log to status
        // so the user sees the upstream cause.
        setError(errorMessage(requestError));
        setStatus("发起搜索失败，可在状态恢复后重试。");
        setSearching(false);
      });

    // Note: we deliberately do NOT call refreshTask + applyTaskProgress
    // here. If we did, applyTaskProgress would race with the backend —
    // the task row hasn't flipped to running yet, so isTaskSearching
    // returns false and immediately resets our optimistic
    // setSearching(true). That would cause the polling effect to bail
    // out before the new batch ever shows up. Instead we rely on the
    // searching=true flag to keep the polling loop alive until the
    // next tick picks up the real status change.
  }

  async function refreshTask(taskId: string) {
    const refreshed = await apiRequest<LeadTask>(`/api/lead-tasks/${taskId}`);
    setCurrentTask(refreshed);
    return refreshed;
  }

  function applyTaskProgress(task: LeadTask) {
    const result = summarizeSearchResultFromTask(task);
    const hasSearchData = Boolean(
      (task.searchQueries?.length ?? 0) || (task.leadCandidates?.length ?? 0)
    );
    const failedMessage = firstFailedStepError(task);

    // 2026-05 LeadHunt 2.0: only LIFT the optimistic searching/creating
    // flags; never drop them based on a single snapshot. The user just
    // clicked "继续搜索 30 条" — the backend may not have flipped the
    // task row to running yet, so `isTaskSearching` would otherwise
    // immediately tear down the polling loop and the new batch would
    // never show up. Once the backend lands a terminal state, the
    // polling effect itself releases the flags via the dedicated reset
    // below.
    if (isTaskPlanning(task)) setCreating(true);
    if (isTaskSearching(task)) setSearching(true);
    setSearchResult(hasSearchData ? result : null);
    if (failedMessage || task.status === "failed") {
      setError(failedMessage || "任务执行失败。");
    } else {
      setError("");
    }
    setStatus(formatTaskProgressStatus(task, result));

    const leadCount = task.leadCandidates?.length ?? 0;
    if (leadCount > 0) {
      setSelectedLeadId((current) => current ?? buildDisplayLeads(task)[0]?.id ?? null);
    }
  }

  function openSelectedLeadMail() {
    const lead = selectedActionableLead;
    if (!lead) {
      setStatus("当前还没有候选客户，请先执行搜索。");
      return;
    }

    if (!lead.actionable) {
      setSelectedLeadId(lead.id);
      setStatus("该线索仍在待复核/情报区，先确认国家、官网和联系方式后再生成开发信或同步 CRM。");
      return;
    }

    const localMailLead = toMailLead(lead);
    setSelectedLeadId(lead.id);
    setMailLead(localMailLead);
    setMailOpen(true);
    setError("");
    setStatus(`已打开 ${lead.companyName} 的邮件预览弹窗。`);
  }

  // 2026-05 Stage 2: bulk approve from the pool detail page. Posts
  // every selected leadId to the existing /approve endpoint so the
  // backend builds CRM rows + email drafts for them, then refreshes
  // the task so the UI reflects the new crmLead/draft entries.
  async function approveSelectedLeads(
    taskId: string,
    leadIds: string[]
  ): Promise<ApprovalResult | null> {
    if (!leadIds.length) return null;
    setApproving(true);
    setError("");
    setStatus(`正在批量加入 CRM：已选择 ${leadIds.length} 家客户...`);
    setCrmSyncDialog({
      kind: "loading",
      title: "正在同步到 CRM",
      detail:
        leadIds.length === 1
          ? "正在写入 1 家客户，请稍候。"
          : `正在写入 ${leadIds.length} 家客户，请稍候。`
    });
    const selectedLeadNames = leadIds
      .map((leadId) => displayLeads.find((lead) => lead.id === leadId)?.companyName)
      .filter((companyName): companyName is string => Boolean(companyName));

    try {
      const result = await apiRequest<ApprovalResult>(`/api/lead-tasks/${taskId}/approve`, {
        method: "POST",
        body: JSON.stringify({ leadIds })
      });
      if (result.approvedCount > 0) {
        setCrmSyncDialog({
          kind: "success",
          title: "已加入 CRM",
          detail:
            result.approvedCount === 1
              ? `${selectedLeadNames[0] ?? "客户"} 已同步到 CRM 客户。`
              : `${result.approvedCount} 家客户已同步到 CRM 客户。`
        });
      } else {
        setCrmSyncDialog({
          kind: "success",
          title: "已在 CRM 中",
          detail: "所选客户已经在 CRM 客户列表中，没有重复写入。"
        });
      }
      await refreshTask(taskId).catch(() => undefined);
      // 2026-05 Stage 3 follow-up: refresh task history so the
      // workbench KPI strip (待同步 CRM, 邮件待确认) reflects the
      // approve immediately. Without this, returning to the workbench
      // shows the cached pre-approve counters until the next mount.
      void loadTaskHistory(taskSearch);
      setStatus(
        `已加入 CRM ${result.approvedCount} 家客户，并生成 ${result.draftCount} 封开发信草稿。`
      );
      return result;
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      setStatus(
        isMissingLeadTaskError(message)
          ? "当前任务不属于当前登录账号或已失效，批量加入 CRM 已取消。"
          : "批量加入 CRM 失败；可重试或先单条审批。"
      );
      appMessage.error("加入 CRM 失败", {
        description: "请稍后重试，或先单条处理。",
        duration: 4000
      });
      setCrmSyncDialog(null);
      return null;
    } finally {
      setApproving(false);
    }
  }

  async function rejectSelectedLeads(
    taskId: string,
    leadIds: string[]
  ): Promise<RejectionResult | null> {
    if (!leadIds.length) return null;
    setRejecting(true);
    setError("");
    setStatus(`正在标记无效：已选择 ${leadIds.length} 家客户...`);

    try {
      const result = await apiRequest<RejectionResult>(`/api/lead-tasks/${taskId}/reject`, {
        method: "POST",
        body: JSON.stringify({
          leadIds,
          reason: "Marked invalid from customer pool review"
        })
      });
      await refreshTask(taskId).catch(() => undefined);
      void loadTaskHistory(taskSearch);
      setLeadDetail((current) =>
        current && leadIds.includes(current.id) ? null : current
      );
      setSelectedLeadId((current) => (current && leadIds.includes(current) ? null : current));
      setStatus(`已标记无效 ${result.rejectedCount} 家客户；系统会把来源 query 作为低产信号学习。`);
      appMessage.success("已标记无效", {
        description: "这些客户已从主客户池移除，并进入 query 效果学习。",
        duration: 3500
      });
      return result;
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      setStatus("标记无效失败；可刷新客户池后重试。");
      appMessage.error("标记无效失败", {
        description: "请确认这些客户尚未加入 CRM，或稍后重试。",
        duration: 4000
      });
      return null;
    } finally {
      setRejecting(false);
    }
  }

  function submitLanding(promptOverride?: string) {
    void startLeadTask(promptOverride ?? landingPrompt);
  }

  function backToLanding() {
    setView("workbench");
    setStatus(currentTask ? "任务已保留，可确认客户或重新执行搜索" : "等待分配任务");
    void loadTaskHistory(taskSearch);
  }

  function openCrmPreview(leadId?: string) {
    setCrmSyncTargetIds(leadId ? [leadId] : null);
    setCrmPage(1);
    setCrmOpen(true);
    const syncableCount = leadId
      ? crmRows.filter((row) => row.id === leadId && !row.raw.crmLead).length
      : crmRows.filter((row) => !row.raw.crmLead).length;
    setStatus(syncableCount ? "已打开 CRM 同步确认。" : "当前客户已同步或暂无可同步主客户。");
  }

  function changeCrmPage(nextPage: number) {
    setCrmPage(Math.min(Math.max(nextPage, 1), crmPageCount));
  }

  async function confirmCrmSync() {
    if (!currentTask?.id) {
      setStatus("当前没有可关联的后端任务，无法同步到 CRM。");
      appMessage.error("无法同步 CRM", {
        description: "当前任务不存在，请重新打开客户池后再试。",
        duration: 4000
      });
      return;
    }

    const targetIds = crmPendingRows.map((row) => row.id);
    if (!targetIds.length) {
      setCrmOpen(false);
      setCrmSyncTargetIds(null);
      window.location.href = "/customers";
      return;
    }

    const result = await approveSelectedLeads(currentTask.id, targetIds);
    if (!result) {
      return;
    }

    setCrmOpen(false);
    setCrmSyncTargetIds(null);
  }

  async function handleMailSent(result: MailSendResult) {
    if (currentTask) {
      await refreshTask(currentTask.id).catch(() => undefined);
    }
    setMailOpen(false);
    appMessage.success(result.scheduled ? "定时发送已安排" : "邮件已发送", {
      description: formatMailSuccessDetail(result),
      duration: 3200
    });
    setStatus(formatMailSentStatus(result));
    setError("");
  }

  return (
    <AppShell
      activePath="/"
      eyebrow=""
      title=""
      hidePageHeader
      mainClassName="aiWorkerMain"
      pageClassName="aiWorkerPage"
    >
      <main className="aiProjectApp">
        <section className="projectWorkspace">
          {view === "workbench" ? (
            <AiWorkerWorkbench
              prompt={landingPrompt}
              onPromptChange={setLandingPrompt}
              onSubmit={submitLanding}
              submitting={creating || searching}
              taskHistory={taskHistory}
              taskSummary={taskSummary}
              taskHistoryTotal={taskHistoryTotal}
              taskHistoryPage={taskHistoryPage}
              taskHistoryPageSize={workbenchPoolPageSize}
              taskHistorySearch={taskHistorySearch}
              taskHistoryStatus={taskHistoryStatus}
              historyLoading={historyLoading}
              onSelectHistoryTask={openPoolFromHistory}
              onOpenSearchRun={openSearchRunFromHistory}
              onRefreshHistory={() => void loadTaskHistory()}
              onHistorySearchChange={(search) => void loadTaskHistory({ search, page: 1 })}
              onHistoryStatusChange={(historyStatus) =>
                void loadTaskHistory({ status: historyStatus, page: 1 })
              }
              onHistoryPageChange={(page) => void loadTaskHistory({ page })}
              onDeleteTask={(taskId) => void deleteLeadTask(taskId)}
              deletingTaskId={deletingTaskId}
              accountName={accountName}
              onContinueSearch={(taskId) => {
                // Finished pool card "继续搜索 30 条" — load the task's
                // full state (prompt, market terms, prior queries) into
                // the conversation view, then re-trigger the search
                // agent. Without the explicit load step, currentTask
                // stays null and the search page shows the fallback
                // chips ("UAE/Saudi Arabia/...") instead of the real
                // task title and target markets.
                setView("conversation");
                void (async () => {
                  try {
                    const refreshed = await refreshTask(taskId);
                    const payload = refreshed.inputPayload as { prompt?: string } | null;
                    setTaskPrompt(
                      typeof payload?.prompt === "string" ? payload.prompt : defaultTaskPrompt
                    );
                    applyTaskProgress(refreshed);
                  } catch (requestError) {
                    // If we can't even load the task, don't fire a
                    // search against it — the polling loop wouldn't
                    // know which task to follow and the user would
                    // see a half-loaded conversation view.
                    setError(errorMessage(requestError));
                    setStatus("加载任务失败，未触发新一轮搜索。");
                    return;
                  }
                  void runTaskSearch(taskId);
                })();
              }}
            />
          ) : view === "pool" ? (
            <AiWorkerPool
              task={currentTask}
              taskHistoryItem={taskHistory.find((task) => task.id === currentTask?.id) ?? null}
              leads={displayLeads}
              loading={poolLoading}
              approving={approving}
              rejecting={rejecting}
              onBack={() => setView("workbench")}
              onOpenSearchRun={() => {
                if (currentTask?.id) {
                  void openSearchRunFromHistory(currentTask.id);
                }
              }}
              onContinueSearch={() => {
                if (currentTask?.id) {
                  setView("conversation");
                  void runTaskSearch(currentTask.id);
                }
              }}
              onBulkApprove={(leadIds) => {
                if (currentTask?.id && leadIds.length > 0) {
                  void approveSelectedLeads(currentTask.id, leadIds);
                }
              }}
              onBulkReject={(leadIds) => {
                if (currentTask?.id && leadIds.length > 0) {
                  void rejectSelectedLeads(currentTask.id, leadIds);
                }
              }}
              onOpenLeadDetail={(lead) => {
                setSelectedLeadId(lead.id);
                setLeadDetail(lead);
              }}
              onApproveLead={(leadId) => {
                if (currentTask?.id) {
                  void approveSelectedLeads(currentTask.id, [leadId]);
                }
              }}
              onRejectLead={(leadId) => {
                if (currentTask?.id) {
                  void rejectSelectedLeads(currentTask.id, [leadId]);
                }
              }}
            />
          ) : (
            <AiWorkerConversation
              prompt={taskPrompt}
              status={status}
              error={error}
              currentTask={currentTask}
              leads={displayLeads}
              crmSyncedCount={crmSyncedCount}
              pendingFollowupCount={pendingFollowupCount}
              searchResult={searchResult}
              creating={creating}
              searching={searching}
              approving={approving}
              selectedLeadId={selectedLeadId}
              onSelectLead={setSelectedLeadId}
              onOpenLeadDetail={(lead) => {
                setSelectedLeadId(lead.id);
                setLeadDetail(lead);
              }}
              onOpenMail={openSelectedLeadMail}
              onOpenCrm={openCrmPreview}
              onBack={backToLanding}
              onContinueSearch={() => {
                if (currentTask?.id) void runTaskSearch(currentTask.id);
              }}
            />
          )}
        </section>

        {crmOpen ? (
          <div className="crmDataBackdrop" role="presentation">
            <section
              className="crmDataModal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="crm-data-title"
            >
              <header className="crmDataHeader">
                <div
                  className={
                    crmModalIsPending ? "crmDataHeroIcon pending" : "crmDataHeroIcon synced"
                  }
                >
                  <Database size={42} aria-hidden="true" />
                  <span className="crmDataHeroBadge" aria-hidden="true">
                    <CheckCircle2 size={22} />
                  </span>
                </div>
                <div className="crmDataHeroText">
                  <span>{crmModalIsPending ? "CRM 同步确认" : "CRM 同步完成"}</span>
                  <h2 id="crm-data-title">
                    {crmModalIsPending
                      ? "准备写入 CRM 客户列表"
                      : `${crmModalSyncedDisplayCount} 家客户已同步到 CRM`}
                  </h2>
                  <p>
                    {crmModalIsPending
                      ? `将 ${crmModalPendingCount} 家待同步客户写入 CRM，重复客户会自动跳过。`
                      : "可直接进入客户列表继续跟进，重复客户已自动跳过。"}
                  </p>
                </div>
                <button
                  className="crmDataClose"
                  type="button"
                  aria-label="关闭 CRM 同步弹窗"
                  onClick={() => {
                    setCrmOpen(false);
                    setCrmSyncTargetIds(null);
                  }}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </header>

              <div className="crmDataSummary">
                <div className="crmDataMetricCard">
                  <span className="crmDataMetricLabel">
                    <span className="crmDataMetricIcon synced">
                      <CheckCircle2 size={22} aria-hidden="true" />
                    </span>
                    已同步
                  </span>
                  <strong>{crmModalSyncedDisplayCount}</strong>
                </div>
                <div className="crmDataMetricCard">
                  <span className="crmDataMetricLabel">
                    <span className="crmDataMetricIcon pending">
                      <Clock size={22} aria-hidden="true" />
                    </span>
                    待同步
                  </span>
                  <strong>{crmModalPendingCount}</strong>
                </div>
                <div className="crmDataMetricCard">
                  <span className="crmDataMetricLabel">
                    <span className="crmDataMetricIcon country">
                      <Globe2 size={22} aria-hidden="true" />
                    </span>
                    覆盖国家
                  </span>
                  <strong>{crmModalCountryCount}</strong>
                </div>
              </div>

              <div className={crmPageCount > 1 ? "crmDataTableWrap paged" : "crmDataTableWrap"}>
                <table className="crmDataTable">
                  <thead>
                    <tr>
                      <th>公司名称</th>
                      <th>国家</th>
                      <th>客户类型</th>
                      <th>邮箱</th>
                      <th>电话</th>
                      <th>官网</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {crmPageRows.length ? (
                      crmPageRows.map((row) => {
                        const synced = Boolean(row.raw.crmLead);
                        const email = row.email !== "-" ? row.email : "—";
                        const phone = row.phone !== "-" ? row.phone : "—";

                        return (
                          <tr key={row.id}>
                            <td className="leadCompanyCell">
                              <strong>{row.companyName}</strong>
                            </td>
                            <td>{row.country}</td>
                            <td>{row.industry}</td>
                            <td className="crmDataContactCell" title={email}>
                              {email}
                            </td>
                            <td className="crmDataPhoneCell" title={phone}>
                              {phone}
                            </td>
                            <td>
                              {row.website && row.website !== "-" ? (
                                <a
                                  href={websiteHref(row.website)}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                >
                                  {formatWebsiteShort(row.website)}
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>
                              <span className={synced ? "crmStageTag synced" : "crmStageTag"}>
                                {synced ? "已同步" : "待同步"}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={7}>暂无可同步客户，先执行 AI 搜索后再同步到 CRM。</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <footer className="crmDataFooter">
                <span>
                  共 {crmModalRows.length} 家客户 · 第 {crmPage} / {crmPageCount} 页
                </span>
                <div className="crmDataFooterActions">
                  {crmPageCount > 1 ? (
                    <div className="crmDataPager">
                      <button
                        type="button"
                        aria-label="上一页"
                        disabled={crmPage === 1}
                        onClick={() => changeCrmPage(crmPage - 1)}
                      >
                        <ChevronLeft size={18} aria-hidden="true" />
                      </button>
                      <span className="crmDataPagerText">
                        {crmPage} / {crmPageCount}
                      </span>
                      <button
                        type="button"
                        aria-label="下一页"
                        disabled={crmPage === crmPageCount}
                        onClick={() => changeCrmPage(crmPage + 1)}
                      >
                        <ChevronRight size={18} aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                  <button
                    className="crmDataSecondary"
                    type="button"
                    onClick={() => {
                      setCrmOpen(false);
                      setCrmSyncTargetIds(null);
                    }}
                  >
                    {crmModalIsPending ? "取消" : "关闭"}
                  </button>
                  <button
                    className="crmDataPrimary"
                    type="button"
                    disabled={approving || (!crmModalPendingCount && !crmModalRows.length)}
                    onClick={() => void confirmCrmSync()}
                  >
                    {crmModalIsPending
                      ? `确认同步 ${crmModalPendingCount} 家`
                      : "查看 CRM 客户列表"}
                  </button>
                </div>
              </footer>
            </section>
          </div>
        ) : null}

        {crmSyncDialog ? (
          <div className="crmSyncFeedbackBackdrop" role="presentation">
            <section
              className="crmSyncFeedbackDialog"
              role="dialog"
              aria-modal="true"
              aria-label={crmSyncDialog.title}
            >
              <span
                className={
                  crmSyncDialog.kind === "loading"
                    ? "crmSyncFeedbackIcon loading"
                    : "crmSyncFeedbackIcon success"
                }
                aria-hidden="true"
              >
                {crmSyncDialog.kind === "loading" ? null : <CheckCircle2 size={28} />}
              </span>
              <h2>{crmSyncDialog.title}</h2>
              <p>{crmSyncDialog.detail}</p>
              {crmSyncDialog.kind === "success" ? (
                <div className="crmSyncFeedbackActions">
                  <button
                    className="crmDataSecondary"
                    type="button"
                    onClick={() => setCrmSyncDialog(null)}
                  >
                    关闭
                  </button>
                  <button
                    className="crmDataPrimary"
                    type="button"
                    onClick={() => {
                      setCrmSyncDialog(null);
                      window.location.href = "/customers";
                    }}
                  >
                    查看 CRM 客户列表
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {leadDetail ? (
          <LeadDetailModal
            lead={leadDetail}
            onClose={() => setLeadDetail(null)}
          />
        ) : null}

        <MailConfirmationModal
          lead={modalLead}
          recipients={modalRecipients}
          open={mailOpen}
          onClose={() => setMailOpen(false)}
          onSent={handleMailSent}
        />
      </main>
    </AppShell>
  );
}

function LeadDetailModal({
  lead,
  onClose
}: {
  lead: DisplayLead;
  onClose: () => void;
}) {
  const emails = pickFirstContactValue(lead.raw.contacts, "email").all;
  const phones = pickFirstContactValue(lead.raw.contacts, "phone").all;
  const socials = pickFirstContactValue(lead.raw.contacts, "social").all;
  const contactSources = leadDetailContactSources(lead);
  const website = lead.website && lead.website !== "-" ? lead.website : "";
  const sourceUrl =
    lead.sourceUrl && lead.sourceUrl !== "-" ? lead.sourceUrl : lead.raw.sourceUrl || "";
  const country = leadDetailCountry(lead);
  const address = lead.address || inferLeadAddress(lead.raw.countryEvidence);
  const customerType = lead.tag && lead.tag !== "-" ? lead.tag : "";

  return (
    <div className="leadDetailBackdrop" role="presentation" onClick={onClose}>
      <section
        className="leadDetailModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="leadDetailHeader">
          <div className="leadDetailTitle">
            <span>客户档案</span>
            <h2 id="lead-detail-title">{lead.companyName}</h2>
            <p>
              {[country, customerType, website ? formatWebsiteShort(website) : ""]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="leadDetailHeaderActions">
            <div className="leadDetailScoreBadge" aria-label={`推荐指数 ${lead.score}`}>
              <span>推荐指数</span>
              <strong>{lead.score}</strong>
            </div>
            <button
              type="button"
              className="leadDetailClose"
              aria-label="关闭客户详情"
              onClick={onClose}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="leadDetailBody">
          <section className="leadDetailPanel leadDetailProfilePanel">
            <div className="leadDetailPanelTitle">
              <Building2 size={16} aria-hidden="true" />
              <h3>基础信息</h3>
            </div>
            <div className="leadDetailInfoGrid">
              <DetailValue label="公司名称" value={lead.companyName} empty="公司名称待补充" />
              <DetailValue label="国家/地区" value={country} empty="国家待补充" />
              <DetailValue label="地址" value={address} empty="未抓取到地址" wide />
              <DetailValue label="客户类型" value={customerType} empty="客户类型待补充" />
            </div>
          </section>

          <section className="leadDetailPanel">
            <div className="leadDetailPanelTitle">
              <Mail size={16} aria-hidden="true" />
              <h3>联系方式</h3>
            </div>
            <div className="leadDetailPanelContent">
              <DetailList label="邮箱" values={emails} empty="暂无邮箱" />
              <DetailList label="电话" values={phones} empty="暂无电话" />
              <DetailList label="社媒入口" values={socials} empty="暂无社媒入口" />
              <DetailList label="联系方式来源" values={contactSources} empty="暂无联系方式来源" />
            </div>
          </section>

          <section className="leadDetailPanel">
            <div className="leadDetailPanelTitle">
              <Globe2 size={16} aria-hidden="true" />
              <h3>官网与来源</h3>
            </div>
            <div className="leadDetailPanelContent">
              <div className="leadDetailField">
                <span>官网</span>
                {website ? (
                  <a href={websiteHref(website)} target="_blank" rel="noreferrer noopener">
                    {formatWebsiteShort(website)}
                  </a>
                ) : (
                  <em>暂无官网</em>
                )}
              </div>
              <div className="leadDetailField">
                <span>来源页面</span>
                {sourceUrl ? (
                  <a href={websiteHref(sourceUrl)} target="_blank" rel="noreferrer noopener">
                    {lead.sourceLabel || formatSourceLinkLabel(sourceUrl)}
                  </a>
                ) : (
                  <em>暂无来源页面</em>
                )}
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function DetailValue({
  label,
  value,
  empty,
  wide
}: {
  label: string;
  value: string;
  empty: string;
  wide?: boolean;
}) {
  const normalized = value && value !== "-" ? value : "";
  return (
    <div className={`leadDetailField${wide ? " wide" : ""}`}>
      <span>{label}</span>
      {normalized ? <strong>{normalized}</strong> : <em>{empty}</em>}
    </div>
  );
}

function DetailList({ label, values, empty }: { label: string; values: string[]; empty: string }) {
  return (
    <div className="leadDetailField">
      <span>{label}</span>
      {values.length ? (
        <ul className="leadDetailContactList">
          {values.map((value, index) => (
            <li key={`${value}-${index}`}>{value}</li>
          ))}
        </ul>
      ) : (
        <em>{empty}</em>
      )}
    </div>
  );
}

function leadDetailContactSources(lead: DisplayLead) {
  return unique(
    (lead.raw.contacts ?? [])
      .map((contact) => {
        if (!contact.sourceUrl || contact.sourceUrl === "-") return "";
        return `${contactTypeLabel(contact.type)} · ${formatSourceLinkLabel(contact.sourceUrl)}`;
      })
      .filter(Boolean)
  ).slice(0, 6);
}

function contactTypeLabel(type?: string | null) {
  if (type === "email") return "邮箱来源";
  if (type === "phone") return "电话来源";
  if (type === "form") return "表单/采购入口来源";
  if (type === "social") return "社媒入口来源";
  return "联系方式来源";
}

function leadDetailMatchReasons(lead: DisplayLead) {
  const payload = icpReasonPayload(lead.raw.icpScore?.reasons);
  const reasons = Array.isArray(payload?.reasons)
    ? payload.reasons.filter((value): value is string => typeof value === "string")
    : [];
  const matchedSignals = Array.isArray(payload?.aiEvaluation?.matchedSignals)
    ? payload.aiEvaluation.matchedSignals.filter(
        (value): value is string => typeof value === "string"
      )
    : [];
  const buyerType =
    typeof payload?.aiEvaluation?.buyerType === "string" ? payload.aiEvaluation.buyerType : "";

  return unique([
    ...matchedSignals.map((signal) => `命中信号：${signal}`),
    ...(buyerType ? [`客户类型判断：${buyerType}`] : []),
    ...reasons
  ]).slice(0, 6);
}

function leadDetailRiskLabels(lead: DisplayLead) {
  const payload = icpReasonPayload(lead.raw.icpScore?.reasons);
  const risks = Array.isArray(payload?.risks)
    ? payload.risks.filter((value): value is string => typeof value === "string")
    : [];
  const reviewLabels = Array.isArray(payload?.reviewLabels)
    ? payload.reviewLabels.filter((value): value is string => typeof value === "string")
    : [];
  const contactCount = lead.raw.contacts?.length ?? 0;

  return unique([
    ...risks,
    ...reviewLabels,
    ...(lead.raw.countryConflict ? ["国家证据冲突"] : []),
    ...(lead.raw.countryConfidence === "low" || lead.raw.countryConfidence === "unknown"
      ? ["国家证据弱，需复核"]
      : []),
    ...(contactCount === 0 ? ["缺少可触达入口"] : [])
  ]).slice(0, 8);
}

function leadDetailCountry(lead: DisplayLead) {
  return (
    [lead.country, lead.raw.inferredCountry, lead.raw.queryCountry, lead.raw.country]
      .map((value) => formatDisplayCountry(value))
      .find((value) => value && value !== "-") ?? ""
  );
}

type LeadCountryEvidenceItem = {
  type?: string;
  value?: string;
};

function inferLeadAddress(countryEvidence: unknown) {
  return (
    leadCountryEvidenceItems(countryEvidence)
      .map((item) => cleanLeadAddressEvidence(item.value))
      .find((value) => Boolean(value) && isLikelyLeadAddress(value)) ?? ""
  );
}

function leadCountryEvidenceItems(value: unknown): LeadCountryEvidenceItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => item.type === "official_text")
    .map((item) => ({
      type: typeof item.type === "string" ? item.type : undefined,
      value: typeof item.value === "string" ? item.value : undefined
    }));
}

function cleanLeadAddressEvidence(value?: string) {
  return (value ?? "")
    .replace(/\bQuery context:\s*.*$/gis, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "")
    .trim();
}

function isLikelyLeadAddress(value: string) {
  if (value.length < 12 || value.length > 220) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/^[+\d\s().-]+$/.test(value)) return false;
  return /\b(?:address|office|offices|headquarters|hq|located|based|location|locations|branch|branches|street|st\.|road|rd\.|avenue|ave\.|building|tower|floor|suite|unit|po box|p\.o\. box|city)\b/i.test(
    value
  );
}

function leadDetailSourceQueries(lead: DisplayLead, task: LeadTask | null) {
  const storedSourceQuery = storedLeadSourceQuery(lead);
  if (storedSourceQuery) {
    return [storedSourceQuery];
  }

  const queries = task?.searchQueries ?? [];
  if (!queries.length) return [];

  const sourceHost = hostnameForMatch(lead.raw.sourceUrl ?? lead.raw.website ?? lead.website);
  const countryKey = normalizeDisplayMarket(lead.raw.queryCountry ?? lead.country);
  const selected: SearchQuery[] = [];
  const seen = new Set<string>();
  const add = (query: SearchQuery) => {
    const key = `${query.query}|${query.country ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    selected.push(query);
  };

  for (const query of queries) {
    const matchesSource = Boolean(
      sourceHost &&
      query.searchResults?.some((result) => {
        const host = hostnameForMatch(result.url ?? result.domain ?? "");
        return Boolean(
          host &&
          (host === sourceHost ||
            host.endsWith(`.${sourceHost}`) ||
            sourceHost.endsWith(`.${host}`))
        );
      })
    );
    if (matchesSource) add(query);
  }

  for (const query of queries) {
    if (selected.length >= 3) break;
    const queryCountry = normalizeDisplayMarket(query.country ?? "");
    if (countryKey && queryCountry && queryCountry === countryKey) add(query);
  }

  for (const query of queries) {
    if (selected.length >= 3) break;
    add(query);
  }

  return selected.slice(0, 3);
}

function storedLeadSourceQuery(lead: DisplayLead): SearchQuery | null {
  const payload = icpReasonPayload(lead.raw.icpScore?.reasons);
  const sourceQuery =
    payload?.sourceQuery && typeof payload.sourceQuery === "object"
      ? (payload.sourceQuery as Record<string, unknown>)
      : null;
  const query = typeof sourceQuery?.query === "string" ? sourceQuery.query : "";
  if (!query) return null;

  return {
    id: typeof sourceQuery?.id === "string" ? sourceQuery.id : undefined,
    query,
    country: typeof sourceQuery?.country === "string" ? sourceQuery.country : null
  };
}

function hostnameForMatch(value: string | null | undefined) {
  if (!value || value === "-") return "";
  try {
    const raw = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return (
      value
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .split("/")[0]
        ?.toLowerCase() ?? ""
    );
  }
}

// AiWorkerLanding (the legacy v1 landing screen) was removed in 2026-05.
// AiWorkerClient now defaults to view: "workbench" and renders the new
// workbench / pool / conversation triad. Anything that pointed at
// view === "landing" is gone.

// ============================================================================
// 2026-05 LeadHunt 2.0 — AiWorkerWorkbench
// ----------------------------------------------------------------------------
// New "工作台" home page redesign. Replaces the legacy AiWorkerLanding when
// the user adds ?v=2 to the URL. Shows:
//   - Greeting + tracking summary
//   - 5 KPI cards (客户池总数 / 今日新增 / 待同步 CRM / 邮件待确认 / 需跟进)
//   - Main "你想继续找哪类客户" search box + 5 quick-action chips
//   - Recent customer pools (3 large cards)
//   - Next-step todos + history task list
// ============================================================================

type WorkbenchProps = {
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: (prompt: string) => void;
  submitting: boolean;
  taskHistory: LeadTaskListItem[];
  taskSummary: LeadTaskSummary | null;
  taskHistoryTotal: number;
  taskHistoryPage: number;
  taskHistoryPageSize: number;
  taskHistorySearch: string;
  taskHistoryStatus: WorkbenchPoolStatusFilter;
  historyLoading: boolean;
  onSelectHistoryTask: (taskId: string) => void;
  onOpenSearchRun: (taskId: string) => void;
  onRefreshHistory: () => void;
  onHistorySearchChange: (value: string) => void;
  onHistoryStatusChange: (value: WorkbenchPoolStatusFilter) => void;
  onHistoryPageChange: (page: number) => void;
  onDeleteTask: (taskId: string) => void;
  deletingTaskId: string | null;
  accountName: string;
  onContinueSearch?: (taskId: string) => void;
};

type WorkbenchQuickAction = {
  label: string;
  prompt: string;
  icon: typeof Target;
};

type WorkbenchPoolCard = {
  id: string;
  title: string;
  status: "active" | "completed" | "pending";
  statusLabel: string;
  markets: string[];
  leadCount: number;
  queryCount: number;
  updatedLabel: string;
  icon: typeof Globe2;
  tone: "blue" | "green" | "orange";
};

function AiWorkerWorkbench({
  prompt,
  onPromptChange,
  onSubmit,
  submitting,
  taskHistory,
  taskSummary,
  taskHistoryTotal,
  taskHistoryPage,
  taskHistoryPageSize,
  taskHistorySearch,
  taskHistoryStatus,
  historyLoading,
  onSelectHistoryTask,
  onOpenSearchRun,
  onRefreshHistory,
  onHistorySearchChange,
  onHistoryStatusChange,
  onHistoryPageChange,
  onDeleteTask,
  deletingTaskId,
  accountName,
  onContinueSearch
}: WorkbenchProps) {
  const greeting = useMemo(() => buildGreeting(), []);
  const [openPoolMenuId, setOpenPoolMenuId] = useState<string | null>(null);
  // 2026-05 Stage 3 follow-up: 跟踪客户池总数显示后端 summary 的全量
  // task_count，而不是 limit=30 列表的长度。一个新任务挤掉旧任务时
  // 列表数会保持 30，而真实总数应该 +1。
  const trackingPoolCount = taskSummary?.taskCount ?? taskHistory.length;

  // 2026-05 Stage 3 workbench KPI aggregation. All counters read ONLY
  // from the backend list summary (computed over the user's full task
  // history, not just the limit=30 listing window). Falls through to
  // taskHistory aggregation when summary is unavailable so the page
  // still renders during the first render before the response lands.
  //
  // 今日新增: sum of main-pool leadCount for tasks created today. The
  // summary builds it server-side from lead_candidates + the same
  // country-confidence gate the per-task lead_count uses, so the
  // strip stays consistent with the per-task counters.
  const todayLeadCount = useMemo(() => {
    if (taskSummary) return taskSummary.todayLeadCount;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return taskHistory
      .filter((task) => {
        const created = new Date(task.createdAt).getTime();
        return Number.isFinite(created) && created >= startOfDay.getTime();
      })
      .reduce((sum, task) => sum + (task.leadCount ?? 0), 0);
  }, [taskHistory, taskSummary]);

  // 待同步 CRM: full-history pendingCrmCount from summary. Used to
  // fall back to summing the limit=30 list rows; that under-counts
  // whenever a user has more than 30 historical tasks.
  const pendingCrmAcrossPools =
    taskSummary?.pendingCrmCount ??
    taskHistory.reduce((sum, task) => sum + (task.pendingCrmCount ?? 0), 0);

  // 邮件待确认: full-history pendingEmailCount from summary.
  const pendingEmailAcrossPools =
    taskSummary?.pendingEmailCount ??
    taskHistory.reduce((sum, task) => sum + (task.pendingEmailCount ?? 0), 0);

  // Reset scroll on mount so the greeting is always visible when the
  // workbench appears (e.g. returning from the pool detail page).
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollHostRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const quickActions: WorkbenchQuickAction[] = [
    {
      label: "找同类客户",
      prompt: "按已保存的客户画像，帮我找同类型买家客户。",
      icon: UsersRound
    },
    {
      label: "换国家继续搜",
      prompt: "继续用同类客户画像搜索其他国家市场。",
      icon: Globe2
    },
    {
      label: "只找渠道商",
      prompt: "只找经销商、分销商、代理商等渠道型买家。",
      icon: Building2
    },
    {
      label: "补充邮箱电话",
      prompt: "为现有客户池补充缺失的邮箱与电话。",
      icon: PhoneCall
    },
    {
      label: "排除弱相关客户",
      prompt: "把弱相关客户标记为 intelligence，从主表移除。",
      icon: Filter
    }
  ];

  // Customer-pool library — paged by the backend so users can reach all
  // pools, not just the first three recent cards.
  const poolCards = useMemo<WorkbenchPoolCard[]>(() => {
    const tones: WorkbenchPoolCard["tone"][] = ["blue", "green", "orange"];
    // Pick an icon based on the pool prompt/title content. Falls back to a
    // generic Globe2 when nothing matches. This makes 5G pools render as
    // antennas, oil/industrial as factories, solar as suns, channel as
    // building, etc — same vocabulary as the design spec.
    const pickIcon = (text: string): WorkbenchPoolCard["icon"] => {
      const t = text.toLowerCase();
      if (/5g|telecom|base station|基站|通信|olt|sfp|fiber|光纤|isp|wisp|无线/.test(t))
        return RadioTower;
      if (/油气|oil|gas|petro|industrial|工业|pump|valve|阀|压缩机|工厂/.test(t)) return Factory;
      if (/光伏|solar|pv|inverter|panel|组件|逆变器/.test(t)) return SunMedium;
      if (/经销|分销|代理|渠道|distributor|reseller|channel|wholesaler/.test(t)) return Building2;
      if (/email|mail|phone|联系|邮箱|电话/.test(t)) return Mail;
      return Globe2;
    };
    // Detect duplicate short titles within the visible page. When a
    // user runs the same prompt repeatedly the cards otherwise look
    // identical; append the run date so each card is distinguishable.
    const titleCounts = new Map<string, number>();
    for (const task of taskHistory) {
      const t = summarizePoolTitle(task.title || task.prompt || "客户池");
      titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
    }
    return taskHistory.map((task, index) => {
      const status = mapTaskStatusToPool(task.status);
      const shortName = summarizePoolTitle(task.title || task.prompt || "客户池");
      const isDuplicateTitle = (titleCounts.get(shortName) ?? 0) > 1;
      const dateSuffix = (() => {
        try {
          // Use HH:mm so duplicate same-day tasks remain distinguishable.
          return new Intl.DateTimeFormat("zh-CN", {
            hour: "2-digit",
            minute: "2-digit"
          }).format(new Date(task.updatedAt));
        } catch {
          return "";
        }
      })();
      const displayTitle =
        isDuplicateTitle && dateSuffix ? `${shortName} · ${dateSuffix}` : shortName;
      return {
        id: task.id,
        title: displayTitle,
        status: status.kind,
        statusLabel: status.label,
        markets: (task.targetMarkets?.length
          ? task.targetMarkets
          : inferTaskMarkets(`${task.title ?? ""} ${task.prompt ?? ""}`)
        ).slice(0, 3),
        leadCount: task.leadCount ?? 0,
        queryCount: task.queryCount ?? 0,
        updatedLabel: formatHistoryDate(task.updatedAt),
        icon: pickIcon(`${task.title ?? ""} ${task.prompt ?? ""}`),
        tone: tones[index] ?? "blue"
      };
    });
  }, [taskHistory]);

  const hasPoolFilters = Boolean(taskHistorySearch.trim()) || taskHistoryStatus !== "all";
  const poolTotalCount = hasPoolFilters
    ? taskHistoryTotal
    : taskHistoryTotal || taskSummary?.taskCount || taskHistory.length;
  const poolPageCount = Math.max(1, Math.ceil(poolTotalCount / taskHistoryPageSize));
  const poolRangeStart = poolTotalCount ? (taskHistoryPage - 1) * taskHistoryPageSize + 1 : 0;
  const poolRangeEnd = Math.min(taskHistoryPage * taskHistoryPageSize, poolTotalCount);
  const poolPageItems = paginationItems(taskHistoryPage, poolPageCount);
  const [poolSearchDraft, setPoolSearchDraft] = useState(taskHistorySearch);

  useEffect(() => {
    setPoolSearchDraft(taskHistorySearch);
  }, [taskHistorySearch]);

  function applyPoolSearch() {
    if (poolSearchDraft.trim() !== taskHistorySearch.trim()) {
      onHistorySearchChange(poolSearchDraft);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const textarea = event.currentTarget.elements.namedItem("lead-search-prompt");
    const submittedPrompt = textarea instanceof HTMLTextAreaElement ? textarea.value : prompt;
    if (!submittedPrompt.trim() || submitting) return;
    onPromptChange(submittedPrompt);
    onSubmit(submittedPrompt);
  }

  function applyQuickAction(action: WorkbenchQuickAction) {
    onPromptChange(action.prompt);
  }

  return (
    <div className="aiWorkbench" ref={scrollHostRef}>
      {/* Greeting */}
      <header className="aiWorkbenchHead">
        <div className="aiWorkbenchGreeting">
          <h1>
            {greeting.title}，{accountName} <span aria-hidden="true">{greeting.emoji}</span>
          </h1>
          <p>{greeting.subtitle}</p>
          <p className="aiWorkbenchTracker">
            <Sparkles size={14} aria-hidden="true" />
            AI 外贸员正在为你跟踪 {trackingPoolCount} 个客户池
          </p>
        </div>
      </header>

      {/* Search input + quick actions */}
      <section className="aiWorkbenchSearch" aria-label="开始搜索">
        <h2 className="aiWorkbenchSectionTitle">你想继续找哪类客户？</h2>
        <form className="aiWorkbenchSearchForm" onSubmit={handleSubmit}>
          <textarea
            name="lead-search-prompt"
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="例如：继续找中东 5G 基站维护客户，优先有邮箱和官网的系统集成商"
            rows={2}
            aria-label="搜索任务描述"
          />
          <div className="aiWorkbenchSearchActions">
            <button type="submit" className="aiWorkbenchPrimaryBtn" disabled={submitting}>
              <Search size={16} aria-hidden="true" />
              {submitting ? "搜索中..." : "开始搜索"}
            </button>
            <button
              type="button"
              className="aiWorkbenchSecondaryBtn"
              onClick={onRefreshHistory}
              disabled={historyLoading}
            >
              <Clock size={16} aria-hidden="true" />
              继续上次客户池
            </button>
          </div>
        </form>

        <p className="aiWorkbenchProfileHint">
          <Sparkles size={14} aria-hidden="true" />
          建议先完善产品画像和客户画像，让 AI 更准确理解产品卖点、目标客户和重点市场
        </p>

        <div className="aiWorkbenchQuickRow" role="group" aria-label="快捷指令">
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="aiWorkbenchQuickChip"
              onClick={() => applyQuickAction(action)}
            >
              <action.icon size={15} aria-hidden="true" />
              {action.label}
            </button>
          ))}
        </div>
        <p className="aiWorkbenchSearchHint">
          <Sparkles size={14} aria-hidden="true" />
          本轮默认生成 30 条搜索指令，可继续追加
        </p>
      </section>

      {/* Customer pool library */}
      <section className="aiWorkbenchPools" aria-label="客户池库">
        <header className="aiWorkbenchSectionHeader">
          <div className="aiWorkbenchPoolTitleBlock">
            <div className="aiWorkbenchPoolLibraryTitle">
              <h2 className="aiWorkbenchSectionTitle">客户池库</h2>
              <span>{poolTotalCount} 个</span>
            </div>
            <p className="aiWorkbenchPoolSummary">
              今日新增 {todayLeadCount} · 待同步 CRM {pendingCrmAcrossPools} · 邮件待确认{" "}
              {pendingEmailAcrossPools}
            </p>
          </div>
          <div className="aiWorkbenchPoolTools">
            <label className="aiWorkbenchPoolSearch">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={poolSearchDraft}
                onChange={(event) => setPoolSearchDraft(event.target.value)}
                onBlur={applyPoolSearch}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyPoolSearch();
                  }
                }}
                placeholder="搜索客户池"
                aria-label="搜索客户池"
              />
            </label>
            <div className="aiWorkbenchPoolTabs" role="tablist" aria-label="客户池状态筛选">
              {(
                [
                  ["all", "全部"],
                  ["active", "持续中"],
                  ["completed", "已完成"],
                  ["stopped", "已停止"]
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={taskHistoryStatus === value ? "active" : ""}
                  onClick={() => onHistoryStatusChange(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="aiWorkbenchSortBtn" disabled>
              最近更新
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
        </header>
        {historyLoading ? (
          <TableLoadingState
            title="正在加载客户池列表"
            description="正在同步客户池数量、搜索批次和待同步 CRM 状态。"
          />
        ) : poolCards.length ? (
          <div className="aiWorkbenchPoolGrid">
            {poolCards.map((pool) => {
              const isDemo = pool.id.startsWith("demo-");
              const isActivePool = pool.status === "active";
              return (
                <article className={`aiWorkbenchPoolCard tone-${pool.tone}`} key={pool.id}>
                  <span className="aiWorkbenchPoolIcon" aria-hidden="true">
                    <pool.icon size={22} />
                  </span>
                  <div className="aiWorkbenchPoolBody">
                    <header className="aiWorkbenchPoolHead">
                      <h3 className="aiWorkbenchPoolTitle" title={pool.title}>
                        {pool.title}
                      </h3>
                      <div className="aiWorkbenchPoolHeadActions">
                        <span className={`aiWorkbenchPoolBadge state-${pool.status}`}>
                          {pool.statusLabel}
                        </span>
                        <div className="aiWorkbenchPoolMenuWrap">
                          <button
                            type="button"
                            className="aiWorkbenchPoolMenuButton"
                            aria-label={`打开 ${pool.title} 操作菜单`}
                            aria-expanded={openPoolMenuId === pool.id}
                            onClick={() =>
                              setOpenPoolMenuId((current) => (current === pool.id ? null : pool.id))
                            }
                            disabled={isDemo || deletingTaskId === pool.id}
                          >
                            <MoreHorizontal size={16} aria-hidden="true" />
                          </button>
                          {openPoolMenuId === pool.id ? (
                            <div className="aiWorkbenchPoolMenu" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                className="danger"
                                disabled={deletingTaskId === pool.id}
                                onClick={() => {
                                  const confirmed =
                                    typeof window === "undefined" ||
                                    window.confirm(
                                      "删除后该客户池将从工作台隐藏，已加入 CRM 的客户不会删除。确定删除吗？"
                                    );
                                  if (!confirmed) return;
                                  setOpenPoolMenuId(null);
                                  onDeleteTask(pool.id);
                                }}
                              >
                                <Trash2 size={14} aria-hidden="true" />
                                {deletingTaskId === pool.id ? "删除中..." : "删除客户池"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </header>
                    <div className="aiWorkbenchPoolMarkets">
                      {pool.markets.length ? (
                        pool.markets.map((market) => <span key={market}>{market}</span>)
                      ) : (
                        <span>市场待补充</span>
                      )}
                    </div>
                    <p className="aiWorkbenchPoolDetail">
                      <span>{pool.leadCount} 客户</span>
                      <i />
                      <span>{pool.queryCount} query</span>
                      <i />
                      <span>{pool.updatedLabel}</span>
                    </p>
                    <footer className="aiWorkbenchPoolFoot">
                      <button
                        type="button"
                        className="aiWorkbenchPoolPrimary"
                        disabled={deletingTaskId === pool.id}
                        onClick={() => {
                          if (isDemo || deletingTaskId === pool.id) return;
                          if (isActivePool) {
                            onOpenSearchRun(pool.id);
                            return;
                          }
                          if (onContinueSearch) {
                            onContinueSearch(pool.id);
                            return;
                          }
                          onSelectHistoryTask(pool.id);
                        }}
                      >
                        {isActivePool ? (
                          <Search size={14} aria-hidden="true" />
                        ) : (
                          <Play size={14} aria-hidden="true" />
                        )}
                        {isActivePool ? "返回搜索界面" : "继续搜索 30 条"}
                      </button>
                      {!isActivePool ? (
                        <button
                          type="button"
                          className="aiWorkbenchPoolSecondary"
                          disabled={deletingTaskId === pool.id}
                          onClick={() => {
                            if (isDemo || deletingTaskId === pool.id) return;
                            onOpenSearchRun(pool.id);
                          }}
                        >
                          搜索记录
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="aiWorkbenchPoolSecondary"
                        disabled={deletingTaskId === pool.id}
                        onClick={() =>
                          isDemo || deletingTaskId === pool.id
                            ? undefined
                            : onSelectHistoryTask(pool.id)
                        }
                      >
                        查看客户池
                      </button>
                    </footer>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="aiWorkbenchPoolEmpty">
            <span className="aiWorkbenchPoolEmptyIcon" aria-hidden="true">
              <Database size={24} />
            </span>
            <strong>{hasPoolFilters ? "没有找到匹配的客户池" : "还没有客户池"}</strong>
            <p>
              {hasPoolFilters
                ? "换个关键词或切回“全部”状态再看看。"
                : "在上方输入客户类型、国家或产品关键词，开始创建第一个客户池。"}
            </p>
          </div>
        )}
        <footer className="aiWorkbenchPoolPager">
          <p>
            显示 {poolRangeStart}-{poolRangeEnd} / {poolTotalCount}
          </p>
          <div className="aiWorkbenchPagerControls">
            <button
              type="button"
              onClick={() => onHistoryPageChange(taskHistoryPage - 1)}
              disabled={taskHistoryPage <= 1 || historyLoading}
            >
              <ChevronLeft size={14} aria-hidden="true" />
              上一页
            </button>
            {poolPageItems.map((item, index) =>
              item === "ellipsis" ? (
                <span className="aiWorkbenchPagerDots" key={`dots-${index}`}>
                  ...
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={item === taskHistoryPage ? "active" : ""}
                  onClick={() => onHistoryPageChange(item)}
                  disabled={historyLoading}
                >
                  {item}
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => onHistoryPageChange(taskHistoryPage + 1)}
              disabled={taskHistoryPage >= poolPageCount || historyLoading}
            >
              下一页
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function buildGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) {
    return { title: "夜深了", subtitle: "今天继续扩充你的外贸客户池", emoji: "🌙" };
  }
  if (hour < 12) {
    return { title: "早上好", subtitle: "今天继续扩充你的外贸客户池", emoji: "☀️" };
  }
  if (hour < 18) {
    return { title: "下午好", subtitle: "今天继续扩充你的外贸客户池", emoji: "☕" };
  }
  return { title: "晚上好", subtitle: "今天继续扩充你的外贸客户池", emoji: "🌆" };
}

function paginationItems(currentPage: number, pageCount: number): Array<number | "ellipsis"> {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, "ellipsis", pageCount];
  }

  if (currentPage >= pageCount - 2) {
    return [1, "ellipsis", pageCount - 2, pageCount - 1, pageCount];
  }

  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", pageCount];
}

function inferTaskMarkets(text: string) {
  const marketPatterns: Array<[string, RegExp]> = [
    ["UAE", /\buae\b|阿联酋|迪拜|dubai/i],
    ["Saudi Arabia", /saudi|沙特/i],
    ["Qatar", /qatar|卡塔尔/i],
    ["Oman", /oman|阿曼/i],
    ["Kuwait", /kuwait|科威特/i],
    ["Germany", /germany|deutschland|德国/i],
    ["Indonesia", /indonesia|印尼|印度尼西亚/i],
    ["Vietnam", /vietnam|越南/i],
    ["Malaysia", /malaysia|马来西亚/i],
    ["Brazil", /brazil|巴西/i],
    ["Mexico", /mexico|墨西哥/i]
  ];

  return marketPatterns.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}

function mapTaskStatusToPool(status: string): { kind: WorkbenchPoolCard["status"]; label: string } {
  const lower = (status || "").toLowerCase();
  if (lower === "running" || lower === "searching") {
    return { kind: "active", label: "持续获客中" };
  }
  if (lower === "paused" || lower === "completed") {
    return { kind: "completed", label: "已完成" };
  }
  if (lower === "failed" || lower === "cancelled") {
    return { kind: "pending", label: "已停止" };
  }
  return { kind: "pending", label: "待触达" };
}

// ============================================================================
// 2026-05 LeadHunt 2.0 — AiWorkerPool
// ----------------------------------------------------------------------------
// Customer pool detail page. Shows:
//   - Header: pool title + status + country chips + meta + right actions
//   - 6 KPI cards (客户池总数 / 高匹配 / 有联系方式 / 待加入 CRM / 已触达 / 回复)
//   - Filter bar (search + 6 dropdowns + clear)
//   - Selected filter chips
//   - Bulk action bar (select N candidates + 4 actions)
//   - Candidate table (12 cols: checkbox / 公司名 / 国家 / 类型 / 推荐指数 /
//                     联系方式 / 电话 / 官网 / 来源批次 / CRM状态 / 邮件状态 /
//                     最近动作 / 操作)
//   - Pagination
//   - Pool health hint (last item; no AI input bar — that was removed
//     in 2026-05 to keep the page within one viewport).
//
// This is a static-first implementation. Real data wiring (filter state,
// bulk actions to API, pagination state) comes in a follow-up commit.
// ============================================================================

type PoolProps = {
  task: LeadTask | null;
  taskHistoryItem: LeadTaskListItem | null;
  leads: DisplayLead[];
  loading: boolean;
  approving: boolean;
  rejecting: boolean;
  onBack: () => void;
  onOpenSearchRun: () => void;
  onContinueSearch: () => void;
  onBulkApprove: (leadIds: string[]) => void;
  onBulkReject: (leadIds: string[]) => void;
  onOpenLeadDetail: (lead: DisplayLead) => void;
  onApproveLead: (leadId: string) => void;
  onRejectLead: (leadId: string) => void;
};

type PoolKpi = {
  label: string;
  value: string | number;
  delta?: string;
  icon: typeof Users;
  tone: "blue" | "orange" | "teal" | "indigo" | "purple" | "rose" | "green";
};

type PoolFilterKey = "country" | "customerType" | "score" | "contact" | "crm" | "mail";

type PoolFilters = Record<PoolFilterKey, string>;

type PoolFilterOption = {
  label: string;
  value: string;
};

type PoolFilterSelect = {
  key: PoolFilterKey;
  label: string;
  options: PoolFilterOption[];
};

type PoolLeadRow = {
  lead: DisplayLead;
  row: PoolTableRow;
};

type PoolTableRow = {
  id: string;
  companyName: string;
  country: string;
  industry: string;
  scoreStars: number; // 0..5
  scoreValue: number;
  hasEmail: boolean;
  emailCount: number;
  emailFirst: string;
  emailAll: string[];
  hasPhone: boolean;
  phoneCount: number;
  phoneFirst: string;
  phoneAll: string[];
  hasReachableContact: boolean;
  website: string;
  websiteShort: string;
  sourceBatch: string;
  crmStatus: "pending" | "synced" | "active";
  crmStatusLabel: string;
  mailStatus: "未触达" | "待发送" | "已发送" | "已回复";
  lastAction: string;
};

const emptyPoolFilters: PoolFilters = {
  country: "",
  customerType: "",
  score: "",
  contact: "",
  crm: "",
  mail: ""
};

const poolScoreFilterOptions: PoolFilterOption[] = [
  { value: "", label: "全部" },
  { value: "high", label: "75+ 高匹配" },
  { value: "medium", label: "60-74 中匹配" },
  { value: "low", label: "50-59 待复核" },
  { value: "below50", label: "50 以下" }
];

const poolContactFilterOptions: PoolFilterOption[] = [
  { value: "", label: "全部" },
  { value: "email", label: "有邮箱" },
  { value: "phone", label: "有电话" },
  { value: "reachable", label: "有可触达入口" },
  { value: "emailOrPhone", label: "有邮箱或电话" },
  { value: "emailAndPhone", label: "邮箱+电话" },
  { value: "none", label: "无联系方式" }
];

const poolCrmStatusFilterOptions: PoolFilterOption[] = [
  { value: "", label: "全部" },
  { value: "joined", label: "已加入" },
  { value: "notJoined", label: "未加入" }
];

const poolMailStatusFilterOptions: PoolFilterOption[] = [
  { value: "", label: "全部" },
  { value: "reached", label: "已触达" },
  { value: "unreached", label: "未触达" }
];

function AiWorkerPool({
  task,
  taskHistoryItem,
  leads,
  loading,
  approving,
  rejecting,
  onBack,
  onOpenSearchRun,
  onContinueSearch,
  onBulkApprove,
  onBulkReject,
  onOpenLeadDetail,
  onApproveLead,
  onRejectLead
}: PoolProps) {
  const poolTitle = useMemo(() => {
    if (taskHistoryItem?.title) {
      return summarizePoolTitle(taskHistoryItem.title);
    }
    if (task?.id) return "客户池";
    return "客户池";
  }, [task, taskHistoryItem]);

  const targetMarkets = useMemo(() => {
    return taskTargetMarkets(task);
  }, [task]);

  const poolStatus = useMemo(() => {
    return mapTaskStatusToPool(taskHistoryItem?.status ?? task?.status ?? "");
  }, [task, taskHistoryItem]);
  const isPoolActive = poolStatus.kind === "active";
  const targetAssessment = useMemo(
    () =>
      task?.inputPayload?.profileSignals?.queryLearning?.targetAssessment ??
      buildClientTargetAssessment(task, leads),
    [task, leads]
  );
  const assessmentChecks = targetAssessment?.checks ?? [];

  // 2026-05 Stage 2: KPIs and the candidate table read ONLY from
  // currentTask.leadCandidates (via the displayLeads prop). When the
  // task hasn't loaded yet we render zeroes / placeholders rather
  // than synthesised demo numbers — those used to leak across into
  // production and made the page look fake.
  const totalLeads = leads.length;
  const queryCount = task?.searchQueries?.length ?? 0;
  // 2026-05 V1-MVP+: align "高匹配" KPI with the backend qualification
  // threshold (score >= 75 → status 'qualified', grade 'high'). The
  // previous >=80 cutoff hid every backend-qualified lead that scored
  // 75-79 (e.g. Kalaam Telecom 79, Alsaif 77, Contacts 76) and made the
  // "0 高匹配 / 30 条 query" KPI feel like the agent failed even when
  // the pool actually contained reachable buyers.
  const highMatch = useMemo(() => leads.filter((lead) => lead.score >= 75).length, [leads]);
  const withContact = useMemo(
    () => leads.filter((lead) => hasReachableLeadContact(lead.raw.contacts)).length,
    [leads]
  );
  const pendingCrm = useMemo(
    () =>
      leads.filter((lead) => {
        const status = lead.raw.status ?? "";
        const inCrm =
          Boolean(lead.raw.crmLead) ||
          status === "approved" ||
          status === "contacted" ||
          status === "email_sent";
        return !inCrm;
      }).length,
    [leads]
  );
  const emailReached = useMemo(
    () => leads.filter((lead) => hasSentEmail(lead.raw)).length,
    [leads]
  );
  // Reply rate is unknown until backend exposes it; show 0 when no
  // email actually went out so the table doesn't read as if 5 customers
  // replied to 1 outbound email.
  const repliedCount = useMemo(() => {
    const replied = leads.filter((lead) => {
      const drafts = lead.raw.outreachDrafts ?? [];
      return drafts.some((draft) => (draft.sendLogs ?? []).some((log) => log.status === "replied"));
    }).length;
    return replied;
  }, [leads]);
  const replyRate = emailReached > 0 ? Math.round((repliedCount / emailReached) * 1000) / 10 : 0;

  // Main vs review-tail counts. buildDisplayLeads already gives us a
  // sorted combined list (mainLeads first, reviewTail after), so we
  // recompute the split here for the "待复核 N 条" hint.
  const mainLeadCount = useMemo(() => leads.filter((lead) => lead.actionable).length, [leads]);
  const reviewTailCount = totalLeads - mainLeadCount;

  // 2026-05 Stage 2: when the backend returns evidence/intelligence
  // candidates that buildDisplayLeads filters out (content_evidence,
  // intelligence, hidden_evidence), the user sees fewer rows than the
  // raw API count. Surface the gap so they know we didn't lose data.
  const hiddenEvidenceCount = Math.max(0, (task?.leadCandidates?.length ?? 0) - totalLeads);

  const kpis: PoolKpi[] = [
    {
      label: "本池客户",
      value: totalLeads,
      // 2026-05 LeadHunt 2.0: no honest week-over-week source yet, so
      // surface batch metadata instead of fake growth deltas.
      delta: queryCount ? `${queryCount} 条 query` : "首批",
      icon: Users,
      tone: "blue"
    },
    {
      label: "高匹配",
      value: highMatch,
      delta: totalLeads > 0 ? `占比 ${percent(highMatch, totalLeads)}` : "暂无数据",
      icon: Star,
      tone: "orange"
    },
    {
      label: "有联系方式",
      value: withContact,
      delta: totalLeads > 0 ? `占比 ${percent(withContact, totalLeads)}` : "暂无数据",
      icon: PhoneCall,
      tone: "teal"
    },
    {
      label: "待加入 CRM",
      value: pendingCrm,
      delta: totalLeads > 0 ? `占比 ${percent(pendingCrm, totalLeads)}` : "暂无数据",
      icon: Database,
      tone: "indigo"
    },
    {
      label: "已触达",
      value: emailReached,
      delta: totalLeads > 0 ? `占比 ${percent(emailReached, totalLeads)}` : "暂无数据",
      icon: Send,
      tone: "purple"
    },
    {
      label: "回复",
      value: repliedCount,
      delta: emailReached > 0 ? `回复率 ${replyRate}%` : "暂无数据",
      icon: MessageCircle,
      tone: "rose"
    }
  ];

  // 2026-05 Stage 2: header chips reflect the real target markets
  // for this task only. No fallback to UAE/Saudi/Qatar — that used to
  // read like a hardcoded sample whenever currentTask hadn't loaded.
  const countryChips = targetMarkets.slice(0, 6);

  // Local UI state. selection / search / page is purely local; the
  // data source is currentTask.leadCandidates via the leads prop.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState("");
  const [poolFilters, setPoolFilters] = useState<PoolFilters>(() => ({ ...emptyPoolFilters }));
  const [openPoolFilterKey, setOpenPoolFilterKey] = useState<PoolFilterKey | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const poolFiltersRef = useRef<HTMLElement>(null);

  const poolLeadRows: PoolLeadRow[] = useMemo(
    () => leads.map((lead) => ({ lead, row: buildPoolTableRow(lead) })),
    [leads]
  );

  const countryFilterOptions = useMemo(
    () =>
      createPoolFilterOptions(
        poolLeadRows.map(({ row }) => row.country),
        "全部"
      ),
    [poolLeadRows]
  );
  const customerTypeFilterOptions = useMemo(
    () =>
      createPoolFilterOptions(
        poolLeadRows.map(({ row }) => row.industry),
        "全部"
      ),
    [poolLeadRows]
  );
  const filterSelects: PoolFilterSelect[] = useMemo(
    () => [
      { key: "country", label: "国家/地区", options: countryFilterOptions },
      { key: "customerType", label: "客户类型", options: customerTypeFilterOptions },
      { key: "score", label: "推荐指数", options: poolScoreFilterOptions },
      { key: "contact", label: "联系方式", options: poolContactFilterOptions },
      { key: "crm", label: "CRM 状态", options: poolCrmStatusFilterOptions },
      { key: "mail", label: "邮件状态", options: poolMailStatusFilterOptions }
    ],
    [countryFilterOptions, customerTypeFilterOptions]
  );
  const hasActivePoolFilters = hasAnyPoolFilter(poolFilters);
  const activePoolFilterChips = useMemo(
    () =>
      filterSelects.flatMap((select) => {
        const value = poolFilters[select.key];
        if (!value) return [];
        const option = select.options.find((item) => item.value === value);
        return [
          {
            key: select.key,
            label: select.label,
            valueLabel: option?.label ?? value
          }
        ];
      }),
    [filterSelects, poolFilters]
  );

  // Filter leads by text search plus the structured select filters above.
  // Empty search / filters mean show everything.
  const filteredLeadRows = useMemo(() => {
    const needle = searchInput.trim().toLowerCase();
    return poolLeadRows.filter((item) => {
      const { lead, row } = item;
      if (!matchesPoolLeadFilters(item, poolFilters)) return false;
      if (!needle) return true;
      const haystack = [
        lead.companyName,
        lead.country,
        lead.website,
        lead.email,
        lead.phone,
        lead.tag,
        row.industry,
        row.crmStatusLabel,
        row.mailStatus,
        row.lastAction,
        row.sourceBatch
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [poolLeadRows, poolFilters, searchInput]);

  const filteredCount = filteredLeadRows.length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
  const safePage = Math.min(pageNumber, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, filteredCount);
  const pagedLeadRows = useMemo(
    () => filteredLeadRows.slice(pageStart, pageEnd),
    [filteredLeadRows, pageStart, pageEnd]
  );
  const pagedLeads = useMemo(() => pagedLeadRows.map(({ lead }) => lead), [pagedLeadRows]);

  // Build table rows from the paged candidates. No demo fallback —
  // empty state shows a single row with a placeholder message.
  const rows: PoolTableRow[] = useMemo(() => pagedLeadRows.map(({ row }) => row), [pagedLeadRows]);

  const allChecked = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));

  // 2026-05 Stage 2: derived helper — only candidates not yet in CRM
  // are valid bulk-approve targets. Used to filter the current
  // selection so a user can't re-approve already-synced rows.
  const isPendingCrmCandidate = (lead: DisplayLead) => {
    return !lead.raw.crmLead;
  };

  // Drop selection ids that no longer exist in the candidate list (e.g.
  // after polling pulls a refreshed task) AND drop ids that have moved
  // out of the pending-CRM bucket — the bulk-approve button should
  // never claim "已选择 N 家" when those N have already been approved.
  useEffect(() => {
    setSelectedIds((current) => {
      const stillPending = new Set(leads.filter(isPendingCrmCandidate).map((lead) => lead.id));
      const next = new Set<string>();
      current.forEach((id) => {
        if (stillPending.has(id)) next.add(id);
      });
      return next.size === current.size ? current : next;
    });
  }, [leads]);

  // How many of the currently selected ids are still pending CRM. The
  // bulk-approve button uses this directly so it can't fire on a
  // selection that's already been synced (race window: between click
  // and the cleanup effect ticking).
  const selectedPendingCount = useMemo(() => {
    const pendingIds = new Set(leads.filter(isPendingCrmCandidate).map((lead) => lead.id));
    let count = 0;
    selectedIds.forEach((id) => {
      if (pendingIds.has(id)) count += 1;
    });
    return count;
  }, [leads, selectedIds]);

  // Snap pageNumber back into range whenever the filtered set shrinks.
  useEffect(() => {
    if (pageNumber > totalPages) {
      setPageNumber(totalPages);
    }
  }, [pageNumber, totalPages]);

  useEffect(() => {
    if (!openPoolFilterKey) return;

    function handlePointerDown(event: MouseEvent) {
      if (!poolFiltersRef.current?.contains(event.target as Node)) {
        setOpenPoolFilterKey(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenPoolFilterKey(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openPoolFilterKey]);

  function toggleAll() {
    if (allChecked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(rows.map((row) => row.id)));
  }

  function toggleRow(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="aiPool">
      {/* Header */}
      <header className="aiPoolHeader">
        <div className="aiPoolHeaderTop">
          <button type="button" className="aiPoolBack" onClick={onBack}>
            <ChevronLeft size={16} aria-hidden="true" />
            返回工作台
          </button>
        </div>
        <div className="aiPoolHeaderRow">
          <div className="aiPoolHeaderLeft">
            <div className="aiPoolHeaderTitle">
              <span className="aiPoolIcon aiPoolIconBlue" aria-hidden="true">
                <RadioTower size={22} />
              </span>
              <h1>{poolTitle}</h1>
              <span className={`aiPoolBadge state-${poolStatus.kind}`}>{poolStatus.label}</span>
            </div>
            <div className="aiPoolCountryChips">
              {countryChips.map((country) => (
                <span key={country} className="aiPoolCountryChip">
                  {country}
                </span>
              ))}
            </div>
            <p className="aiPoolMeta">
              {loading
                ? "正在同步客户池客户"
                : totalLeads > 0
                  ? `本池 ${totalLeads} 家客户`
                  : "本池暂无候选客户"}
              {queryCount > 0 ? `，本批跑了 ${queryCount} 条 query` : ""}
            </p>
          </div>
          <div className="aiPoolHeaderActions">
            <button
              type="button"
              className="aiPoolPrimaryBtn"
              onClick={isPoolActive ? onOpenSearchRun : onContinueSearch}
            >
              {isPoolActive ? (
                <Search size={14} aria-hidden="true" />
              ) : (
                <Play size={14} aria-hidden="true" />
              )}
              {isPoolActive ? "返回搜索界面" : "继续搜索 30 条"}
            </button>
            <button type="button" className="aiPoolGhostBtn" disabled title="导出功能开发中">
              <Download size={14} aria-hidden="true" />
              导出
            </button>
            <button
              type="button"
              className="aiPoolGhostBtn"
              disabled
              title="批量加入 CRM 请在下方表格勾选客户后从批量操作栏触发"
            >
              <Database size={14} aria-hidden="true" />
              批量加入 CRM
            </button>
            <button
              type="button"
              className="aiPoolGhostBtn"
              disabled
              title="批量生成邮件功能开发中"
            >
              <Mail size={14} aria-hidden="true" />
              批量生成邮件
            </button>
          </div>
        </div>
      </header>

      {/* KPI cards */}
      <section className="aiPoolKpis" aria-label="数据概览">
        {kpis.map((kpi) => (
          <article className={`aiPoolKpi tone-${kpi.tone}`} key={kpi.label}>
            <span className="aiPoolKpiIcon" aria-hidden="true">
              <kpi.icon size={20} />
            </span>
            <div className="aiPoolKpiBody">
              <span className="aiPoolKpiLabel">{kpi.label}</span>
              <strong className="aiPoolKpiValue">{kpi.value}</strong>
              {kpi.delta ? <span className="aiPoolKpiDelta">{kpi.delta}</span> : null}
            </div>
          </article>
        ))}
      </section>

      {targetAssessment ? (
        <section
          className={`aiPoolMaturity tone-${maturityAssessmentTone(targetAssessment.status)}`}
          aria-label="成熟目标验收"
        >
          <div className="aiPoolMaturitySummary">
            <span className="aiPoolMaturityEyebrow">30 query 验收目标</span>
            <strong>{maturityAssessmentTitle(targetAssessment.status)}</strong>
            <span>
              成熟度 {Math.round(targetAssessment.readinessScore ?? 0)} · 基于{" "}
              {targetAssessment.queryBasis ?? 0} 条已执行 query
            </span>
          </div>
          <div className="aiPoolMaturityChecks">
            {assessmentChecks.map((check) => (
              <span
                key={check.key ?? check.label}
                className={`aiPoolMaturityCheck state-${maturityAssessmentTone(check.status)}`}
                title={`目标 ${check.target ?? "-"}`}
              >
                {maturityCheckLabel(check.key, check.label)}
                <strong>{formatMaturityCheckValue(check.key, check.value)}</strong>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {/* Filter bar */}
      <section className="aiPoolFilters" aria-label="筛选条件" ref={poolFiltersRef}>
        <label className="aiPoolSearchInput">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => {
              // 2026-05 Stage 2: snap back to page 1 immediately so a
              // user typing on page 3 doesn't see an empty page flash
              // before the effect-based clamp kicks in.
              setSearchInput(event.target.value);
              setPageNumber(1);
            }}
            placeholder="搜索公司、官网、邮箱、国家"
          />
        </label>
        {filterSelects.map((dropdown) => {
          const selectedValue = poolFilters[dropdown.key];
          const selectedOption =
            dropdown.options.find((option) => option.value === selectedValue) ??
            dropdown.options[0];
          const isOpen = openPoolFilterKey === dropdown.key;

          return (
            <div
              key={dropdown.key}
              className="aiPoolFilterDropdown"
              data-active={poolFilters[dropdown.key] ? "true" : undefined}
              data-filter-key={dropdown.key}
              data-open={isOpen ? "true" : undefined}
            >
              <button
                type="button"
                className="aiPoolFilterTrigger"
                aria-label={dropdown.label}
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                onClick={() => {
                  setOpenPoolFilterKey((current) =>
                    current === dropdown.key ? null : dropdown.key
                  );
                }}
              >
                <span className="aiPoolFilterLabel">{dropdown.label}</span>
                <span className="aiPoolFilterValue">{selectedOption?.label ?? "全部"}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              {isOpen ? (
                <div className="aiPoolFilterMenu" role="listbox" aria-label={dropdown.label}>
                  {dropdown.options.map((option) => {
                    const selected = option.value === selectedValue;
                    return (
                      <button
                        key={option.value || "all"}
                        type="button"
                        className="aiPoolFilterOption"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setPoolFilters((current) =>
                            current[dropdown.key] === option.value
                              ? current
                              : { ...current, [dropdown.key]: option.value }
                          );
                          setOpenPoolFilterKey(null);
                          setPageNumber(1);
                        }}
                      >
                        <span>{option.label}</span>
                        {selected ? <CheckCircle2 size={14} aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          className="aiPoolFilterClear"
          onClick={() => {
            setSearchInput("");
            setPoolFilters({ ...emptyPoolFilters });
            setPageNumber(1);
          }}
          disabled={!searchInput && !hasActivePoolFilters}
        >
          清空筛选
        </button>
      </section>

      {/* 2026-05 Stage 2: meta hint row replaces the old hardcoded
          "Saudi Arabia / 推荐指数 60+ / 有邮箱" chips. Now shows the
          real review-tail count and the batch query count, so users
          know where the difference between the API total and the
          main table comes from. */}
      {activePoolFilterChips.length > 0 ||
      reviewTailCount > 0 ||
      queryCount > 0 ||
      hiddenEvidenceCount > 0 ? (
        <div className="aiPoolSelectedChips">
          {activePoolFilterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="aiPoolSelectedChip is-removable"
              title={`移除 ${chip.label} 筛选`}
              onClick={() => {
                setPoolFilters((current) => ({ ...current, [chip.key]: "" }));
                setPageNumber(1);
              }}
            >
              <span>
                {chip.label}：{chip.valueLabel}
              </span>
              <X size={12} aria-hidden="true" />
            </button>
          ))}
          {queryCount > 0 ? (
            <span className="aiPoolSelectedChip" data-tone="info">
              本批 {queryCount} 条 query
            </span>
          ) : null}
          {totalLeads > 0 ? (
            <span className="aiPoolSelectedChip" data-tone="info">
              主客户 {mainLeadCount} 条
            </span>
          ) : null}
          {reviewTailCount > 0 ? (
            <span
              className="aiPoolSelectedChip"
              data-tone="warn"
              title="国家/邮箱待补全的候选客户，需要先逐条复核再纳入主客户"
            >
              待复核 {reviewTailCount} 条
            </span>
          ) : null}
          {hiddenEvidenceCount > 0 ? (
            <span
              className="aiPoolSelectedChip"
              data-tone="muted"
              title="内容证据/情报类候选已自动归档，不进入主客户表"
            >
              情报归档 {hiddenEvidenceCount} 条
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Bulk action bar (shown when selection exists) */}
      {selectedIds.size > 0 ? (
        <div className="aiPoolBulkBar" aria-label="批量操作">
          <label className="aiPoolBulkSelectAll">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="全选" />
            <span>已选</span>
            <strong>{selectedIds.size}</strong>
            <span>家客户</span>
            {selectedPendingCount < selectedIds.size ? (
              <span className="aiPoolBulkSelectAllNote" title="已加入 CRM 的客户不会重复同步">
                （其中 {selectedPendingCount} 家可加入 CRM）
              </span>
            ) : null}
          </label>
          <div className="aiPoolBulkActions">
            <button
              type="button"
              className="aiPoolBulkAction primary"
              disabled={approving || selectedPendingCount === 0}
              title={selectedPendingCount === 0 ? "已选客户都已加入 CRM，无需重复同步" : undefined}
              onClick={() => {
                const pendingIds = new Set(
                  leads.filter(isPendingCrmCandidate).map((lead) => lead.id)
                );
                const targetIds = Array.from(selectedIds).filter((id) => pendingIds.has(id));
                if (targetIds.length === 0) return;
                onBulkApprove(targetIds);
                // Optimistically clear selection — refreshTask will land
                // and the cleanup effect would clear it shortly anyway,
                // but doing it eagerly avoids a half-second window where
                // the bulk bar still reads "已选 N 家".
                setSelectedIds(new Set());
              }}
            >
              <Database size={14} aria-hidden="true" />
              {selectedPendingCount === 0 ? "已加入 CRM" : "加入 CRM"}
            </button>
            <button
              type="button"
              className="aiPoolBulkAction"
              disabled
              title="批量生成邮件功能开发中，请先完成 CRM 同步"
            >
              <Mail size={13} aria-hidden="true" />
              生成邮件
            </button>
            <button
              type="button"
              className="aiPoolBulkAction danger"
              disabled={rejecting || selectedPendingCount === 0}
              title={selectedPendingCount === 0 ? "已加入 CRM 的客户不会在这里标记无效" : undefined}
              onClick={() => {
                const pendingIds = new Set(
                  leads.filter(isPendingCrmCandidate).map((lead) => lead.id)
                );
                const targetIds = Array.from(selectedIds).filter((id) => pendingIds.has(id));
                if (targetIds.length === 0) return;
                onBulkReject(targetIds);
                setSelectedIds(new Set());
              }}
            >
              <X size={13} aria-hidden="true" />
              标记无效
            </button>
            <button type="button" className="aiPoolBulkAction" disabled title="导出选中功能开发中">
              <Download size={13} aria-hidden="true" />
              导出选中
            </button>
          </div>
        </div>
      ) : null}

      {/* Candidate table */}
      <section className="aiPoolTableWrap" aria-label="候选客户表">
        {loading ? (
          <TableLoadingState
            title="正在加载客户池客户"
            description="正在同步候选客户、联系方式和 CRM 状态。"
          />
        ) : (
          <div className="aiPoolTableScroll">
            <table className="aiPoolTable">
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      aria-label="全选当前页"
                    />
                  </th>
                  <th className="col-company">公司名称</th>
                  <th>国家/地区</th>
                  <th>客户类型</th>
                  <th className="col-score">推荐指数</th>
                  <th className="col-email">邮箱</th>
                  <th className="col-phone">电话</th>
                  <th className="col-website">官网</th>
                  <th>CRM 状态</th>
                  <th>邮件状态</th>
                  <th>最近动作</th>
                  <th className="col-action">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((row) => (
                    <tr key={row.id} className={selectedIds.has(row.id) ? "selected" : undefined}>
                      <td className="col-check">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.id)}
                          onChange={() => toggleRow(row.id)}
                          aria-label={`选择 ${row.companyName}`}
                        />
                      </td>
                      <td className="col-company" title={row.companyName}>
                        <span className="aiPoolCompanyName">{row.companyName}</span>
                      </td>
                      <td>{row.country}</td>
                      <td>{row.industry}</td>
                      <td className="col-score">
                        <span className="aiPoolScoreStars" aria-hidden="true">
                          {renderStars(row.scoreStars)}
                        </span>
                        <span className="aiPoolScoreValue">{row.scoreValue}</span>
                      </td>
                      <td
                        className="col-email"
                        title={row.emailCount ? row.emailAll.join("\n") : "暂无邮箱"}
                      >
                        {row.hasEmail ? (
                          <span className="aiPoolContactValue">
                            <Mail size={11} aria-hidden="true" />
                            <span className="aiPoolContactText">{row.emailFirst}</span>
                            {row.emailCount > 1 ? (
                              <span className="aiPoolContactMore">…</span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="aiPoolContactBadge muted">— 邮箱 0</span>
                        )}
                      </td>
                      <td
                        className="col-phone"
                        title={row.phoneCount ? row.phoneAll.join("\n") : "暂无电话"}
                      >
                        {row.hasPhone ? (
                          <span className="aiPoolContactValue">
                            <PhoneCall size={11} aria-hidden="true" />
                            <span className="aiPoolContactText">{row.phoneFirst}</span>
                            {row.phoneCount > 1 ? (
                              <span className="aiPoolContactMore">…</span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="aiPoolContactBadge muted">电话 0</span>
                        )}
                      </td>
                      <td className="col-website" title={row.website}>
                        {row.websiteShort && row.websiteShort !== "—" ? (
                          <a
                            className="aiPoolWebsite"
                            href={websiteHref(row.website)}
                            onClick={(event) => event.stopPropagation()}
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            {row.websiteShort}
                          </a>
                        ) : (
                          <span className="aiPoolWebsite">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`aiPoolCrmBadge state-${row.crmStatus}`}>
                          {row.crmStatusLabel}
                        </span>
                      </td>
                      <td>
                        <span className="aiPoolMailStatus">{row.mailStatus}</span>
                      </td>
                      <td className="col-action-meta">{row.lastAction}</td>
                      <td className="col-action">
                        <button
                          type="button"
                          className="aiPoolRowAction"
                          onClick={(event) => {
                            event.stopPropagation();
                            const lead = pagedLeads.find((item) => item.id === row.id);
                            if (lead) {
                              onOpenLeadDetail(lead);
                            }
                          }}
                        >
                          详情
                        </button>
                        <button
                          type="button"
                          className="aiPoolRowAction"
                          disabled={approving || row.crmStatus === "synced"}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (row.crmStatus !== "synced") {
                              onApproveLead(row.id);
                            }
                          }}
                        >
                          {row.crmStatus === "synced" ? "已加入" : "加入 CRM"}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="leadEmptyCell" colSpan={12}>
                      {searchInput || hasActivePoolFilters
                        ? "没有匹配当前筛选条件的候选客户。"
                        : "暂无候选客户。回到搜索页继续搜索 30 条来扩充客户池。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <footer className="aiPoolTableFooter">
          <p className="aiPoolTableFootHint">
            显示 {filteredCount === 0 ? 0 : pageStart + 1}-{pageEnd} / {filteredCount}
            {filteredCount !== totalLeads ? `（全部 ${totalLeads}）` : ""}
            <span className="aiPoolTableFootSep">·</span>
            点击公司可查看完整邮箱、电话、地址、来源 query 和评分原因
          </p>
          <div className="aiPoolPagination">
            <span className="aiPoolPageSize">
              每页
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPageNumber(1);
                }}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </span>
            <button
              type="button"
              className="aiPoolPageBtn"
              disabled={safePage <= 1}
              onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            >
              上一页
            </button>
            <span className="aiPoolPageIndicator">
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              className="aiPoolPageBtn"
              disabled={safePage >= totalPages}
              onClick={() => setPageNumber((current) => Math.min(totalPages, current + 1))}
            >
              下一页
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function summarizePoolTitle(raw: string): string {
  const trimmed = raw.trim();
  // Common prefix in user prompts
  const cleaned = trimmed.replace(/^帮我找/, "").replace(/^找/, "");
  const firstChunk = cleaned.split(/[，,]|目标/)[0]?.trim() || cleaned;
  // If the user prompt already ends with "客户" / "客户池", don't append
  // an extra suffix that produces awkward strings like
  // "...买家客户客户池". Just trim length and return.
  const alreadyHasPoolSuffix = /客户池$/.test(firstChunk);
  const alreadyEndsWithCustomer = /客户$/.test(firstChunk);
  let label = firstChunk;
  if (!alreadyHasPoolSuffix) {
    label = alreadyEndsWithCustomer ? firstChunk + "池" : firstChunk + "客户池";
  }
  if (label.length > 24) {
    return label.slice(0, 22) + "…";
  }
  return label;
}

function renderStars(filled: number): string {
  const full = "★".repeat(Math.max(0, Math.min(5, Math.floor(filled))));
  const empty = "☆".repeat(Math.max(0, 5 - Math.floor(filled)));
  return full + empty;
}

// 2026-05 lead-table polish: cell formatting helpers shared by both
// the search-run new-lead table and the pool-detail full table.

function pickFirstContactValue(
  contacts: LeadContact[] | undefined,
  type: "email" | "phone" | "social" | "form"
): { first: string; all: string[]; count: number } {
  const all = (contacts ?? [])
    .filter((c) => c.type === type)
    .map((c) => c.value)
    .filter((v) => typeof v === "string" && v.length > 0);
  return { first: all[0] ?? "", all, count: all.length };
}

function hasReachableLeadContact(contacts: LeadContact[] | undefined): boolean {
  return (contacts ?? []).some((contact) =>
    ["email", "phone", "social", "form"].includes(String(contact.type ?? "").toLowerCase())
  );
}

// Trim a website URL down to a short, readable form: drop the
// scheme (http/https) and any trailing path. Designs show plain
// domains like "azrait.sa" rather than the full URL with /path.
function formatWebsiteShort(website: string | null | undefined): string {
  if (!website || website === "—") return "—";
  let raw = String(website).trim();
  if (!raw) return "—";
  raw = raw.replace(/^https?:\/\//i, "");
  raw = raw.replace(/^www\./i, "");
  // Cut the path off so the column stays narrow.
  const slash = raw.indexOf("/");
  if (slash > 0) raw = raw.slice(0, slash);
  // Drop trailing slash if any.
  raw = raw.replace(/\/+$/, "");
  return raw || "—";
}

// Build a safe href for the website cell anchor. Accepts either a
// bare domain ("azrait.sa") or a full URL ("https://azrait.sa/...")
// and always returns an https URL the browser can open.
function websiteHref(website: string | null | undefined): string {
  const raw = (website ?? "").trim();
  if (!raw || raw === "—") return "#";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, "")}`;
}

function percent(part: number, total: number): string {
  if (!total) return "—";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function maturityAssessmentTone(status: string | undefined) {
  if (status === "pass") return "pass";
  if (status === "near") return "near";
  if (status === "collecting") return "collecting";
  return "fail";
}

function maturityAssessmentTitle(status: string | undefined) {
  if (status === "pass") return "已达到成熟目标";
  if (status === "near") return "接近成熟目标";
  if (status === "collecting") return "数据积累中";
  return "未达到成熟目标";
}

function maturityCheckLabel(key: string | undefined, fallback: string | undefined) {
  switch (key) {
    case "main_customers_per_30":
      return "主客户/30";
    case "high_match_per_30":
      return "高匹配/30";
    case "contact_coverage":
      return "触达率";
    case "wrong_country_ratio":
      return "错国家";
    case "rejected_ratio":
      return "拒绝率";
    case "lane_coverage":
      return "Lane覆盖";
    case "query_quality_coverage":
      return "Query质量";
    case "customer_trust_coverage":
      return "可信度";
    default:
      return fallback ?? "指标";
  }
}

function formatMaturityCheckValue(key: string | undefined, value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (
    key === "contact_coverage" ||
    key === "wrong_country_ratio" ||
    key === "rejected_ratio" ||
    key === "query_quality_coverage" ||
    key === "customer_trust_coverage"
  ) {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (key === "lane_coverage") {
    return value.toFixed(0);
  }
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

const clientSearchQueryLaneDefinitions = [
  {
    key: "channel",
    label: "channel_distributor",
    pattern:
      /\b(?:distributors?|stockists?|resellers?|dealers?|importers?|wholesalers?|trading compan(?:y|ies)|channel partners?)\b/i
  },
  {
    key: "project",
    label: "project_contractor_integrator",
    pattern:
      /\b(?:contractors?|installers?|installation compan(?:y|ies)|system integrators?|engineering compan(?:y|ies)|epc|project delivery|turnkey)\b/i
  },
  {
    key: "maintenance_mro",
    label: "maintenance_mro_service",
    pattern:
      /\b(?:maintenance|repair|mro|field service|after-sales|after sales|service compan(?:y|ies)|o&m|managed services?|operations)\b/i
  },
  {
    key: "procurement_entry",
    label: "procurement_rfq_vendor_entry",
    pattern:
      /\b(?:procurement|purchasing|vendor registration|supplier registration|rfq|request for quotation|tender|bid|procurement portal|supplier portal)\b/i
  },
  {
    key: "end_user_operator",
    label: "operator_terminal_buyer",
    pattern:
      /\b(?:operators?|isp|wisp|ftth|fiber operator|utility|utilities|factory|plant|hospital|hotel|mine|mining|oil gas|airport|port|municipality|government|data center|commercial|industrial)\b/i
  },
  {
    key: "local_market",
    label: "local_market_anchor",
    pattern: /\b(?:site:\.[a-z]{2}|near me|locations?|branches?|offices?|contact)\b/i
  },
  {
    key: "reference_competitor_channel",
    label: "reference_competitor_channel",
    pattern:
      /\b(?:authorized distributor|authorized dealer|dealer locator|partner locator|channel partner|brands|catalog|case stud(?:y|ies)|clients?|partners?|deployments?|success stories)\b/i
  },
  {
    key: "industry_scenario",
    label: "industry_scenario",
    pattern:
      /\b(?:project|solution provider|applications?|use cases?|solar farm|microgrid|base station|cell site|ran|telecom network|factory maintenance|shutdown maintenance|oil gas project|commercial solar|industrial automation|water treatment|hvac|fire protection)\b/i
  }
] as const;

function assessClientSearchQueryLaneCoverage(queries: SearchQuery[] | undefined) {
  const laneCounts = Object.fromEntries(
    clientSearchQueryLaneDefinitions.map((lane) => [lane.key, 0])
  ) as Record<(typeof clientSearchQueryLaneDefinitions)[number]["key"], number>;

  for (const row of queries ?? []) {
    const text = [row.query, row.strategyTemplate, row.operatorSource].filter(Boolean).join(" ");
    for (const lane of clientSearchQueryLaneDefinitions) {
      const hasLaneSignal =
        lane.pattern.test(text) ||
        (lane.key === "local_market" && Boolean(row.country && row.country.trim()));
      if (hasLaneSignal) {
        laneCounts[lane.key] += 1;
      }
    }
  }

  const coveredLanes = clientSearchQueryLaneDefinitions
    .filter((lane) => laneCounts[lane.key] > 0)
    .map((lane) => ({ key: lane.key, label: lane.label, count: laneCounts[lane.key] }));
  const missingLanes = clientSearchQueryLaneDefinitions
    .filter((lane) => laneCounts[lane.key] === 0)
    .map((lane) => ({ key: lane.key, label: lane.label }));
  const requiredLaneCount = 5;
  const coveredCount = coveredLanes.length;

  return {
    coveredCount,
    requiredLaneCount,
    totalTrackedLanes: clientSearchQueryLaneDefinitions.length,
    coverageScore: roundThree(Math.min(1, coveredCount / Math.max(1, requiredLaneCount))),
    coveredLanes,
    missingLanes
  };
}

const clientQueryBuyerIntentPattern =
  /\b(?:distributors?|stockists?|resellers?|dealers?|importers?|wholesalers?|trading compan(?:y|ies)|contractors?|installers?|installation compan(?:y|ies)|system integrators?|integrators?|engineering compan(?:y|ies)|epc|maintenance|repair|mro|field service|after-sales|service compan(?:y|ies)|operators?|isp|wisp|ftth|channel partners?)\b/i;
const clientQueryProcurementEntryPattern =
  /\b(?:procurement|purchasing|vendor registration|supplier registration|rfq|request for quotation|tender|bid|supplier portal|procurement portal)\b/i;
const clientQueryEndUserPattern =
  /\b(?:factory|plant|hospital|hotel|mine|mining|oil gas|airport|port|utility|utilities|municipality|government|data center|commercial|industrial)\b/i;
const clientQueryReferencePivotPattern =
  /\b(?:authorized distributor|authorized dealer|dealer locator|partner locator|channel partner|brands|catalog|case stud(?:y|ies)|clients?|partners?|deployments?|success stories)\b/i;
const clientQueryProductOrScenarioPattern =
  /\b(?:equipment|spare parts?|parts?|module|system|systems|solution|solutions|inverter|solar|pv|bess|battery|pump|valve|seal|motor|automation|telecom|telecommunications?|network|fiber|ftth|ran|base station|cell site|rectifier|olt|rru|bbu|power|microgrid|project|maintenance|installation|deployment|industrial|commercial|oil gas)\b/i;
const clientQueryContactEntryPattern =
  /\b(?:contact|contacts|contact-us|get in touch|get-in-touch|reach us|reach-us|inquiry|inquiries|enquiry|enquiries|quote|request a quote|request-a-quote|sales|support|office|offices|locations?|catalog|brands|services|projects|registration)\b/i;
const clientQueryMarketAnchorPattern =
  /\b(?:uae|united arab emirates|saudi arabia|qatar|oman|kuwait|iraq|afghanistan|nigeria|kenya|south africa|egypt|morocco|ghana|tanzania|brazil|chile|colombia|peru|russia|ukraine|indonesia|vietnam|thailand|philippines|malaysia|singapore|dubai|riyadh|doha|muscat|lagos|nairobi|johannesburg|cairo|sao paulo)\b/i;
const clientQueryNoiseIntentPattern =
  /\b(?:jobs?|careers?|hiring|recruitment|training|course|courses|news|press release|blog|article|articles|whitepaper|wikipedia|encyclopedia|reddit|youtube|alibaba|made-in-china|globalsources|indiamart|exporthub|tradewheel|market report|industry report|research report)\b/i;

function assessClientSearchQueryQualityCoverage(queries: SearchQuery[] | undefined) {
  const rows = queries ?? [];
  let completeCount = 0;
  const missingCounts = {
    productOrScenario: 0,
    buyerIntent: 0,
    marketAnchor: 0,
    contactOrProcurementEntry: 0,
    noiseControlled: 0
  };

  for (const row of rows) {
    const query = row.query ?? "";
    const text = [query, row.strategyTemplate, row.operatorSource].filter(Boolean).join(" ");
    const hasReferencePivot = clientQueryReferencePivotPattern.test(text);
    const productOrScenario =
      clientQueryProductOrScenarioPattern.test(text) ||
      hasReferencePivot ||
      /\b[A-Z]{2,}\d{2,}\b/.test(query);
    const buyerIntent =
      clientQueryBuyerIntentPattern.test(text) ||
      clientQueryProcurementEntryPattern.test(text) ||
      clientQueryEndUserPattern.test(text) ||
      hasReferencePivot;
    const marketAnchor = Boolean(
      (row.country && row.country.trim()) ||
        /\bsite:\.[a-z]{2}\b/i.test(query) ||
        clientQueryMarketAnchorPattern.test(query)
    );
    const contactOrProcurementEntry =
      clientQueryContactEntryPattern.test(query) ||
      clientQueryProcurementEntryPattern.test(query) ||
      hasReferencePivot;
    const noiseControlled = !clientQueryHasUncontrolledNoiseIntent(query);

    if (!productOrScenario) missingCounts.productOrScenario += 1;
    if (!buyerIntent) missingCounts.buyerIntent += 1;
    if (!marketAnchor) missingCounts.marketAnchor += 1;
    if (!contactOrProcurementEntry) missingCounts.contactOrProcurementEntry += 1;
    if (!noiseControlled) missingCounts.noiseControlled += 1;

    if (
      productOrScenario &&
      buyerIntent &&
      marketAnchor &&
      contactOrProcurementEntry &&
      noiseControlled
    ) {
      completeCount += 1;
    }
  }

  return {
    completeCount,
    total: rows.length,
    coverage: roundThree(completeCount / Math.max(1, rows.length)),
    missingCounts
  };
}

function clientQueryHasUncontrolledNoiseIntent(query: string) {
  const withoutExplicitExclusions = query.replace(
    /-\s*(?:jobs?|careers?|hiring|recruitment|training|course|courses|news|press release|blog|article|articles|whitepaper|wikipedia|encyclopedia|reddit|youtube|alibaba|made-in-china|globalsources|indiamart|exporthub|tradewheel|market report|industry report|research report)\b/gi,
    ""
  );
  return clientQueryNoiseIntentPattern.test(withoutExplicitExclusions);
}

type ClientTrustMissingCounts = {
  sourceQuery: number;
  sourcePage: number;
  matchReason: number;
  riskLabel: number;
  contactSource: number;
  customerType: number;
};

function assessClientCustomerTrustCoverage(leads: DisplayLead[], task: LeadTask | null) {
  const actionableLeads = leads.filter((lead) => lead.actionable);
  const total = actionableLeads.length;
  let completeCount = 0;
  const missingCounts: ClientTrustMissingCounts = {
    sourceQuery: 0,
    sourcePage: 0,
    matchReason: 0,
    riskLabel: 0,
    contactSource: 0,
    customerType: 0
  };

  for (const lead of actionableLeads) {
    const hasSourceQuery = leadDetailSourceQueries(lead, task).length > 0;
    const hasSourcePage = Boolean(
      (lead.sourceUrl && lead.sourceUrl !== "-") ||
        (lead.raw.sourceUrl && lead.raw.sourceUrl !== "-") ||
        (lead.website && lead.website !== "-")
    );
    const hasMatchReason = leadDetailMatchReasons(lead).length > 0;
    const hasRiskLabel = leadDetailRiskLabels(lead).length > 0;
    const hasContactSource = leadDetailContactSources(lead).length > 0;
    const hasCustomerType = Boolean(lead.tag && lead.tag !== "-");

    if (!hasSourceQuery) missingCounts.sourceQuery += 1;
    if (!hasSourcePage) missingCounts.sourcePage += 1;
    if (!hasMatchReason) missingCounts.matchReason += 1;
    if (!hasRiskLabel) missingCounts.riskLabel += 1;
    if (!hasContactSource) missingCounts.contactSource += 1;
    if (!hasCustomerType) missingCounts.customerType += 1;

    if (
      hasSourceQuery &&
      hasSourcePage &&
      hasMatchReason &&
      hasRiskLabel &&
      hasContactSource &&
      hasCustomerType
    ) {
      completeCount += 1;
    }
  }

  return {
    completeCount,
    total,
    coverage: roundThree(completeCount / Math.max(1, total)),
    missingCounts
  };
}

function buildClientTargetAssessment(
  task: LeadTask | null,
  leads: DisplayLead[]
): QueryLearningTargetAssessment | null {
  if (!task || (!leads.length && !(task.searchQueries?.length ?? 0))) {
    return null;
  }
  const queryCount = task.searchQueries?.length ?? 0;
  const completedQueryCount =
    task.searchQueries?.filter((query) => query.executionStatus === "completed").length ?? 0;
  const queryBasis = Math.max(1, completedQueryCount || queryCount);
  const per30Factor = 30 / queryBasis;
  const mainCustomers = leads.filter((lead) => lead.actionable).length;
  const highMatchCustomers = leads.filter((lead) => lead.actionable && lead.score >= 75).length;
  const contactableCustomers = leads.filter(
    (lead) => lead.actionable && hasReachableLeadContact(lead.raw.contacts)
  ).length;
  const rejectedCount =
    task.leadCandidates?.filter((lead) => lead.status === "rejected").length ?? 0;
  const totalCandidates = Math.max(1, task.leadCandidates?.length ?? leads.length);
  const wrongCountryCount = leads.filter((lead) => lead.actionable && lead.raw.countryConflict)
    .length;
  const mainCustomersPer30 = roundOne(mainCustomers * per30Factor);
  const highMatchCustomersPer30 = roundOne(highMatchCustomers * per30Factor);
  const contactCoverage = roundThree(contactableCustomers / Math.max(1, mainCustomers));
  const wrongCountryRatio = roundThree(wrongCountryCount / Math.max(1, mainCustomers));
  const rejectedRatio = roundThree(rejectedCount / totalCandidates);
  const laneCoverage = assessClientSearchQueryLaneCoverage(task.searchQueries);
  const queryQualityCoverage = assessClientSearchQueryQualityCoverage(task.searchQueries);
  const customerTrustCoverage = assessClientCustomerTrustCoverage(leads, task);
  const checks = [
    clientMaturityCheck(
      "main_customers_per_30",
      mainCustomersPer30,
      ">=10",
      mainCustomersPer30 >= 10,
      mainCustomersPer30 >= 8
    ),
    clientMaturityCheck(
      "high_match_per_30",
      highMatchCustomersPer30,
      ">=5",
      highMatchCustomersPer30 >= 5,
      highMatchCustomersPer30 >= 4
    ),
    clientMaturityCheck(
      "contact_coverage",
      contactCoverage,
      ">=0.80",
      contactCoverage >= 0.8,
      contactCoverage >= 0.72
    ),
    clientMaturityCheck(
      "wrong_country_ratio",
      wrongCountryRatio,
      "<=0.10",
      wrongCountryRatio <= 0.1,
      wrongCountryRatio <= 0.15
    ),
    clientMaturityCheck(
      "rejected_ratio",
      rejectedRatio,
      "<=0.60",
      rejectedRatio <= 0.6,
      rejectedRatio <= 0.7
    ),
    clientMaturityCheck(
      "lane_coverage",
      laneCoverage.coveredCount,
      `>=${laneCoverage.requiredLaneCount}`,
      laneCoverage.coveredCount >= laneCoverage.requiredLaneCount,
      laneCoverage.coveredCount >= Math.max(1, laneCoverage.requiredLaneCount - 1)
    ),
    clientMaturityCheck(
      "query_quality_coverage",
      queryQualityCoverage.coverage,
      ">=0.80",
      queryQualityCoverage.coverage >= 0.8,
      queryQualityCoverage.coverage >= 0.7
    ),
    clientMaturityCheck(
      "customer_trust_coverage",
      customerTrustCoverage.coverage,
      ">=0.80",
      customerTrustCoverage.coverage >= 0.8,
      customerTrustCoverage.coverage >= 0.7
    )
  ];
  const passCount = checks.filter((check) => check.status === "pass").length;
  const nearCount = checks.filter((check) => check.status === "near").length;
  const readinessScore = Math.round(((passCount + nearCount * 0.5) / checks.length) * 100);
  const status =
    queryBasis < 15
      ? "collecting"
      : passCount === checks.length
        ? "pass"
        : readinessScore >= 70
          ? "near"
          : "fail";

  return {
    status,
    readinessScore,
    queryBasis,
    normalizedMetrics: {
      queryBatchSize: 30,
      mainCustomersPer30,
      highMatchCustomersPer30,
      contactCoverage,
      wrongCountryRatio,
      rejectedRatio,
      laneCoverageScore: laneCoverage.coverageScore,
      coveredLaneCount: laneCoverage.coveredCount,
      queryQualityCoverage: queryQualityCoverage.coverage,
      customerTrustCoverage: customerTrustCoverage.coverage
    },
    laneCoverage,
    queryQualityCoverage,
    customerTrustCoverage,
    checks
  };
}

function clientMaturityCheck(
  key: string,
  value: number,
  target: string,
  pass: boolean,
  near: boolean
) {
  return {
    key,
    label: key,
    value,
    target,
    status: pass ? "pass" : near ? "near" : "fail"
  };
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function roundThree(value: number) {
  return Math.round(value * 1000) / 1000;
}

function buildPoolTableRow(lead: DisplayLead): PoolTableRow {
  // Count emails / phones from the raw contact list (not the formatted
  // display string). The display string joins phones with " ; ", so a
  // naive split on whitespace would yield silly numbers like "电话 16".
  const contacts = lead.raw.contacts ?? [];
  const emails = pickFirstContactValue(contacts, "email");
  const phones = pickFirstContactValue(contacts, "phone");
  const socials = pickFirstContactValue(contacts, "social");
  const forms = pickFirstContactValue(contacts, "form");
  const emailCount = emails.count;
  const phoneCount = phones.count;
  const crmStage = lead.raw.crmLead?.stage ?? null;
  const sentEmail = hasSentEmail(lead.raw);
  const status = lead.raw.status ?? "";
  const isApproved = status === "approved" || status === "contacted" || status === "email_sent";
  const crmActive = Boolean(crmStage);
  // Most recent action label: newest row reflects what just happened
  // ("已加入 CRM"/"已发送邮件") instead of the static "新发现".
  let lastAction = "新发现";
  if (sentEmail) {
    lastAction = "邮件已发送";
  } else if (crmActive) {
    lastAction = "已加入 CRM";
  } else if (isApproved) {
    lastAction = "待写入 CRM";
  }
  return {
    id: lead.id,
    companyName: lead.companyName,
    country: lead.country || "—",
    industry: lead.tag || "通用买家",
    scoreStars: Math.max(1, Math.min(5, Math.round(lead.score / 20))),
    scoreValue: lead.score,
    hasEmail: emailCount > 0,
    emailCount,
    emailFirst: emails.first,
    emailAll: emails.all,
    hasPhone: phoneCount > 0,
    phoneCount,
    phoneFirst: phones.first,
    phoneAll: phones.all,
    hasReachableContact:
      emailCount > 0 || phoneCount > 0 || socials.count > 0 || forms.count > 0,
    website: lead.website || "—",
    websiteShort: formatWebsiteShort(lead.website),
    sourceBatch: lead.source || "第 1 批",
    crmStatus: crmActive ? "synced" : "pending",
    crmStatusLabel: crmActive ? "已加入CRM" : "待加入CRM",
    mailStatus: sentEmail ? "已发送" : isApproved || crmActive ? "待发送" : "未触达",
    lastAction
  };
}

function hasAnyPoolFilter(filters: PoolFilters): boolean {
  return Object.values(filters).some(Boolean);
}

function createPoolFilterOptions(values: string[], allLabel: string): PoolFilterOption[] {
  const seen = new Set<string>();
  const options: PoolFilterOption[] = [{ value: "", label: allLabel }];

  values.forEach((rawValue) => {
    const value = normalizePoolFilterValue(rawValue);
    if (!value || seen.has(value)) return;
    seen.add(value);
    options.push({ value, label: displayPoolFilterValue(value) });
  });

  return options;
}

function normalizePoolFilterValue(value: string): string {
  return String(value ?? "").trim();
}

function displayPoolFilterValue(value: string): string {
  if (value === "-" || value === "—") return "未标注";
  return value;
}

function matchesPoolLeadFilters({ row }: PoolLeadRow, filters: PoolFilters): boolean {
  if (filters.country && row.country !== filters.country) return false;
  if (filters.customerType && row.industry !== filters.customerType) return false;
  if (filters.score && !matchesPoolScoreFilter(row.scoreValue, filters.score)) return false;
  if (filters.contact && !matchesPoolContactFilter(row, filters.contact)) return false;
  if (filters.crm && !matchesPoolCrmFilter(row, filters.crm)) return false;
  if (filters.mail && !matchesPoolMailFilter(row, filters.mail)) return false;
  return true;
}

function matchesPoolScoreFilter(score: number, filter: string): boolean {
  if (filter === "high") return score >= 75;
  if (filter === "medium") return score >= 60 && score < 75;
  if (filter === "low") return score >= 50 && score < 60;
  if (filter === "below50") return score < 50;
  return true;
}

function matchesPoolContactFilter(row: PoolTableRow, filter: string): boolean {
  if (filter === "email") return row.hasEmail;
  if (filter === "phone") return row.hasPhone;
  if (filter === "reachable") return row.hasReachableContact;
  if (filter === "emailOrPhone") return row.hasEmail || row.hasPhone;
  if (filter === "emailAndPhone") return row.hasEmail && row.hasPhone;
  if (filter === "none") return !row.hasReachableContact;
  return true;
}

function matchesPoolCrmFilter(row: PoolTableRow, filter: string): boolean {
  if (filter === "joined") return row.crmStatus === "synced" || row.crmStatus === "active";
  if (filter === "notJoined") return row.crmStatus === "pending";
  return true;
}

function matchesPoolMailFilter(row: PoolTableRow, filter: string): boolean {
  const reached = row.mailStatus === "已发送" || row.mailStatus === "已回复";
  if (filter === "reached") return reached;
  if (filter === "unreached") return !reached;
  return true;
}

type ConversationProps = {
  prompt: string;
  status: string;
  error: string;
  currentTask: LeadTask | null;
  leads: DisplayLead[];
  crmSyncedCount: number;
  pendingFollowupCount: number;
  searchResult: SearchRunResult | null;
  creating: boolean;
  searching: boolean;
  approving: boolean;
  selectedLeadId: string | null;
  onSelectLead: (leadId: string) => void;
  onOpenLeadDetail: (lead: DisplayLead) => void;
  onOpenMail: () => void;
  onOpenCrm: (leadId?: string) => void;
  onBack: () => void;
  onContinueSearch: () => void;
};

function AiWorkerConversation({
  prompt,
  status,
  error,
  currentTask,
  leads,
  crmSyncedCount,
  pendingFollowupCount,
  searchResult,
  creating,
  searching,
  approving,
  selectedLeadId,
  onSelectLead,
  onOpenLeadDetail,
  onOpenMail,
  onOpenCrm,
  onBack,
  onContinueSearch
}: ConversationProps) {
  const queryCount = currentTask?.searchQueries?.length ?? 0;
  // 2026-05 polish: progress numerator must include running queries,
  // not just completed. The Brave step lands candidates in the DB
  // (and the new-lead table starts to fill) BEFORE the worker pool
  // marks the query "completed" — that final flip happens after
  // qualification, dedupe, and lead writing finish. Counting only
  // completed queries makes the progress bar sit at 0/20 while
  // candidates are already showing up, which the user reads as
  // "nothing is happening" or "data appeared from thin air".
  //
  // Sub-counters keep their literal meaning for the explainer line
  // under the progress bar so the user can see what's actually
  // finished versus what's mid-qualification.
  const completedQueryCount =
    currentTask?.searchQueries?.filter((q) => q.executionStatus === "completed").length ?? 0;
  const runningQueryCount =
    currentTask?.searchQueries?.filter((q) => q.executionStatus === "running").length ?? 0;
  // executedCount = "已执行" — every query that's in flight or done.
  // Pending queries are the only thing left out. failedQueryCount is
  // computed below via useMemo and folded in at usage sites.
  const actionableLeads = leads.filter(isActionableDisplayLead);
  const qualifiedCount = actionableLeads.filter((lead) => lead.score >= 75).length;
  const hasActionableLeads = actionableLeads.length > 0;
  const running = creating || searching || approving;
  const leadQualityCounts = useMemo(() => summarizeLeadQualityCounts(currentTask), [currentTask]);
  // Live execution log surfaced in the right-hand panel of the run card.
  // Reuses buildActivityLogs which derives messages from agentSteps +
  // searchQueries + leadQualityCounts. The other AI activity helpers
  // (buildActivitySteps / buildActivityMetrics) belong to the legacy
  // AgentSearchActivity widget which is no longer rendered here.
  const activityLogs = buildActivityLogs({
    creating,
    searching,
    currentTask,
    searchResult,
    leads,
    leadQualityCounts,
    hasError: Boolean(error)
  });
  const [leadPage, setLeadPage] = useState(1);
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  // Continuation searches are cumulative: keep the existing customer
  // pool visible while the backend plans/appends the next 30 queries,
  // then append newly found leads into this same list.
  const currentBatchLeads = leads;

  const leadPageCount = Math.max(1, Math.ceil(currentBatchLeads.length / leadPageSize));
  const leadStartIndex = (leadPage - 1) * leadPageSize;
  const pagedLeads = currentBatchLeads.slice(leadStartIndex, leadStartIndex + leadPageSize);
  const leadRangeStart = currentBatchLeads.length ? leadStartIndex + 1 : 0;
  const leadRangeEnd = Math.min(leadStartIndex + leadPageSize, currentBatchLeads.length);

  useEffect(() => {
    setLeadPage(1);
  }, [currentTask?.id]);

  useEffect(() => {
    if (leadPage > leadPageCount) {
      setLeadPage(leadPageCount);
    }
  }, [leadPage, leadPageCount]);

  function changeLeadPage(nextPage: number) {
    const safePage = Math.min(Math.max(nextPage, 1), leadPageCount);
    setLeadPage(safePage);
    const firstLeadOnPage = currentBatchLeads[(safePage - 1) * leadPageSize];
    if (firstLeadOnPage) {
      onSelectLead(firstLeadOnPage.id);
    }
  }

  // 2026-05 LeadHunt 2.0 — derived helpers for the search-in-progress
  // page. Layout follows ui/ai-search.png: title + KPI strip + run-batch
  // card (progress + step pills + realtime log) + new-lead table +
  // 3 conversion cards + health hint. Pure-frontend; data is whatever
  // the live LeadTask polling already provides.
  const poolTitle = summarizePoolTitle(prompt || "客户池");
  const poolStatus = mapTaskStatusToPool(
    currentTask?.status ?? (searching ? "running" : "pending")
  );
  const targetMarkets = useMemo(() => taskTargetMarkets(currentTask), [currentTask]);
  const profileIndustryAlignment = currentTask?.inputPayload?.profileSignals?.profileIndustryAlignment;
  const hasProfileIndustryConflict = Boolean(
    profileIndustryAlignment?.productProfileConflicts ||
      profileIndustryAlignment?.customerProfileConflicts
  );
  const continuationOptimization =
    currentTask?.inputPayload?.profileSignals?.continuationOptimization;
  const continuationOptimizationMarkets = continuationOptimization?.selectedMarkets ?? [];
  const continuationAvoidedMarkets = continuationOptimization?.avoidedMarkets ?? [];
  const showContinuationOptimization = Boolean(
    continuationOptimization?.action === "focus_high_yield_markets" &&
      continuationOptimizationMarkets.length > 0
  );
  const countryChips = targetMarkets.slice(0, 6);
  const failedQueryCount = useMemo(
    () =>
      currentTask?.searchQueries?.filter((query) => query.executionStatus === "failed").length ?? 0,
    [currentTask]
  );
  const pendingQueryCount = useMemo(
    () =>
      currentTask?.searchQueries?.filter(
        (query) => query.executionStatus === "pending" || query.executionStatus === "running"
      ).length ?? 0,
    [currentTask]
  );
  // 2026-05 LeadHunt 2.0: when the backend marks the task as
  // failed/completed/cancelled/paused, the UI must converge to a
  // terminal display even if a few searchQueries remain in
  // pending/running (the worker bailed out without finalizing them).
  // Without this, pendingQueryCount > 0 keeps isRunActive=true and the
  // page reads "进行中 / ETA / pending" forever.
  const isTerminalTask =
    currentTask?.status === "failed" ||
    currentTask?.status === "completed" ||
    currentTask?.status === "cancelled" ||
    currentTask?.status === "paused";
  // The run is complete when the task is terminal, OR when we've drained
  // every query and the local searching/creating flags are also off.
  // Mixed success+failure surfaces the failure count on the run header
  // so the page never reads "已完成" + "进行中" at the same time.
  const isRunComplete =
    isTerminalTask || (queryCount > 0 && pendingQueryCount === 0 && !searching && !creating);
  // A run is "active" only when the task itself is still active. If the
  // task is terminal but a few queries got stranded in pending/running,
  // we must NOT treat it as active — that's the bug that pinned the
  // page at "19/40 第 N 批进行中 ETA 6 分钟".
  const isRunActive = !isTerminalTask && (searching || creating || pendingQueryCount > 0);

  useEffect(() => {
    if (!isRunActive && showBackConfirm) {
      setShowBackConfirm(false);
    }
  }, [isRunActive, showBackConfirm]);

  // Stranded query count for the failure subline. Only meaningful in
  // terminal state — during active runs these are just queued work.
  const strandedQueryCount = isTerminalTask ? pendingQueryCount : 0;
  // 2026-05 polish: progress = completed + failed + running (everything
  // that's been picked up). Running queries are mid-flight — Brave has
  // returned, candidates are being saved — so users should see them as
  // "already executed", not "stuck at zero". This is computed here
  // (after failedQueryCount is declared) so any earlier helpers that
  // used the old completed-only meaning have already been updated to
  // reference completedQueryCount explicitly.
  const executedCount = completedQueryCount + failedQueryCount + runningQueryCount;
  const allBraveQueriesFailed = queryCount > 0 && failedQueryCount === queryCount;
  const hasVisibleRunIssue = allBraveQueriesFailed || strandedQueryCount > 0;
  const planningStepStatus =
    currentTask?.agentSteps
      ?.find((step) => step.nodeName === "plan_search_queries" || step.nodeName === "plan_search")
      ?.status?.toLowerCase() ?? "";
  const isStillFillingInitialQueryBatch =
    !isTerminalTask &&
    planningStepStatus === "running" &&
    queryCount > 0 &&
    queryCount < plannedBatchQueryCount;
  const isPlanningSearchQueries =
    isRunActive &&
    (((creating || searching) && pendingQueryCount === 0) || isStillFillingInitialQueryBatch);
  const displayQueryTotal = isPlanningSearchQueries
    ? isStillFillingInitialQueryBatch
      ? plannedBatchQueryCount
      : queryCount + plannedBatchQueryCount
    : queryCount;
  const runHeaderStatus = isStillFillingInitialQueryBatch
    ? `已先生成 ${queryCount}/${plannedBatchQueryCount} 条搜索指令，正在补齐并执行已生成部分`
    : status;
  const progressDoneCount = isStillFillingInitialQueryBatch ? queryCount : executedCount;
  const progressQueryTotal = displayQueryTotal || queryCount;
  const progressPercent = progressQueryTotal
    ? Math.min(100, Math.round((progressDoneCount / progressQueryTotal) * 100))
    : 0;
  const displayBatchNumber = Math.max(
    1,
    Math.ceil(Math.max(queryCount || plannedBatchQueryCount, 1) / plannedBatchQueryCount)
  );
  const planningBatchNumber = Math.floor(queryCount / plannedBatchQueryCount) + 1;
  // Rough ETA: each remaining query typically takes ~15s in the polling
  // backend. Floor at 1 minute so we don't say "0 minutes" while there
  // are still queries pending. When everything is done it's hidden.
  const estimateEtaMinutes = useMemo(() => {
    if (!isRunActive || isPlanningSearchQueries) return 0;
    const remaining = pendingQueryCount;
    if (remaining <= 0) return 0;
    const seconds = remaining * 15;
    return Math.max(1, Math.ceil(seconds / 60));
  }, [isRunActive, isPlanningSearchQueries, pendingQueryCount]);
  const currentRunningQuery = useMemo(
    () =>
      isRunActive
        ? (currentTask?.searchQueries?.find((query) => query.executionStatus === "running") ?? null)
        : null,
    [currentTask, isRunActive]
  );
  const currentQueryDisplay = currentRunningQuery
    ? {
        label: "正在搜索",
        country: currentRunningQuery.country || targetMarkets[0] || "—",
        query: currentRunningQuery.query,
        title: currentRunningQuery.query
      }
    : isPlanningSearchQueries
      ? {
          label: "正在生成",
          country: queryCount > 0 ? `第 ${planningBatchNumber} 批` : "搜索指令",
          query:
            queryCount > 0
              ? `正在追加生成下一批 ${plannedBatchQueryCount} 条搜索指令，已有 ${queryCount} 条会继续保留`
              : `正在读取产品画像和客户画像，生成本批 ${plannedBatchQueryCount} 条搜索指令`,
          title:
            queryCount > 0
              ? `正在追加生成下一批 ${plannedBatchQueryCount} 条搜索指令，已有 ${queryCount} 条会继续保留`
              : `正在读取产品画像和客户画像，生成本批 ${plannedBatchQueryCount} 条搜索指令`
        }
      : isRunActive
        ? {
            label: "等待执行",
            country: targetMarkets[0] || "搜索指令",
            query: "已生成搜索指令，正在等待下一条开始执行",
            title: "已生成搜索指令，正在等待下一条开始执行"
          }
        : {
            label: isRunComplete ? "已完成" : "未开始",
            country: "搜索指令",
            query: queryCount
              ? `本轮共生成 ${queryCount} 条搜索指令`
              : "任务启动后会先生成搜索指令",
            title: queryCount ? `本轮共生成 ${queryCount} 条搜索指令` : "任务启动后会先生成搜索指令"
          };
  const planningLoadingDescription = isStillFillingInitialQueryBatch
    ? `已生成 ${queryCount}/${plannedBatchQueryCount} 条搜索指令，正在补齐剩余指令；已生成部分会继续执行。`
    : `后端正在生成 ${plannedBatchQueryCount} 条搜索指令，完成后会自动开始搜索。`;
  const planningEmptyDescription = isStillFillingInitialQueryBatch
    ? `已生成 ${queryCount}/${plannedBatchQueryCount} 条搜索指令，正在补齐搜索指令，候选客户会在清洗完成时出现在这里。`
    : `生成 ${plannedBatchQueryCount} 条搜索指令后，客户会在清洗完成时出现在这里。`;
  const planningFooterDescription = isStillFillingInitialQueryBatch
    ? `已生成 ${queryCount}/${plannedBatchQueryCount} 条搜索指令，正在补齐搜索指令，候选客户会在搜索后陆续进入列表`
    : `正在生成 ${plannedBatchQueryCount} 条搜索指令，候选客户会在搜索后陆续进入列表`;
  const showLeadTableLoading =
    currentBatchLeads.length === 0 && (isPlanningSearchQueries || isRunActive);

  function handleBackToWorkbench() {
    if (isRunActive) {
      setShowBackConfirm(true);
      return;
    }
    onBack();
  }

  // 5-step pills: 生成指令 / Brave 搜索 / 清洗候选 / ICP 评分 / 写入客户池.
  // State derived from agentSteps + searchQueries when available.
  type RunStep = {
    label: string;
    state: "completed" | "running" | "pending" | "failed";
    stateLabel: string;
    icon: typeof Sparkles;
  };
  const runStepPills: RunStep[] = useMemo(() => {
    const stepByName = (name: string) => currentTask?.agentSteps?.find((s) => s.nodeName === name);
    const planning = stepByName("plan_search_queries") ?? stepByName("plan_search");
    const search = stepByName("brave_search");
    const normalize = stepByName("normalize_leads");
    const score = stepByName("score_icp");
    const stateLabelOf = (s?: { status?: string }): RunStep["state"] => {
      const status = (s?.status ?? "").toLowerCase();
      if (status === "completed") return "completed";
      if (status === "running") return "running";
      if (status === "failed") return "failed";
      return "pending";
    };
    const stateText = (state: RunStep["state"]) =>
      state === "completed"
        ? "已完成"
        : state === "running"
          ? "进行中"
          : state === "failed"
            ? "失败"
            : "等待中";
    // 2026-05 LeadHunt 2.0: when the whole run is complete (no pending,
    // no running, not actively searching) we collapse pending downstream
    // steps into "completed" — otherwise the page reads as e.g.
    // "26/28 query, 写入客户池 进行中" which contradicts the run-level
    // "本批已跑完" status. Partial query failures are treated as
    // skipped noise; only an all-query failure turns Brave red.
    const stepStateAfterRun = (raw: RunStep["state"]): RunStep["state"] =>
      isRunComplete && (raw === "running" || raw === "pending") ? "completed" : raw;
    // 生成指令: planning step, but if any query exists we know it's done
    // (legacy tasks never expose a "plan_search" agent step).
    const planningRaw = stateLabelOf(planning);
    const planningState: RunStep["state"] =
      planningRaw === "pending" && queryCount >= plannedBatchQueryCount
        ? "completed"
        : planningRaw === "pending" && queryCount
          ? "running"
          : planningRaw;
    // Brave 搜索: show failure only if every query in the batch failed.
    const searchRaw = stepStateAfterRun(stateLabelOf(search));
    const searchState: RunStep["state"] =
      isRunComplete && allBraveQueriesFailed ? "failed" : searchRaw;
    const hasLiveBatchLeads = currentBatchLeads.length > 0;
    const normalizeRaw = stepStateAfterRun(stateLabelOf(normalize));
    const scoreRaw = stepStateAfterRun(stateLabelOf(score));
    const normalizeState: RunStep["state"] =
      !isRunComplete && hasLiveBatchLeads && normalizeRaw === "pending" ? "running" : normalizeRaw;
    const scoreState: RunStep["state"] =
      !isRunComplete && hasLiveBatchLeads && scoreRaw === "pending" ? "running" : scoreRaw;
    // 写入客户池: this is "completed" once the run is over with at
    // least some leads landed. If the run ended with zero leads we
    // mark it failed so the timeline reflects reality. While active,
    // it tracks the score step (the last node before the lead pool is
    // updated) plus a small heuristic for when leads start landing
    // live.
    const writeState: RunStep["state"] = isRunComplete
      ? leads.length > 0
        ? "completed"
        : "failed"
      : hasLiveBatchLeads
        ? "running"
        : scoreState;
    return [
      {
        label: "生成指令",
        state: planningState,
        stateLabel: stateText(planningState),
        icon: Sparkles
      },
      {
        label: "Brave 搜索",
        state: searchState,
        stateLabel: stateText(searchState),
        icon: Search
      },
      {
        label: "清洗候选",
        state: normalizeState,
        stateLabel: stateText(normalizeState),
        icon: Filter
      },
      {
        label: "ICP 评分",
        state: scoreState,
        stateLabel: stateText(scoreState),
        icon: Star
      },
      {
        label: "写入客户池",
        state: writeState,
        stateLabel: stateText(writeState),
        icon: Database
      }
    ];
  }, [
    currentBatchLeads.length,
    currentTask,
    allBraveQueriesFailed,
    failedQueryCount,
    isRunComplete,
    leads.length,
    queryCount,
    strandedQueryCount
  ]);

  function formatLogTime(index: number, total: number) {
    // Synthetic ascending HH:mm timestamps so the realtime log reads
    // chronologically. The real backend doesn't expose per-step times
    // yet; once it does, this falls back to log.detail.
    const now = new Date();
    const minutesAgo = total - index - 1;
    const stamp = new Date(now.getTime() - minutesAgo * 60_000);
    return `${stamp.getHours().toString().padStart(2, "0")}:${stamp.getMinutes().toString().padStart(2, "0")}`;
  }

  return (
    <div className="aiPool aiSearchRunPool">
      {/* Header — same shape as AiWorkerPool */}
      <header className="aiPoolHeader">
        <div className="aiPoolHeaderTop">
          <button type="button" className="aiPoolBack" onClick={handleBackToWorkbench}>
            <ChevronLeft size={16} aria-hidden="true" />
            返回工作台
          </button>
        </div>
        <div className="aiPoolHeaderRow">
          <div className="aiPoolHeaderLeft">
            {/* Single inline row: icon + title + status pill + country
                chips, matching the design. The legacy two-row variant
                (chips below title) is the AiWorkerPool detail page. */}
            <div className="aiPoolHeaderTitle aiSearchRunHeaderTitle">
              <span className="aiPoolIcon aiPoolIconBlue" aria-hidden="true">
                <RadioTower size={22} />
              </span>
              <h1>{poolTitle}</h1>
              <span className={`aiPoolBadge state-${poolStatus.kind}`}>{poolStatus.label}</span>
              <div className="aiPoolCountryChips aiSearchRunCountryChips">
                {countryChips.map((country) => (
                  <span key={country} className="aiPoolCountryChip">
                    {country}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 持续搜索批次 — main run card */}
      {hasProfileIndustryConflict ? (
        <div className="aiProfileConflictBanner" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            <strong>画像行业与本次任务不一致</strong>
            <span>
              系统已按本次搜索内容的行业生成搜索指令，冲突的产品画像或客户画像只保留为风险提示。
            </span>
          </div>
        </div>
      ) : null}

      {showContinuationOptimization ? (
        <div className="aiOptimizationBanner" role="status">
          <Target size={16} aria-hidden="true" />
          <div>
            <strong>上一轮搜索产出偏低，已自动切换重点地区</strong>
            <span>
              系统将优先搜索 {formatCompactMarketList(continuationOptimizationMarkets)}
              {continuationAvoidedMarkets.length > 0
                ? `，暂缓 ${formatCompactMarketList(continuationAvoidedMarkets, 3)}`
                : ""}
              ，继续覆盖高产客户类型。
            </span>
          </div>
        </div>
      ) : null}

      <section className="aiSearchRunCard" aria-label="持续搜索批次">
        <header className="aiSearchRunHead">
          <div className="aiSearchRunHeadLeft">
            <h2>持续搜索批次</h2>
            {isRunComplete && hasVisibleRunIssue ? (
              <p>
                {(() => {
                  const parts: string[] = [`${completedQueryCount} 条成功`];
                  if (allBraveQueriesFailed) parts.push(`${failedQueryCount} 条失败`);
                  if (strandedQueryCount > 0) parts.push(`${strandedQueryCount} 条未完成`);
                  return `本批已停止：${parts.join("，")}`;
                })()}
              </p>
            ) : !isRunComplete ? (
              <p>{runHeaderStatus}</p>
            ) : null}
          </div>
          <div className="aiSearchRunHeadActions">
            <button
              type="button"
              className="aiPoolPrimaryBtn"
              onClick={onContinueSearch}
              disabled={running}
            >
              <Play size={14} aria-hidden="true" />
              继续搜索 30 条
            </button>
            <button
              type="button"
              className="aiPoolGhostBtn"
              disabled
              title="搜索方向调整功能开发中"
            >
              调整搜索方向
            </button>
          </div>
        </header>

        <div className="aiSearchRunBody">
          {/* Left: progress + current query */}
          <div className="aiSearchRunProgress">
            {/* Big "第 N 批正在搜索中..." headline + ETA, matching the
                design. The batch number uses the count of completed
                searchQueries divided by 30 (one batch per the legacy
                "继续搜索 30 条" affordance), defaulting to 1. */}
            <div className="aiSearchRunHeadline">
              <span className="aiSearchRunHeadlineDot" aria-hidden="true">
                {isRunActive ? <Sparkles size={14} /> : <CheckCircle2 size={14} />}
              </span>
              <strong className="aiSearchRunHeadlineTitle">
                {isRunActive
                  ? isPlanningSearchQueries
                    ? isStillFillingInitialQueryBatch
                      ? `已生成 ${queryCount}/${plannedBatchQueryCount} 条，正在补齐搜索指令`
                      : queryCount > 0
                        ? `正在生成第 ${planningBatchNumber} 批搜索指令...`
                      : "正在生成搜索指令..."
                    : `第 ${displayBatchNumber} 批正在搜索中...`
                  : isRunComplete
                    ? hasVisibleRunIssue
                      ? allBraveQueriesFailed
                        ? "本批搜索失败"
                        : "本批已停止"
                      : "本批搜索已完成"
                    : "等待启动"}
              </strong>
              {isRunActive && estimateEtaMinutes > 0 ? (
                <span className="aiSearchRunHeadlineEta">预计还需 {estimateEtaMinutes} 分钟</span>
              ) : null}
            </div>

            {/* Progress bar + inline "N / M query 已执行" label on the right.
                2026-05 polish: numerator includes running queries —
                see executedCount comment. The explainer subline below
                the bar tells the user "N done, M cleaning candidates"
                so the literal completion count isn't lost. */}
            <div className="aiSearchRunProgressRow">
              <div className="aiSearchRunProgressBar" aria-hidden="true">
                <div
                  className="aiSearchRunProgressFill"
                  style={{
                    width: `${progressPercent}%`
                  }}
                />
              </div>
              <p className="aiSearchRunProgressLabel">
                <strong>{progressDoneCount}</strong>
                <span>
                  / {displayQueryTotal || "—"} query{" "}
                  {isStillFillingInitialQueryBatch ? "已生成" : "已执行"}
                </span>
              </p>
            </div>
            {isRunActive && executedCount > 0 ? (
              <p className="aiSearchRunProgressBreakdown">
                其中 <b>{completedQueryCount}</b> 条已完成
                {runningQueryCount > 0 ? `，${runningQueryCount} 条处理中` : ""}
                {allBraveQueriesFailed ? `，${failedQueryCount} 条失败` : ""}
              </p>
            ) : null}

            <div className="aiSearchRunCurrent">
              <span className="aiSearchRunCurrentLabel">{currentQueryDisplay.label}</span>
              <span className="aiSearchRunCurrentCountry">{currentQueryDisplay.country}</span>
              <code className="aiSearchRunCurrentQuery" title={currentQueryDisplay.title}>
                {currentQueryDisplay.query}
              </code>
            </div>

            {/* Lead counter underneath. Continuation searches are
                cumulative, so this keeps the pool total visible while
                the next batch is being planned/executed. */}
            <p className="aiSearchRunStat">
              {isRunActive ? "已发现" : "累计客户"} <strong>{currentBatchLeads.length}</strong> 家
              {isRunActive ? "候选客户" : "客户"}
              {allBraveQueriesFailed ? `，${failedQueryCount} 条 query 失败` : ""}
              {strandedQueryCount > 0 ? `，${strandedQueryCount} 条 query 未完成` : ""}
            </p>

            {/* 5-step horizontal timeline below the progress card.
                Each step is icon + label/state pair, dashed lines
                between them — matches the design's flat row. */}
            <div className="aiSearchRunSteps" role="list">
              {runStepPills.map((step) => (
                <div
                  className={`aiSearchRunStep state-${step.state}`}
                  key={step.label}
                  role="listitem"
                >
                  <span className="aiSearchRunStepIcon" aria-hidden="true">
                    {step.state === "completed" ? (
                      <CheckCircle2 size={14} />
                    ) : step.state === "running" ? (
                      <Sparkles size={14} />
                    ) : step.state === "failed" ? (
                      <X size={14} />
                    ) : (
                      <step.icon size={14} />
                    )}
                  </span>
                  <span className="aiSearchRunStepText">
                    <span className="aiSearchRunStepLabel">{step.label}</span>
                    <span className="aiSearchRunStepState">{step.stateLabel}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: realtime log */}
          <aside className="aiSearchRunLog" aria-label="实时执行记录">
            <header className="aiSearchRunLogHead">
              <h3>实时执行记录</h3>
              <span
                className={`aiSearchRunLogPulse ${
                  isRunActive ? "live" : isRunComplete ? "done" : "idle"
                }`}
                aria-hidden="true"
              >
                {isRunActive
                  ? "实时更新中"
                  : isRunComplete
                    ? failedQueryCount > 0 || strandedQueryCount > 0
                      ? "已停止（含未完成）"
                      : "已完成"
                    : "未启动"}
              </span>
            </header>
            <ol className="aiSearchRunLogList">
              {activityLogs.slice(0, 4).map((log, index) => (
                <li
                  className={`aiSearchRunLogItem state-${log.state} palette-${index}`}
                  key={`${log.title}-${index}`}
                >
                  <span className="aiSearchRunLogTime">
                    {formatLogTime(index, Math.min(activityLogs.length, 4))}
                  </span>
                  <span className="aiSearchRunLogBullet" aria-hidden="true" />
                  <span className="aiSearchRunLogText">
                    <strong>{log.title}</strong>
                    <em>{log.detail}</em>
                  </span>
                </li>
              ))}
              {activityLogs.length === 0 ? (
                <li className="aiSearchRunLogItem state-pending palette-0">
                  <span className="aiSearchRunLogTime">--:--</span>
                  <span className="aiSearchRunLogBullet" aria-hidden="true" />
                  <span className="aiSearchRunLogText">
                    <strong>等待任务调度</strong>
                    <em>{status}</em>
                  </span>
                </li>
              ) : null}
            </ol>
          </aside>
        </div>
      </section>

      {/* 客户列表 */}
      <section className="aiPoolTableWrap aiSearchRunTableWrap" aria-label="客户列表">
        <header className="aiSearchRunTableHead">
          <h3>客户列表</h3>
          <p>点击公司可查看完整邮箱、电话、来源 query 和评分原因</p>
        </header>
        {showLeadTableLoading ? (
          <TableLoadingState
            title={isPlanningSearchQueries ? "正在生成搜索指令" : "正在搜索候选客户"}
            description={
              isPlanningSearchQueries
                ? planningLoadingDescription
                : "正在等待后端搜索、清洗和评分，客户会陆续进入列表。"
            }
          />
        ) : (
          <div className="aiPoolTableScroll">
            <table className="aiPoolTable">
              <thead>
                <tr>
                  <th className="col-company">公司名称</th>
                  <th className="col-country">国家/地区</th>
                  <th className="col-type">类型</th>
                  <th className="col-score">推荐指数</th>
                  <th className="col-email">邮箱</th>
                  <th className="col-phone">电话</th>
                  <th className="col-website">官网</th>
                  <th className="col-status">状态</th>
                  <th className="col-action">操作</th>
                </tr>
              </thead>
              <tbody>
                {currentBatchLeads.length ? (
                  pagedLeads.map((lead) => {
                    const emails = pickFirstContactValue(lead.raw.contacts, "email");
                    const phones = pickFirstContactValue(lead.raw.contacts, "phone");
                    const websiteShort = formatWebsiteShort(lead.website);
                    const websiteFull = lead.website && lead.website !== "—" ? lead.website : "";
                    const inCrm = Boolean(lead.raw.crmLead);
                    const isFresh = lead.stage === "新发现" || lead.stage === "main";
                    return (
                      <tr
                        key={lead.id}
                        className={[
                          isFresh ? "is-fresh" : "",
                          selectedLeadId === lead.id ? "selected" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => onSelectLead(lead.id)}
                      >
                        <td className="col-company" title={lead.companyName}>
                          {isFresh ? <span className="aiSearchRunFreshBadge">新增</span> : null}
                          <span className="aiSearchRunCompanyName">{lead.companyName}</span>
                        </td>
                        <td className="col-country" title={lead.country}>
                          {lead.country}
                        </td>
                        <td className="col-type" title={lead.tag}>
                          {lead.tag}
                        </td>
                        <td className="col-score">
                          <span className="aiSearchRunScoreStars" aria-hidden="true">
                            {renderStars(lead.score / 20)}
                          </span>
                          <span className="aiSearchRunScore">{lead.score}</span>
                        </td>
                        <td
                          className="col-email"
                          title={emails.count ? emails.all.join("\n") : "暂无邮箱"}
                        >
                          {emails.count > 0 ? (
                            <span className="aiSearchRunContactValue">
                              <span className="aiSearchRunContactText">{emails.first}</span>
                              {emails.count > 1 ? (
                                <span className="aiSearchRunContactMore">…</span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="aiSearchRunContactMuted">—</span>
                          )}
                        </td>
                        <td
                          className="col-phone"
                          title={phones.count ? phones.all.join("\n") : "暂无电话"}
                        >
                          {phones.count > 0 ? (
                            <span className="aiSearchRunContactValue">
                              <span className="aiSearchRunContactText">{phones.first}</span>
                              {phones.count > 1 ? (
                                <span className="aiSearchRunContactMore">…</span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="aiSearchRunContactMuted">—</span>
                          )}
                        </td>
                        <td className="col-website" title={websiteFull || websiteShort}>
                          {websiteFull ? (
                            <a
                              className="aiSearchRunWebsite"
                              href={websiteHref(websiteFull)}
                              onClick={(event) => event.stopPropagation()}
                              rel="noreferrer noopener"
                              target="_blank"
                            >
                              {websiteShort}
                            </a>
                          ) : (
                            <span className="aiSearchRunWebsite">—</span>
                          )}
                        </td>
                        <td className="col-status">
                          <span className={`aiPoolStatusPill ${inCrm ? "synced" : "pending"}`}>
                            {inCrm ? "已加入CRM" : "待加入CRM"}
                          </span>
                        </td>
                        <td className="col-action">
                          <button
                            type="button"
                            className="aiPoolRowAction"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenLeadDetail(lead);
                            }}
                          >
                            详情
                          </button>
                          <button
                            type="button"
                            className="aiPoolRowAction"
                            onClick={() => onOpenCrm(lead.id)}
                            disabled={inCrm}
                            title={inCrm ? "已加入 CRM" : "加入 CRM"}
                          >
                            {inCrm ? "已加入" : "加入 CRM"}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="leadEmptyCell" colSpan={9}>
                      <div className="aiSearchRunEmptyState">
                        <span className="aiSearchRunEmptyIcon" aria-hidden="true">
                          <Search size={20} />
                        </span>
                        <strong>
                          {isPlanningSearchQueries
                            ? "正在生成搜索指令"
                            : isRunActive
                              ? "正在搜索并清洗候选客户"
                              : "暂无候选客户"}
                        </strong>
                        <span>
                          {isPlanningSearchQueries
                            ? planningEmptyDescription
                            : isRunActive
                              ? "搜索结果会按客户质量陆续进入列表。"
                              : "任务创建后会先生成搜索指令，再自动执行搜索。"}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <footer className="aiPoolTableFooter">
          {currentBatchLeads.length ? (
            <p className="aiPoolTableFootHint">
              显示 {leadRangeStart}-{leadRangeEnd} / {currentBatchLeads.length}
              <span className="aiPoolTableFootSep">·</span>
              主客户 {actionableLeads.length} 条，ICP 75+ {qualifiedCount} 条
            </p>
          ) : (
            <p className="aiPoolTableFootHint aiPoolTableFootHintMuted">
              {isPlanningSearchQueries
                ? planningFooterDescription
                : isRunActive
                  ? "正在搜索并清洗候选客户，结果会陆续进入列表"
                  : "暂无候选客户，任务执行后客户会进入列表"}
            </p>
          )}
          {currentBatchLeads.length ? (
            <div className="projectPager leadPager">
              <span>每页 {leadPageSize}</span>
              <button
                type="button"
                onClick={() => changeLeadPage(leadPage - 1)}
                disabled={leadPage <= 1}
              >
                上一页
              </button>
              <strong>
                {leadPage} / {leadPageCount}
              </strong>
              <button
                type="button"
                onClick={() => changeLeadPage(leadPage + 1)}
                disabled={leadPage >= leadPageCount}
              >
                下一页
              </button>
            </div>
          ) : null}
        </footer>
      </section>

      {/* 下一步转化 — 三张转化卡（按设计图）：色块 icon + 标题 +
          完整两行描述 + 卡片底部左侧的彩色按钮。 */}
      <section className="aiSearchRunBottomBar" aria-label="下一步转化">
        <h2 className="aiSearchRunBottomTitle">下一步转化</h2>
        <div className="aiSearchRunBottomCards">
          <article className="aiSearchRunBottomCard tone-blue">
            <div className="aiPoolIcon aiPoolIconBlue" aria-hidden="true">
              <span className="aiPoolIconText">CRM</span>
            </div>
            <div className="aiSearchRunBottomBody">
              <p className="aiSearchRunBottomCardTitle">CRM 同步</p>
              <p className="aiSearchRunBottomMeta">
                <strong>{Math.max(leads.length - crmSyncedCount, 0)}</strong>{" "}
                家客户待同步，字段已整理，可进入客户库。
              </p>
              <button
                type="button"
                className="aiSearchRunBottomCta tone-blue"
                onClick={() => onOpenCrm()}
              >
                确认同步
              </button>
            </div>
          </article>

          <article className="aiSearchRunBottomCard tone-green">
            <div className="aiPoolIcon aiPoolIconGreen" aria-hidden="true">
              <Mail size={20} />
            </div>
            <div className="aiSearchRunBottomBody">
              <p className="aiSearchRunBottomCardTitle">邮件触达</p>
              <p className="aiSearchRunBottomMeta">
                <strong>{actionableLeads.length}</strong> 封邮件待确认，主题：中国 B2B
                工厂产品推荐。
              </p>
              <button
                type="button"
                className="aiSearchRunBottomCta tone-green"
                onClick={onOpenMail}
                disabled={running || !hasActionableLeads}
              >
                发送邮件
              </button>
            </div>
          </article>

          <article className="aiSearchRunBottomCard tone-orange">
            <div className="aiPoolIcon aiPoolIconOrange" aria-hidden="true">
              <Bell size={20} />
            </div>
            <div className="aiSearchRunBottomBody">
              <p className="aiSearchRunBottomCardTitle">跟进提醒</p>
              <p className="aiSearchRunBottomMeta">
                <strong>{pendingFollowupCount}</strong> 家客户需跟进，最近提醒：3 天后。
              </p>
              <button
                type="button"
                className="aiSearchRunBottomCta tone-orange"
                disabled
                title="跟进提醒功能开发中"
              >
                查看跟进
              </button>
            </div>
          </article>
        </div>
      </section>

      {showBackConfirm ? (
        <div className="aiSearchLeaveBackdrop" role="presentation">
          <div
            className="aiSearchLeaveDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-search-leave-title"
          >
            <span className="aiSearchLeaveIcon" aria-hidden="true">
              <Clock size={22} />
            </span>
            <div className="aiSearchLeaveBody">
              <h2 id="ai-search-leave-title">搜索会继续在后台执行</h2>
              <p>
                离开这个页面不会停止当前搜索。回到工作台后，你可以在“客户池”里找到这个任务，点击“搜索记录”继续查看实时进度。
              </p>
            </div>
            <div className="aiSearchLeaveActions">
              <button
                type="button"
                className="aiSearchLeaveSecondary"
                onClick={() => setShowBackConfirm(false)}
              >
                留在搜索页
              </button>
              <button
                type="button"
                className="aiSearchLeavePrimary"
                onClick={() => {
                  setShowBackConfirm(false);
                  onBack();
                }}
              >
                返回工作台
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

async function apiRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(resolveApiUrl(url), {
    ...init,
    cache: init.cache ?? "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      ...(init.headers ?? {})
    }
  });
  const payload = await readJson(response);

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("请先登录 LeadHunt，再运行 AI 外贸员任务。");
    }

    throw new Error(extractApiMessage(payload) || `接口请求失败：HTTP ${response.status}`);
  }

  return payload as T;
}

function displayAiWorkerAccountName(user: CurrentUser) {
  const name = user.name?.trim();
  if (name) {
    return name;
  }

  return user.email.split("@")[0] || "你";
}

function resolveApiUrl(url: string) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const configuredBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (configuredBase && url.startsWith("/api/")) {
    return `${configuredBase}${url}`;
  }

  if (
    typeof window !== "undefined" &&
    url.startsWith("/api/") &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
    window.location.port === "3000"
  ) {
    return `${window.location.protocol}//${window.location.hostname}:4000${url}`;
  }

  return url;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractApiMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return typeof payload === "string" ? payload : "";
  }

  const message = (payload as { message?: unknown }).message;
  if (Array.isArray(message)) {
    return message.filter((item): item is string => typeof item === "string").join("；");
  }

  return typeof message === "string" ? message : "";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

const planningStepNames = [
  "load_task",
  "analyze_product_profile",
  "analyze_customer_profile",
  "expand_keywords",
  "plan_search_queries"
];
const searchStepNames = ["brave_search", "normalize_leads", "extract_contacts", "score_icp"];

function isBackendTaskActive(task: LeadTask) {
  // 2026-05 LeadHunt 2.0: terminal task.status wins over stale agent
  // step rows. A failed/completed/cancelled/paused task must never be
  // treated as active even if a worker forgot to flip its leftover
  // step rows from "running" to a final state — that's exactly what
  // pinned the search page in the P0 bug.
  if (
    task.status === "failed" ||
    task.status === "completed" ||
    task.status === "cancelled" ||
    task.status === "paused"
  ) {
    return false;
  }
  if (task.status === "running" || task.status === "pending") {
    return true;
  }

  return Boolean(task.agentSteps?.some((step) => step.status === "running"));
}

function isTaskPlanning(task: LeadTask) {
  if (!isBackendTaskActive(task)) {
    return false;
  }

  const planStep = findStep(task, "plan_search_queries");
  if (planStep?.status === "completed" || planStep?.status === "failed") {
    return false;
  }

  return true;
}

function isTaskSearching(task: LeadTask) {
  if (!isBackendTaskActive(task) || isTaskPlanning(task)) {
    return false;
  }

  const scoreStep = findStep(task, "score_icp");
  const pendingQueries =
    task.searchQueries?.filter((query) => query.executionStatus === "pending").length ?? 0;
  const runningQueries =
    task.searchQueries?.filter((query) => query.executionStatus === "running").length ?? 0;

  return (
    pendingQueries > 0 ||
    runningQueries > 0 ||
    scoreStep?.status === "running" ||
    scoreStep?.status === "pending"
  );
}

function firstFailedStepError(task: LeadTask) {
  return task.agentSteps?.find((step) => step.status === "failed")?.error ?? null;
}

function findStep(task: LeadTask, nodeName: string) {
  return task.agentSteps?.find((step) => step.nodeName === nodeName);
}

function stepLabel(nodeName: string) {
  const labels: Record<string, string> = {
    load_task: "读取产品画像 / 客户画像",
    analyze_product_profile: "分析产品画像",
    analyze_customer_profile: "分析客户画像",
    expand_keywords: "扩展关键词",
    plan_search_queries: "生成搜索指令",
    brave_search: "执行 Brave 搜索",
    normalize_leads: "清洗候选客户",
    extract_contacts: "提取联系方式",
    score_icp: "ICP 评分"
  };

  return labels[nodeName] ?? nodeName;
}

function activeStepLabel(task: LeadTask, names: string[]) {
  const running = task.agentSteps?.find(
    (step) => names.includes(step.nodeName) && step.status === "running"
  );
  if (running) {
    return stepLabel(running.nodeName);
  }

  const pending = task.agentSteps?.find(
    (step) => names.includes(step.nodeName) && step.status === "pending"
  );
  return pending ? stepLabel(pending.nodeName) : null;
}

function formatTaskProgressStatus(task: LeadTask, result: SearchRunResult) {
  const failedMessage = firstFailedStepError(task);
  if (failedMessage || task.status === "failed") {
    return `任务执行失败：${failedMessage ?? "请检查后端日志"}`;
  }

  if (isTaskPlanning(task)) {
    return `后端正在${activeStepLabel(task, planningStepNames) ?? "生成搜索指令"}，完成后会自动执行全部 query。`;
  }

  if (isTaskSearching(task)) {
    const queryCount = task.searchQueries?.length ?? 0;
    const runningText = result.runningQueries ? `，${result.runningQueries} 条正在处理` : "";
    return `后端正在${activeStepLabel(task, searchStepNames) ?? "执行搜索"}：已完成 ${result.executedQueries}/${queryCount || "-"} 条 query${runningText}，已命中 ${result.resultCount} 条 Brave 原始结果；${formatLeadQualitySummary(summarizeLeadQualityCounts(task))}。`;
  }

  if (task.status === "paused") {
    return `本轮搜索已完成：执行 ${result.executedQueries} 条 query，命中 ${result.resultCount} 条 Brave 原始结果；${formatLeadQualitySummary(summarizeLeadQualityCounts(task))}。`;
  }

  if (task.status === "completed") {
    return `任务已完成：执行 ${result.executedQueries} 条 query；${formatLeadQualitySummary(summarizeLeadQualityCounts(task))}。`;
  }

  return "任务已创建，后端会自动生成搜索指令并执行本轮全部搜索。";
}

function isMissingLeadTaskError(message: string) {
  return /lead task not found|任务.*不存在|任务.*失效/i.test(message);
}

function normalizeCreatedTask(payload: CreateLeadTaskResponse): LeadTask {
  return {
    ...payload.task,
    agentSteps: payload.task.agentSteps ?? payload.steps ?? [],
    searchQueries: payload.task.searchQueries ?? payload.searchQueries ?? []
  };
}

function buildActivityLogs({
  creating,
  searching,
  currentTask,
  searchResult,
  leads,
  leadQualityCounts,
  hasError
}: {
  creating: boolean;
  searching: boolean;
  currentTask: LeadTask | null;
  searchResult: SearchRunResult | null;
  leads: DisplayLead[];
  leadQualityCounts: LeadQualityCounts;
  hasError: boolean;
}): ActivityLog[] {
  const queryCount = currentTask?.searchQueries?.length ?? 0;
  // 2026-05 polish: same as the conversation view — count completed +
  // failed + running so the "数据搜索中 — 正在执行 N/M" log line moves
  // as soon as Brave work begins, instead of waiting for the worker
  // pool to flip executionStatus to "completed" after qualification.
  const completedQueryCount =
    currentTask?.searchQueries?.filter((q) => q.executionStatus === "completed").length ?? 0;
  const failedQueryCount =
    currentTask?.searchQueries?.filter((q) => q.executionStatus === "failed").length ?? 0;
  const runningQueryCount =
    currentTask?.searchQueries?.filter((q) => q.executionStatus === "running").length ?? 0;
  const executedCount = completedQueryCount + failedQueryCount + runningQueryCount;
  const actionableLeads = leads.filter(isActionableDisplayLead);
  const qualifiedCount = actionableLeads.filter((lead) => lead.score >= 75).length;
  const hasTask = Boolean(currentTask);
  const hasLeads = leads.length > 0;
  const planningStatus =
    currentTask?.agentSteps
      ?.find((step) => step.nodeName === "plan_search_queries" || step.nodeName === "plan_search")
      ?.status?.toLowerCase() ?? "";
  const planningStillAppending =
    planningStatus === "running" && queryCount > 0 && queryCount < plannedBatchQueryCount;

  return [
    {
      title: "LLM思考中",
      detail: creating
        ? "正在理解任务、产品画像和目标市场"
        : hasTask
          ? "任务理解完成"
          : "等待用户输入",
      state: creating ? "active" : hasTask ? "done" : "pending"
    },
    {
      title: "技能挑选中",
      detail: creating ? "选择搜索、清洗、ICP评分工具" : hasTask ? "工具链已选定" : "等待任务规划",
      state: creating ? "active" : hasTask ? "done" : "pending"
    },
    {
      title: "任务规划中",
      detail: planningStillAppending
        ? `已先生成 ${queryCount} 条，正在补齐到 ${plannedBatchQueryCount} 条搜索指令`
        : queryCount
        ? `已生成 ${queryCount} 条搜索指令`
        : creating
          ? "正在生成执行步骤"
          : "等待画像读取",
      state: planningStillAppending ? "active" : queryCount ? "done" : creating ? "active" : "pending"
    },
    {
      title: "数据搜索中",
      detail: searching
        ? `正在执行 ${executedCount}/${queryCount || "-"} 条 query`
        : searchResult
          ? `检索到 ${searchResult.resultCount} 条数据`
          : executedCount
            ? `已执行 ${executedCount} 条 query`
            : hasError
              ? "搜索接口失败，可重试"
              : "等待搜索接口",
      state: searching
        ? "active"
        : searchResult || executedCount
          ? "done"
          : hasError
            ? "failed"
            : "pending"
    },
    {
      title: "数据搜索完成",
      detail: searchResult
        ? formatLeadQualitySummary(leadQualityCounts)
        : hasLeads
          ? `${leads.length} 条主客户已写入列表`
          : hasError
            ? "本轮未写入候选"
            : "等待候选客户",
      state:
        searchResult || hasLeads ? "done" : searching ? "active" : hasError ? "failed" : "pending"
    },
    {
      title: "检索结果分析",
      detail: hasLeads
        ? `${leads.length} 条主客户，${qualifiedCount} 条 ICP 75+`
        : searching
          ? "正在清洗、去重和评分"
          : hasError
            ? "等待重新搜索"
            : "等待结果分析",
      state: hasLeads ? "done" : searching ? "active" : hasError ? "failed" : "pending"
    }
  ];
}

function formatHistoryDate(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return value.slice(0, 10);
  }
}

function summarizeSearchResultFromTask(task: LeadTask): SearchRunResult {
  const completedQueries =
    task.searchQueries?.filter((query) => query.executionStatus === "completed") ?? [];
  const failedQueries =
    task.searchQueries?.filter((query) => query.executionStatus === "failed") ?? [];
  const pendingQueries =
    task.searchQueries?.filter((query) => query.executionStatus === "pending") ?? [];
  const runningQueries =
    task.searchQueries?.filter((query) => query.executionStatus === "running") ?? [];
  const resultCount = (task.searchQueries ?? []).reduce(
    (sum, query) => sum + (query.resultCount ?? 0),
    0
  );
  const createdCandidates = task.leadCandidates?.length ?? 0;
  const skippedCandidates = completedQueries.reduce(
    (sum, query) => sum + Math.max((query.resultCount ?? 0) - (query.qualifiedCount ?? 0), 0),
    0
  );

  return {
    ok: failedQueries.length === 0,
    executedQueries: completedQueries.length + failedQueries.length,
    successfulQueries: completedQueries.length,
    failedQueries: failedQueries.length,
    runningQueries: runningQueries.length,
    resultCount,
    createdCandidates,
    skippedCandidates,
    hasMore: pendingQueries.length + runningQueries.length > 0,
    remainingQueries: pendingQueries.length + runningQueries.length
  };
}

function buildDisplayLeads(task: LeadTask | null): DisplayLead[] {
  const targetMarkets = taskTargetMarkets(task);
  const candidates = task?.leadCandidates ?? [];
  const sortLeads = (leads: LeadCandidate[]) =>
    leads
      .map((lead) => ({
        displayLead: buildDisplayLead(lead),
        priority: displayLeadPriority(lead, targetMarkets)
      }))
      .sort((left, right) => {
        const adjustedDelta =
          right.displayLead.score + right.priority - (left.displayLead.score + left.priority);
        if (adjustedDelta !== 0) return adjustedDelta;
        const scoreDelta = right.displayLead.score - left.displayLead.score;
        if (scoreDelta !== 0) return scoreDelta;
        const priorityDelta = right.priority - left.priority;
        if (priorityDelta !== 0) return priorityDelta;
        return left.displayLead.companyName.localeCompare(right.displayLead.companyName);
      })
      .map(({ displayLead }) => displayLead);

  const mainLeads = sortLeads(candidates.filter(isDisplayableLeadCandidate));
  const reviewTailLimit = Math.max(8, 20 - mainLeads.length);
  const reviewTail = sortLeads(candidates.filter(isReviewTailLeadCandidate)).slice(
    0,
    reviewTailLimit
  );

  return [...mainLeads, ...reviewTail];
}

function isMainLeadStatus(status: string | undefined) {
  return ["review", "qualified", "approved", "contacted", "email_sent"].includes(status ?? "");
}

function isDisplayableLeadCandidate(lead: LeadCandidate) {
  // 2026-05: country verification and low ICP score are no longer hard
  // display gates. If a row is still in a main-customer status, keep it
  // show "国家待补充" in the UI; downstream review still lets users
  // ranking/review instead of silently hiding plausible low-score leads.
  return (
    isMainLeadStatus(lead.status) &&
    !hasEvidenceLeadType(lead) &&
    !isHiddenEvidenceOrContentLead(lead)
  );
}

function isReviewTailLeadCandidate(lead: LeadCandidate) {
  if (
    isDisplayableLeadCandidate(lead) ||
    lead.status === "rejected" ||
    lead.status === "intelligence" ||
    // Legacy evidence/intelligence statuses kept for historical rows.
    lead.status === "intelligence_review" ||
    lead.status === "evidence_review" ||
    hasEvidenceLeadType(lead) ||
    isHiddenEvidenceOrContentLead(lead)
  ) {
    return false;
  }

  // Legacy buckets only — needs_country_review and country_conflict_review
  // do not exist in new scoring, but historical task rows still carry
  // them. They surface here as a soft tail of "country unconfirmed"
  // entries below the main list.
  return (
    lead.status === "needs_country_review" ||
    lead.status === "country_conflict_review" ||
    lead.countryConflict ||
    lead.countryConfidence === "low" ||
    lead.countryConfidence === "unknown"
  );
}

function isActionableDisplayLead(lead: DisplayLead) {
  return lead.actionable;
}

function hasEvidenceLeadType(lead: LeadCandidate) {
  const payload = icpReasonPayload(lead.icpScore?.reasons);
  const leadType = typeof payload?.leadType === "string" ? payload.leadType : "";
  return (
    lead.status === "intelligence" ||
    // Legacy: kept for historical rows.
    lead.status === "intelligence_review" ||
    lead.status === "evidence_review" ||
    leadType === "intelligence" ||
    leadType === "content_evidence" ||
    leadType === "government_information"
  );
}

function isHiddenEvidenceOrContentLead(lead: LeadCandidate) {
  const payload = icpReasonPayload(lead.icpScore?.reasons);
  const summary = typeof payload?.summary === "string" ? payload.summary : "";
  const text = [
    lead.companyName,
    lead.website,
    lead.sourceUrl,
    summary,
    firstIcpReason(lead.icpScore?.reasons)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return containsAny(text, [
    "/glossary",
    "/resources/",
    "/resource/",
    "/blog",
    "/article",
    "/articles",
    "/news",
    "/press-release",
    "/topics/",
    "/applications/",
    "/application/",
    "/definition",
    "what is",
    "what does",
    "stands for",
    "stands-for",
    "essential knowledge",
    "specifications",
    "standards & performance",
    "open access journal",
    "sciencedirect.com",
    "mdpi.com",
    "techtarget.com",
    "whatis.com",
    "microchip.com/en-us/solutions/communications-infrastructure",
    "st.com/en/applications/telecom-infrastructure"
  ]);
}

function summarizeLeadQualityCounts(task: LeadTask | null): LeadQualityCounts {
  const candidates = task?.leadCandidates ?? [];
  const main = candidates.filter(isDisplayableLeadCandidate).length;
  const rejected = candidates.filter((lead) => lead.status === "rejected").length;
  // Combine new "intelligence" status with legacy "intelligence_review".
  const intelligenceReview = candidates.filter(
    (lead) => lead.status === "intelligence" || lead.status === "intelligence_review"
  ).length;
  const evidenceReview = candidates.filter((lead) => lead.status === "evidence_review").length;
  const needsCountryReview = candidates.filter(
    (lead) =>
      lead.status !== "rejected" &&
      lead.status !== "intelligence" &&
      lead.status !== "intelligence_review" &&
      lead.status !== "evidence_review" &&
      !isHiddenEvidenceOrContentLead(lead) &&
      !isDisplayableLeadCandidate(lead) &&
      (lead.status === "needs_country_review" ||
        lead.status === "country_conflict_review" ||
        lead.countryConflict ||
        lead.countryConfidence === "low" ||
        lead.countryConfidence === "unknown")
  ).length;
  const rawEvidence = candidates.length;
  const other = Math.max(
    rawEvidence - main - rejected - needsCountryReview - intelligenceReview - evidenceReview,
    0
  );

  return {
    rawEvidence,
    main,
    needsCountryReview,
    intelligenceReview,
    evidenceReview,
    rejected,
    other
  };
}

function formatLeadQualitySummary(counts: LeadQualityCounts) {
  const parts = [
    `${counts.rawEvidence} 条原始候选证据`,
    `${counts.main} 条主客户`,
    `${counts.needsCountryReview} 条待国家复核`,
    `${counts.rejected} 条拒绝`
  ];
  if (counts.intelligenceReview) {
    parts.push(`${counts.intelligenceReview} 条采购情报线索`);
  }
  if (counts.evidenceReview) {
    parts.push(`${counts.evidenceReview} 条证据待复核`);
  }
  if (counts.other) {
    parts.push(`${counts.other} 条其他待处理`);
  }

  return parts.join("，");
}

function buildDisplayLead(lead: LeadCandidate): DisplayLead {
  const email = formatEmailContacts(
    lead.contacts?.filter((contact) => contact.type === "email").map((contact) => contact.value),
    lead.website ?? lead.sourceUrl
  );
  const phone = formatPhoneContacts(
    lead.contacts?.filter((contact) => contact.type === "phone").map((contact) => contact.value)
  );
  const social = formatSocialProfiles(
    lead.contacts?.filter((contact) => contact.type === "social").map((contact) => contact.value)
  );
  const storedCountry = formatDisplayCountry(lead.inferredCountry ?? lead.country);
  const contactCountry = inferCountryFromLeadContacts(lead.contacts);
  const country = chooseDisplayCountry(storedCountry, contactCountry) || "-";
  const score = lead.icpScore?.score ?? 0;
  const grade = lead.icpScore?.grade ? `${lead.icpScore.grade} ICP` : "待评分";
  const sourceUrl = lead.sourceUrl ?? lead.website ?? "";

  return {
    id: lead.id,
    companyName: displayCompanyName(lead),
    score,
    source: lead.sourceUrl ? "Brave 搜索" : "AI 筛选",
    sourceUrl,
    sourceLabel: formatSourceLinkLabel(sourceUrl),
    country,
    tag: buildCustomerBrief(lead) || grade,
    phone: phone || "-",
    email: email || "-",
    website: formatWebsite(lead.website ?? lead.sourceUrl),
    social: social || "-",
    address: inferLeadAddress(lead.countryEvidence),
    stage: displayLeadStage(lead),
    actionable: isDisplayableLeadCandidate(lead),
    raw: lead
  };
}

function chooseDisplayCountry(storedCountry: string, contactCountry: string) {
  if (!storedCountry) {
    return contactCountry;
  }

  if (
    contactCountry &&
    normalizeDisplayMarket(storedCountry) !== normalizeDisplayMarket(contactCountry)
  ) {
    return contactCountry;
  }

  return storedCountry;
}

function displayCompanyName(lead: LeadCandidate) {
  const currentName = cleanupDisplayCompanyName(lead.companyName);
  const domainName = companyNameFromUrl(lead.website ?? lead.sourceUrl);
  const attributedName = extractDisplayAttributedCompanyName(currentName);

  if (
    /^\s*(?:created|designed|powered|developed|maintained|hosted)\s+by\s+|^\s*website\s+by\s+/i.test(
      lead.companyName ?? ""
    )
  ) {
    return domainName || currentName || "Unknown Company";
  }

  if (attributedName) {
    return attributedName;
  }

  if (isLikelyDisplayCompanyName(currentName, domainName)) {
    return currentName;
  }

  return domainName || currentName || "Unknown Company";
}

function extractDisplayAttributedCompanyName(value: string) {
  const match = value.match(/\bfrom\s+([A-Z0-9][^|:]{2,80})$/i);
  if (!match?.[1]) {
    return "";
  }

  return cleanupDisplayCompanyName(match[1]);
}

function cleanupDisplayCompanyName(value: string | null | undefined) {
  return (value ?? "")
    .replace(
      /\b(home|official site|website|about us|contact us|logo|tagline|awesome image|pdf)\b/gi,
      ""
    )
    .replace(/^\s*(?:welcome to|official)\s+/i, "")
    .replace(
      /^\s*(?:created|designed|powered|developed|maintained|hosted)\s+by\s+|^\s*website\s+by\s+/i,
      ""
    )
    .replace(/\s+\b(?:homepage|home page)\b$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[|:\\\-\s]+|[|:\\\-\s]+$/g, "")
    .trim();
}

function isLikelyDisplayCompanyName(value: string, domainName: string) {
  const name = cleanupDisplayCompanyName(value);
  const lower = name.toLowerCase();
  if (
    !name ||
    name.length > 72 ||
    isForbiddenDisplayCompanyName(value) ||
    looksLikeDisplayProductTitle(name)
  ) {
    return false;
  }

  if (domainName && normalizeDisplayCompanyKey(name) === normalizeDisplayCompanyKey(domainName)) {
    return true;
  }

  if (displayCompanyEntityTerms.some((term) => lower.includes(term))) {
    return true;
  }

  return /^[A-Z0-9][A-Za-z0-9&().' ]{2,48}$/.test(name);
}

function isForbiddenDisplayCompanyName(value: string) {
  const normalized = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return (
    !normalized ||
    displayForbiddenCompanyNameTerms.has(normalized) ||
    /^by\s+[a-z0-9 .'-]{2,60}$/i.test(value.trim()) ||
    /^\s*(?:created|designed|powered|developed|maintained|hosted)\s+by\s+|^\s*website\s+by\s+/i.test(
      value.trim()
    ) ||
    /\b(?:tagline|awesome image|blog category|article author|pdf)\b/i.test(value)
  );
}

function looksLikeDisplayProductTitle(value: string) {
  const lower = value.toLowerCase();
  return (
    containsAny(lower, displayProductTitleTerms) ||
    /\b(?:\d{2,5}\s?w|\d{2,5}w|48v|24v|85-300|vac|vdc|sfp\+?|100g|10g)\b/i.test(value) ||
    (containsAny(lower, displayTelecomBrandTerms) &&
      containsAny(lower, [
        "rectifier",
        "module",
        "board",
        "rru",
        "bbu",
        "aau",
        "networking equipment",
        "hardware repair"
      ]))
  );
}

function companyNameFromUrl(value: string | null | undefined) {
  const domain = domainFromUrl(value);
  if (!domain || domain === "-") {
    return "";
  }

  const label = domain.split(".")[0] ?? domain;
  return formatDomainLabelAsCompany(label);
}

function formatDomainLabelAsCompany(label: string) {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (displayDomainCompanyNameOverrides[normalized]) {
    return displayDomainCompanyNameOverrides[normalized];
  }

  return label
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      displayDomainAcronymTerms.has(part.toLowerCase())
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join(" ");
}

function normalizeDisplayCompanyKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function taskTargetMarkets(task: LeadTask | null) {
  return unique([
    ...(task?.inputPayload?.keywordGroups?.marketTerms ?? []),
    ...((task?.searchQueries ?? []).map((query) => query.country).filter(Boolean) as string[])
  ]);
}

function formatCompactMarketList(markets: string[], limit = 4) {
  const visible = markets.map((market) => market.trim()).filter(Boolean).slice(0, limit);
  if (!visible.length) return "";
  const remainingCount = Math.max(0, markets.length - visible.length);
  return remainingCount > 0 ? `${visible.join("、")} 等 ${markets.length} 个地区` : visible.join("、");
}

function displayLeadPriority(lead: LeadCandidate, targetMarkets: string[]) {
  const contacts = lead.contacts ?? [];
  const url = lead.website ?? lead.sourceUrl ?? "";
  const domain = domainFromUrl(url);
  const path = pathFromUrl(url);
  const text = [
    lead.companyName,
    lead.website,
    lead.sourceUrl,
    lead.country,
    contacts.map((contact) => contact.value).join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let priority = 0;

  if (contacts.some((contact) => contact.type === "email" || contact.type === "phone"))
    priority += 4;
  if (containsAny(text, displayBuyerTerms)) priority += 4;
  if (containsAny(text, displaySpecificProductTerms)) priority += 3;
  if (lead.country) priority += 1;
  const explicitMarkets = explicitDisplayMarkets(targetMarkets);
  if (lead.country && explicitMarkets.length) {
    priority += matchesDisplayMarket(lead.country, explicitMarkets) ? 12 : -18;
  }
  if (domain && !isDiscoveryDomain(domain) && looksLikeOfficialPath(path)) priority += 3;
  if (
    isDiscoveryDomain(domain) ||
    isDiscoveryPath(path) ||
    containsAny(text, displayDiscoveryTerms)
  )
    priority -= 8;

  return priority;
}

function domainFromUrl(value: string | null | undefined) {
  if (!value) return "";

  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return formatWebsite(value).toLowerCase();
  }
}

function pathFromUrl(value: string | null | undefined) {
  if (!value) return "";

  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function containsAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function matchesDisplayMarket(country: string, targetMarkets: string[]) {
  const normalizedCountry = normalizeDisplayMarket(country);
  return targetMarkets.some((market) => normalizeDisplayMarket(market) === normalizedCountry);
}

function explicitDisplayMarkets(targetMarkets: string[]) {
  return targetMarkets.filter((market) => !displayMacroMarkets.has(normalizeDisplayMarket(market)));
}

function normalizeDisplayMarket(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function looksLikeOfficialPath(path: string) {
  return (
    !path ||
    path === "/" ||
    [
      "/about",
      "/contact",
      "/company",
      "/products",
      "/solutions",
      "/services",
      "/telecom",
      "/network"
    ].some((term) => path.includes(term))
  );
}

function isDiscoveryPath(path: string) {
  return [
    "/article",
    "/blog",
    "/news",
    "/report",
    "/research",
    "/resource",
    "/category",
    "/catalog",
    "/directory",
    "/listing",
    "/wiki"
  ].some((term) => path.includes(term));
}

function isDiscoveryDomain(domain: string) {
  return displayDiscoveryDomains.some((item) => domain === item || domain.endsWith(`.${item}`));
}

const displayBuyerTerms = [
  "base station maintenance",
  "ran maintenance",
  "radio access network maintenance",
  "cell site maintenance",
  "telecom field services",
  "tower maintenance",
  "tower company",
  "towerco",
  "wireless infrastructure contractor",
  "telecom power maintenance",
  "mobile network operator",
  "network operator",
  "isp network operations",
  "wisp",
  "ftth operator",
  "fiber network operator",
  "distributor",
  "stockist",
  "system integrator",
  "contractor",
  "maintenance",
  "repair",
  "reverse logistics",
  "spare parts management",
  "procurement",
  "purchasing",
  "project supply"
];

const displaySpecificProductTerms = [
  "telecom equipment",
  "base station",
  "rru",
  "bbu",
  "aau",
  "ran",
  "microwave backhaul",
  "telecom power",
  "rectifier",
  "olt",
  "sfp",
  "optical module",
  "huawei",
  "zte",
  "ericsson",
  "nokia",
  "eltek"
];

const displayProductTitleTerms = [
  "private 5g",
  "critical networks",
  "hardware repair",
  "repair service",
  "networking equipment",
  "telecom networking equipment",
  "rectifier",
  "rectifier module",
  "flatpack",
  "power module",
  "baseband",
  "radio unit",
  "optical module",
  "sfp",
  "datasheet",
  "price",
  "buy",
  "stock",
  "product",
  "products"
];

const displayTelecomBrandTerms = ["huawei", "zte", "ericsson", "nokia", "alcatel-lucent", "eltek"];

const displayCompanyEntityTerms = [
  "trading",
  "general trading",
  "llc",
  "l.l.c",
  "fze",
  "fzc",
  "co.",
  "company",
  "limited",
  "ltd",
  "solutions",
  "technologies",
  "electronics",
  "communications",
  "systems",
  "services",
  "networks",
  "group"
];

const displayDomainCompanyNameOverrides: Record<string, string> = {
  ats4solutions: "ATS 4 Solutions",
  greenportsuppliers: "Greenport Suppliers",
  alhazmservices: "Al Hazm Services",
  hctgroup: "HCT Group",
  ispsupplies: "ISP Supplies",
  mfcomm: "MF Communications",
  rtesqatar: "RTES Qatar",
  screamerelectronicservices: "Screamer Electronic Services",
  tempestns: "Tempest"
};

const displayDomainAcronymTerms = new Set(["isp", "hct", "ats", "mf", "rtes", "usa", "uk", "uae"]);

const displayForbiddenCompanyNameTerms = new Set([
  "about",
  "about us",
  "article author",
  "awesome image",
  "blog category",
  "by",
  "category",
  "contact",
  "contact us",
  "home",
  "homepage",
  "pdf",
  "tagline",
  "welcome"
]);

const displayDiscoveryTerms = [
  "mcc & mnc",
  "mobile network code",
  "lookup",
  "regulatory bodies",
  "register as a telecommunications provider",
  "market report",
  "industry report",
  "supplier directory",
  "company directory",
  "trade directory",
  "b2b marketplace",
  "yellow pages",
  "deployment challenges",
  "discussion board",
  "forum",
  "management system",
  "what is",
  "guide to",
  "top 10",
  "top 15"
];

const displayDiscoveryDomains = [
  "wikipedia.org",
  "celltowerfinder.com",
  "directory.org.ng",
  "ensun.io",
  "nairaland.com",
  "rantcell.com",
  "sourcesecurity.com",
  "targetd.com",
  "telecom.directory",
  "dlapiperintelligence.com",
  "crtc.gc.ca",
  "globaltenders.com",
  "tendersontime.com",
  "biddetail.com",
  "tendernews.com",
  "techtarget.com",
  "budde.com.au",
  "expertmarketresearch.com",
  "telcomagazine.com",
  "meter.com",
  "graphiteconnect.com",
  "made-in-china.com",
  "tradewheel.com",
  "alibaba.com",
  "accio.com"
];

const displayMacroMarkets = new Set([
  "global",
  "worldwide",
  "all countries",
  "all markets",
  "middle east",
  "gcc",
  "europe",
  "africa",
  "latin america",
  "latam",
  "americas",
  "asia",
  "north america",
  "south america"
]);

const countryAcronyms = new Set(["UAE", "USA", "UK", "US", "EU"]);

const countryDisplayAliases = new Map<string, string>([
  ["UNITED STATES OF AMERICA", "United States"],
  ["UNITED STATES", "United States"],
  ["UNITED KINGDOM", "United Kingdom"],
  ["GREAT BRITAIN", "United Kingdom"],
  ["BRITAIN", "United Kingdom"]
]);

const countryLowercaseWords = new Set(["and", "of", "the"]);

const phoneCountryCodes: Array<[string, string]> = [
  ["971", "UAE"],
  ["966", "Saudi Arabia"],
  ["974", "Qatar"],
  ["968", "Oman"],
  ["965", "Kuwait"],
  ["973", "Bahrain"],
  ["44", "United Kingdom"],
  ["55", "Brazil"],
  ["61", "Australia"],
  ["1", "United States"],
  ["49", "Germany"],
  ["33", "France"],
  ["39", "Italy"],
  ["34", "Spain"],
  ["48", "Poland"],
  ["234", "Nigeria"],
  ["27", "South Africa"],
  ["254", "Kenya"],
  ["20", "Egypt"],
  ["212", "Morocco"],
  ["233", "Ghana"],
  ["91", "India"],
  ["63", "Philippines"],
  ["62", "Indonesia"],
  ["60", "Malaysia"],
  ["65", "Singapore"],
  ["66", "Thailand"],
  ["84", "Vietnam"],
  ["52", "Mexico"],
  ["57", "Colombia"],
  ["56", "Chile"],
  ["51", "Peru"],
  ["90", "Turkey"],
  ["7", "Russia"]
];

const domainCountrySuffixes: Array<[string, string]> = [
  [".com.au", "Australia"],
  [".co.uk", "United Kingdom"],
  [".ae", "UAE"],
  [".sa", "Saudi Arabia"],
  [".qa", "Qatar"],
  [".om", "Oman"],
  [".kw", "Kuwait"],
  [".bh", "Bahrain"],
  [".br", "Brazil"],
  [".au", "Australia"],
  [".ca", "Canada"],
  [".uk", "United Kingdom"],
  [".de", "Germany"],
  [".fr", "France"],
  [".it", "Italy"],
  [".es", "Spain"],
  [".pl", "Poland"],
  [".ng", "Nigeria"],
  [".za", "South Africa"],
  [".ke", "Kenya"],
  [".eg", "Egypt"],
  [".ma", "Morocco"],
  [".gh", "Ghana"],
  [".in", "India"],
  [".ph", "Philippines"],
  [".id", "Indonesia"],
  [".my", "Malaysia"],
  [".sg", "Singapore"],
  [".th", "Thailand"],
  [".vn", "Vietnam"],
  [".mx", "Mexico"],
  [".tr", "Turkey"],
  [".ru", "Russia"]
];

const socialProfileLabels: Record<string, string> = {
  linkedin: "LinkedIn",
  x: "X",
  facebook: "Facebook",
  instagram: "Instagram",
  whatsapp: "WhatsApp"
};

const socialProfileOrder = ["linkedin", "x", "facebook", "instagram", "whatsapp"];

function displayLeadStage(lead: LeadCandidate) {
  if (hasSentEmail(lead)) {
    return "已触达";
  }
  if (lead.crmLead) {
    return "已同步 CRM";
  }
  if (lead.status === "intelligence" || lead.status === "intelligence_review") {
    return "采购情报待复核";
  }
  if (lead.status === "evidence_review") {
    return "证据待复核";
  }
  // 2026-05: country verification was downgraded to a soft tag. Keep
  // the legacy needs_country_review / country_conflict_review labels
  // for historical rows; for new rows we surface a single "国家待补充"
  // tag whenever country confidence is missing.
  if (lead.status === "needs_country_review") {
    return "待国家复核";
  }
  if (lead.status === "country_conflict_review") {
    return "国家冲突复核";
  }
  if (
    isMainLeadStatus(lead.status) &&
    (lead.countryConfidence === "low" ||
      lead.countryConfidence === "unknown" ||
      lead.countryConflict)
  ) {
    return "国家待补充";
  }
  if (lead.status === "approved") {
    return "已进入开发信";
  }
  if (lead.status === "contacted") {
    return "已触达";
  }

  return "待触达";
}

function hasSentEmail(lead: LeadCandidate) {
  return (
    lead.outreachDrafts?.some((draft) =>
      draft.sendLogs?.some(
        (log) => Boolean(log.sentAt) || ["sent", "delivered"].includes(log.status)
      )
    ) ?? false
  );
}

function pendingFollowups(lead: LeadCandidate) {
  return lead.followupTasks?.filter((task) => task.status === "pending") ?? [];
}

function formatMailSuccessDetail(result: MailSendResult) {
  const totalCount = result.totalCount ?? result.successCount ?? 1;
  const successCount = result.successCount ?? totalCount;
  const actionText = result.scheduled ? "已安排发送" : "已成功发送";
  return totalCount > 1
    ? `${actionText} ${successCount}/${totalCount} 位收件人。`
    : `${actionText} 1 位收件人。`;
}

function formatMailSentStatus(result: MailSendResult) {
  const totalCount = result.totalCount ?? result.successCount ?? 1;
  const successCount = result.successCount ?? totalCount;
  const sentText = totalCount > 1 ? `${successCount}/${totalCount} 位收件人` : "1 位收件人";
  const actionText = result.scheduled ? "已安排 Gmail 定时发送" : "邮件已通过 Gmail 发送";

  return `${actionText}给 ${sentText}。`;
}

type IcpReasonPayload = {
  reasons?: unknown;
  risks?: unknown;
  summary?: unknown;
  sourceQuery?: unknown;
  leadType?: unknown;
  intelligenceType?: unknown;
  reviewLabels?: unknown;
  extractableCompanies?: unknown;
  aiEvaluation?: {
    resultType?: unknown;
    buyerType?: unknown;
    matchedSignals?: unknown;
  } | null;
};

function buildCustomerBrief(lead: LeadCandidate) {
  const evidenceBrief = evidenceBriefFromPayload(
    lead.status,
    icpReasonPayload(lead.icpScore?.reasons)
  );
  if (evidenceBrief) return evidenceBrief;

  if (lead.status === "intelligence" || lead.status === "intelligence_review") {
    return "采购情报线索";
  }
  if (lead.status === "evidence_review") {
    return "证据待复核";
  }
  if (lead.status === "needs_country_review") {
    return "待国家复核";
  }
  if (lead.status === "country_conflict_review") {
    return "国家冲突复核";
  }
  const payload = icpReasonPayload(lead.icpScore?.reasons);
  const aiBrief = customerBriefFromAi(payload?.aiEvaluation);
  if (aiBrief) return aiBrief;

  const reasonText = firstIcpReason(lead.icpScore?.reasons);
  const summary = typeof payload?.summary === "string" ? payload.summary : "";
  const matchedSignals = Array.isArray(payload?.aiEvaluation?.matchedSignals)
    ? payload.aiEvaluation.matchedSignals.filter(
        (value): value is string => typeof value === "string"
      )
    : [];
  const text = [
    lead.companyName,
    lead.website,
    lead.sourceUrl,
    summary,
    reasonText,
    ...matchedSignals
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    containsAny(text, [
      "rfq",
      "request for quotation",
      "tender",
      "procurement",
      "vendor registration",
      "supplier registration"
    ])
  ) {
    return "采购/RFQ 线索";
  }
  if (
    containsAny(text, ["factory", "industrial", "machine", "equipment", "component", "parts"]) &&
    !containsAny(text, ["telecom", "base station", "fiber", "olt", "sfp", "tower", "isp", "wisp"])
  ) {
    return "行业设备客户";
  }
  if (
    containsAny(text, ["telecom power", "rectifier", "dc power", "power system", "cell site power"])
  ) {
    return "电源/模块维护客户";
  }
  if (
    containsAny(text, [
      "ftth",
      "olt",
      "fiber network",
      "optical transport",
      "transmission network",
      "sfp"
    ])
  ) {
    return "光纤/FTTH 运维客户";
  }
  if (containsAny(text, ["tower maintenance", "towerco", "cell tower", "site maintenance"])) {
    return "铁塔/站点维护客户";
  }
  if (
    containsAny(text, [
      "base station",
      "ran maintenance",
      "bts",
      "radio access network",
      "field maintenance"
    ])
  ) {
    return "基站/RAN 维护客户";
  }
  if (
    containsAny(text, [
      "mobile network operator",
      "telecom operator",
      "network operator",
      "isp",
      "wisp"
    ])
  ) {
    return "运营商/ISP 客户";
  }
  if (
    containsAny(text, [
      "system integrator",
      "integrator",
      "network contractor",
      "infrastructure contractor",
      "engineering contractor"
    ])
  ) {
    return "工程/系统集成客户";
  }
  if (containsAny(text, ["repair", "maintenance service", "field service"])) {
    return "维修维护服务客户";
  }
  if (containsAny(text, ["supplier", "distributor", "reseller", "stockist", "wholesale"])) {
    return "渠道商待复核";
  }
  if (containsAny(text, ["contact page", "official", "company website"])) {
    return "官网线索";
  }

  return "潜在客户线索";
}

function evidenceBriefFromPayload(status: string | undefined, payload: IcpReasonPayload | null) {
  const leadType = typeof payload?.leadType === "string" ? payload.leadType : "";
  const intelligenceType =
    typeof payload?.intelligenceType === "string" ? payload.intelligenceType : "";
  const extractableCompanies = Array.isArray(payload?.extractableCompanies)
    ? payload.extractableCompanies.filter((value): value is string => typeof value === "string")
    : [];
  const suffix = extractableCompanies.length ? " \u00b7 \u53ef\u63d0\u53d6\u5ba2\u6237" : "";

  if (leadType === "content_evidence") {
    return "\u5185\u5bb9\u8bc1\u636e";
  }
  if (leadType === "government_information") {
    return "\u653f\u5e9c\u4fe1\u606f\u7ebf\u7d22";
  }
  if (
    leadType === "intelligence" ||
    status === "intelligence" ||
    status === "intelligence_review"
  ) {
    if (intelligenceType === "government_tender") {
      return "\u653f\u5e9c\u62db\u6807\u60c5\u62a5" + suffix;
    }
    if (intelligenceType === "rfq_notice") {
      return "\u91c7\u8d2d\u516c\u544a/RFQ" + suffix;
    }
    if (intelligenceType === "exhibition_pdf") {
      return "\u5c55\u4f1a\u540d\u5f55/PDF\u540d\u5355" + suffix;
    }
    if (intelligenceType === "project_news") {
      return "\u9879\u76ee\u65b0\u95fb\u60c5\u62a5" + suffix;
    }
    if (intelligenceType === "company_directory") {
      return "\u540d\u5f55\u60c5\u62a5/\u53ef\u63d0\u53d6\u5ba2\u6237";
    }
    if (intelligenceType === "decision_maker_profile") {
      return "LinkedIn 决策人情报" + suffix;
    }
    if (intelligenceType === "buyer_directory") {
      return "B2B 买家情报" + suffix;
    }
    if (intelligenceType === "operator_vendor_registration") {
      return "运营商供应商入口";
    }
    return "\u60c5\u62a5\u7ebf\u7d22" + suffix;
  }
  if (status === "evidence_review") {
    return "\u8bc1\u636e\u5f85\u590d\u6838";
  }

  return "";
}

function customerBriefFromAi(aiEvaluation: IcpReasonPayload["aiEvaluation"]) {
  if (!aiEvaluation) return "";

  const resultType = typeof aiEvaluation.resultType === "string" ? aiEvaluation.resultType : "";
  const buyerType =
    typeof aiEvaluation.buyerType === "string" ? aiEvaluation.buyerType.toLowerCase() : "";

  if (
    ["directory", "content_article", "job_page", "market_report", "irrelevant"].includes(resultType)
  ) {
    return "资料页待复核";
  }
  if (resultType === "procurement_intelligence") {
    return "采购情报线索";
  }
  if (resultType === "supplier_or_competitor") {
    return "供应商/竞品待复核";
  }
  if (containsAny(buyerType, ["procurement", "rfq", "tender", "buyer"])) return "采购/RFQ 线索";
  if (containsAny(buyerType, ["power", "rectifier"])) return "电源/模块维护客户";
  if (containsAny(buyerType, ["ftth", "fiber", "optical", "olt", "sfp"]))
    return "光纤/FTTH 运维客户";
  if (containsAny(buyerType, ["tower", "towerco"])) return "铁塔/站点维护客户";
  if (containsAny(buyerType, ["base station", "ran", "bts", "field service"]))
    return "基站/RAN 维护客户";
  if (containsAny(buyerType, ["operator", "isp", "wisp"])) return "运营商/ISP 客户";
  if (containsAny(buyerType, ["integrator", "contractor", "engineering"]))
    return "工程/系统集成客户";
  if (containsAny(buyerType, ["maintenance", "repair", "service"])) return "维修维护服务客户";
  if (containsAny(buyerType, ["supplier", "distributor", "reseller", "stockist", "wholesale"]))
    return "渠道商待复核";
  if (resultType === "target_buyer") return "目标买家客户";
  if (resultType === "possible_buyer") return "潜在买家客户";

  return "";
}

function icpReasonPayload(reasons: unknown): IcpReasonPayload | null {
  return reasons && typeof reasons === "object" ? (reasons as IcpReasonPayload) : null;
}

function firstIcpReason(reasons: unknown) {
  const payload = icpReasonPayload(reasons);
  if (!payload) {
    return "";
  }

  const list = payload.reasons;
  return Array.isArray(list) && typeof list[0] === "string" ? list[0] : "";
}

function buildCrmRows(displayLeads: DisplayLead[], ownerName = "当前账号"): CrmRow[] {
  return displayLeads.map((lead) => ({
    ...lead,
    industry: lead.tag,
    owner: ownerName
  }));
}

function toMailLead(lead: DisplayLead): MailConfirmationLead {
  return {
    id: lead.id,
    companyName: lead.companyName,
    country: lead.country,
    website: lead.website,
    email: lead.email === "-" ? `sales@${lead.website.replace(/^www\./, "")}` : lead.email,
    score: lead.score
  };
}

function formatWebsite(value: string | null | undefined) {
  if (!value) return "-";

  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/\/$/, "") || "-";
  }
}

function formatSourceLinkLabel(value: string | null | undefined) {
  if (!value) return "-";

  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname.replace(/\/$/, "");
    if (!path || path === "/") {
      return host;
    }

    const joined = `${host}${path}`;
    return joined.length > 42 ? `${joined.slice(0, 39)}...` : joined;
  } catch {
    return formatWebsite(value);
  }
}

function formatDisplayCountry(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "-") return "";

  const upper = trimmed.toUpperCase();
  if (countryAcronyms.has(upper)) return upper;
  return titleCaseCountry(countryDisplayAliases.get(upper) ?? trimmed);
}

function inferCountryFromLeadContacts(contacts: LeadContact[] | undefined) {
  const countries = unique(
    (contacts ?? [])
      .map((contact) => inferCountryFromContactValue(contact.value, contact.type))
      .filter((value): value is string => Boolean(value))
  );

  return countries.length === 1 ? (countries[0] ?? "") : "";
}

function inferCountryFromContactValue(value: string, type: string) {
  if (type === "phone") {
    return inferCountryFromPhoneValue(value);
  }

  return inferCountryFromDomainValue(value);
}

function inferCountryFromPhoneValue(phone: string) {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  const internationalDigits = trimmed.startsWith("+")
    ? digits
    : digits.startsWith("00")
      ? digits.slice(2)
      : "";

  if (internationalDigits) {
    const match = phoneCountryCodes.find(([code]) => internationalDigits.startsWith(code));
    return match?.[1] ?? "";
  }

  if (!digits.startsWith("0") && /^\(?[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}$/.test(trimmed)) {
    return "United States";
  }

  return "";
}

function inferCountryFromDomainValue(value: string) {
  const host = hostFromContactValue(value);
  if (!host) return "";

  const match = domainCountrySuffixes.find(
    ([suffix]) => host === suffix.slice(1) || host.endsWith(suffix)
  );
  return match?.[1] ?? "";
}

function hostFromContactValue(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";

  if (trimmed.includes("@") && !trimmed.startsWith("http")) {
    return (
      trimmed
        .split("@")
        .pop()
        ?.replace(/[),.;:]+$/g, "") ?? ""
    );
  }

  try {
    return new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`).hostname.replace(
      /^www\./,
      ""
    );
  } catch {
    return "";
  }
}

function titleCaseCountry(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((part) =>
      countryLowercaseWords.has(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join(" ");
}

function formatSocialProfiles(values: string[] | undefined) {
  const profiles: Array<{ key: string; label: string }> = [];

  for (const value of values ?? []) {
    const key = socialProfileKey(value);
    if (!key || profiles.some((profile) => profile.key === key)) continue;
    profiles.push({ key, label: socialProfileLabels[key] ?? formatWebsite(value) });
  }

  return profiles
    .sort((left, right) => socialProfilePriority(left.key) - socialProfilePriority(right.key))
    .slice(0, 2)
    .map((profile) => profile.label)
    .join(" ; ");
}

function socialProfileKey(value: string) {
  const host = hostFromContactValue(value);
  if (!host) return "";

  if (host.includes("linkedin.com")) return "linkedin";
  if (host.includes("twitter.com") || host.includes("x.com")) return "x";
  if (host.includes("facebook.com")) return "facebook";
  if (host.includes("instagram.com")) return "instagram";
  if (host.includes("wa.me") || host.includes("whatsapp.com")) return "whatsapp";
  return host;
}

function socialProfilePriority(key: string) {
  const priority = socialProfileOrder.indexOf(key);
  return priority === -1 ? socialProfileOrder.length : priority;
}

function formatPhoneContacts(values: string[] | undefined) {
  return dedupeDisplayPhones(unique(values ?? []).filter(isDisplayPhoneValue))
    .slice(0, 4)
    .join(" ; ");
}

function dedupeDisplayPhones(values: string[]) {
  const internationalKeys = values.map(internationalPhoneKey).filter(Boolean);
  const seen = new Set<string>();
  const phones: string[] = [];

  for (const value of values) {
    const key = phoneDisplayKey(value, internationalKeys);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    phones.push(value);
  }

  return phones;
}

function phoneDisplayKey(value: string, internationalKeys: string[]) {
  const trimmed = value.trim();
  const digits = digitsOnly(trimmed);
  const internationalKey = internationalPhoneKey(trimmed);
  if (internationalKey) {
    return internationalKey;
  }

  if (digits.startsWith("0") && digits.length >= 9) {
    const localDigits = digits.slice(1);
    const matchingInternational = internationalKeys.find((key) => key.endsWith(localDigits));
    if (matchingInternational) {
      return matchingInternational;
    }
  }

  return digits;
}

function internationalPhoneKey(value: string) {
  const trimmed = value.trim();
  const digits = digitsOnly(trimmed);
  if (trimmed.startsWith("+")) return digits;
  if (trimmed.startsWith("00")) return digits.slice(2);
  return "";
}

function isDisplayPhoneValue(value: string) {
  const trimmed = value.trim();
  const digits = digitsOnly(trimmed);
  if (digits.length < 8 || digits.length > 16) return false;
  if (trimmed.startsWith("00") && digits.startsWith("000")) return false;
  if (hasRepeatedPhoneChunk(trimmed)) return false;
  if (/^\d{3}[-/.]\d{4}[-/.]\d{3}$/.test(trimmed)) return false;
  if (/^\d{2,4}\s+\d{9,}$/.test(trimmed)) return false;

  return (
    trimmed.startsWith("+") ||
    trimmed.startsWith("00") ||
    /^\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}$/.test(trimmed) ||
    /^0\d{2,4}[\s.-]\d{3}[\s.-]\d{4}$/.test(trimmed) ||
    /^0\d{2,5}[\s.-]\d{5,9}$/.test(trimmed)
  );
}

function hasRepeatedPhoneChunk(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const chunks = normalized.split(" ");
  return (
    chunks.length > 1 &&
    chunks.some(
      (chunk, index) => chunks.indexOf(chunk) !== index && chunk.replace(/\D/g, "").length >= 4
    )
  );
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function formatEmailContacts(values: string[] | undefined, companyUrl?: string | null) {
  const companyDomain = domainFromUrl(companyUrl);
  return unique(values ?? [])
    .sort(
      (left, right) =>
        emailContactPriority(left, companyDomain) - emailContactPriority(right, companyDomain)
    )
    .slice(0, 1)
    .join(" ; ");
}

function emailContactPriority(value: string, companyDomain?: string) {
  const [localPart = "", emailDomain = ""] = value.toLowerCase().split("@");
  const priorityTerms = ["sales", "info", "contact", "enquiries", "enquiry", "support", "office"];
  const index = priorityTerms.findIndex(
    (term) => localPart === term || localPart.startsWith(`${term}.`)
  );
  const sameDomain = companyDomain && domainsMatch(emailDomain, companyDomain) ? 0 : 20;
  return sameDomain + (index === -1 ? priorityTerms.length : index);
}

function domainsMatch(emailDomain: string, companyDomain: string) {
  const normalizedEmailDomain = emailDomain.replace(/^www\./, "");
  const normalizedCompanyDomain = companyDomain.replace(/^www\./, "");
  return (
    normalizedEmailDomain === normalizedCompanyDomain ||
    normalizedEmailDomain.endsWith(`.${normalizedCompanyDomain}`)
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function countDistinct(values: string[]) {
  return new Set(values.filter((value) => value && value !== "-")).size;
}
