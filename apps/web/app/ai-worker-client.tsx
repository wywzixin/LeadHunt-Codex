"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Database,
  ExternalLink,
  GraduationCap,
  Mail,
  Paperclip,
  Search,
  Settings,
  Sparkles,
  Target,
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

const landingShortcuts = [
  { label: "找客户", icon: Target },
  { label: "营销触达", icon: Mail },
  { label: "客户管理", icon: UsersRound },
  { label: "外贸导师", icon: GraduationCap },
  { label: "我的配置", icon: Settings }
];

const landingExamples = [
  {
    icon: Target,
    title: "找 B2B 买家客户",
    description:
      "读取已保存的产品画像和客户画像，搜索维护商、工程商、运营商、采购方和运维客户，并筛选可做首轮触达的目标。",
    prompt:
      "帮我找某类产品的买家客户，优先找维护公司、工程商、运营商、采购方和网络运维客户。"
  },
  {
    icon: UsersRound,
    title: "按客户画像找同类客户",
    description:
      "使用已保存的参考客户画像，提炼客户类型、关键词、采购场景与地域特征，用于搜索同类客户。",
    prompt:
      "按已保存的客户画像，帮我找同类型买家客户。"
  },
  {
    icon: Mail,
    title: "生成开发信并同步 CRM",
    description:
      "面向高相关客户生成首封英文开发信，确认发送后自动写入 CRM，并设置 3 天后二次跟进提醒。",
    prompt:
      "面向高相关客户生成首封英文开发信，确认发送后自动写入 CRM，并设置 3 天后二次跟进提醒。"
  }
];

const fallbackKeywordRows: KeywordRow[] = [
  {
    label: "产品扩展词",
    values: ["product category", "core product", "spare parts", "components", "equipment", "materials"]
  },
  {
    label: "客户类型词",
    values: [
      "maintenance company",
      "system integrator",
      "engineering contractor",
      "operator",
      "procurement",
      "service provider"
    ]
  },
  {
    label: "品牌/型号词",
    values: ["brand + model", "model replacement", "SKU RFQ", "product group maintenance", "key spare parts"]
  },
  {
    label: "场景/市场词",
    values: ["UAE", "Saudi Arabia", "project rollout", "maintenance service", "vendor registration"]
  },
  {
    label: "ICP 风险词",
    values: ["jobs", "news", "training", "blog", "marketplace"]
  }
];

const fallbackSearchQueries = [
  '("maintenance company" OR "field service") "product category" UAE -job -news -marketplace -directory',
  '("system integrator" OR contractor) "core product" Saudi Arabia -yellowpages -Alibaba',
  '("repair service" OR replacement) "spare parts" Nigeria -marketplace -directory',
  '("project contractor" OR "deployment contractor") equipment Brazil -job -blog -forum',
  '("vendor registration" OR RFQ OR procurement) "product category" Philippines -marketplace -directory'
];

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
const maxTaskPollAttempts = 240;

type ViewState = "landing" | "conversation";
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
    promptMarkets?: string[];
    profileMarkets?: string[];
    marketSource?: "prompt" | "profile" | "merged" | "none" | string;
  };
  aiPlanning?: {
    rejectedQueryCount?: number;
    rejectedQueries?: Array<{ query?: string; country?: string; reason?: string }>;
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

type KeywordRow = {
  label: string;
  values: string[];
};

type ProfileSourceRow = {
  label: string;
  values: string[];
};

type FlowRow = {
  title: string;
  description: string;
  state: StepState;
};

type ActivityStep = {
  title: string;
  detail: string;
  state: StepState;
};

type ActivityMetric = {
  label: string;
  value: string;
  tone?: "blue" | "green" | "orange" | "gray";
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
  rejected: number;
  other: number;
};

type DisplaySearchResult = {
  id: string;
  title: string;
  domain: string;
  url: string;
  country: string;
  query: string;
  status: string;
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
  const [command, setCommand] = useState("");
  const [view, setView] = useState<ViewState>("landing");
  const [landingPrompt, setLandingPrompt] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [taskPrompt, setTaskPrompt] = useState(defaultTaskPrompt);
  const [hostingMode, setHostingMode] = useState<"semi" | "full">("semi");
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
  const sentCount = useMemo(() => displayLeads.filter((lead) => hasSentEmail(lead.raw)).length, [displayLeads]);
  const crmSyncedCount = useMemo(() => displayLeads.filter((lead) => Boolean(lead.raw.crmLead)).length, [displayLeads]);
  const pendingFollowupCount = useMemo(
    () => displayLeads.reduce((total, lead) => total + pendingFollowups(lead.raw).length, 0),
    [displayLeads]
  );
  const leadQualityCounts = useMemo(() => summarizeLeadQualityCounts(currentTask), [currentTask]);
  const keywordRows = useMemo(() => buildKeywordRows(currentTask, view !== "landing"), [currentTask, view]);
  const profileSourceRows = useMemo(() => buildProfileSourceRows(currentTask), [currentTask]);
  const flowRows = useMemo(
    () =>
      buildFlowRows(currentTask, {
        creating,
        searching,
        approving,
        leadCount: displayLeads.length,
        leadQualityCounts,
        sentCount,
        crmSyncedCount,
        pendingFollowupCount
      }),
    [
      approving,
      creating,
      crmSyncedCount,
      currentTask,
      displayLeads.length,
      leadQualityCounts,
      pendingFollowupCount,
      searching,
      sentCount
    ]
  );
  const crmRows = useMemo(() => buildCrmRows(displayLeads), [displayLeads]);
  const crmPageCount = Math.max(1, Math.ceil(crmRows.length / crmPageSize));
  const crmPageRows = crmRows.slice((crmPage - 1) * crmPageSize, crmPage * crmPageSize);
  const selectedDisplayLead =
    displayLeads.find((lead) => lead.id === selectedLeadId) ?? displayLeads[0] ?? null;
  const modalLead = mailLead ?? (selectedDisplayLead ? toMailLead(selectedDisplayLead) : fallbackMailLead);
  const modalRecipients = useMemo<MailConfirmationRecipient[]>(() => {
    return displayLeads
      .map((lead) => {
        const mailLead = toMailLead(lead);
        return {
          email: mailLead.email,
          leadId: lead.id,
          companyName: mailLead.companyName
        };
      })
      .filter((item) => item.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email));
  }, [displayLeads]);

  useEffect(() => {
    if (!currentTask?.id || !isBackendTaskActive(currentTask)) {
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
            void loadTaskHistory(taskSearch);
            return;
          }
        } catch (requestError) {
          if (!cancelled) {
            setError(errorMessage(requestError));
            setStatus("任务状态刷新失败，后端任务可能仍在执行。");
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
  }, [currentTask?.id, currentTask?.status]);

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

  async function openHistoryTask(taskId: string) {
    setView("conversation");
    setStatus("正在恢复任务...");
    setError("");
    setMailLead(null);
    try {
      const refreshed = await apiRequest<LeadTask>(`/api/lead-tasks/${taskId}`);
      setCurrentTask(refreshed);
      const payload = refreshed.inputPayload as { prompt?: string } | null;
      const restoredPrompt = typeof payload?.prompt === "string" ? payload.prompt : defaultTaskPrompt;
      setTaskPrompt(restoredPrompt);
      applyTaskProgress(refreshed);
      if ((refreshed.leadCandidates?.length ?? 0) > 0) {
        setSelectedLeadId(refreshed.leadCandidates?.[0]?.id ?? null);
      }
    } catch (requestError) {
      setError(errorMessage(requestError));
      setStatus("恢复任务失败，请检查登录状态。");
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

  async function runTaskSearch(taskId = currentTask?.id) {
    if (!taskId) {
      setStatus("请先创建任务，后端会自动完成本轮搜索。");
      return;
    }

    try {
      const refreshedTask = await refreshTask(taskId);
      applyTaskProgress(refreshedTask);
    } catch (requestError) {
      setError(errorMessage(requestError));
      setStatus("任务状态刷新失败；后端会自动执行搜索，稍后可从任务历史打开查看。");
    }
  }

  async function refreshTask(taskId: string) {
    const refreshed = await apiRequest<LeadTask>(`/api/lead-tasks/${taskId}`);
    setCurrentTask(refreshed);
    return refreshed;
  }

  function applyTaskProgress(task: LeadTask) {
    const result = summarizeSearchResultFromTask(task);
    const hasSearchData = Boolean((task.searchQueries?.length ?? 0) || (task.leadCandidates?.length ?? 0));
    const failedMessage = firstFailedStepError(task);

    setCreating(isTaskPlanning(task));
    setSearching(isTaskSearching(task));
    setSearchResult(hasSearchData ? result : null);
    if (failedMessage || task.status === "failed") {
      setError(failedMessage || "任务执行失败。");
    } else {
      setError("");
    }
    setStatus(formatTaskProgressStatus(task, result));

    const leadCount = task.leadCandidates?.length ?? 0;
    if (leadCount > 0) {
      setSelectedLeadId((current) => current ?? task.leadCandidates?.[0]?.id ?? null);
    }
  }

  async function approveSelectedLead() {
    const lead = selectedDisplayLead;
    if (!lead) {
      setStatus("当前还没有候选客户，请先执行搜索。");
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
        refreshed.leadCandidates?.find((candidate) => candidate.id === result.approvedLeadIds[0]) ?? lead.raw;
      const modalCandidate = buildDisplayLead(approvedLead);
      setSelectedLeadId(approvedLead.id);
      setMailLead(toMailLead(modalCandidate));
      setMailOpen(true);
      setStatus(`已审批 ${result.approvedCount} 家客户，并生成 ${result.draftCount} 封开发信草稿。`);
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

  function submitLanding() {
    void startLeadTask(landingPrompt);
  }

  function backToLanding() {
    setView("landing");
    setCommand("");
    setStatus(currentTask ? "任务已保留，可确认客户或重新执行搜索" : "等待分配任务");
  }

  function openCrmPreview() {
    setCrmPage(1);
    setCrmOpen(true);
    setStatus(displayLeads.length ? "已打开 CRM 同步预览。" : "当前暂无候选客户，CRM 预览为空。");
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

  function sendCommand() {
    const text = command.trim();
    if (!text) return;
    setCommand("");

    if (/搜索|重新执行|search/i.test(text)) {
      void runTaskSearch();
      return;
    }

    if (/邮件|开发信|发信|mail/i.test(text)) {
      void approveSelectedLead();
      return;
    }

    setStatus(text);
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
          {view === "landing" ? (
            <AiWorkerLanding
              prompt={landingPrompt}
              onPromptChange={setLandingPrompt}
              onSubmit={submitLanding}
              taskSearch={taskSearch}
              onTaskSearchChange={setTaskSearch}
              submitting={creating || searching}
              hostingMode={hostingMode}
              onHostingModeChange={setHostingMode}
              taskHistory={taskHistory}
              historyLoading={historyLoading}
              onSelectHistoryTask={openHistoryTask}
              onRefreshHistory={() => void loadTaskHistory(taskSearch)}
            />
          ) : (
            <AiWorkerConversation
              prompt={taskPrompt}
              status={status}
              error={error}
              command={command}
              currentTask={currentTask}
              keywordRows={keywordRows}
              profileSourceRows={profileSourceRows}
              flowRows={flowRows}
              leads={displayLeads}
              crmRows={crmRows}
              sentCount={sentCount}
              crmSyncedCount={crmSyncedCount}
              pendingFollowupCount={pendingFollowupCount}
              searchResult={searchResult}
              creating={creating}
              searching={searching}
              approving={approving}
              selectedLeadId={selectedLeadId}
              onSelectLead={setSelectedLeadId}
              onCommandChange={setCommand}
              onSendCommand={sendCommand}
              onOpenMail={() => void approveSelectedLead()}
              onOpenCrm={openCrmPreview}
              onBack={backToLanding}
            />
          )}
        </section>

        {crmOpen ? (
          <div className="crmDataBackdrop" role="presentation">
            <section className="crmDataModal" role="dialog" aria-modal="true" aria-labelledby="crm-data-title">
              <header className="crmDataHeader">
                <div>
                  <span>CRM 数据</span>
                  <h2 id="crm-data-title">本次同步客户</h2>
                </div>
                <button className="crmDataClose" type="button" aria-label="关闭 CRM 数据弹窗" onClick={() => setCrmOpen(false)}>
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
                        <td colSpan={10}>暂无可同步客户，先执行 AI 搜索后会在这里预览 CRM 字段。</td>
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
                  <button type="button" aria-label="上一页" disabled={crmPage === 1} onClick={() => changeCrmPage(crmPage - 1)}>
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

type LandingProps = {
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  taskSearch: string;
  onTaskSearchChange: (value: string) => void;
  submitting: boolean;
  hostingMode: "semi" | "full";
  onHostingModeChange: (mode: "semi" | "full") => void;
  taskHistory: LeadTaskListItem[];
  historyLoading: boolean;
  onSelectHistoryTask: (taskId: string) => void;
  onRefreshHistory: () => void;
};

function AiWorkerLanding({
  prompt,
  onPromptChange,
  onSubmit,
  taskSearch,
  onTaskSearchChange,
  submitting,
  hostingMode,
  onHostingModeChange,
  taskHistory,
  historyLoading,
  onSelectHistoryTask,
  onRefreshHistory
}: LandingProps) {
  const [hostingDialogOpen, setHostingDialogOpen] = useState(false);
  const [draftHostingMode, setDraftHostingMode] = useState<"semi" | "full">(hostingMode);
  const filteredHistory = useMemo(() => {
    const keyword = taskSearch.trim().toLowerCase();
    if (!keyword) return taskHistory;
    return taskHistory.filter((task) => task.title.toLowerCase().includes(keyword) || task.prompt.toLowerCase().includes(keyword));
  }, [taskHistory, taskSearch]);
  function pickExample(text: string) {
    onPromptChange(text);
  }

  function openHostingDialog() {
    setDraftHostingMode(hostingMode);
    setHostingDialogOpen(true);
  }

  function confirmHostingMode() {
    onHostingModeChange(draftHostingMode);
    setHostingDialogOpen(false);
  }

  return (
    <div className="aiLanding">
      <aside className="aiLandingTasks" aria-label="历史任务">
        <div className="aiLandingTaskHead">
          <button className="aiLandingTaskBtn primary" type="button" onClick={onRefreshHistory}>
            <span aria-hidden="true">+</span> 新任务
          </button>
          <button className="aiLandingTaskBtn" type="button">
            <Settings size={15} aria-hidden="true" /> 我的配置
          </button>
        </div>
        <label className="aiLandingTaskSearch">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={taskSearch}
            onChange={(event) => onTaskSearchChange(event.target.value)}
            placeholder="搜索任务"
            aria-label="搜索历史任务"
          />
        </label>
        <div className="aiLandingTaskTitle">
          历史任务
          <span className="aiLandingTaskCount">{historyLoading ? "..." : `${filteredHistory.length}`}</span>
        </div>
        {filteredHistory.length === 0 ? (
          <div className="aiLandingTaskEmpty">
            <div className="aiLandingTaskEmptyIcon" aria-hidden="true" />
            <strong>{historyLoading ? "正在读取历史任务..." : "暂无历史任务"}</strong>
            <span>{historyLoading ? "请稍候" : "创建任务后将在此展示"}</span>
          </div>
        ) : (
          <ul className="aiLandingTaskList" aria-label="历史任务列表">
            {filteredHistory.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  className="aiLandingTaskItem"
                  onClick={() => onSelectHistoryTask(task.id)}
                >
                  <strong>{task.title || "未命名任务"}</strong>
                  <small>
                    {formatHistoryDate(task.createdAt)} · 主客户 {task.leadCount} · 指令 {task.queryCount}
                  </small>
                  <span className={`aiLandingTaskStatus status-${task.status}`}>{task.status}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="aiLandingHero">
        <div className="aiLandingHeroInner">
          <h1 className="aiLandingTitle">外贸获客 寻找下一个客户</h1>
          <p className="aiLandingSubtitle">
            你的 AI 外贸员 7×24 小时工作，先理解产品与客户画像，再自动搜索潜在客户、判断 ICP、生成开发信，并同步 CRM 跟进。
          </p>

          <div className="aiLandingComposer">
            <div className="aiLandingComposerHead">分配一个任务，开始对话吧</div>
            <textarea
              className="aiLandingComposerInput"
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              placeholder="例如：帮我找某类产品买家客户，先筛选目标客户，再生成首封开发信"
              aria-label="分配一个任务"
            />
            <div className="aiLandingComposerBottom">
              <button
                className="aiLandingHostingPill"
                type="button"
                aria-expanded={hostingDialogOpen}
                aria-haspopup="dialog"
                onClick={openHostingDialog}
              >
                <span className="hostingLabel">当前：</span>
                <strong>{hostingMode === "semi" ? "半托管" : "全托管"}</strong>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              <button className="aiLandingAttach" type="button" aria-label="添加附件">
                <Paperclip size={16} aria-hidden="true" />
              </button>
              <span className="aiLandingComposerSpacer" />
              <button
                className="aiLandingSend"
                type="button"
                aria-label="发送任务"
                onClick={onSubmit}
                disabled={submitting || prompt.trim().length === 0}
              >
                ↑
              </button>
            </div>
          </div>

          {hostingDialogOpen ? (
            <div className="hostingModeBackdrop" role="presentation" onClick={() => setHostingDialogOpen(false)}>
              <section
                className="hostingModeDialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="hosting-mode-title"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  className="hostingModeClose"
                  type="button"
                  aria-label="关闭托管模式选择"
                  onClick={() => setHostingDialogOpen(false)}
                >
                  <X size={16} aria-hidden="true" />
                </button>
                <button
                  className={draftHostingMode === "semi" ? "hostingModeOption active" : "hostingModeOption"}
                  type="button"
                  onClick={() => setDraftHostingMode("semi")}
                >
                  {draftHostingMode === "semi" ? (
                    <CheckCircle2 size={20} aria-hidden="true" />
                  ) : (
                    <Circle size={20} aria-hidden="true" />
                  )}
                  <span className="hostingModeBadge">半</span>
                  <span className="hostingModeCopy">
                    <strong id="hosting-mode-title">半托管状态</strong>
                    <small>AI 执行关键步骤前会征求您的确认</small>
                  </span>
                  <em>运行中</em>
                </button>
                <button
                  className={draftHostingMode === "full" ? "hostingModeOption active" : "hostingModeOption"}
                  type="button"
                  onClick={() => setDraftHostingMode("full")}
                >
                  {draftHostingMode === "full" ? (
                    <CheckCircle2 size={20} aria-hidden="true" />
                  ) : (
                    <Circle size={20} aria-hidden="true" />
                  )}
                  <span className="hostingModeBadge">全</span>
                  <span className="hostingModeCopy">
                    <strong>全托管状态</strong>
                    <small>满足条件后自动执行任务，适合成熟规则下批量运行</small>
                  </span>
                  <em>可切换</em>
                </button>
                <button className="hostingModeConfirm" type="button" onClick={confirmHostingMode}>
                  确定
                </button>
              </section>
            </div>
          ) : null}

          <div className="aiLandingShortcuts">
            {landingShortcuts.map((item) => {
              const Icon = item.icon;
              return (
                <button className="aiLandingShortcut" type="button" key={item.label}>
                  <Icon size={16} aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="aiLandingExamples">
            {landingExamples.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className="aiLandingExampleCard"
                  type="button"
                  key={item.title}
                  onClick={() => pickExample(item.prompt)}
                >
                  <div className="aiLandingExampleHead">
                    <Icon size={16} aria-hidden="true" />
                    <strong>{item.title}</strong>
                  </div>
                  <p>{item.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

type ConversationProps = {
  prompt: string;
  status: string;
  error: string;
  command: string;
  currentTask: LeadTask | null;
  keywordRows: KeywordRow[];
  profileSourceRows: ProfileSourceRow[];
  flowRows: FlowRow[];
  leads: DisplayLead[];
  crmRows: CrmRow[];
  sentCount: number;
  crmSyncedCount: number;
  pendingFollowupCount: number;
  searchResult: SearchRunResult | null;
  creating: boolean;
  searching: boolean;
  approving: boolean;
  selectedLeadId: string | null;
  onSelectLead: (leadId: string) => void;
  onCommandChange: (value: string) => void;
  onSendCommand: () => void;
  onOpenMail: () => void;
  onOpenCrm: () => void;
  onBack: () => void;
};

function AiWorkerConversation({
  prompt,
  status,
  error,
  command,
  currentTask,
  keywordRows,
  profileSourceRows,
  flowRows,
  leads,
  crmRows,
  sentCount,
  crmSyncedCount,
  pendingFollowupCount,
  searchResult,
  creating,
  searching,
  approving,
  selectedLeadId,
  onSelectLead,
  onCommandChange,
  onSendCommand,
  onOpenMail,
  onOpenCrm,
  onBack
}: ConversationProps) {
  const queryCount = currentTask?.searchQueries?.length ?? 0;
  const executedCount = currentTask?.searchQueries?.filter((query) => query.executionStatus === "completed").length ?? 0;
  const rawSearchResults = useMemo(() => buildDisplaySearchResults(currentTask), [currentTask]);
  const rawResultCount =
    currentTask?.searchQueries?.reduce((total, query) => total + (query.resultCount ?? 0), 0) ?? rawSearchResults.length;
  const qualifiedCount = leads.filter((lead) => lead.score >= 75).length;
  const running = creating || searching || approving;
  const leadQualityCounts = useMemo(() => summarizeLeadQualityCounts(currentTask), [currentTask]);
  const activitySteps = buildActivitySteps({
    creating,
    searching,
    currentTask,
    searchResult,
    leads,
    leadQualityCounts,
    hasError: Boolean(error)
  });
  const activityMetrics = buildActivityMetrics({ currentTask, searchResult, leads, leadQualityCounts });
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

  return (
    <>
      <div className="aiConversationBar">
        <button className="aiConversationBack" type="button" onClick={onBack}>
          <ChevronLeft size={16} aria-hidden="true" />
          返回工作台
        </button>
      </div>
      <div className="chatScroll">
        <div className="taskBubble">{prompt}</div>

        <p className="agentText">
          我将先帮你筛选符合要求的目标客户，再生成邮件触达任务，最后同步到 CRM
          系统并标记标签。当前第一步是筛选目标客户，系统会输出 AI 扩展词、搜索指令和候选客户列表。
        </p>

        <div className={error ? "apiStatusLine error" : "apiStatusLine"}>
          <strong>{status}</strong>
          {currentTask ? <span>任务 ID：{currentTask.id}</span> : null}
          {error ? <span>{error}</span> : null}
        </div>

        <AgentSearchActivity
          active={creating || searching}
          steps={activitySteps}
          metrics={activityMetrics}
          queryCount={queryCount}
          executedCount={executedCount}
          resultCount={searchResult?.resultCount ?? 0}
          leadCount={leads.length}
          leadQualityCounts={leadQualityCounts}
          logs={activityLogs}
          hasError={Boolean(error)}
        />

        <div className="flow">
          {flowRows.map((row, index) => (
            <div className={`flowRow ${row.state}`} key={row.title}>
              <div className={row.state === "pending" ? "flowDot pending" : "flowDot"}>
                {row.state === "pending" ? index + 1 : row.state === "failed" ? "!" : "✓"}
              </div>
              <div>
                <strong>{row.title}</strong>
                <span>{row.description}</span>
              </div>
            </div>
          ))}
        </div>

        <section className="keywordCard aiExpansionCard">
          <div className="keywordHead">
            <div>
              <div className="keywordTitle">
                <span className="keywordIcon">
                  <Sparkles size={16} aria-hidden="true" />
                </span>
                AI 扩展词
              </div>
              <div className="keywordSubtitle">
                根据产品画像、参考客户官网和目标市场自动扩展，并组合成首批搜索指令。
              </div>
            </div>
            <span className="keywordStatusPill">
              已同步
            </span>
          </div>
          {profileSourceRows.length ? (
            <div className="profileSourceGrid">
              {profileSourceRows.map((row) => (
                <div className="profileSourceRow" key={row.label}>
                  <span>{row.label}</span>
                  <div>
                    {row.values.map((value) => (
                      <strong key={value}>{value}</strong>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {keywordRows.map((row) => (
            <div className="keywordRow" key={row.label}>
              <span className="keywordRowLabel">{row.label}</span>
              <div className="keywordChips">
                {row.values.map((value) => (
                  <span className="keywordChip" key={value}>
                    {value}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="keywordActions">
            <span className="keywordMeta">
              搜索指令会一次性执行完本轮全部 query；目录站、B2B 平台和内容页会降权，主候选表优先展示可触达客户
            </span>
          </div>
        </section>

        <div className="executionTitle">
          <span className={searching ? "flowDot" : leads.length ? "flowDot" : "flowDot pending"}>
            {leads.length || searching ? "✓" : "1"}
          </span>
          执行任务
        </div>
        <div className="flow executionFlow">
          <div className={searching ? "flowRow active" : "flowRow done"}>
            <div className="flowDot">✓</div>
            <div>
              <strong>筛选目标客户</strong>
              <span>{searching ? "正在调用 Brave 搜索" : queryCount ? "搜索指令已就绪" : "等待任务创建"}</span>
            </div>
          </div>
          <div className={leadQualityCounts.rawEvidence ? "flowRow active" : "flowRow pending"}>
            <div className={leadQualityCounts.rawEvidence ? "flowDot" : "flowDot pending"}>{leadQualityCounts.rawEvidence ? "✓" : "2"}</div>
            <div>
              <strong>线索清洗结果</strong>
              <span>
                {searchResult
                  ? formatLeadQualitySummary(leadQualityCounts)
                  : "等待首轮搜索结果"}
              </span>
            </div>
          </div>
        </div>

        <section className="leadTableCard rawResultCard">
          <div className="rawResultHead">
            <div>
              <span>Brave 原始搜索结果</span>
              <strong>
                {rawResultCount
                  ? `当前已命中 ${rawResultCount} 条原始结果，展示前 ${Math.min(rawSearchResults.length, 20)} 条`
                  : "等待首轮 Brave 搜索结果"}
              </strong>
            </div>
            <span className="rawResultBadge">
              {searchResult
                ? searchResult.hasMore
                  ? `剩余 ${searchResult.remainingQueries ?? 0} 条未执行`
                  : "已执行完本轮搜索指令"
                : "实时"}
            </span>
          </div>
          <div className="leadTableWrap">
            <table className="leadTable rawResultTable">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>域名</th>
                  <th>来源 query 国家</th>
                  <th>来源查询</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {rawSearchResults.length ? (
                  rawSearchResults.slice(0, 20).map((result) => (
                    <tr key={result.id}>
                      <td className="rawResultTitle">{result.title}</td>
                      <td>{result.domain}</td>
                      <td title="仅代表这条搜索指令的目标国家，不代表客户官网真实国家。">{result.country}</td>
                      <td className="rawResultQuery">{result.query}</td>
                      <td>{result.status}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="leadEmptyCell" colSpan={5}>
                      {searching ? "正在等待 Brave 返回原始命中..." : "暂无原始搜索结果"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="leadTableCard">
          <div className="leadTableWrap">
            <table className="leadTable">
              <thead>
                <tr>
                  <th>
                    <span className="leadCheck" />
                  </th>
                  <th>公司名称</th>
                  <th>推荐指数</th>
                  <th>数据来源</th>
                  <th>来源页</th>
                  <th>国家/地区</th>
                  <th>客户简述</th>
                  <th>电话</th>
                  <th>邮箱</th>
                  <th>官网</th>
                  <th>社媒</th>
                  <th>地址</th>
                </tr>
              </thead>
              <tbody>
                {leads.length ? (
                  pagedLeads.map((lead) => (
                    <tr key={lead.id}>
                      <td>
                        <button
                          className={lead.id === selectedLeadId ? "leadCheckButton active" : "leadCheckButton"}
                          type="button"
                          aria-label={`选择 ${lead.companyName}`}
                          onClick={() => onSelectLead(lead.id)}
                        />
                      </td>
                      <td className="leadCompanyCell">{lead.companyName}</td>
                      <td>
                        <span className="stars">{scoreStars(lead.score)}</span>
                      </td>
                      <td>
                        {lead.source} <span className="realBadge">实时</span>
                      </td>
                      <td className="leadSourceCell" title={lead.sourceUrl}>
                        {lead.sourceUrl ? (
                          <a
                            className="leadSourceLink"
                            href={lead.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`打开来源页 ${lead.sourceUrl}`}
                          >
                            <span>{lead.sourceLabel}</span>
                            <ExternalLink size={14} aria-hidden="true" />
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td title={lead.country}>{lead.country}</td>
                      <td title={lead.tag}>{lead.tag}</td>
                      <td title={lead.phone}>{lead.phone}</td>
                      <td title={lead.email}>{lead.email}</td>
                      <td title={lead.website}>{lead.website}</td>
                      <td title={lead.social}>{lead.social}</td>
                      <td>{lead.address}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="leadEmptyCell" colSpan={12}>
                      {searching ? "正在搜索并清洗候选客户..." : "暂无候选客户。创建任务后会自动执行本轮全部搜索指令。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="leadActionBar">
            <div className="leadTools">
              <button className="leadAction" type="button" data-open-mail="true" onClick={onOpenMail} disabled={running || !leads.length}>
                ✉ 发邮件
              </button>
              <button className="leadAction" type="button" data-open-crm="true" onClick={onOpenCrm}>
                <Database size={16} aria-hidden="true" /> 加入 CRM
              </button>
            </div>
            <div className="projectPager leadPager">
              <span>
                已找到 {leads.length} 条，ICP 75+ {qualifiedCount} 条
                {leads.length ? ` · 当前 ${leadRangeStart}-${leadRangeEnd}` : ""}
              </span>
              <button type="button" onClick={() => changeLeadPage(leadPage - 1)} disabled={leadPage <= 1 || !leads.length}>
                上一页
              </button>
              <strong>{leadPage} / {leadPageCount}</strong>
              <button type="button" onClick={() => changeLeadPage(leadPage + 1)} disabled={leadPage >= leadPageCount || !leads.length}>
                下一页
              </button>
            </div>
          </div>
        </section>

        <section className="crmSyncPreview">
          <div className="crmSyncHead">
            <div>
              <span>CRM 同步预览</span>
              <strong>
                {crmSyncedCount
                  ? `已同步 ${crmSyncedCount} 家客户，剩余 ${Math.max(crmRows.length - crmSyncedCount, 0)} 家待同步。`
                  : `本次将同步 ${crmRows.length} 家客户，字段已按 CRM 客户库整理。`}
              </strong>
            </div>
            <button className="crmSyncOpen" type="button" data-open-crm-preview="true" onClick={onOpenCrm}>
              查看 CRM 数据 <ExternalLink size={15} aria-hidden="true" />
            </button>
          </div>
          <div
            className="crmPreviewThumb"
            role="button"
            tabIndex={0}
            aria-label="打开 CRM 数据弹窗"
            data-crm-preview-thumb="true"
            onClick={onOpenCrm}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenCrm();
              }
            }}
          >
            <div className="crmPreviewStats">
              <span>
                <b>{crmSyncedCount}</b>已同步 CRM
              </span>
              <span>
                <b>{Math.max(crmRows.length - crmSyncedCount, 0)}</b>待同步客户
              </span>
              <span>
                <b>{pendingFollowupCount}</b>待跟进提醒
              </span>
            </div>
            <div className="crmPreviewRows">
              {crmRows.length ? (
                crmRows.slice(0, 3).map((row) => (
                  <div className="crmPreviewRow" key={row.id}>
                    <strong>{row.companyName}</strong>
                    <span>{row.country}</span>
                    <span>{row.industry}</span>
                    <span>{row.stage}</span>
                    <b>{row.score}</b>
                  </div>
                ))
              ) : (
                <div className="crmPreviewRow">
                  <strong>等待候选客户</strong>
                  <span>-</span>
                  <span>搜索后生成</span>
                  <span>待处理</span>
                  <b>0</b>
                </div>
              )}
            </div>
          </div>
        </section>

        <p className="projectSummary">
          {sentCount
            ? `已完成 ${sentCount} 封 Gmail 发送，${crmSyncedCount} 家客户已同步 CRM，${pendingFollowupCount} 个 3 天后跟进提醒已创建。`
            : leads.length
            ? `我已为您找到 ${leads.length} 家候选公司，其中 ${qualifiedCount} 家达到 ICP 75 分以上。下一步可以选择客户进入邮件触达。`
            : "任务创建后，系统会先生成搜索策略，再调用搜索接口清洗候选客户。当前页面已经接入真实任务链路，等待首批候选客户返回。"}
        </p>

        <section className="projectCard resultCard">
          <table className="taskTable">
            <thead>
              <tr>
                <th>群发任务</th>
                <th>发送状态</th>
                <th>邮件数量</th>
                <th>成功数/打开数</th>
                <th>邮件主题</th>
                <th>任务状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{currentTask?.id ? currentTask.id.slice(0, 8).toUpperCase() : "待创建"}</td>
                <td>
                  <span className="statusTag">{sentCount ? "已发送" : leads.length ? "待确认" : "待搜索"}</span>
                </td>
                <td>{leads.length}</td>
                <td>{sentCount}封/0封</td>
                <td>中国 B2B 工厂产品推荐</td>
                <td>{currentTask?.status ?? "pending"}</td>
                <td>
                  <button className="tableSendBtn" type="button" data-open-mail="true" onClick={onOpenMail} disabled={running || !leads.length}>
                    发送
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="finalSummary">
          <h3>本次任务总结</h3>
          <p>
            系统已基于任务文本、产品画像、客户画像和高级搜索策略库生成关键词与搜索 query。
            搜索接口返回候选客户后，会自动清洗公司、联系人、ICP 分数，并可进入人工确认和开发信生成。
          </p>
          <p>
            邮件发送前仍会打开确认弹窗；确认后客户可同步进入 CRM，并按 3 天后跟进的节奏继续推进。
          </p>
        </section>
      </div>

      <div className="projectComposer">
        <label className="srOnly" htmlFor="project-command">
          继续输入任务
        </label>
        <textarea
          aria-label="继续输入任务"
          id="project-command"
          name="command"
          placeholder="请输入内容... 例如：重新执行搜索 / 打开邮件确认弹窗"
          value={command}
          onChange={(event) => onCommandChange(event.target.value)}
        />
        <div className="composerBottom">
          <label className="srOnly" htmlFor="project-hosting-mode">
            托管模式
          </label>
          <select aria-label="托管模式" defaultValue="semi" id="project-hosting-mode" name="hostingMode">
            <option value="semi">半托管</option>
            <option value="full">全托管</option>
          </select>
          <button className="sendCircle" type="button" onClick={onSendCommand} disabled={running || command.trim().length === 0}>
            ↑
          </button>
        </div>
      </div>
    </>
  );
}

type AgentSearchActivityProps = {
  active: boolean;
  steps: ActivityStep[];
  metrics: ActivityMetric[];
  queryCount: number;
  executedCount: number;
  resultCount: number;
  leadCount: number;
  leadQualityCounts: LeadQualityCounts;
  logs: ActivityLog[];
  hasError: boolean;
};

function AgentSearchActivity({
  active,
  steps,
  metrics,
  queryCount,
  executedCount,
  resultCount,
  leadCount,
  leadQualityCounts,
  logs,
  hasError
}: AgentSearchActivityProps) {
  const activeMessages = [
    "正在拆解目标市场和客户画像",
    "正在调用 Brave Search 获取官网/目录页",
    "正在标记文章页、社媒页和电商风险",
    "正在合并域名并写入候选池",
    "正在计算 ICP 分数和推荐理由"
  ];
  const [messageIndex, setMessageIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setMessageIndex(0);
      setElapsedSeconds(0);
      return;
    }

    const messageTimer = window.setInterval(() => {
      setMessageIndex((index) => (index + 1) % activeMessages.length);
    }, 1400);
    const elapsedTimer = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => {
      window.clearInterval(messageTimer);
      window.clearInterval(elapsedTimer);
    };
  }, [active, activeMessages.length]);

  const headline = active
    ? activeMessages[messageIndex]
    : leadQualityCounts.rawEvidence
      ? `${leadQualityCounts.rawEvidence} 条原始候选证据，${leadQualityCounts.main} 条主客户`
      : resultCount
      ? `本轮搜索已完成，命中 ${resultCount} 条 Brave 原始结果`
      : leadCount
        ? `已有 ${leadCount} 条主客户写入列表`
        : hasError
          ? "搜索接口失败，任务已保留"
      : "等待搜索任务启动";
  const subline = active
    ? `已执行 ${executedCount}/${queryCount || "-"} 条搜索指令，清洗后会拆分为主客户、待国家复核和拒绝。`
    : leadQualityCounts.rawEvidence
      ? `已执行 ${executedCount}/${queryCount || "-"} 条搜索指令；${formatLeadQualitySummary(leadQualityCounts)}。`
    : resultCount
      ? `已执行 ${executedCount}/${queryCount || "-"} 条搜索指令。`
    : leadCount
      ? `已执行 ${executedCount}/${queryCount || "-"} 条搜索指令；接口失败时会保留已返回候选，可重新执行搜索补齐。`
    : hasError
      ? `已保留 ${queryCount || "-"} 条搜索指令，修复配置或网络后可重新执行搜索。`
    : queryCount
      ? `已生成 ${queryCount} 条搜索指令，将一次性执行本轮全部 query。`
      : "创建任务后会自动生成搜索指令并开始执行。";
  const workText = active
    ? headline
    : resultCount || leadCount
      ? "搜索记录已生成"
      : hasError
        ? "搜索失败，可重新执行"
      : "等待分配搜索任务";

  return (
    <section
      className={active ? "agentSearchActivity isActive" : "agentSearchActivity"}
      aria-live="polite"
      data-search-activity="true"
    >
      <div className="agentActivityHeader">
        <div className="agentActivityMark" aria-hidden="true">
          <Search size={18} />
        </div>
        <div className="agentActivityCopy">
          <strong>{headline}</strong>
          <span>{subline}</span>
        </div>
        {active ? (
          <span className="agentActivityDots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : (
          <span className={hasError ? "agentActivityBadge error" : "agentActivityBadge"}>
            {hasError ? "需重试" : resultCount ? "已完成" : "待启动"}
          </span>
        )}
      </div>

      <div className="agentActivityRail">
        {steps.map((step, index) => (
          <div className={`agentActivityStep ${step.state}`} key={step.title}>
            <span className="agentStepDot">{step.state === "done" ? "✓" : step.state === "failed" ? "!" : index + 1}</span>
            <strong>{step.title}</strong>
            <small>{step.detail}</small>
          </div>
        ))}
      </div>

      {active ? (
        <div className="agentActivityScan" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : null}

      <div className="agentActivityMetrics">
        {metrics.map((metric) => (
          <div className={`agentActivityMetric ${metric.tone ?? "gray"}`} key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>

      <div className={active ? "agentActivityWorkbar isActive" : "agentActivityWorkbar"}>
        <span>正在工作:</span>
        <strong>{workText}</strong>
        <b>{active ? formatElapsedTime(elapsedSeconds) : "--:--"}</b>
        <em>{active ? "AI正在任务执行" : resultCount || leadCount ? "AI任务已记录" : hasError ? "执行失败" : "等待启动"}</em>
      </div>

      <div className="agentActivityLogs" aria-label="AI 执行日志">
        {logs.map((log) => (
          <div className={`agentActivityLog ${log.state}`} key={log.title}>
            <span className="agentLogDot" aria-hidden="true" />
            <strong>{log.title}</strong>
            <small>{log.detail}</small>
          </div>
        ))}
      </div>
    </section>
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

const planningStepNames = ["load_task", "analyze_product_profile", "analyze_customer_profile", "expand_keywords", "plan_search_queries"];
const searchStepNames = ["brave_search", "normalize_leads", "extract_contacts", "score_icp"];

function isBackendTaskActive(task: LeadTask) {
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
  const pendingQueries = task.searchQueries?.filter((query) => query.executionStatus === "pending").length ?? 0;
  const runningQueries = task.searchQueries?.filter((query) => query.executionStatus === "running").length ?? 0;

  return pendingQueries > 0 || runningQueries > 0 || scoreStep?.status === "running" || scoreStep?.status === "pending";
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
  const running = task.agentSteps?.find((step) => names.includes(step.nodeName) && step.status === "running");
  if (running) {
    return stepLabel(running.nodeName);
  }

  const pending = task.agentSteps?.find((step) => names.includes(step.nodeName) && step.status === "pending");
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

function buildKeywordRows(task: LeadTask | null, taskSurfaceActive = false): KeywordRow[] {
  const pendingRows = fallbackKeywordRows.map((row) => keywordRow(row.label, [], ["正在生成"]));
  const searchInstructionRow = keywordRow(
    "搜索指令",
    unique(collectSearchQueries(task).map((query) => query.query)),
    task || taskSurfaceActive ? ["正在生成"] : fallbackSearchQueries
  );

  if (!task) {
    return taskSurfaceActive ? [...pendingRows, searchInstructionRow] : [...fallbackKeywordRows, searchInstructionRow];
  }

  const groups = task.inputPayload?.keywordGroups ?? firstKeywordGroups(task.searchQueries) ?? {};

  return [
    keywordRow(
      "产品扩展词",
      [...(groups.productTerms ?? []), ...(groups.longTailProductTerms ?? [])],
      ["正在生成"]
    ),
    keywordRow("客户类型词", groups.customerIntentTerms, ["正在生成"]),
    keywordRow("品牌/型号词", groups.brandTerms, ["正在生成"]),
    keywordRow(
      "场景/市场词",
      [...(groups.scenarioTerms ?? []), ...(groups.marketTerms ?? [])],
      ["正在生成"]
    ),
    keywordRow("ICP 风险词", groups.excludeTerms, ["正在生成"]),
    searchInstructionRow
  ];
}

function buildProfileSourceRows(task: LeadTask | null): ProfileSourceRow[] {
  const signals = task?.inputPayload?.profileSignals;
  const siteEvidence = task?.inputPayload?.siteEvidence;
  if (!signals && !siteEvidence) {
    return [];
  }

  const rows: ProfileSourceRow[] = [];
  const productSources = siteEvidence?.productSites?.length
    ? formatSiteEvidenceValues(siteEvidence.productSites)
    : formatSourceUrls(signals?.productUrlsUsed);
  const referenceSources = siteEvidence?.referenceCustomerSites?.length
    ? formatSiteEvidenceValues(siteEvidence.referenceCustomerSites)
    : formatSourceUrls(signals?.referenceCustomerUrlsUsed);

  if (productSources.length) {
    rows.push({ label: siteEvidence?.productSites?.length ? "产品网页证据" : "产品画像URL", values: productSources });
  }
  if (referenceSources.length) {
    rows.push({ label: siteEvidence?.referenceCustomerSites?.length ? "客户网页证据" : "客户画像URL", values: referenceSources });
  }
  if (siteEvidence?.summary?.attempted) {
    rows.push({
      label: "读取状态",
      values: [
        `已读取 ${siteEvidence.summary.read ?? 0}/${siteEvidence.summary.attempted}`,
        `失败 ${siteEvidence.summary.failed ?? 0}`
      ]
    });
  }
  if (signals?.marketSelection) {
    const selectedMarkets = signals.marketSelection.targetMarkets ?? [];
    const promptMarkets = signals.marketSelection.promptMarkets ?? [];
    const profileMarkets = signals.marketSelection.profileMarkets ?? [];
    rows.push({
      label: "目标市场来源",
      values: [
        `本轮采用：${selectedMarkets.length ? selectedMarkets.join(", ") : "-"}`,
        `用户输入：${promptMarkets.length ? promptMarkets.join(", ") : "-"}`,
        `画像保存：${profileMarkets.length ? profileMarkets.join(", ") : "-"}`,
        `来源：${formatMarketSource(signals.marketSelection.marketSource)}`
      ]
    });
  }
  if (signals?.aiPlanning?.rejectedQueryCount) {
    rows.push({
      label: "Query 守门",
      values: [`已拦截 ${signals.aiPlanning.rejectedQueryCount} 条异常 GPT query`]
    });
  }
  if (signals?.crmSampleCount) {
    rows.push({ label: "CRM 样本", values: [`${signals.crmSampleCount} 个已选客户`] });
  }

  return rows;
}

function formatMarketSource(source: string | undefined) {
  const labels: Record<string, string> = {
    prompt: "用户输入优先",
    profile: "客户画像默认",
    merged: "合并",
    none: "未识别"
  };
  return source ? labels[source] ?? source : "-";
}

function keywordRow(label: string, values: string[] | undefined, fallback: string[] = []): KeywordRow {
  return {
    label,
    values: (values?.length ? values : fallback).slice(0, label === "搜索指令" ? 8 : 6)
  };
}

function collectSearchQueries(task: LeadTask | null): SearchQuery[] {
  const merged = new Map<string, SearchQuery>();

  for (const query of [...(task?.inputPayload?.searchQueries ?? []), ...(task?.searchQueries ?? [])]) {
    if (!query.query?.trim()) {
      continue;
    }
    const key = query.query.trim();
    const existing = merged.get(key);
    merged.set(key, mergeSearchQuery(existing, query));
  }

  return Array.from(merged.values());
}

function mergeSearchQuery(existing: SearchQuery | undefined, next: SearchQuery): SearchQuery {
  if (!existing) {
    return next;
  }

  return {
    ...existing,
    ...next,
    provider: next.provider ?? existing.provider,
    keywordGroups: next.keywordGroups ?? existing.keywordGroups,
    country: next.country ?? existing.country,
    operatorSource: next.operatorSource ?? existing.operatorSource,
    operatorName: next.operatorName ?? existing.operatorName,
    strategyTemplate: next.strategyTemplate ?? existing.strategyTemplate,
    templateId: next.templateId ?? existing.templateId,
    resultCount: next.resultCount ?? existing.resultCount,
    qualifiedCount: next.qualifiedCount ?? existing.qualifiedCount,
    effectivenessScore: next.effectivenessScore ?? existing.effectivenessScore,
    searchResults: next.searchResults ?? existing.searchResults
  };
}

function buildActivitySteps({
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
}): ActivityStep[] {
  const queryCount = currentTask?.searchQueries?.length ?? 0;
  const executedCount = currentTask?.searchQueries?.filter((query) => query.executionStatus === "completed").length ?? 0;
  const qualifiedCount = leads.filter((lead) => lead.score >= 75).length;
  const hasReturnedLeads = leads.length > 0;

  return [
    {
      title: "任务规划",
      detail: creating ? "读取画像并拆解目标市场" : currentTask ? "任务上下文已生成" : "等待任务",
      state: creating ? "active" : currentTask ? "done" : "pending"
    },
    {
      title: "生成指令",
      detail: queryCount ? `已生成 ${queryCount} 条 query` : creating ? "组合关键词" : "等待关键词",
      state: queryCount ? "done" : creating ? "active" : "pending"
    },
    {
      title: "Brave 搜索",
      detail: searching
        ? `正在执行 ${executedCount}/${queryCount || "-"} 条`
        : searchResult
          ? `执行 ${searchResult.executedQueries} 条，命中 ${searchResult.resultCount} 条`
          : executedCount
            ? `已执行 ${executedCount} 条，候选已回写`
            : hasError
              ? "接口失败，可重新执行"
          : "等待搜索",
      state: searching ? "active" : searchResult || executedCount ? "done" : hasError ? "failed" : "pending"
    },
    {
      title: "清洗候选",
      detail: searchResult
        ? `${leadQualityCounts.rawEvidence} 条证据，${leadQualityCounts.main} 条主客户，${leadQualityCounts.needsCountryReview} 条待国家复核`
        : hasReturnedLeads
          ? `已有 ${leads.length} 条主客户进入表格`
        : searching
          ? "标记社媒/文章/电商风险"
          : hasError
            ? "未返回候选，等待重试"
          : "等待结果",
      state: searching ? "active" : searchResult || hasReturnedLeads ? "done" : hasError ? "failed" : "pending"
    },
    {
      title: "ICP 评分",
      detail: leads.length ? `已产出 ${leads.length} 条主客户，${qualifiedCount} 条 75+` : searching ? "正在评分和归因" : "等待清洗",
      state: leads.length ? "done" : searching ? "active" : "pending"
    }
  ];
}

function buildActivityMetrics({
  currentTask,
  searchResult,
  leads,
  leadQualityCounts
}: {
  currentTask: LeadTask | null;
  searchResult: SearchRunResult | null;
  leads: DisplayLead[];
  leadQualityCounts: LeadQualityCounts;
}): ActivityMetric[] {
  const queryCount = currentTask?.searchQueries?.length ?? 0;
  const executedCount = currentTask?.searchQueries?.filter((query) => query.executionStatus === "completed").length ?? 0;
  const failedQueries = searchResult?.failedQueries ?? 0;

  return [
    {
      label: "搜索指令",
      value: queryCount ? `${executedCount}/${queryCount}` : "待生成",
      tone: "blue"
    },
    {
      label: "Brave 命中",
      value: searchResult ? String(searchResult.resultCount) : executedCount ? `已执行 ${executedCount}` : "等待",
      tone: "orange"
    },
    {
      label: "主客户",
      value: String(leadQualityCounts.main || leads.length),
      tone: "green"
    },
    {
      label: failedQueries ? "失败指令" : "待复核/拒绝",
      value: searchResult
        ? String(failedQueries || leadQualityCounts.needsCountryReview + leadQualityCounts.rejected)
        : String(leadQualityCounts.needsCountryReview + leadQualityCounts.rejected),
      tone: failedQueries ? "orange" : "gray"
    }
  ];
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
  const executedCount = currentTask?.searchQueries?.filter((query) => query.executionStatus === "completed").length ?? 0;
  const qualifiedCount = leads.filter((lead) => lead.score >= 75).length;
  const hasTask = Boolean(currentTask);
  const hasLeads = leads.length > 0;

  return [
    {
      title: "LLM思考中",
      detail: creating ? "正在理解任务、产品画像和目标市场" : hasTask ? "任务理解完成" : "等待用户输入",
      state: creating ? "active" : hasTask ? "done" : "pending"
    },
    {
      title: "技能挑选中",
      detail: creating ? "选择搜索、清洗、ICP评分工具" : hasTask ? "工具链已选定" : "等待任务规划",
      state: creating ? "active" : hasTask ? "done" : "pending"
    },
    {
      title: "任务规划中",
      detail: queryCount ? `已生成 ${queryCount} 条搜索指令` : creating ? "正在生成执行步骤" : "等待画像读取",
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
      state: searching ? "active" : searchResult || executedCount ? "done" : hasError ? "failed" : "pending"
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
      state: searchResult || hasLeads ? "done" : searching ? "active" : hasError ? "failed" : "pending"
    },
    {
      title: "检索结果分析",
      detail: hasLeads ? `${leads.length} 条主客户，${qualifiedCount} 条 ICP 75+` : searching ? "正在清洗、去重和评分" : hasError ? "等待重新搜索" : "等待结果分析",
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

function formatElapsedTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function firstKeywordGroups(queries: SearchQuery[] | undefined) {
  return queries?.find((query) => query.keywordGroups)?.keywordGroups ?? null;
}

function summarizeSearchResultFromTask(task: LeadTask): SearchRunResult {
  const completedQueries = task.searchQueries?.filter((query) => query.executionStatus === "completed") ?? [];
  const failedQueries = task.searchQueries?.filter((query) => query.executionStatus === "failed") ?? [];
  const pendingQueries = task.searchQueries?.filter((query) => query.executionStatus === "pending") ?? [];
  const runningQueries = task.searchQueries?.filter((query) => query.executionStatus === "running") ?? [];
  const resultCount = (task.searchQueries ?? []).reduce((sum, query) => sum + (query.resultCount ?? 0), 0);
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

function buildDisplaySearchResults(task: LeadTask | null): DisplaySearchResult[] {
  const rows: DisplaySearchResult[] = [];
  const seen = new Set<string>();

  for (const query of task?.searchQueries ?? []) {
    for (const result of query.searchResults ?? []) {
      const key = searchResultKey(result);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push({
        id: `${query.id ?? query.query}:${key}`,
        title: result.title || formatWebsite(result.url) || "Untitled result",
        domain: result.domain || formatWebsite(result.url),
        url: result.url || "",
        country: query.country ?? "-",
        query: query.query,
        status: query.executionStatus ?? "-"
      });
    }
  }

  return rows;
}

function searchResultKey(result: SearchResult) {
  if (result.url) {
    return result.url.replace(/\/$/, "").toLowerCase();
  }

  return result.title?.trim().toLowerCase() ?? "";
}

function buildDisplayLeads(task: LeadTask | null): DisplayLead[] {
  const targetMarkets = taskTargetMarkets(task);
  return (task?.leadCandidates ?? [])
    .filter((lead) => {
      return isDisplayableLeadCandidate(lead);
    })
    .map((lead) => ({ displayLead: buildDisplayLead(lead), priority: displayLeadPriority(lead, targetMarkets) }))
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
}

function isMainLeadStatus(status: string | undefined) {
  return ["review", "qualified", "approved", "contacted", "email_sent"].includes(status ?? "");
}

function isDisplayableLeadCandidate(lead: LeadCandidate) {
  const score = lead.icpScore?.score ?? 0;
  return (
    isMainLeadStatus(lead.status) &&
    score >= 50 &&
    (lead.countryConfidence === "high" || lead.countryConfidence === "medium") &&
    !lead.countryConflict
  );
}

function summarizeLeadQualityCounts(task: LeadTask | null): LeadQualityCounts {
  const candidates = task?.leadCandidates ?? [];
  const main = candidates.filter(isDisplayableLeadCandidate).length;
  const rejected = candidates.filter((lead) => lead.status === "rejected").length;
  const needsCountryReview = candidates.filter(
    (lead) =>
      lead.status !== "rejected" &&
      !isDisplayableLeadCandidate(lead) &&
      (lead.status === "needs_country_review" ||
        lead.status === "country_conflict_review" ||
        lead.countryConflict ||
        lead.countryConfidence === "low" ||
        lead.countryConfidence === "unknown")
  ).length;
  const rawEvidence = candidates.length;
  const other = Math.max(rawEvidence - main - rejected - needsCountryReview, 0);

  return {
    rawEvidence,
    main,
    needsCountryReview,
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
  if (counts.other) {
    parts.push(`${counts.other} 条其他待处理`);
  }

  return parts.join("，");
}

function buildDisplayLead(lead: LeadCandidate): DisplayLead {
  const email = formatEmailContacts(lead.contacts?.filter((contact) => contact.type === "email").map((contact) => contact.value));
  const phone = formatPhoneContacts(lead.contacts?.filter((contact) => contact.type === "phone").map((contact) => contact.value));
  const social = formatSocialProfiles(lead.contacts?.filter((contact) => contact.type === "social").map((contact) => contact.value));
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
    raw: lead
  };
}

function chooseDisplayCountry(storedCountry: string, contactCountry: string) {
  if (!storedCountry) {
    return contactCountry;
  }

  if (contactCountry && normalizeDisplayMarket(storedCountry) !== normalizeDisplayMarket(contactCountry)) {
    return contactCountry;
  }

  return storedCountry;
}

function displayCompanyName(lead: LeadCandidate) {
  const currentName = cleanupDisplayCompanyName(lead.companyName);
  const domainName = companyNameFromUrl(lead.website ?? lead.sourceUrl);
  const attributedName = extractDisplayAttributedCompanyName(currentName);

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
    .replace(/\b(home|official site|website|about us|contact us|logo)\b/gi, "")
    .replace(/^\s*(?:welcome to|official)\s+/i, "")
    .replace(/\s+\b(?:homepage|home page)\b$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[|:\\\-\s]+|[|:\\\-\s]+$/g, "")
    .trim();
}

function isLikelyDisplayCompanyName(value: string, domainName: string) {
  const name = cleanupDisplayCompanyName(value);
  const lower = name.toLowerCase();
  if (!name || name.length > 72 || looksLikeDisplayProductTitle(name)) {
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

function looksLikeDisplayProductTitle(value: string) {
  const lower = value.toLowerCase();
  return (
    containsAny(lower, displayProductTitleTerms) ||
    /\b(?:\d{2,5}\s?w|\d{2,5}w|48v|24v|85-300|vac|vdc|sfp\+?|100g|10g)\b/i.test(value) ||
    (containsAny(lower, displayTelecomBrandTerms) &&
      containsAny(lower, ["rectifier", "module", "board", "rru", "bbu", "aau", "networking equipment", "hardware repair"]))
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
    .map((part) => (displayDomainAcronymTerms.has(part.toLowerCase()) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
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

  if (contacts.some((contact) => contact.type === "email" || contact.type === "phone")) priority += 4;
  if (containsAny(text, displayBuyerTerms)) priority += 4;
  if (containsAny(text, displaySpecificProductTerms)) priority += 3;
  if (lead.country) priority += 1;
  const explicitMarkets = explicitDisplayMarkets(targetMarkets);
  if (lead.country && explicitMarkets.length) {
    priority += matchesDisplayMarket(lead.country, explicitMarkets) ? 12 : -18;
  }
  if (domain && !isDiscoveryDomain(domain) && looksLikeOfficialPath(path)) priority += 3;
  if (isDiscoveryDomain(domain) || isDiscoveryPath(path) || containsAny(text, displayDiscoveryTerms)) priority -= 8;

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
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function looksLikeOfficialPath(path: string) {
  return (
    !path ||
    path === "/" ||
    ["/about", "/contact", "/company", "/products", "/solutions", "/services", "/telecom", "/network"].some((term) =>
      path.includes(term)
    )
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
  hctgroup: "HCT Group",
  ispsupplies: "ISP Supplies",
  mfcomm: "MF Communications",
  screamerelectronicservices: "Screamer Electronic Services",
  tempestns: "Tempest"
};

const displayDomainAcronymTerms = new Set(["isp", "hct", "ats", "mf", "usa", "uk", "uae"]);

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
      draft.sendLogs?.some((log) => Boolean(log.sentAt) || ["sent", "delivered"].includes(log.status))
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
  aiEvaluation?: {
    resultType?: unknown;
    buyerType?: unknown;
    matchedSignals?: unknown;
  } | null;
};

function buildCustomerBrief(lead: LeadCandidate) {
  const payload = icpReasonPayload(lead.icpScore?.reasons);
  const aiBrief = customerBriefFromAi(payload?.aiEvaluation);
  if (aiBrief) return aiBrief;

  const reasonText = firstIcpReason(lead.icpScore?.reasons);
  const summary = typeof payload?.summary === "string" ? payload.summary : "";
  const matchedSignals = Array.isArray(payload?.aiEvaluation?.matchedSignals)
    ? payload.aiEvaluation.matchedSignals.filter((value): value is string => typeof value === "string")
    : [];
  const text = [lead.companyName, lead.website, lead.sourceUrl, summary, reasonText, ...matchedSignals]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (containsAny(text, ["rfq", "request for quotation", "tender", "procurement", "vendor registration", "supplier registration"])) {
    return "采购/RFQ 线索";
  }
  if (containsAny(text, ["factory", "industrial", "machine", "equipment", "component", "parts"]) && !containsAny(text, ["telecom", "base station", "fiber", "olt", "sfp", "tower", "isp", "wisp"])) {
    return "行业设备客户";
  }
  if (containsAny(text, ["telecom power", "rectifier", "dc power", "power system", "cell site power"])) {
    return "电源/模块维护客户";
  }
  if (containsAny(text, ["ftth", "olt", "fiber network", "optical transport", "transmission network", "sfp"])) {
    return "光纤/FTTH 运维客户";
  }
  if (containsAny(text, ["tower maintenance", "towerco", "cell tower", "site maintenance"])) {
    return "铁塔/站点维护客户";
  }
  if (containsAny(text, ["base station", "ran maintenance", "bts", "radio access network", "field maintenance"])) {
    return "基站/RAN 维护客户";
  }
  if (containsAny(text, ["mobile network operator", "telecom operator", "network operator", "isp", "wisp"])) {
    return "运营商/ISP 客户";
  }
  if (containsAny(text, ["system integrator", "integrator", "network contractor", "infrastructure contractor", "engineering contractor"])) {
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

function customerBriefFromAi(aiEvaluation: IcpReasonPayload["aiEvaluation"]) {
  if (!aiEvaluation) return "";

  const resultType = typeof aiEvaluation.resultType === "string" ? aiEvaluation.resultType : "";
  const buyerType = typeof aiEvaluation.buyerType === "string" ? aiEvaluation.buyerType.toLowerCase() : "";

  if (["directory", "content_article", "job_page", "market_report", "irrelevant"].includes(resultType)) {
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
  if (containsAny(buyerType, ["ftth", "fiber", "optical", "olt", "sfp"])) return "光纤/FTTH 运维客户";
  if (containsAny(buyerType, ["tower", "towerco"])) return "铁塔/站点维护客户";
  if (containsAny(buyerType, ["base station", "ran", "bts", "field service"])) return "基站/RAN 维护客户";
  if (containsAny(buyerType, ["operator", "isp", "wisp"])) return "运营商/ISP 客户";
  if (containsAny(buyerType, ["integrator", "contractor", "engineering"])) return "工程/系统集成客户";
  if (containsAny(buyerType, ["maintenance", "repair", "service"])) return "维修维护服务客户";
  if (containsAny(buyerType, ["supplier", "distributor", "reseller", "stockist", "wholesale"])) return "渠道商待复核";
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

function buildFlowRows(
  task: LeadTask | null,
  state: {
    creating: boolean;
    searching: boolean;
    approving: boolean;
    leadCount: number;
    leadQualityCounts: LeadQualityCounts;
    sentCount: number;
    crmSyncedCount: number;
    pendingFollowupCount: number;
  }
): FlowRow[] {
  const queryCount = task?.searchQueries?.length ?? 0;
  const approvedCount = task?.leadCandidates?.filter((lead) => lead.status === "approved").length ?? 0;
  const hasError = task?.agentSteps?.some((step) => step.status === "failed") ?? false;

  return [
    {
      title: "任务规划",
      description: state.creating
        ? "正在读取画像并生成搜索策略"
        : task
          ? `已生成 ${queryCount} 条搜索指令`
          : "等待创建任务",
      state: hasError ? "failed" : task ? "done" : state.creating ? "active" : "pending"
    },
    {
      title: "筛选目标客户",
      description: state.searching
        ? "正在执行搜索并清洗候选客户"
        : state.leadCount
          ? `${state.leadQualityCounts.main} 条主客户，${state.leadQualityCounts.needsCountryReview} 条待国家复核`
          : task
            ? state.leadQualityCounts.rawEvidence
              ? formatLeadQualitySummary(state.leadQualityCounts)
              : "搜索指令已就绪，等待返回候选客户"
            : "等待任务规划完成",
      state: state.leadCount || state.leadQualityCounts.rawEvidence ? "done" : task || state.searching ? "active" : "pending"
    },
    {
      title: "邮件触达",
      description: state.approving
        ? "正在生成开发信草稿"
        : state.sentCount
          ? `已发送 ${state.sentCount} 封 Gmail 开发信`
          : approvedCount
          ? `已审批 ${approvedCount} 家客户，等待邮件确认`
          : state.leadCount
            ? "选择客户后生成可确认发送的开发信"
            : "等待候选客户确认",
      state: state.sentCount || approvedCount ? "done" : state.leadCount || state.approving ? "active" : "pending"
    },
    {
      title: "同步 CRM 并标记",
      description: state.crmSyncedCount
        ? `已同步 ${state.crmSyncedCount} 家客户，创建 ${state.pendingFollowupCount} 个跟进提醒`
        : approvedCount || state.sentCount
          ? "邮件确认后同步 CRM 并创建跟进提醒"
          : "等待邮件确认后同步",
      state: state.crmSyncedCount ? "done" : approvedCount || state.sentCount ? "active" : "pending"
    }
  ];
}

function scoreStars(score: number) {
  if (score >= 85) return "★★★★★";
  if (score >= 70) return "★★★★☆";
  if (score >= 50) return "★★★☆☆";
  if (score > 0) return "★★☆☆☆";
  return "☆☆☆☆☆";
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

  return countries.length === 1 ? countries[0] ?? "" : "";
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
  const internationalDigits = trimmed.startsWith("+") ? digits : digits.startsWith("00") ? digits.slice(2) : "";

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

  const match = domainCountrySuffixes.find(([suffix]) => host === suffix.slice(1) || host.endsWith(suffix));
  return match?.[1] ?? "";
}

function hostFromContactValue(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";

  if (trimmed.includes("@") && !trimmed.startsWith("http")) {
    return trimmed.split("@").pop()?.replace(/[),.;:]+$/g, "") ?? "";
  }

  try {
    return new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function titleCaseCountry(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((part) => (countryLowercaseWords.has(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
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
  return chunks.length > 1 && chunks.some((chunk, index) => chunks.indexOf(chunk) !== index && chunk.replace(/\D/g, "").length >= 4);
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function formatEmailContacts(values: string[] | undefined) {
  return unique(values ?? [])
    .sort((left, right) => emailContactPriority(left) - emailContactPriority(right))
    .slice(0, 1)
    .join(" ; ");
}

function emailContactPriority(value: string) {
  const localPart = value.split("@")[0]?.toLowerCase() ?? "";
  const priorityTerms = ["sales", "info", "contact", "enquiries", "enquiry", "support", "office"];
  const index = priorityTerms.findIndex((term) => localPart === term || localPart.startsWith(`${term}.`));
  return index === -1 ? priorityTerms.length : index;
}

function formatSourceUrls(values: string[] | undefined) {
  return unique((values ?? []).map((value) => formatWebsite(value)).filter((value) => value !== "-")).slice(0, 4);
}

function formatSiteEvidenceValues(values: SiteEvidenceRow[] | undefined) {
  return (values ?? [])
    .map((value) => {
      const domain = value.domain || formatWebsite(value.finalUrl || value.url);
      if (value.status === "read") {
        return `${domain} 已读取${value.wordCount ? ` ${value.wordCount}词` : ""}`;
      }
      return `${domain} 读取失败`;
    })
    .slice(0, 4);
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
