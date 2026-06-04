"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CalendarDays,
  Check,
  CircleCheck,
  CirclePlus,
  ClipboardList,
  FileText,
  MapPinCheck,
  PackageCheck,
  Search,
  Send,
  Settings,
  Truck,
  Upload,
  UserPlus,
  WalletCards
} from "lucide-react";
import { AppShell } from "../app-shell";
import { TableLoadingState } from "../table-loading-state";

type ViewKey = "overview" | "create" | "templates" | "addressBook" | "account";
type TaskTab = "tasks" | "recipients";
type TaskStatusFilter = "all" | "completed" | "queued" | "ready";
type AddressStatus = "unchecked" | "valid" | "warning";
type MailingStatus = "draft" | "ready" | "queued" | "completed";
type TemplateScope = "mine" | "system";
type TemplateTypeFilter = "all" | "postcard" | "letter";
type AccountTab = "account" | "prices";

type MailingRecipient = {
  id: string;
  companyName: string;
  contactName: string;
  country: string;
  city: string;
  addressLine1: string;
  addressLine2?: string;
  postalCode: string;
  phone?: string;
  website?: string;
  addressStatus: AddressStatus;
};

type MailingTemplate = {
  id: string;
  name: string;
  format: string;
  product: string;
  frontTitle: string;
  backTitle: string;
  tone: string;
};

type TemplateCard = MailingTemplate & {
  source: TemplateScope;
  kind: "postcard" | "letter";
  country: string;
  price: number;
  size: string;
};

type MailingTask = {
  id: string;
  taskName: string;
  product: string;
  templateName: string;
  recipientCount: number;
  countries: string[];
  amountUsd: number;
  status: MailingStatus;
  providerMode: "sandbox" | "real";
  providerMessageId?: string;
  createdAt: string;
  executedAt?: string;
};

type MailingBootstrap = {
  recipients: MailingRecipient[];
  templates: MailingTemplate[];
  tasks: MailingTask[];
};

const secondaryNav: Array<{ key: ViewKey; label: string; icon: typeof ClipboardList }> = [
  { key: "overview", label: "任务概览", icon: ClipboardList },
  { key: "create", label: "创建任务", icon: CirclePlus },
  { key: "templates", label: "模板库", icon: FileText },
  { key: "addressBook", label: "地址簿", icon: BookOpen },
  { key: "account", label: "账户管理", icon: Settings }
];

const createSteps = ["设置任务名称", "选择收件人", "地址检测", "选择要邮寄的明信片/信件", "校验并提交"];

const countries = ["全部", "美国", "加拿大", "英国", "德国", "欧洲（法意西）"];

const fallbackRecipients: MailingRecipient[] = [
  {
    id: "recipient-emirates-tower-power",
    companyName: "Emirates Tower Power",
    contactName: "Procurement Manager",
    country: "UAE",
    city: "Dubai",
    addressLine1: "Office 1205, Business Bay",
    postalCode: "00000",
    phone: "+971 4 555 0188",
    website: "emiratestowerpower.ae",
    addressStatus: "unchecked"
  },
  {
    id: "recipient-gulf-telecom",
    companyName: "Gulf Telecom Supplies FZE",
    contactName: "Sourcing Team",
    country: "UAE",
    city: "Dubai",
    addressLine1: "Jebel Ali Free Zone, Warehouse 8",
    postalCode: "00000",
    phone: "+971 4 555 0126",
    website: "gulftelecom.ae",
    addressStatus: "unchecked"
  },
  {
    id: "recipient-riyadh-radio",
    companyName: "Riyadh Radio Parts",
    contactName: "Spare Parts Buyer",
    country: "Saudi Arabia",
    city: "Riyadh",
    addressLine1: "King Fahd Road, Telecom District",
    postalCode: "12212",
    phone: "+966 11 555 0188",
    website: "riyadhradio.sa",
    addressStatus: "unchecked"
  },
  {
    id: "recipient-metro-network",
    companyName: "Metro Network Systems",
    contactName: "Operations Director",
    country: "UAE",
    city: "Abu Dhabi",
    addressLine1: "Al Reem Island, Tower B",
    postalCode: "00000",
    website: "metronetwork.ae",
    addressStatus: "unchecked"
  }
];

const fallbackTemplates: MailingTemplate[] = [
  {
    id: "telecom-spares-postcard",
    name: "通信备件明信片",
    format: "4x6 明信片",
    product: "RRU / BBU / AAU 备件",
    frontTitle: "Reliable telecom spare parts, ready to ship",
    backTitle: "Factory supply for RRU, BBU, rectifier and microwave parts",
    tone: "blue"
  },
  {
    id: "network-rollout-letter",
    name: "网络建设项目信件",
    format: "6x9 信件",
    product: "站点建设与替换件",
    frontTitle: "Support for network rollout and site maintenance",
    backTitle: "Send us your BOM, we will match stock and lead time",
    tone: "green"
  },
  {
    id: "tower-power-card",
    name: "塔站电源明信片",
    format: "6x11 明信片",
    product: "整流模块 / 电源系统",
    frontTitle: "Telecom power modules for urgent replacement",
    backTitle: "Huawei, ZTE, Eltek, Delta and compatible stock",
    tone: "amber"
  }
];

const systemTemplateCards: TemplateCard[] = [
  {
    id: "system-us-4x6",
    source: "system",
    kind: "postcard",
    country: "美国",
    price: 1,
    size: "4x6",
    name: "明信片-美国4*6特快",
    format: "4x6 明信片",
    product: "通用产品介绍",
    frontTitle: "Your reliable telecom parts wholesaler",
    backTitle: "Fast delivery, tested parts, stable supply for urgent network maintenance",
    tone: "blue"
  },
  {
    id: "system-us-6x9",
    source: "system",
    kind: "postcard",
    country: "美国",
    price: 1.1,
    size: "6x9",
    name: "明信片-美国6*9特快",
    format: "6x9 明信片",
    product: "通信备件",
    frontTitle: "Telecom spare parts ready to ship",
    backTitle: "Huawei, ZTE, Ericsson, Nokia compatible stock and replacement parts",
    tone: "blue"
  },
  {
    id: "system-us-letter",
    source: "system",
    kind: "letter",
    country: "美国",
    price: 1.4,
    size: "8.5x11",
    name: "信件-美国8.5*11特快",
    format: "8.5x11 信件",
    product: "公司介绍信",
    frontTitle: "Factory supply letter",
    backTitle: "A concise outreach letter for procurement managers and integrators",
    tone: "letter"
  },
  {
    id: "system-ca-4x6",
    source: "system",
    kind: "postcard",
    country: "加拿大",
    price: 1.4,
    size: "4x6",
    name: "明信片-加拿大4*6特快",
    format: "4x6 明信片",
    product: "塔站电源",
    frontTitle: "Telecom power modules for urgent replacement",
    backTitle: "Rectifier modules and power system spares with fast matching support",
    tone: "green"
  },
  {
    id: "system-ca-letter",
    source: "system",
    kind: "letter",
    country: "加拿大",
    price: 2,
    size: "8.5x11",
    name: "信件-加拿大8.5*11特快",
    format: "8.5x11 信件",
    product: "项目合作信",
    frontTitle: "Network rollout support",
    backTitle: "Send us your BOM and we will match stock, lead time and alternatives",
    tone: "letter"
  },
  {
    id: "system-eu-6x11",
    source: "system",
    kind: "postcard",
    country: "德国",
    price: 2.2,
    size: "6x11",
    name: "明信片-德国6*11特快",
    format: "6x11 明信片",
    product: "微波回传",
    frontTitle: "Microwave backhaul parts",
    backTitle: "Stable supply for site maintenance, replacement and rollout teams",
    tone: "amber"
  }
];

const priceRows = [
  { country: "United States", flag: "🇺🇸", product: "4*6明信片", carrier: "USPS", price: 1, eta: "5-7工作日" },
  { country: "United States", flag: "🇺🇸", product: "6*9明信片", carrier: "USPS", price: 1.1, eta: "5-7工作日" },
  { country: "United States", flag: "🇺🇸", product: "6*11明信片", carrier: "USPS", price: 1.4, eta: "5-7工作日" },
  { country: "United States", flag: "🇺🇸", product: "8.5*11信件", carrier: "USPS", price: 1.4, eta: "5-7工作日" },
  { country: "Canada", flag: "🇨🇦", product: "4*6明信片", carrier: "Canada Post", price: 1.4, eta: "5-7工作日" },
  { country: "Canada", flag: "🇨🇦", product: "6*9明信片", carrier: "Canada Post", price: 1.5, eta: "5-7工作日" },
  { country: "Canada", flag: "🇨🇦", product: "6*11明信片", carrier: "Canada Post", price: 2, eta: "5-7工作日" },
  { country: "Canada", flag: "🇨🇦", product: "8.5*11信件", carrier: "Canada Post", price: 2, eta: "5-7工作日" }
];

const fallbackTasks: MailingTask[] = [
  {
    id: "mailing-demo-001",
    taskName: "UAE 高分客户明信片触达",
    product: "RRU / BBU / AAU 备件",
    templateName: "通信备件明信片",
    recipientCount: 2,
    countries: ["UAE"],
    amountUsd: 7.8,
    status: "completed",
    providerMode: "sandbox",
    providerMessageId: "sandbox_postcard_001",
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    executedAt: new Date(Date.now() - 82800000).toISOString()
  }
];

const statusLabel: Record<MailingStatus, string> = {
  draft: "草稿",
  ready: "待寄出",
  queued: "运输中",
  completed: "已完成"
};

export function BrochuresClient() {
  const [view, setView] = useState<ViewKey>("overview");
  const [taskTab, setTaskTab] = useState<TaskTab>("tasks");
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatusFilter>("all");
  const [templateScope, setTemplateScope] = useState<TemplateScope>("mine");
  const [templateType, setTemplateType] = useState<TemplateTypeFilter>("all");
  const [templateCountry, setTemplateCountry] = useState("全部");
  const [accountTab, setAccountTab] = useState<AccountTab>("account");
  const [taskName, setTaskName] = useState("UAE 高分客户明信片触达");
  const [countryGroup, setCountryGroup] = useState("UAE / Saudi Arabia");
  const [product, setProduct] = useState("RRU / BBU / AAU 备件");
  const [selectedTemplateId, setSelectedTemplateId] = useState(fallbackTemplates[0]?.id ?? "");
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>(
    fallbackRecipients.slice(0, 2).map((recipient) => recipient.id)
  );
  const [recipients, setRecipients] = useState<MailingRecipient[]>(fallbackRecipients);
  const [templates, setTemplates] = useState<MailingTemplate[]>(fallbackTemplates);
  const [tasks, setTasks] = useState<MailingTask[]>(fallbackTasks);
  const [searchText, setSearchText] = useState("");
  const [templateSearchText, setTemplateSearchText] = useState("");
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [executingTaskId, setExecutingTaskId] = useState<string | null>(null);
  const [latestTask, setLatestTask] = useState<MailingTask | null>(fallbackTasks[0] ?? null);
  const [statusText, setStatusText] = useState("明信片任务已准备，可创建新任务并执行沙盒调用。");

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0];
  const selectedRecipients = recipients.filter((recipient) => selectedRecipientIds.includes(recipient.id));

  const filteredRecipients = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    if (!needle) return recipients;
    return recipients.filter((recipient) =>
      [recipient.companyName, recipient.country, recipient.city, recipient.website ?? "", recipient.contactName].some((value) =>
        value.toLowerCase().includes(needle)
      )
    );
  }, [recipients, searchText]);

  const filteredTasks = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesStatus = taskStatusFilter === "all" || task.status === taskStatusFilter;
      const matchesSearch =
        !needle ||
        [task.taskName, task.templateName, task.product, task.countries.join(" ")].some((value) =>
          value.toLowerCase().includes(needle)
        );
      return matchesStatus && matchesSearch;
    });
  }, [tasks, searchText, taskStatusFilter]);

  const templateCards = useMemo(() => {
    const mine = templates.map<TemplateCard>((template, index) => ({
      ...template,
      source: "mine",
      kind: template.format.includes("信件") ? "letter" : "postcard",
      country: index % 2 === 0 ? "美国" : "加拿大",
      price: Number((estimateAmount(1) / (index + 1)).toFixed(1)),
      size: template.format.split(" ")[0] ?? "4x6"
    }));
    const sourceCards = templateScope === "mine" ? mine : systemTemplateCards;
    const needle = templateSearchText.trim().toLowerCase();

    return sourceCards.filter((template) => {
      const matchesKind = templateType === "all" || template.kind === templateType;
      const matchesCountry = templateCountry === "全部" || template.country === templateCountry || templateCountry.startsWith("欧洲");
      const matchesSearch =
        !needle ||
        [template.name, template.product, template.frontTitle, template.backTitle].some((value) => value.toLowerCase().includes(needle));
      return matchesKind && matchesCountry && matchesSearch;
    });
  }, [templates, templateCountry, templateScope, templateSearchText, templateType]);

  const metrics = useMemo(() => {
    const totalTasks = tasks.length;
    const queuedRecipients = tasks
      .filter((task) => task.status === "queued")
      .reduce((total, task) => total + task.recipientCount, 0);
    const readyRecipients = tasks
      .filter((task) => task.status === "ready")
      .reduce((total, task) => total + task.recipientCount, 0);
    const completedRecipients = tasks
      .filter((task) => task.status === "completed")
      .reduce((total, task) => total + task.recipientCount, 0);

    return [
      { label: "任务总数", value: String(totalTasks), tone: "blue", icon: FileText },
      { label: "运输中（收件人数）", value: String(queuedRecipients), tone: "violet", icon: Truck },
      { label: "待寄出（收件人数）", value: String(readyRecipients), tone: "amber", icon: PackageCheck },
      { label: "已完成（收件人数）", value: String(completedRecipients), tone: "green", icon: CircleCheck }
    ];
  }, [tasks]);

  const currentStep = !taskName.trim()
    ? 0
    : !selectedRecipients.length
      ? 1
      : selectedRecipients.some((recipient) => recipient.addressStatus !== "valid")
        ? 2
        : !selectedTemplate
          ? 3
          : 4;
  const allSelectedAddressesValid =
    selectedRecipients.length > 0 && selectedRecipients.every((recipient) => recipient.addressStatus === "valid");
  const canSubmit = Boolean(taskName.trim() && selectedTemplate && allSelectedAddressesValid);

  useEffect(() => {
    let cancelled = false;

    async function loadMailingData() {
      setLoading(true);
      try {
        const payload = await apiRequest<MailingBootstrap>("/api/postcard-mailings");
        if (cancelled) return;
        setRecipients(payload.recipients.length ? payload.recipients : fallbackRecipients);
        setTemplates(payload.templates.length ? payload.templates : fallbackTemplates);
        setTasks(payload.tasks.length ? payload.tasks : fallbackTasks);
        setLatestTask(payload.tasks[0] ?? fallbackTasks[0] ?? null);
      } catch {
        if (!cancelled) {
          setStatusText("邮寄接口暂不可用，已加载本地演示数据。");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadMailingData();

    return () => {
      cancelled = true;
    };
  }, []);

  function toggleRecipient(recipientId: string) {
    setSelectedRecipientIds((current) =>
      current.includes(recipientId) ? current.filter((id) => id !== recipientId) : [...current, recipientId]
    );
  }

  async function validateAddresses() {
    if (!selectedRecipients.length) {
      setStatusText("请先选择至少 1 个收件人。");
      return;
    }

    setValidating(true);
    try {
      const payload = await apiRequest<{ recipients: MailingRecipient[] }>("/api/postcard-mailings/validate-addresses", {
        method: "POST",
        body: JSON.stringify({ recipients: selectedRecipients })
      });
      setRecipients((current) =>
        current.map((recipient) => payload.recipients.find((item) => item.id === recipient.id) ?? recipient)
      );
      setStatusText(`地址检测完成，${payload.recipients.filter((item) => item.addressStatus === "valid").length} 个地址可寄送。`);
    } catch (error) {
      setStatusText(errorMessage(error));
    } finally {
      setValidating(false);
    }
  }

  async function submitTask() {
    if (!canSubmit || !selectedTemplate) {
      setStatusText("请先完成收件人选择、地址检测和模板选择。");
      return;
    }

    setSubmitting(true);
    try {
      const payload = await apiRequest<{ task: MailingTask }>("/api/postcard-mailings", {
        method: "POST",
        body: JSON.stringify({
          taskName,
          countryGroup,
          product,
          templateId: selectedTemplate.id,
          recipients: selectedRecipients,
          realSend: false
        })
      });
      setTasks((current) => [payload.task, ...current.filter((task) => task.id !== payload.task.id)]);
      setLatestTask(payload.task);
      setStatusText(`已创建邮寄任务 ${payload.task.id.slice(0, 8).toUpperCase()}，可在任务概览执行沙盒寄送。`);
      setView("overview");
    } catch (error) {
      setStatusText(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function executeTask(taskToExecute: MailingTask | null = latestTask) {
    if (!taskToExecute) {
      setStatusText("请先创建邮寄任务。");
      return;
    }

    setExecutingTaskId(taskToExecute.id);
    try {
      const payload = await apiRequest<{ task: MailingTask; realSendAvailable: boolean }>(
        `/api/postcard-mailings/${taskToExecute.id}/send`,
        {
          method: "POST",
          body: JSON.stringify({ confirmRealSend: false })
        }
      );
      setLatestTask(payload.task);
      setTasks((current) => current.map((task) => (task.id === payload.task.id ? payload.task : task)));
      setStatusText(
        payload.realSendAvailable
          ? "沙盒调用成功。真实寄送已配置，提交真实寄送前仍需要你确认收件人和费用。"
          : `沙盒寄送成功：${payload.task.providerMessageId ?? "已生成供应商记录"}`
      );
    } catch (error) {
      setStatusText(errorMessage(error));
    } finally {
      setExecutingTaskId(null);
    }
  }

  return (
    <AppShell
      activePath="/brochures"
      eyebrow="邮寄明信片"
      hidePageHeader
      mainClassName="brochureMain"
      pageClassName="brochurePage"
      title="邮寄明信片"
    >
      <section className="brochureShell">
        <header className="brochureTopBar">
          <div className="brochureTopTitle">
            <h1>邮寄明信片</h1>
            <p>给高分客户寄产品册、设备清单、项目介绍。</p>
          </div>
          <nav className="brochureTopTabs" aria-label="邮寄明信片导航">
            {secondaryNav.map(({ key, label, icon: Icon }) => (
              <button
                aria-current={view === key ? "page" : undefined}
                className={view === key ? "active" : ""}
                key={key}
                onClick={() => setView(key)}
                type="button"
              >
                <Icon aria-hidden="true" size={15} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </header>

        <section className={view === "overview" ? "brochureWorkspace" : "brochureWorkspace single"}>
          {view === "overview" ? (
            <OverviewPage
              filteredRecipients={filteredRecipients}
              filteredTasks={filteredTasks}
              loading={loading}
              metrics={metrics}
              onExecuteTask={(task) => void executeTask(task)}
              onOpenCreate={() => setView("create")}
              onSearchChange={setSearchText}
              onStatusFilterChange={setTaskStatusFilter}
              onTabChange={setTaskTab}
              onToggleRecipient={toggleRecipient}
              searchText={searchText}
              selectedRecipientIds={selectedRecipientIds}
              statusFilter={taskStatusFilter}
              statusText={statusText}
              taskTab={taskTab}
              latestTask={latestTask}
              executingTaskId={executingTaskId}
            />
          ) : null}

          {view === "create" ? (
            <CreateTaskPage
              allSelectedAddressesValid={allSelectedAddressesValid}
              canSubmit={canSubmit}
              countryGroup={countryGroup}
              currentStep={currentStep}
              onCountryGroupChange={setCountryGroup}
              onProductChange={setProduct}
              onSubmit={() => void submitTask()}
              onTaskNameChange={setTaskName}
              onTemplateChange={setSelectedTemplateId}
              onToggleRecipient={toggleRecipient}
              onValidateAddresses={() => void validateAddresses()}
              product={product}
              recipients={recipients}
              selectedRecipientIds={selectedRecipientIds}
              selectedRecipients={selectedRecipients}
              selectedTemplateId={selectedTemplateId}
              submitting={submitting}
              taskName={taskName}
              templates={templates}
              validating={validating}
            />
          ) : null}

          {view === "templates" ? (
            <TemplateLibraryPage
              cards={templateCards}
              country={templateCountry}
              onCountryChange={setTemplateCountry}
              onCreate={() => setView("create")}
              onScopeChange={setTemplateScope}
              onSearchChange={setTemplateSearchText}
              onSelectTemplate={(templateId) => setSelectedTemplateId(templateId)}
              onTypeChange={setTemplateType}
              scope={templateScope}
              searchText={templateSearchText}
              selectedTemplateId={selectedTemplateId}
              type={templateType}
            />
          ) : null}

          {view === "addressBook" ? (
            <AddressBookPage
              loading={loading}
              recipients={filteredRecipients}
              searchText={searchText}
              selectedRecipientIds={selectedRecipientIds}
              onSearchChange={setSearchText}
              onToggleRecipient={toggleRecipient}
              onValidateAddresses={() => void validateAddresses()}
              validating={validating}
            />
          ) : null}

          {view === "account" ? (
            <AccountPage
              accountTab={accountTab}
              loading={loading}
              onTabChange={setAccountTab}
              tasks={tasks}
            />
          ) : null}
        </section>
      </section>
    </AppShell>
  );
}

function OverviewPage({
  metrics,
  loading,
  statusText,
  latestTask,
  taskTab,
  statusFilter,
  searchText,
  filteredTasks,
  filteredRecipients,
  selectedRecipientIds,
  executingTaskId,
  onOpenCreate,
  onTabChange,
  onStatusFilterChange,
  onSearchChange,
  onToggleRecipient,
  onExecuteTask
}: {
  metrics: Array<{ label: string; value: string; tone: string; icon: typeof FileText }>;
  loading: boolean;
  statusText: string;
  latestTask: MailingTask | null;
  taskTab: TaskTab;
  statusFilter: TaskStatusFilter;
  searchText: string;
  filteredTasks: MailingTask[];
  filteredRecipients: MailingRecipient[];
  selectedRecipientIds: string[];
  executingTaskId: string | null;
  onOpenCreate: () => void;
  onTabChange: (tab: TaskTab) => void;
  onStatusFilterChange: (status: TaskStatusFilter) => void;
  onSearchChange: (value: string) => void;
  onToggleRecipient: (recipientId: string) => void;
  onExecuteTask: (task: MailingTask) => void;
}) {
  const visibleLatestTask = loading ? null : latestTask;

  return (
    <>
      <div className="brochureOverviewHeader">
        <div className="brochureRangeSegment" role="tablist" aria-label="时间范围">
          <button className="active" type="button" role="tab" aria-selected="true">
            全部
          </button>
          <button type="button" role="tab" aria-selected="false">本日</button>
          <button type="button" role="tab" aria-selected="false">本周</button>
          <button type="button" role="tab" aria-selected="false">本月</button>
        </div>
      </div>

      <div className="brochureMetrics">
        {metrics.map(({ label, value, tone, icon: Icon }) => (
          <article className={`brochureMetric tone-${tone}`} key={label}>
            <span className="brochureMetricIcon" aria-hidden="true">
              <Icon size={18} />
            </span>
            <p>{label}</p>
            <strong>{loading ? "..." : value}</strong>
          </article>
        ))}
      </div>

      <div className="brochureContent">
        <section className="brochureOverviewCard">
          <header className="brochureListHeader">
            <div className="brochureTabs">
              <button className={taskTab === "tasks" ? "active" : ""} type="button" onClick={() => onTabChange("tasks")}>
                任务列表
              </button>
              <button className={taskTab === "recipients" ? "active" : ""} type="button" onClick={() => onTabChange("recipients")}>
                收件人列表
              </button>
            </div>
            {taskTab === "tasks" ? (
              <div className="brochureStatusFilters" aria-label="运输状态">
                {[
                  ["all", "全部"],
                  ["completed", "已送达"],
                  ["queued", "进行中"],
                  ["ready", "待寄出"]
                ].map(([key, label]) => (
                  <button
                    className={statusFilter === key ? "active" : ""}
                    key={key}
                    type="button"
                    onClick={() => onStatusFilterChange(key as TaskStatusFilter)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            <label className="brochureSearch">
              <Search size={15} aria-hidden="true" />
              <input
                value={searchText}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={taskTab === "tasks" ? "任务名 / 公司 / 国家" : "公司 / 联系人 / 国家"}
              />
            </label>
            <button className="brochurePrimary" type="button" onClick={onOpenCreate} data-testid="create-mailing-task">
              <CirclePlus size={15} aria-hidden="true" />
              创建任务
            </button>
          </header>

          {(statusText && statusText !== "明信片任务已准备，可创建新任务并执行沙盒调用。") || visibleLatestTask ? (
            <p className="brochureStatusInline">
              <span>{statusText}</span>
              {visibleLatestTask ? <em>最近任务：{visibleLatestTask.taskName}</em> : null}
            </p>
          ) : null}

          {taskTab === "tasks" ? (
            <MailingTaskTable
              executingTaskId={executingTaskId}
              loading={loading}
              onExecuteTask={onExecuteTask}
              tasks={filteredTasks}
            />
          ) : (
            <RecipientTable
              loading={loading}
              onToggle={onToggleRecipient}
              recipients={filteredRecipients}
              selectedIds={selectedRecipientIds}
            />
          )}
        </section>
      </div>
    </>
  );
}

function CreateTaskPage({
  taskName,
  countryGroup,
  product,
  selectedRecipientIds,
  selectedRecipients,
  recipients,
  templates,
  selectedTemplateId,
  currentStep,
  allSelectedAddressesValid,
  canSubmit,
  validating,
  submitting,
  onTaskNameChange,
  onCountryGroupChange,
  onProductChange,
  onToggleRecipient,
  onTemplateChange,
  onValidateAddresses,
  onSubmit
}: {
  taskName: string;
  countryGroup: string;
  product: string;
  selectedRecipientIds: string[];
  selectedRecipients: MailingRecipient[];
  recipients: MailingRecipient[];
  templates: MailingTemplate[];
  selectedTemplateId: string;
  currentStep: number;
  allSelectedAddressesValid: boolean;
  canSubmit: boolean;
  validating: boolean;
  submitting: boolean;
  onTaskNameChange: (value: string) => void;
  onCountryGroupChange: (value: string) => void;
  onProductChange: (value: string) => void;
  onToggleRecipient: (recipientId: string) => void;
  onTemplateChange: (templateId: string) => void;
  onValidateAddresses: () => void;
  onSubmit: () => void;
}) {
  return (
    <section className="brochureCreatePage" data-testid="postcard-create-panel">
      <h1>创建邮寄任务</h1>

      <div className="brochureSteps" aria-label="创建邮寄任务步骤">
        {createSteps.map((step, index) => {
          const state = index < currentStep ? "done" : index === currentStep ? "active" : "";
          return (
            <div className={state} key={step}>
              <span>{index < currentStep ? <CircleCheck aria-hidden="true" size={18} /> : index + 1}</span>
              <p>{step}</p>
            </div>
          );
        })}
      </div>

      <div className="brochureCreateForm">
        <label className="brochureWideField">
          <span>任务名称</span>
          <input value={taskName} onChange={(event) => onTaskNameChange(event.target.value)} placeholder="请输入任务名称" />
        </label>

        <div className="brochureRecipientStage">
          <span>收件人</span>
          <div className="brochureRecipientCanvas">
            <button className="brochureAddRecipient" type="button" onClick={() => onToggleRecipient(recipients[0]?.id ?? "")}>
              <CirclePlus size={16} aria-hidden="true" />
              添加收件人
            </button>
            <div className="brochureRecipientPicker compact">
              {recipients.map((recipient) => (
                <button
                  className={selectedRecipientIds.includes(recipient.id) ? "active" : ""}
                  key={recipient.id}
                  type="button"
                  onClick={() => onToggleRecipient(recipient.id)}
                >
                  <span>{selectedRecipientIds.includes(recipient.id) ? <Check size={14} /> : <UserPlus size={14} />}</span>
                  <strong>{recipient.companyName}</strong>
                  <small>
                    {recipient.city}, {recipient.country} · {addressStatusLabel(recipient.addressStatus)}
                  </small>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="brochureCreateGrid">
          <label>
            <span>国家/地区</span>
            <select value={countryGroup} onChange={(event) => onCountryGroupChange(event.target.value)}>
              <option>UAE / Saudi Arabia</option>
              <option>美国 / 加拿大</option>
              <option>英国 / 德国 / 欧洲</option>
            </select>
          </label>
          <label>
            <span>邮寄产品</span>
            <select value={product} onChange={(event) => onProductChange(event.target.value)}>
              <option>RRU / BBU / AAU 备件</option>
              <option>整流模块 / 电源系统</option>
              <option>微波回传 / 站点维护</option>
            </select>
          </label>
        </div>

        <section className="brochureTemplateChoice">
          <div className="brochureInlineHead">
            <h2>选择明信片/信件</h2>
            <button className="brochureGhost" type="button" onClick={onValidateAddresses} disabled={validating || !selectedRecipients.length}>
              <MapPinCheck size={16} aria-hidden="true" />
              {validating ? "检测中..." : allSelectedAddressesValid ? "地址已通过" : "地址检测"}
            </button>
          </div>
          <div className="postcardTemplateGrid">
            {templates.map((template) => (
              <button
                className={selectedTemplateId === template.id ? `postcardTemplate active ${template.tone}` : `postcardTemplate ${template.tone}`}
                key={template.id}
                type="button"
                onClick={() => onTemplateChange(template.id)}
              >
                <PostcardPreview template={template} />
                <strong>{template.name}</strong>
                <span>
                  {template.format} · {template.product}
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="brochureSubmitBar detached">
          <span>
            已选择 {selectedRecipients.length} 位收件人，预计 ${estimateAmount(selectedRecipients.length).toFixed(2)}
          </span>
          <button className="brochurePrimary" type="button" onClick={onSubmit} disabled={!canSubmit || submitting}>
            {submitting ? "提交中..." : "提交任务"}
          </button>
        </div>
      </div>
    </section>
  );
}

function TemplateLibraryPage({
  scope,
  type,
  country,
  searchText,
  cards,
  selectedTemplateId,
  onScopeChange,
  onTypeChange,
  onCountryChange,
  onSearchChange,
  onCreate,
  onSelectTemplate
}: {
  scope: TemplateScope;
  type: TemplateTypeFilter;
  country: string;
  searchText: string;
  cards: TemplateCard[];
  selectedTemplateId: string;
  onScopeChange: (scope: TemplateScope) => void;
  onTypeChange: (type: TemplateTypeFilter) => void;
  onCountryChange: (country: string) => void;
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  onSelectTemplate: (templateId: string) => void;
}) {
  return (
    <section className="brochureLibraryPage">
      <div className="brochureLibraryToolbar">
        <div className="brochureSegment">
          <button className={scope === "mine" ? "active" : ""} type="button" onClick={() => onScopeChange("mine")}>
            我的产品
          </button>
          <button className={scope === "system" ? "active" : ""} type="button" onClick={() => onScopeChange("system")}>
            系统模板
          </button>
        </div>
        <label className="brochureSearch wide">
          <Search size={16} aria-hidden="true" />
          <input value={searchText} onChange={(event) => onSearchChange(event.target.value)} placeholder="模板标题或模板内容" />
        </label>
        <select className="brochureSelectCompact" defaultValue="全部">
          <option>全部</option>
          <option>审核通过</option>
          <option>待审核</option>
        </select>
        <button className="brochurePrimary" type="button" onClick={onCreate}>
          <CirclePlus size={16} aria-hidden="true" />
          新建明信片/信件
        </button>
      </div>

      <div className="brochureFilterLine">
        <span>模板分类：</span>
        {[
          ["all", "全部"],
          ["postcard", "明信片"],
          ["letter", "信件"]
        ].map(([key, label]) => (
          <button className={type === key ? "active" : ""} key={key} type="button" onClick={() => onTypeChange(key as TemplateTypeFilter)}>
            {label}
          </button>
        ))}
      </div>

      <div className="brochureCountryLine">
        <span>国家：</span>
        {countries.map((item) => (
          <button className={country === item ? "active" : ""} key={item} type="button" onClick={() => onCountryChange(item)}>
            <i aria-hidden="true" />
            {item}
          </button>
        ))}
      </div>

      {cards.length ? (
        <div className="brochureTemplateGallery">
          {cards.map((template) => (
            <button
              className={selectedTemplateId === template.id ? "brochureTemplateCard active" : "brochureTemplateCard"}
              key={template.id}
              type="button"
              onClick={() => onSelectTemplate(template.id)}
            >
              <div className="brochureTemplateTitle">
                <strong>{template.name}</strong>
                <span>{template.kind === "letter" ? "信件" : "明信片"}</span>
              </div>
              <TemplateCover template={template} />
              <p>
                <b>{flagForCountry(template.country)}</b>
                {template.format}｜单价：${template.price}/封
              </p>
            </button>
          ))}
        </div>
      ) : (
        <div className="brochureEmptyState">
          <FileText size={46} aria-hidden="true" />
          <strong>当前暂无模板</strong>
          <button className="brochurePrimary" type="button" onClick={onCreate}>
            <CirclePlus size={16} aria-hidden="true" />
            新建明信片/信件
          </button>
        </div>
      )}
    </section>
  );
}

function AddressBookPage({
  loading,
  recipients,
  searchText,
  selectedRecipientIds,
  validating,
  onSearchChange,
  onToggleRecipient,
  onValidateAddresses
}: {
  loading: boolean;
  recipients: MailingRecipient[];
  searchText: string;
  selectedRecipientIds: string[];
  validating: boolean;
  onSearchChange: (value: string) => void;
  onToggleRecipient: (recipientId: string) => void;
  onValidateAddresses: () => void;
}) {
  return (
    <section className="brochurePanelPage">
      <div className="brochurePageHead">
        <div>
          <span>地址簿</span>
          <h1>收件人地址管理</h1>
        </div>
        <div className="brochureToolbarActions">
          <label className="brochureSearch">
            <Search size={16} aria-hidden="true" />
            <input value={searchText} onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索公司、城市或国家" />
          </label>
          <button className="brochureGhost" type="button">
            <Upload size={16} aria-hidden="true" />
            导入
          </button>
          <button className="brochurePrimary" type="button">
            <UserPlus size={16} aria-hidden="true" />
            添加收件人
          </button>
        </div>
      </div>

      <div className="brochureStatusLine slim">
        <strong>{loading ? "正在同步收件人" : `已收录 ${recipients.length} 位收件人`}</strong>
        <button className="brochureGhost" type="button" onClick={onValidateAddresses} disabled={validating || !selectedRecipientIds.length}>
          <MapPinCheck size={16} aria-hidden="true" />
          {validating ? "检测中..." : "检测已选地址"}
        </button>
      </div>

      <RecipientAddressTable
        loading={loading}
        onToggle={onToggleRecipient}
        recipients={recipients}
        selectedIds={selectedRecipientIds}
      />
    </section>
  );
}

function AccountPage({
  accountTab,
  loading,
  tasks,
  onTabChange
}: {
  accountTab: AccountTab;
  loading: boolean;
  tasks: MailingTask[];
  onTabChange: (tab: AccountTab) => void;
}) {
  const totalSpend = tasks.reduce((total, task) => total + (task.status === "completed" ? task.amountUsd : 0), 0);

  return (
    <section className="brochurePanelPage">
      <div className="brochureAccountTabs">
        <button className={accountTab === "account" ? "active" : ""} type="button" onClick={() => onTabChange("account")}>
          我的账户
        </button>
        <button className={accountTab === "prices" ? "active" : ""} type="button" onClick={() => onTabChange("prices")}>
          邮寄价格表
        </button>
      </div>

      {accountTab === "account" ? (
        <>
          <div className="brochureAccountOverview">
            <article>
              <WalletCards aria-hidden="true" size={24} />
              <strong>$0</strong>
              <span>账户余额</span>
              <button type="button">去充值 &gt;</button>
            </article>
            <article>
              <PackageCheck aria-hidden="true" size={24} />
              <strong>$0</strong>
              <span>邮寄专项余额</span>
              <button type="button">去充值 &gt;</button>
            </article>
            <article>
              <CalendarDays aria-hidden="true" size={24} />
              <strong>{loading ? "..." : `$${totalSpend.toFixed(2)}`}</strong>
              <span>累计消耗</span>
            </article>
          </div>

          <div className="brochureBillHead">
            <div>
              <h2>账单列表</h2>
              <p>
                {loading ? "正在同步邮寄记录" : `当前结果：${tasks.length} 次邮寄记录，总计消耗：$${totalSpend.toFixed(2)}`}
              </p>
            </div>
            <label className="brochureDateRange">
              <CalendarDays size={16} aria-hidden="true" />
              <span>开始日期</span>
              <b>至</b>
              <span>结束日期</span>
            </label>
          </div>

          {loading ? (
            <TableLoadingState
              title="正在加载邮寄账单"
              description="正在同步任务记录、金额和执行时间。"
            />
          ) : (
            <div className="brochureTableWrap">
              <table className="brochureTable">
                <thead>
                  <tr>
                    <th>任务名称</th>
                    <th>收件人数</th>
                    <th>金额($)</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.length ? (
                    tasks.map((task) => (
                      <tr key={task.id}>
                        <td>{task.taskName}</td>
                        <td>{task.recipientCount}</td>
                        <td>{task.amountUsd.toFixed(2)}</td>
                        <td>{formatDate(task.executedAt ?? task.createdAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4}>暂无数据</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div className="brochurePricePage">
          <div className="brochurePriceTitle">
            <h1>
              国际邮寄实物 <span>计价表</span>
            </h1>
            <p>以最优惠的价格提供全球送货服务</p>
          </div>
          <div className="brochureTableWrap price">
            <table className="brochureTable">
              <thead>
                <tr>
                  <th>国家地区</th>
                  <th>产品类型</th>
                  <th>快递公司</th>
                  <th>单价($/封)</th>
                  <th>预计配送时长</th>
                </tr>
              </thead>
              <tbody>
                {priceRows.map((row) => (
                  <tr key={`${row.country}-${row.product}`}>
                    <td>
                      {row.flag} {row.country}
                    </td>
                    <td>{row.product}</td>
                    <td>{row.carrier}</td>
                    <td>{row.price}</td>
                    <td>{row.eta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function MailingTaskTable({
  tasks,
  loading,
  executingTaskId,
  onExecuteTask
}: {
  tasks: MailingTask[];
  loading: boolean;
  executingTaskId: string | null;
  onExecuteTask: (task: MailingTask) => void;
}) {
  if (loading) {
    return (
      <TableLoadingState
        title="正在加载邮寄任务"
        description="正在同步任务状态、收件人数和费用。"
      />
    );
  }

  return (
    <div className="brochureTableWrap">
      <table className="brochureTable">
        <thead>
          <tr>
            <th>任务名称</th>
            <th>收件人数</th>
            <th>包含国家</th>
            <th>任务状态</th>
            <th>邮寄产品</th>
            <th>金额($)</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {tasks.length ? (
            tasks.map((task) => (
              <tr key={task.id}>
                <td>
                  <strong>{task.taskName}</strong>
                  <span>{task.templateName}</span>
                </td>
                <td>{task.recipientCount}</td>
                <td>{task.countries.join(" / ")}</td>
                <td>
                  <b className={`brochureStatus ${task.status}`}>{statusLabel[task.status]}</b>
                </td>
                <td>{task.product}</td>
                <td>{task.amountUsd.toFixed(2)}</td>
                <td>{formatDate(task.createdAt)}</td>
                <td>
                  {task.status === "completed" ? (
                    <span className="brochureMuted">{task.providerMessageId ?? "已完成"}</span>
                  ) : (
                    <button
                      className="brochureMiniButton"
                      type="button"
                      onClick={() => onExecuteTask(task)}
                      disabled={executingTaskId === task.id}
                    >
                      <Send size={14} aria-hidden="true" />
                      {executingTaskId === task.id ? "调用中" : "执行沙盒"}
                    </button>
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={8}>暂无任务</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RecipientTable({
  recipients,
  loading,
  selectedIds,
  onToggle
}: {
  recipients: MailingRecipient[];
  loading: boolean;
  selectedIds: string[];
  onToggle: (recipientId: string) => void;
}) {
  if (loading) {
    return (
      <TableLoadingState
        title="正在加载收件人列表"
        description="正在同步客户地址、联系人和检测状态。"
      />
    );
  }

  return (
    <div className="brochureTableWrap">
      <table className="brochureTable">
        <thead>
          <tr>
            <th>选择</th>
            <th>公司</th>
            <th>联系人</th>
            <th>国家/城市</th>
            <th>地址</th>
            <th>检测状态</th>
          </tr>
        </thead>
        <tbody>
          {recipients.map((recipient) => (
            <tr key={recipient.id}>
              <td>
                <button
                  className={selectedIds.includes(recipient.id) ? "brochureCheck active" : "brochureCheck"}
                  type="button"
                  aria-label={`选择 ${recipient.companyName}`}
                  onClick={() => onToggle(recipient.id)}
                />
              </td>
              <td>
                <strong>{recipient.companyName}</strong>
                <span>{recipient.website ?? "-"}</span>
              </td>
              <td>{recipient.contactName}</td>
              <td>
                {recipient.city}, {recipient.country}
              </td>
              <td>{recipient.addressLine1}</td>
              <td>{addressStatusLabel(recipient.addressStatus)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecipientAddressTable({
  recipients,
  loading,
  selectedIds,
  onToggle
}: {
  recipients: MailingRecipient[];
  loading: boolean;
  selectedIds: string[];
  onToggle: (recipientId: string) => void;
}) {
  if (loading) {
    return (
      <TableLoadingState
        title="正在加载地址簿"
        description="正在同步收件公司、地址和邮编信息。"
      />
    );
  }

  return (
    <div className="brochureTableWrap">
      <table className="brochureTable address">
        <thead>
          <tr>
            <th>选择</th>
            <th>收件公司</th>
            <th>联系人</th>
            <th>国家</th>
            <th>城市</th>
            <th>地址</th>
            <th>邮编</th>
            <th>检测状态</th>
          </tr>
        </thead>
        <tbody>
          {recipients.map((recipient) => (
            <tr key={recipient.id}>
              <td>
                <button
                  className={selectedIds.includes(recipient.id) ? "brochureCheck active" : "brochureCheck"}
                  type="button"
                  aria-label={`选择 ${recipient.companyName}`}
                  onClick={() => onToggle(recipient.id)}
                />
              </td>
              <td>
                <strong>{recipient.companyName}</strong>
                <span>{recipient.website ?? "-"}</span>
              </td>
              <td>{recipient.contactName}</td>
              <td>{recipient.country}</td>
              <td>{recipient.city}</td>
              <td>{recipient.addressLine1}</td>
              <td>{recipient.postalCode}</td>
              <td>
                <b className={`addressBadge ${recipient.addressStatus}`}>{addressStatusLabel(recipient.addressStatus)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PostcardPreview({ template }: { template: MailingTemplate }) {
  return (
    <div className={`postcardPreview ${template.tone}`}>
      <div>
        <span>LeadHunt AI</span>
        <strong>{template.frontTitle}</strong>
      </div>
      <p>{template.backTitle}</p>
    </div>
  );
}

function TemplateCover({ template }: { template: TemplateCard }) {
  return (
    <div className={`templateCover ${template.kind === "letter" ? "letter" : template.tone}`}>
      <div className="coverBrand">
        <span>Company Name</span>
        <b>{template.kind === "letter" ? "LOGO" : "LeadHunt AI"}</b>
      </div>
      <strong>{template.frontTitle}</strong>
      <p>{template.backTitle}</p>
    </div>
  );
}

async function apiRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(extractApiMessage(payload) || `接口请求失败：HTTP ${response.status}`);
  }

  return payload as T;
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
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

function addressStatusLabel(status: AddressStatus) {
  if (status === "valid") return "地址有效";
  if (status === "warning") return "需复核";
  return "待检测";
}

function estimateAmount(count: number) {
  return count * 3.9;
}

function flagForCountry(country: string) {
  if (country === "美国") return "🇺🇸";
  if (country === "加拿大") return "🇨🇦";
  if (country === "英国") return "🇬🇧";
  if (country === "德国") return "🇩🇪";
  return "🌐";
}

function formatDate(value: string) {
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
