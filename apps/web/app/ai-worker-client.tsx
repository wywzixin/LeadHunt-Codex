"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
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
  TrendingUp,
  Users,
  UsersRound,
  X
} from "lucide-react";
import { AppShell } from "./app-shell";
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
const crmPageSize = 3;
const taskPollIntervalMs = 2500;
const maxTaskPollAttempts = 720;

type ViewState = "workbench" | "pool" | "conversation";
type StepState = "done" | "active" | "pending" | "failed";

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

export function AiWorkerClient() {
  const [mailOpen, setMailOpen] = useState(false);
  const [crmOpen, setCrmOpen] = useState(false);
  const [crmPage, setCrmPage] = useState(1);
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
  const [historyLoading, setHistoryLoading] = useState(false);
  const [currentTask, setCurrentTask] = useState<LeadTask | null>(null);
  const [searchResult, setSearchResult] = useState<SearchRunResult | null>(null);
  const [creating, setCreating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [approving, setApproving] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [mailLead, setMailLead] = useState<MailConfirmationLead | null>(null);

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
      actionableDisplayLeads.reduce(
        (total, lead) => total + pendingFollowups(lead.raw).length,
        0
      ),
    [actionableDisplayLeads]
  );
  // sentCount and leadQualityCounts kept for the CRM/mail dialogs and
  // status messages that still consume them; the search-in-progress JSX
  // no longer uses them directly. Touch them here so eslint's no-unused
  // rule stays happy.
  void sentCount;
  void summarizeLeadQualityCounts;
  const crmRows = useMemo(() => buildCrmRows(actionableDisplayLeads), [actionableDisplayLeads]);
  const crmPageCount = Math.max(1, Math.ceil(crmRows.length / crmPageSize));
  const crmPageRows = crmRows.slice((crmPage - 1) * crmPageSize, crmPage * crmPageSize);
  const selectedDisplayLead =
    displayLeads.find((lead) => lead.id === selectedLeadId) ?? displayLeads[0] ?? null;
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

  async function loadTaskHistory(query?: string) {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams();
      if (query?.trim()) params.set("search", query.trim());
      params.set("limit", "30");
      const url = `/api/lead-tasks?${params.toString()}`;
      const payload = await apiRequest<LeadTaskListResponse>(url);
      setTaskHistory(payload.tasks);
    } catch {
      setTaskHistory([]);
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
    setView("pool");
    setStatus("正在加载客户池...");
    setError("");
    setMailLead(null);
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
    setError("");
    setStatus("已发起新一批搜索，正在等待后端 LLM 规划与 Brave 调用...");

    // Fire-and-forget the workflow trigger. The endpoint blocks until
    // the LangGraph batch finishes, so the polling effect will keep
    // updating the page once currentTask flips to running.
    void apiRequest(`/api/lead-tasks/${taskId}/search`, {
      method: "POST",
      body: JSON.stringify({ limit: 30 })
    }).catch((requestError) => {
      // We don't fail the page on a search-trigger error — the polling
      // loop will surface failed steps as they arrive. Log to status
      // so the user sees the upstream cause.
      setError(errorMessage(requestError));
      setStatus("发起搜索失败，可在状态恢复后重试。");
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

  async function approveSelectedLead() {
    const lead = selectedDisplayLead;
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

    if (!currentTask) {
      setMailLead({ ...localMailLead, id: undefined });
      setStatus("已打开邮件确认弹窗；当前没有可关联的后端任务，先使用候选客户信息预填草稿。");
      return;
    }

    setApproving(true);
    setError("");
    setStatus(`已打开 ${lead.companyName} 的邮件确认弹窗，正在后台生成开发信草稿...`);

    try {
      const result = await apiRequest<ApprovalResult>(`/api/lead-tasks/${currentTask.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ leadIds: [lead.id] })
      });
      const refreshed = await refreshTask(currentTask.id);
      const approvedLead =
        refreshed.leadCandidates?.find((candidate) => candidate.id === result.approvedLeadIds[0]) ??
        lead.raw;
      const modalCandidate = buildDisplayLead(approvedLead);
      setSelectedLeadId(approvedLead.id);
      setMailLead(toMailLead(modalCandidate));
      setMailOpen(true);
      // 2026-05 Stage 3 follow-up: refresh task history so the
      // workbench KPI strip (待同步 CRM, 邮件待确认) reflects the
      // approve immediately, even when a single-lead approval
      // happens via the conversation/mail flow.
      void loadTaskHistory(taskSearch);
      setStatus(
        `已审批 ${result.approvedCount} 家客户，并生成 ${result.draftCount} 封开发信草稿。`
      );
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      setMailLead({ ...localMailLead, id: undefined });
      setStatus(
        isMissingLeadTaskError(message)
          ? "当前页面的任务不属于当前登录账号或已失效；已先打开本地邮件确认弹窗。重新创建任务后可走完整草稿与 CRM 链路。"
          : "开发信草稿接口失败；已先打开邮件确认弹窗，可检查收件人和正文后再处理。"
      );
    } finally {
      setApproving(false);
    }
  }

  // 2026-05 Stage 2: bulk approve from the pool detail page. Posts
  // every selected leadId to the existing /approve endpoint so the
  // backend builds CRM rows + email drafts for them, then refreshes
  // the task so the UI reflects the new crmLead/draft entries.
  async function approveSelectedLeads(taskId: string, leadIds: string[]) {
    if (!leadIds.length) return;
    setApproving(true);
    setError("");
    setStatus(`正在批量加入 CRM：已选择 ${leadIds.length} 家客户...`);

    try {
      const result = await apiRequest<ApprovalResult>(`/api/lead-tasks/${taskId}/approve`, {
        method: "POST",
        body: JSON.stringify({ leadIds })
      });
      await refreshTask(taskId).catch(() => undefined);
      // 2026-05 Stage 3 follow-up: refresh task history so the
      // workbench KPI strip (待同步 CRM, 邮件待确认) reflects the
      // approve immediately. Without this, returning to the workbench
      // shows the cached pre-approve counters until the next mount.
      void loadTaskHistory(taskSearch);
      setStatus(
        `已加入 CRM ${result.approvedCount} 家客户，并生成 ${result.draftCount} 封开发信草稿。`
      );
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      setStatus(
        isMissingLeadTaskError(message)
          ? "当前任务不属于当前登录账号或已失效，批量加入 CRM 已取消。"
          : "批量加入 CRM 失败；可重试或先单条审批。"
      );
    } finally {
      setApproving(false);
    }
  }

  function submitLanding() {
    void startLeadTask(landingPrompt);
  }

  function backToLanding() {
    setView("workbench");
    setStatus(currentTask ? "任务已保留，可确认客户或重新执行搜索" : "等待分配任务");
  }

  function openCrmPreview() {
    setCrmPage(1);
    setCrmOpen(true);
    setStatus(crmRows.length ? "已打开 CRM 同步预览。" : "当前暂无可同步主客户，CRM 预览为空。");
  }

  function changeCrmPage(nextPage: number) {
    setCrmPage(Math.min(Math.max(nextPage, 1), crmPageCount));
  }

  async function handleMailSent(result: MailSendResult) {
    if (currentTask) {
      await refreshTask(currentTask.id).catch(() => undefined);
    }
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
              historyLoading={historyLoading}
              onSelectHistoryTask={openPoolFromHistory}
              onRefreshHistory={() => void loadTaskHistory(taskSearch)}
              onContinueSearch={(taskId) => {
                // Active pool card "继续搜索 30 条" — load the task's
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
              taskHistoryItem={
                taskHistory.find((task) => task.id === currentTask?.id) ?? null
              }
              leads={displayLeads}
              approving={approving}
              onBack={() => setView("workbench")}
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
              onOpenMail={() => void approveSelectedLead()}
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
                <div>
                  <span>CRM 数据</span>
                  <h2 id="crm-data-title">本次同步客户</h2>
                </div>
                <button
                  className="crmDataClose"
                  type="button"
                  aria-label="关闭 CRM 数据弹窗"
                  onClick={() => setCrmOpen(false)}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </header>

              <div className="crmDataSummary">
                <div>
                  <strong>{crmRows.length}</strong>
                  <span>客户</span>
                </div>
                <div>
                  <strong>{countDistinct(crmRows.map((row) => row.country))}</strong>
                  <span>国家 / 地区</span>
                </div>
                <div>
                  <strong>{averageScore(crmRows)}</strong>
                  <span>平均 ICP</span>
                </div>
                <div>
                  <strong>王亚伟</strong>
                  <span>默认负责人</span>
                </div>
              </div>

              <div className="crmDataTableWrap">
                <table className="crmDataTable">
                  <thead>
                    <tr>
                      <th>公司名称</th>
                      <th>国家</th>
                      <th>行业</th>
                      <th>电话</th>
                      <th>邮箱</th>
                      <th>数据来源</th>
                      <th>客户简述</th>
                      <th>客户阶段</th>
                      <th>负责人</th>
                      <th>评分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {crmPageRows.length ? (
                      crmPageRows.map((row) => (
                        <tr key={row.id}>
                          <td className="leadCompanyCell">{row.companyName}</td>
                          <td>{row.country}</td>
                          <td>{row.industry}</td>
                          <td>{row.phone}</td>
                          <td>{row.email}</td>
                          <td>{row.source}</td>
                          <td>{row.tag}</td>
                          <td>
                            <span className="crmStageTag">{row.stage}</span>
                          </td>
                          <td>{row.owner}</td>
                          <td>
                            <b className="crmScore">{row.score}</b>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={10}>
                          暂无可同步客户，先执行 AI 搜索后会在这里预览 CRM 字段。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <footer className="crmDataFooter">
                <span>
                  第 {crmPage} / {crmPageCount} 页，已整理 {crmRows.length} 条同步记录
                </span>
                <div className="crmDataPager">
                  <button
                    type="button"
                    aria-label="上一页"
                    disabled={crmPage === 1}
                    onClick={() => changeCrmPage(crmPage - 1)}
                  >
                    <ChevronLeft size={18} aria-hidden="true" />
                  </button>
                  {Array.from({ length: crmPageCount }, (_, index) => index + 1).map((page) => (
                    <button
                      className={page === crmPage ? "active" : ""}
                      type="button"
                      key={page}
                      onClick={() => changeCrmPage(page)}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label="下一页"
                    disabled={crmPage === crmPageCount}
                    onClick={() => changeCrmPage(crmPage + 1)}
                  >
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                </div>
              </footer>
            </section>
          </div>
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
  onSubmit: () => void;
  submitting: boolean;
  taskHistory: LeadTaskListItem[];
  historyLoading: boolean;
  onSelectHistoryTask: (taskId: string) => void;
  onRefreshHistory: () => void;
  onContinueSearch?: (taskId: string) => void;
};

type WorkbenchKpi = {
  label: string;
  value: string | number;
  delta?: string;
  icon: typeof Users;
  tone: "blue" | "green" | "purple" | "indigo" | "orange";
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
  leadCount: number;
  weekDelta: number;
  detail: string;
  primaryActionLabel: string;
  icon: typeof Globe2;
  tone: "blue" | "green" | "orange";
};

function AiWorkerWorkbench({
  prompt,
  onPromptChange,
  onSubmit,
  submitting,
  taskHistory,
  historyLoading,
  onSelectHistoryTask,
  onRefreshHistory,
  onContinueSearch
}: WorkbenchProps) {
  const greeting = useMemo(() => buildGreeting(), []);
  const trackingPoolCount = taskHistory.length;

  // 2026-05 Stage 3 workbench KPI aggregation. All counters read ONLY
  // from real taskHistory fields; nothing is estimated, and any field
  // we don't actually have falls through to 0 with no fake delta.
  //
  // 今日新增: sum of leadCount for tasks created today. Uses createdAt
  // (not updatedAt) so a task that re-runs tomorrow still counts under
  // its original creation day instead of jumping back into "今日".
  const todayLeadCount = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return taskHistory
      .filter((task) => {
        const created = new Date(task.createdAt).getTime();
        return Number.isFinite(created) && created >= startOfDay.getTime();
      })
      .reduce((sum, task) => sum + (task.leadCount ?? 0), 0);
  }, [taskHistory]);

  // 待同步 CRM: sum of pendingCrmCount across every tracked task — any
  // candidate in main pool (review/qualified) that hasn't been
  // approved into a CRM row yet. Backend list endpoint computes this
  // SQL-side; we just add up the per-task counter.
  const pendingCrmAcrossPools = useMemo(
    () => taskHistory.reduce((sum, task) => sum + (task.pendingCrmCount ?? 0), 0),
    [taskHistory]
  );

  // 邮件待确认: sum of pendingEmailCount — leads with at least one
  // outreach draft in 'draft' status and no successful send_log yet.
  const pendingEmailAcrossPools = useMemo(
    () => taskHistory.reduce((sum, task) => sum + (task.pendingEmailCount ?? 0), 0),
    [taskHistory]
  );

  // Reset scroll on mount so the greeting is always visible when the
  // workbench appears (e.g. returning from the pool detail page).
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollHostRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  // KPI cards. Values come from real taskHistory aggregations; deltas
  // stay at "较上周 +0" because we don't have a trustworthy
  // week-over-week baseline yet (per Stage 3 spec — no estimation).
  const kpis: WorkbenchKpi[] = [
    {
      label: "客户池总数",
      value: taskHistory.length,
      delta: "较上周 +0",
      icon: Users,
      tone: "blue"
    },
    {
      label: "今日新增",
      value: todayLeadCount,
      delta: "较上周 +0",
      icon: TrendingUp,
      tone: "green"
    },
    {
      label: "待同步 CRM",
      value: pendingCrmAcrossPools,
      delta: "较上周 +0",
      icon: Database,
      tone: "indigo"
    },
    {
      label: "邮件待确认",
      value: pendingEmailAcrossPools,
      delta: "较上周 +0",
      icon: Mail,
      tone: "purple"
    },
    {
      label: "需跟进",
      value: 0,
      delta: "较上周 +0",
      icon: Bell,
      tone: "orange"
    }
  ];

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

  // Recent pools — derived from taskHistory. Map up to 3 most recent.
  // Pool naming and detail use the same logic as the pool detail page
  // so the workbench card and detail header read the same.
  const recentPools = useMemo<WorkbenchPoolCard[]>(() => {
    const tones: WorkbenchPoolCard["tone"][] = ["blue", "green", "orange"];
    // Pick an icon based on the pool prompt/title content. Falls back to a
    // generic Globe2 when nothing matches. This makes 5G pools render as
    // antennas, oil/industrial as factories, solar as suns, channel as
    // building, etc — same vocabulary as the design spec.
    const pickIcon = (text: string): WorkbenchPoolCard["icon"] => {
      const t = text.toLowerCase();
      if (/5g|telecom|base station|基站|通信|olt|sfp|fiber|光纤|isp|wisp|无线/.test(t)) return RadioTower;
      if (/油气|oil|gas|petro|industrial|工业|pump|valve|阀|压缩机|工厂/.test(t)) return Factory;
      if (/光伏|solar|pv|inverter|panel|组件|逆变器/.test(t)) return SunMedium;
      if (/经销|分销|代理|渠道|distributor|reseller|channel|wholesaler/.test(t)) return Building2;
      if (/email|mail|phone|联系|邮箱|电话/.test(t)) return Mail;
      return Globe2;
    };
    const slice = taskHistory.slice(0, 3);
    // Detect duplicate short titles within the visible 3 cards. When a
    // user runs the same prompt repeatedly the cards otherwise look
    // identical; append the run date so each card is distinguishable.
    const titleCounts = new Map<string, number>();
    for (const task of slice) {
      const t = summarizePoolTitle(task.title || task.prompt || "客户池");
      titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
    }
    return slice.map((task, index) => {
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
      const displayTitle = isDuplicateTitle && dateSuffix
        ? `${shortName} · ${dateSuffix}`
        : shortName;
      const isActive = status.kind === "active";
      // Build a richer business detail. Until backend exposes
      // weekly-new and high-match aggregates per pool, we surface
      // leadCount + queryCount + the most recent batch timestamp.
      const detail = isActive
        ? `${task.leadCount ?? 0} 家客户 · ${task.queryCount ?? 0} 条 query · 持续获客中`
        : `${task.leadCount ?? 0} 家客户 · ${task.queryCount ?? 0} 条 query · ${formatHistoryDate(task.updatedAt)}`;
      return {
        id: task.id,
        title: displayTitle,
        status: status.kind,
        statusLabel: status.label,
        leadCount: task.leadCount ?? 0,
        weekDelta: 0,
        detail,
        // 2026-05 LeadHunt 2.0: both primary and secondary buttons open
        // the pool detail page; the actual "继续搜索 30 条" trigger lives
        // on the pool detail header (where it calls runTaskSearch).
        // Keeping the workbench label honest until backend supports a
        // one-click incremental search from the workbench card.
        primaryActionLabel: "查看客户池",
        icon: pickIcon(`${task.title ?? ""} ${task.prompt ?? ""}`),
        tone: tones[index] ?? "blue"
      };
    });
  }, [taskHistory]);

  // Demo fallback when no history yet, so layout doesn't look empty.
  const poolCards: WorkbenchPoolCard[] = recentPools.length
    ? recentPools
    : [
        {
          id: "demo-1",
          title: "5G 通信设备客户池",
          status: "active",
          statusLabel: "持续获客中",
          leadCount: 328,
          weekDelta: 42,
          detail: "328 家客户 · 本周新增 42 · 第 3 批搜索中",
          primaryActionLabel: "查看客户池",
          icon: RadioTower,
          tone: "blue"
        },
        {
          id: "demo-2",
          title: "中东油气工业泵阀客户池",
          status: "completed",
          statusLabel: "已完成",
          leadCount: 96,
          weekDelta: 0,
          detail: "96 家客户 · 高匹配 18 · 待同步 CRM 7",
          primaryActionLabel: "查看客户池",
          icon: Factory,
          tone: "green"
        },
        {
          id: "demo-3",
          title: "巴西光伏安装商客户池",
          status: "pending",
          statusLabel: "待触达",
          leadCount: 74,
          weekDelta: 11,
          detail: "74 家客户 · 本周新增 11 · 邮件待确认 4",
          primaryActionLabel: "查看客户池",
          icon: SunMedium,
          tone: "orange"
        }
      ];

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim() || submitting) return;
    onSubmit();
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
            {greeting.title}，王亚伟 <span aria-hidden="true">{greeting.emoji}</span>
          </h1>
          <p>{greeting.subtitle}</p>
          <p className="aiWorkbenchTracker">
            <Sparkles size={14} aria-hidden="true" />
            AI 外贸员正在为你跟踪 {trackingPoolCount} 个客户池
          </p>
        </div>
      </header>

      {/* KPI cards */}
      <section className="aiWorkbenchKpis" aria-label="数据概览">
        {kpis.map((kpi) => (
          <article className={`aiWorkbenchKpi tone-${kpi.tone}`} key={kpi.label}>
            <span className="aiWorkbenchKpiIcon" aria-hidden="true">
              <kpi.icon size={20} />
            </span>
            <div className="aiWorkbenchKpiBody">
              <span className="aiWorkbenchKpiLabel">{kpi.label}</span>
              <strong className="aiWorkbenchKpiValue">{kpi.value}</strong>
              {kpi.delta ? <span className="aiWorkbenchKpiDelta">{kpi.delta}</span> : null}
            </div>
          </article>
        ))}
      </section>

      {/* Search input + quick actions */}
      <section className="aiWorkbenchSearch" aria-label="开始搜索">
        <h2 className="aiWorkbenchSectionTitle">你想继续找哪类客户？</h2>
        <form className="aiWorkbenchSearchForm" onSubmit={handleSubmit}>
          <textarea
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
      </section>

      {/* Recent pools */}
      <section className="aiWorkbenchPools" aria-label="最近客户池">
        <header className="aiWorkbenchSectionHeader">
          <h2 className="aiWorkbenchSectionTitle">最近客户池</h2>
        </header>
        <div className="aiWorkbenchPoolGrid">
          {poolCards.map((pool) => {
            const isActive = pool.status === "active";
            const isDemo = pool.id.startsWith("demo-");
            return (
              <article className={`aiWorkbenchPoolCard tone-${pool.tone}`} key={pool.id}>
                <span className="aiWorkbenchPoolIcon" aria-hidden="true">
                  <pool.icon size={22} />
                </span>
                <div className="aiWorkbenchPoolBody">
                  <header className="aiWorkbenchPoolHead">
                    <h3 className="aiWorkbenchPoolTitle" title={pool.title}>{pool.title}</h3>
                    <span className={`aiWorkbenchPoolBadge state-${pool.status}`}>
                      {pool.statusLabel}
                    </span>
                  </header>
                  <p className="aiWorkbenchPoolDetail">{pool.detail}</p>
                  <footer className="aiWorkbenchPoolFoot">
                    <button
                      type="button"
                      className="aiWorkbenchPoolPrimary"
                      onClick={() =>
                        isDemo
                          ? undefined
                          : isActive
                            ? onContinueSearch?.(pool.id)
                            : onSelectHistoryTask(pool.id)
                      }
                    >
                      {isActive ? <Play size={14} aria-hidden="true" /> : null}
                      {isActive ? "继续搜索 30 条" : "继续搜索"}
                    </button>
                    <button
                      type="button"
                      className="aiWorkbenchPoolSecondary"
                      onClick={() => (isDemo ? undefined : onSelectHistoryTask(pool.id))}
                    >
                      查看客户池
                    </button>
                  </footer>
                </div>
              </article>
            );
          })}
        </div>
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

function mapTaskStatusToPool(
  status: string
): { kind: WorkbenchPoolCard["status"]; label: string } {
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
  approving: boolean;
  onBack: () => void;
  onContinueSearch: () => void;
  onBulkApprove: (leadIds: string[]) => void;
};

type PoolKpi = {
  label: string;
  value: string | number;
  delta?: string;
  icon: typeof Users;
  tone: "blue" | "orange" | "teal" | "indigo" | "purple" | "rose" | "green";
};

type PoolFilterDropdown = {
  label: string;
  icon?: typeof Filter;
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
  hasPhone: boolean;
  phoneCount: number;
  website: string;
  sourceBatch: string;
  crmStatus: "pending" | "synced" | "active";
  crmStatusLabel: string;
  mailStatus: "未触达" | "待发送" | "已发送" | "已回复";
  lastAction: string;
};

function AiWorkerPool({
  task,
  taskHistoryItem,
  leads,
  approving,
  onBack,
  onContinueSearch,
  onBulkApprove
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

  // 2026-05 Stage 2: KPIs and the candidate table read ONLY from
  // currentTask.leadCandidates (via the displayLeads prop). When the
  // task hasn't loaded yet we render zeroes / placeholders rather
  // than synthesised demo numbers — those used to leak across into
  // production and made the page look fake.
  const totalLeads = leads.length;
  const queryCount = task?.searchQueries?.length ?? 0;
  const highMatch = useMemo(
    () => leads.filter((lead) => lead.score >= 80).length,
    [leads]
  );
  const withContact = useMemo(
    () => leads.filter((lead) => lead.email !== "—" || lead.phone !== "—").length,
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
      return drafts.some((draft) =>
        (draft.sendLogs ?? []).some((log) => log.status === "replied")
      );
    }).length;
    return replied;
  }, [leads]);
  const replyRate =
    emailReached > 0
      ? Math.round((repliedCount / emailReached) * 1000) / 10
      : 0;

  // Main vs review-tail counts. buildDisplayLeads already gives us a
  // sorted combined list (mainLeads first, reviewTail after), so we
  // recompute the split here for the "待复核 N 条" hint.
  const mainLeadCount = useMemo(
    () => leads.filter((lead) => lead.actionable).length,
    [leads]
  );
  const reviewTailCount = totalLeads - mainLeadCount;

  // 2026-05 Stage 2: when the backend returns evidence/intelligence
  // candidates that buildDisplayLeads filters out (content_evidence,
  // intelligence, hidden_evidence), the user sees fewer rows than the
  // raw API count. Surface the gap so they know we didn't lose data.
  const hiddenEvidenceCount = Math.max(
    0,
    (task?.leadCandidates?.length ?? 0) - totalLeads
  );

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

  // Filter dropdowns shown above the table.
  const filterDropdowns: PoolFilterDropdown[] = [
    { label: "国家/地区" },
    { label: "客户类型" },
    { label: "推荐指数" },
    { label: "联系方式" },
    { label: "CRM 状态" },
    { label: "邮件状态" },
    { label: "来源批次" },
    { label: "更新时间" }
  ];

  // 2026-05 Stage 2: header chips reflect the real target markets
  // for this task only. No fallback to UAE/Saudi/Qatar — that used to
  // read like a hardcoded sample whenever currentTask hadn't loaded.
  const countryChips = targetMarkets.slice(0, 6);

  // Local UI state. selection / search / page is purely local; the
  // data source is currentTask.leadCandidates via the leads prop.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Filter leads by the search input (company, country, website,
  // email, phone). Empty input means show everything.
  const filteredLeads = useMemo(() => {
    const needle = searchInput.trim().toLowerCase();
    if (!needle) return leads;
    return leads.filter((lead) => {
      const haystack = [
        lead.companyName,
        lead.country,
        lead.website,
        lead.email,
        lead.phone,
        lead.tag
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [leads, searchInput]);

  const filteredCount = filteredLeads.length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
  const safePage = Math.min(pageNumber, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, filteredCount);
  const pagedLeads = useMemo(
    () => filteredLeads.slice(pageStart, pageEnd),
    [filteredLeads, pageStart, pageEnd]
  );

  // Build table rows from the paged candidates. No demo fallback —
  // empty state shows a single row with a placeholder message.
  const rows: PoolTableRow[] = useMemo(
    () => pagedLeads.map((lead) => buildPoolTableRow(lead)),
    [pagedLeads]
  );

  const allChecked = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));

  // 2026-05 Stage 2: derived helper — only candidates not yet in CRM
  // are valid bulk-approve targets. Used to filter the current
  // selection so a user can't re-approve already-synced rows.
  const isPendingCrmCandidate = (lead: DisplayLead) => {
    const status = lead.raw.status ?? "";
    const inCrm =
      Boolean(lead.raw.crmLead) ||
      status === "approved" ||
      status === "contacted" ||
      status === "email_sent";
    return !inCrm;
  };

  // Drop selection ids that no longer exist in the candidate list (e.g.
  // after polling pulls a refreshed task) AND drop ids that have moved
  // out of the pending-CRM bucket — the bulk-approve button should
  // never claim "已选择 N 家" when those N have already been approved.
  useEffect(() => {
    setSelectedIds((current) => {
      const stillPending = new Set(
        leads.filter(isPendingCrmCandidate).map((lead) => lead.id)
      );
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
    const pendingIds = new Set(
      leads.filter(isPendingCrmCandidate).map((lead) => lead.id)
    );
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
              <span className={`aiPoolBadge state-${poolStatus.kind}`}>
                {poolStatus.label}
              </span>
            </div>
            <div className="aiPoolCountryChips">
              {countryChips.map((country) => (
                <span key={country} className="aiPoolCountryChip">
                  {country}
                </span>
              ))}
            </div>
            <p className="aiPoolMeta">
              {totalLeads > 0
                ? `本池 ${totalLeads} 家客户`
                : "本池暂无候选客户"}
              {queryCount > 0 ? `，本批跑了 ${queryCount} 条 query` : ""}
            </p>
          </div>
          <div className="aiPoolHeaderActions">
            <button
              type="button"
              className="aiPoolPrimaryBtn"
              onClick={onContinueSearch}
            >
              <Play size={14} aria-hidden="true" />
              继续搜索 30 条
            </button>
            <button
              type="button"
              className="aiPoolGhostBtn"
              disabled
              title="导出功能开发中"
            >
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

      {/* Filter bar */}
      <section className="aiPoolFilters" aria-label="筛选条件">
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
        {filterDropdowns.map((dropdown) => (
          <button key={dropdown.label} type="button" className="aiPoolFilterDropdown">
            {dropdown.label}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        ))}
        <button
          type="button"
          className="aiPoolFilterClear"
          onClick={() => {
            setSearchInput("");
            setPageNumber(1);
          }}
          disabled={!searchInput}
        >
          清空筛选
        </button>
      </section>

      {/* 2026-05 Stage 2: meta hint row replaces the old hardcoded
          "Saudi Arabia / 推荐指数 60+ / 有邮箱" chips. Now shows the
          real review-tail count and the batch query count, so users
          know where the difference between the API total and the
          main table comes from. */}
      {(reviewTailCount > 0 || queryCount > 0 || hiddenEvidenceCount > 0) ? (
        <div className="aiPoolSelectedChips">
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
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              aria-label="全选"
            />
            已选择 <strong>{selectedIds.size}</strong> 家客户
            {selectedPendingCount < selectedIds.size ? (
              <span
                className="aiPoolBulkSelectAllNote"
                title="已加入 CRM 的客户不会重复同步"
              >
                （其中 {selectedPendingCount} 家可加入 CRM）
              </span>
            ) : null}
          </label>
          <button
            type="button"
            className="aiPoolBulkAction primary"
            disabled={approving || selectedPendingCount === 0}
            title={
              selectedPendingCount === 0
                ? "已选客户都已加入 CRM，无需重复同步"
                : undefined
            }
            onClick={() => {
              const pendingIds = new Set(
                leads.filter(isPendingCrmCandidate).map((lead) => lead.id)
              );
              const targetIds = Array.from(selectedIds).filter((id) =>
                pendingIds.has(id)
              );
              if (targetIds.length === 0) return;
              onBulkApprove(targetIds);
              // Optimistically clear selection — refreshTask will land
              // and the cleanup effect would clear it shortly anyway,
              // but doing it eagerly avoids a half-second window where
              // the bulk bar still reads "已选 N 家".
              setSelectedIds(new Set());
            }}
          >
            <Database size={13} aria-hidden="true" />
            {approving
              ? "加入中..."
              : selectedPendingCount === 0
                ? "已加入 CRM"
                : selectedPendingCount < selectedIds.size
                  ? `加入 CRM（${selectedPendingCount}）`
                  : "加入 CRM"}
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
            className="aiPoolBulkAction"
            disabled
            title="标记无效功能开发中"
          >
            <X size={13} aria-hidden="true" />
            标记无效
          </button>
          <button
            type="button"
            className="aiPoolBulkAction"
            disabled
            title="导出选中功能开发中"
          >
            <Download size={13} aria-hidden="true" />
            导出选中
          </button>
        </div>
      ) : null}

      {/* Candidate table */}
      <section className="aiPoolTableWrap" aria-label="候选客户表">
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
                <th>公司名称</th>
                <th>国家/地区</th>
                <th>客户类型</th>
                <th className="col-score">推荐指数</th>
                <th>联系方式</th>
                <th>电话</th>
                <th>官网</th>
                <th>来源批次</th>
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
                  <td className="col-company">{row.companyName}</td>
                  <td>{row.country}</td>
                  <td>{row.industry}</td>
                  <td className="col-score">
                    <span className="aiPoolScoreStars" aria-hidden="true">
                      {renderStars(row.scoreStars)}
                    </span>
                    <span className="aiPoolScoreValue">{row.scoreValue}</span>
                  </td>
                  <td>
                    {row.hasEmail ? (
                      <span className="aiPoolContactBadge active">
                        <Mail size={11} aria-hidden="true" /> 邮箱 {row.emailCount}
                      </span>
                    ) : (
                      <span className="aiPoolContactBadge muted">— 邮箱 0</span>
                    )}
                  </td>
                  <td>
                    {row.hasPhone ? (
                      <span className="aiPoolContactBadge active">
                        <PhoneCall size={11} aria-hidden="true" /> 电话 {row.phoneCount}
                      </span>
                    ) : (
                      <span className="aiPoolContactBadge muted">电话 0</span>
                    )}
                  </td>
                  <td className="col-website">{row.website}</td>
                  <td>
                    <span className="aiPoolSourceBadge">{row.sourceBatch}</span>
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
                    <button type="button" className="aiPoolRowAction">
                      详情
                    </button>
                    <button type="button" className="aiPoolRowAction icon">
                      <MoreHorizontal size={14} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))
              ) : (
                <tr>
                  <td className="leadEmptyCell" colSpan={13}>
                    {searchInput
                      ? "没有匹配当前搜索条件的候选客户。"
                      : "暂无候选客户。回到搜索页继续搜索 30 条来扩充客户池。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

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

function percent(part: number, total: number): string {
  if (!total) return "—";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function buildPoolTableRow(lead: DisplayLead): PoolTableRow {
  // Count emails / phones from the raw contact list (not the formatted
  // display string). The display string joins phones with " ; ", so a
  // naive split on whitespace would yield silly numbers like "电话 16".
  const contacts = lead.raw.contacts ?? [];
  const emailCount = contacts.filter((contact) => contact.type === "email").length;
  const phoneCount = contacts.filter((contact) => contact.type === "phone").length;
  const crmStage = lead.raw.crmLead?.stage ?? null;
  const sentEmail = hasSentEmail(lead.raw);
  // 2026-05 Stage 2: CRM status reflects either an explicit crmLead row
  // OR the candidate having been approved (status approved / contacted
  // / email_sent). The /approve endpoint flips status before the CRM
  // row is created, so mapping only on crmLead would leave the table
  // stuck on "待加入CRM" right after a successful bulk approve.
  const status = lead.raw.status ?? "";
  const isApproved =
    status === "approved" ||
    status === "contacted" ||
    status === "email_sent";
  const crmActive = Boolean(crmStage) || isApproved;
  // Most recent action label: newest row reflects what just happened
  // ("已加入 CRM"/"已发送邮件") instead of the static "新发现".
  let lastAction = "新发现";
  if (sentEmail) {
    lastAction = "邮件已发送";
  } else if (isApproved) {
    lastAction = "已加入 CRM";
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
    hasPhone: phoneCount > 0,
    phoneCount,
    website: lead.website || "—",
    sourceBatch: lead.source || "第 1 批",
    crmStatus: crmActive ? "synced" : "pending",
    crmStatusLabel: crmActive ? "已加入CRM" : "待加入CRM",
    mailStatus: sentEmail ? "已发送" : isApproved ? "待发送" : "未触达",
    lastAction
  };
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
  onOpenMail: () => void;
  onOpenCrm: () => void;
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
  onOpenMail,
  onOpenCrm,
  onBack,
  onContinueSearch
}: ConversationProps) {
  const queryCount = currentTask?.searchQueries?.length ?? 0;
  const executedCount =
    currentTask?.searchQueries?.filter((query) => query.executionStatus === "completed").length ??
    0;
  const actionableLeads = leads.filter(isActionableDisplayLead);
  const qualifiedCount = actionableLeads.filter((lead) => lead.score >= 75).length;
  const hasActionableLeads = actionableLeads.length > 0;
  const running = creating || searching || approving;
  // Reply count: any lead whose outreach drafts have a send log marked
  // "replied". 0 when nothing has been sent yet — matches the 待跟进 KPI
  // shape (number, not em-dash) per the design.
  const repliedCount = useMemo(
    () =>
      leads.filter((lead) =>
        (lead.raw.outreachDrafts ?? []).some((draft) =>
          (draft.sendLogs ?? []).some((log) => log.status === "replied")
        )
      ).length,
    [leads]
  );
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
  const leadPageCount = Math.max(1, Math.ceil(leads.length / leadPageSize));
  const leadStartIndex = (leadPage - 1) * leadPageSize;
  const pagedLeads = leads.slice(leadStartIndex, leadStartIndex + leadPageSize);
  const leadRangeStart = leads.length ? leadStartIndex + 1 : 0;
  const leadRangeEnd = Math.min(leadStartIndex + leadPageSize, leads.length);

  useEffect(() => {
    if (leadPage > leadPageCount) {
      setLeadPage(leadPageCount);
    }
  }, [leadPage, leadPageCount]);

  useEffect(() => {
    if (!selectedLeadId) return;
    const selectedIndex = leads.findIndex((lead) => lead.id === selectedLeadId);
    if (selectedIndex < 0) return;
    const nextPage = Math.floor(selectedIndex / leadPageSize) + 1;
    setLeadPage((current) => (current === nextPage ? current : nextPage));
  }, [leads, selectedLeadId]);

  function changeLeadPage(nextPage: number) {
    const safePage = Math.min(Math.max(nextPage, 1), leadPageCount);
    setLeadPage(safePage);
    const firstLeadOnPage = leads[(safePage - 1) * leadPageSize];
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
  const poolStatus = mapTaskStatusToPool(currentTask?.status ?? (searching ? "running" : "pending"));
  const targetMarkets = useMemo(() => taskTargetMarkets(currentTask), [currentTask]);
  const countryChips = targetMarkets.length > 0
    ? targetMarkets.slice(0, 6)
    : ["UAE", "Saudi Arabia", "Qatar", "Oman"];
  const taskHistoryCount = leads.length;
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
    isTerminalTask ||
    (queryCount > 0 && pendingQueryCount === 0 && !searching && !creating);
  // A run is "active" only when the task itself is still active. If the
  // task is terminal but a few queries got stranded in pending/running,
  // we must NOT treat it as active — that's the bug that pinned the
  // page at "19/40 第 N 批进行中 ETA 6 分钟".
  const isRunActive = !isTerminalTask && (searching || creating || pendingQueryCount > 0);
  // Stranded query count for the failure subline. Only meaningful in
  // terminal state — during active runs these are just queued work.
  const strandedQueryCount = isTerminalTask ? pendingQueryCount : 0;
  // Rough ETA: each remaining query typically takes ~15s in the polling
  // backend. Floor at 1 minute so we don't say "0 minutes" while there
  // are still queries pending. When everything is done it's hidden.
  const estimateEtaMinutes = useMemo(() => {
    if (!isRunActive) return 0;
    const remaining = pendingQueryCount;
    const seconds = remaining * 15;
    return Math.max(1, Math.ceil(seconds / 60));
  }, [isRunActive, pendingQueryCount]);
  const currentRunningQuery = useMemo(
    () => (isRunActive ? currentTask?.searchQueries?.find((query) => query.executionStatus === "running") ?? null : null),
    [currentTask, isRunActive]
  );
  // 5-step pills: 生成指令 / Brave 搜索 / 清洗候选 / ICP 评分 / 写入客户池.
  // State derived from agentSteps + searchQueries when available.
  type RunStep = {
    label: string;
    state: "completed" | "running" | "pending" | "failed";
    stateLabel: string;
    icon: typeof Sparkles;
  };
  const runStepPills: RunStep[] = useMemo(() => {
    const stepByName = (name: string) =>
      currentTask?.agentSteps?.find((s) => s.nodeName === name);
    const planning = stepByName("plan_search");
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
    // "本批已跑完" status. A run that ends with failed queries surfaces
    // them on the affected step (Brave 搜索) and lets everything after
    // settle as "已完成".
    const stepStateAfterRun = (raw: RunStep["state"]): RunStep["state"] =>
      isRunComplete && (raw === "running" || raw === "pending") ? "completed" : raw;
    // 生成指令: planning step, but if any query exists we know it's done
    // (legacy tasks never expose a "plan_search" agent step).
    const planningRaw = stateLabelOf(planning);
    const planningState: RunStep["state"] =
      planningRaw === "pending" && queryCount ? "completed" : planningRaw;
    // Brave 搜索: if any query failed OR stranded in pending/running at
    // terminal time, surface that failure here. This is the step that
    // "owns" the search batch, so it's the right home for the failure
    // signal.
    const searchRaw = stepStateAfterRun(stateLabelOf(search));
    const searchState: RunStep["state"] =
      isRunComplete && (failedQueryCount > 0 || strandedQueryCount > 0)
        ? "failed"
        : searchRaw;
    const normalizeState = stepStateAfterRun(stateLabelOf(normalize));
    const scoreState = stepStateAfterRun(stateLabelOf(score));
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
      : leads.length > 0
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
  }, [currentTask, failedQueryCount, isRunComplete, leads.length, queryCount, strandedQueryCount]);

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
          <button type="button" className="aiPoolBack" onClick={onBack}>
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
              <span className={`aiPoolBadge state-${poolStatus.kind}`}>
                {poolStatus.label}
              </span>
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

      {/* KPI strip — 4 cards. Tones match the design: blue / green /
          orange / purple. All deltas use the consistent "较上周 +N"
          pattern with 0 fallback when there's no real WoW source yet. */}
      <section className="aiPoolKpis aiSearchRunKpis" aria-label="数据概览">
        <article className="aiPoolKpi tone-blue">
          <span className="aiPoolKpiIcon" aria-hidden="true">
            <Users size={20} />
          </span>
          <div className="aiPoolKpiBody">
            <span className="aiPoolKpiLabel">客户池总数</span>
            <strong className="aiPoolKpiValue">{leads.length || taskHistoryCount}</strong>
            <span className="aiPoolKpiDelta">较上周 +0</span>
          </div>
        </article>
        <article className="aiPoolKpi tone-green">
          <span className="aiPoolKpiIcon" aria-hidden="true">
            <TrendingUp size={20} />
          </span>
          <div className="aiPoolKpiBody">
            <span className="aiPoolKpiLabel">本批新增</span>
            <strong className="aiPoolKpiValue">{leads.length}</strong>
            <span className="aiPoolKpiDelta">{`较上周 +${leads.length}`}</span>
          </div>
        </article>
        <article className="aiPoolKpi tone-orange">
          <span className="aiPoolKpiIcon" aria-hidden="true">
            <Bell size={20} />
          </span>
          <div className="aiPoolKpiBody">
            <span className="aiPoolKpiLabel">待跟进</span>
            <strong className="aiPoolKpiValue">{pendingFollowupCount}</strong>
            <span className="aiPoolKpiDelta">较上周 +0</span>
          </div>
        </article>
        <article className="aiPoolKpi tone-purple">
          <span className="aiPoolKpiIcon" aria-hidden="true">
            <MessageCircle size={20} />
          </span>
          <div className="aiPoolKpiBody">
            <span className="aiPoolKpiLabel">回复</span>
            <strong className="aiPoolKpiValue">{repliedCount}</strong>
            <span className="aiPoolKpiDelta">较上周 +0</span>
          </div>
        </article>
      </section>

      {/* 持续搜索批次 — main run card */}
      <section className="aiSearchRunCard" aria-label="持续搜索批次">
        <header className="aiSearchRunHead">
          <div className="aiSearchRunHeadLeft">
            <h2>持续搜索批次</h2>
            {isRunActive ? (
              <p>
                {`正在执行：已完成 ${executedCount}/${queryCount || "—"} 条 query${
                  failedQueryCount ? `，失败 ${failedQueryCount} 条` : ""
                }`}
              </p>
            ) : isRunComplete && (failedQueryCount > 0 || strandedQueryCount > 0) ? (
              <p>
                {(() => {
                  const parts: string[] = [`${executedCount} 条成功`];
                  if (failedQueryCount > 0) parts.push(`${failedQueryCount} 条失败`);
                  if (strandedQueryCount > 0) parts.push(`${strandedQueryCount} 条未完成`);
                  return `本批已停止：${parts.join("，")}`;
                })()}
              </p>
            ) : !isRunComplete ? (
              <p>{status}</p>
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
                  ? `第 ${Math.max(1, Math.ceil(queryCount / 30))} 批正在搜索中...`
                  : isRunComplete
                    ? failedQueryCount > 0 || strandedQueryCount > 0
                      ? "本批已停止"
                      : "本批搜索已完成"
                    : "等待启动"}
              </strong>
              {isRunActive ? (
                <span className="aiSearchRunHeadlineEta">预计还需 {estimateEtaMinutes} 分钟</span>
              ) : null}
            </div>

            {/* Progress bar + inline "N / M query 已执行" label on the right. */}
            <div className="aiSearchRunProgressRow">
              <div className="aiSearchRunProgressBar" aria-hidden="true">
                <div
                  className="aiSearchRunProgressFill"
                  style={{
                    width: `${queryCount ? Math.min(100, Math.round((executedCount / queryCount) * 100)) : 0}%`
                  }}
                />
              </div>
              <p className="aiSearchRunProgressLabel">
                <strong>{executedCount}</strong>
                <span>/ {queryCount || "—"} query 已执行</span>
              </p>
            </div>

            {currentRunningQuery ? (
              <div className="aiSearchRunCurrent">
                <span className="aiSearchRunCurrentLabel">正在搜索</span>
                <span className="aiSearchRunCurrentCountry">
                  {currentRunningQuery.country || targetMarkets[0] || "—"}
                </span>
                <code className="aiSearchRunCurrentQuery" title={currentRunningQuery.query}>
                  {currentRunningQuery.query}
                </code>
              </div>
            ) : null}

            <p className="aiSearchRunStat">
              本批新增 <strong>{leads.length}</strong> 家客户
              {failedQueryCount > 0
                ? `，${failedQueryCount} 条 query 失败已忽略`
                : ""}
              {strandedQueryCount > 0
                ? `，${strandedQueryCount} 条 query 未完成`
                : ""}
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
                  className={`aiSearchRunLogItem state-${log.state}`}
                  key={`${log.title}-${index}`}
                >
                  <span className="aiSearchRunLogTime">{formatLogTime(index, Math.min(activityLogs.length, 4))}</span>
                  <span className="aiSearchRunLogBullet" aria-hidden="true" />
                  <span className="aiSearchRunLogText">
                    <strong>{log.title}</strong>
                    <em>{log.detail}</em>
                  </span>
                </li>
              ))}
              {activityLogs.length === 0 ? (
                <li className="aiSearchRunLogItem state-pending">
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

      {/* 新增客户表 */}
      <section className="aiPoolTableWrap aiSearchRunTableWrap" aria-label="新增客户">
        <header className="aiSearchRunTableHead">
          <h3>新增客户</h3>
          <p>点击公司可查看完整邮箱、电话、来源 query 和评分原因</p>
        </header>
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
              {leads.length ? (
                pagedLeads.map((lead) => {
                  const phoneCount = (lead.raw.contacts ?? []).filter(
                    (c) => c.type === "phone"
                  ).length;
                  const emailCount = (lead.raw.contacts ?? []).filter(
                    (c) => c.type === "email"
                  ).length;
                  const isFresh = lead.stage === "新发现" || lead.stage === "main";
                  return (
                    <tr key={lead.id} className={isFresh ? "is-fresh" : ""}>
                      <td className="col-company" title={lead.companyName}>
                        {isFresh ? <span className="aiSearchRunFreshBadge">新增</span> : null}
                        {lead.companyName}
                      </td>
                      <td className="col-country" title={lead.country}>{lead.country}</td>
                      <td className="col-type" title={lead.tag}>{lead.tag}</td>
                      <td className="col-score">
                        <span className="stars">{renderStars(lead.score / 20)}</span>
                        <span className="aiSearchRunScore">{lead.score}</span>
                      </td>
                      <td className="col-email">
                        <span className="aiSearchRunContactChip">
                          邮箱 <b>{emailCount}</b>
                        </span>
                      </td>
                      <td className="col-phone">
                        <span className="aiSearchRunContactChip">
                          电话 <b>{phoneCount}</b>
                        </span>
                      </td>
                      <td className="col-website" title={lead.website}>
                        {lead.website !== "—" ? lead.website : "-"}
                      </td>
                      <td className="col-status">
                        <span className={`aiPoolStatusPill ${lead.raw.crmLead ? "synced" : "pending"}`}>
                          {lead.raw.crmLead ? "已加入CRM" : "待加入CRM"}
                        </span>
                      </td>
                      <td className="col-action">
                        <button
                          type="button"
                          className="aiPoolRowAction"
                          onClick={() => onSelectLead(lead.id)}
                        >
                          详情
                        </button>
                        <button type="button" className="aiPoolRowAction icon" aria-label="更多操作">
                          <MoreHorizontal size={14} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="leadEmptyCell" colSpan={9}>
                    {searching
                      ? "正在搜索并清洗候选客户..."
                      : "暂无候选客户。任务创建后会自动执行本轮全部搜索指令。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <footer className="aiPoolTableFooter">
          <p className="aiPoolTableFootHint">
            显示 {leadRangeStart}-{leadRangeEnd} / {leads.length}
            <span className="aiPoolTableFootSep">·</span>
            主客户 {actionableLeads.length} 条，ICP 75+ {qualifiedCount} 条
          </p>
          <div className="projectPager leadPager">
            <span>每页 {leadPageSize}</span>
            <button
              type="button"
              onClick={() => changeLeadPage(leadPage - 1)}
              disabled={leadPage <= 1 || !leads.length}
            >
              上一页
            </button>
            <strong>
              {leadPage} / {leadPageCount}
            </strong>
            <button
              type="button"
              onClick={() => changeLeadPage(leadPage + 1)}
              disabled={leadPage >= leadPageCount || !leads.length}
            >
              下一页
            </button>
          </div>
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
                <strong>{Math.max(leads.length - crmSyncedCount, 0)}</strong> 家客户待同步，字段已整理，可进入客户库。
              </p>
              <button
                type="button"
                className="aiSearchRunBottomCta tone-blue"
                onClick={onOpenCrm}
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
                <strong>{actionableLeads.length}</strong> 封邮件待确认，主题：中国 B2B 工厂产品推荐。
              </p>
              <button
                type="button"
                className="aiSearchRunBottomCta tone-green"
                onClick={onOpenMail}
                disabled={running || !hasActionableLeads}
              >
                预览邮件
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
  const executedCount =
    currentTask?.searchQueries?.filter((query) => query.executionStatus === "completed").length ??
    0;
  const actionableLeads = leads.filter(isActionableDisplayLead);
  const qualifiedCount = actionableLeads.filter((lead) => lead.score >= 75).length;
  const hasTask = Boolean(currentTask);
  const hasLeads = leads.length > 0;

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
      detail: queryCount
        ? `已生成 ${queryCount} 条搜索指令`
        : creating
          ? "正在生成执行步骤"
          : "等待画像读取",
      state: queryCount ? "done" : creating ? "active" : "pending"
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
  // 2026-05: country verification is no longer a gate. We keep
  // candidates with unconfirmed country in the main customer list and
  // show "国家待补充" in the UI; downstream review still lets users
  // double-check before sending. Score >= 50 + main status + not an
  // evidence-only or hidden content lead is enough.
  const score = lead.icpScore?.score ?? 0;
  return (
    isMainLeadStatus(lead.status) &&
    !hasEvidenceLeadType(lead) &&
    !isHiddenEvidenceOrContentLead(lead) &&
    score >= 50
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
    address: country,
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
    .replace(/\b(home|official site|website|about us|contact us|logo|tagline|awesome image|pdf)\b/gi, "")
    .replace(/^\s*(?:welcome to|official)\s+/i, "")
    .replace(/^\s*(?:created|designed|powered|developed|maintained|hosted)\s+by\s+|^\s*website\s+by\s+/i, "")
    .replace(/\s+\b(?:homepage|home page)\b$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[|:\\\-\s]+|[|:\\\-\s]+$/g, "")
    .trim();
}

function isLikelyDisplayCompanyName(value: string, domainName: string) {
  const name = cleanupDisplayCompanyName(value);
  const lower = name.toLowerCase();
  if (!name || name.length > 72 || isForbiddenDisplayCompanyName(value) || looksLikeDisplayProductTitle(name)) {
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
  const normalized = (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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

function formatMailSentStatus(result: MailSendResult) {
  if (result.crmLead && result.followupTask) {
    return "邮件已通过 Gmail 发送，客户已同步 CRM，并创建 3 天后跟进提醒。";
  }
  if (result.crmLead) {
    return "邮件已通过 Gmail 发送，客户已同步 CRM。";
  }

  return "邮件已通过 Gmail 发送。";
}

type IcpReasonPayload = {
  reasons?: unknown;
  summary?: unknown;
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
  if (
    isMainLeadStatus(lead.status) &&
    (lead.countryConfidence === "low" ||
      lead.countryConfidence === "unknown" ||
      lead.countryConflict)
  ) {
    return "国家待补充";
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
  if (leadType === "intelligence" || status === "intelligence" || status === "intelligence_review") {
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

function buildCrmRows(displayLeads: DisplayLead[]): CrmRow[] {
  return displayLeads.map((lead) => ({
    ...lead,
    industry: lead.tag,
    owner: "王亚伟"
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
    .sort((left, right) => emailContactPriority(left, companyDomain) - emailContactPriority(right, companyDomain))
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

function averageScore(rows: Array<{ score: number }>) {
  if (!rows.length) return 0;
  return Math.round(rows.reduce((total, row) => total + row.score, 0) / rows.length);
}
