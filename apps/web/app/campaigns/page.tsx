"use client";

import {
  Bold,
  CalendarDays,
  ChevronDown,
  Code2,
  Eye,
  Filter,
  Grid2X2,
  Italic,
  Link,
  MoreHorizontal,
  Paperclip,
  Search,
  Send,
  Sparkles,
  UploadCloud,
  Underline,
  Undo2,
  UserPlus,
  X
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../app-shell";
import {
  customTemplateStorageKey,
  renderMailTemplate,
  systemMailTemplates,
  type MailTemplate
} from "../mail-templates";

type RewriteResponse = {
  subject?: string;
  body: string;
  changes: string[];
};

type CampaignView = "records" | "compose";
type RecipientSourceTab = "crm" | "search" | "file" | "queue";
type RecipientCustomerKind = "company" | "contact";

type GmailAccountResponse = {
  connected: boolean;
  account: {
    email: string;
  } | null;
};

type CampaignSendResult = {
  ok: boolean;
  providerMessageId?: string | null;
  threadId?: string | null;
};

type CampaignSendRecord = {
  id: string;
  sentAt: string;
  recipients: string[];
  subject: string;
  templateName: string;
  status: "sent" | "failed";
  providerMessageId?: string | null;
};

const campaignSendRecordsKey = "leadhunt_campaign_send_records";
const emptyGmailAccount: GmailAccountResponse = {
  connected: false,
  account: null
};

const recipientSourceTabs: Array<{ id: RecipientSourceTab; label: string }> = [
  { id: "crm", label: "从 CRM 添加" },
  { id: "search", label: "搜索记录添加" },
  { id: "file", label: "本地文件导入" },
  { id: "queue", label: "待发送列表" }
];

const recipientCustomerTabs: Array<{ id: RecipientCustomerKind; label: string }> = [
  { id: "company", label: "公司客户" },
  { id: "contact", label: "联系人客户" }
];

const demoRecipientRows = [
  {
    company: "Gulf Telecom Supplies FZE",
    contact: "Procurement Team",
    email: "procurement@gulftelecom.ae",
    country: "UAE",
    tag: "通信设备经销商"
  },
  {
    company: "High Cloud Technologies",
    contact: "Sales Desk",
    email: "sales@highcloud.ae",
    country: "UAE",
    tag: "系统集成商"
  },
  {
    company: "Spectrum Middle East",
    contact: "Purchase Office",
    email: "info@spectrummea.com",
    country: "UAE",
    tag: "项目供货"
  }
];

const demoTemplateVariables = {
  companyName: "Gulf Telecom Supplies FZE",
  country: "UAE"
};
const defaultMailTemplate = systemMailTemplates[0] as MailTemplate;

export default function CampaignsPage() {
  const initialDraft = renderMailTemplate(defaultMailTemplate, demoTemplateVariables);
  const [activeView, setActiveView] = useState<CampaignView>("compose");
  const [templates, setTemplates] = useState<MailTemplate[]>(systemMailTemplates);
  const [selectedTemplateId, setSelectedTemplateId] = useState(systemMailTemplates[0]?.id ?? "");
  const [subject, setSubject] = useState(initialDraft.subject);
  const [body, setBody] = useState(initialDraft.body);
  const [outputLanguage, setOutputLanguage] = useState("英语 - English");
  const [tone, setTone] = useState("尊敬");
  const [rewriteInstruction, setRewriteInstruction] = useState(
    "把当前开发信改得更正式，突出 Telecorenet 可以整套项目供货，也可以单个设备、模块、板卡、备件供应。"
  );
  const [rewriteResult, setRewriteResult] = useState(initialDraft.body);
  const [status, setStatus] = useState("请选择模板后，可在右侧输入要求进行 AI 改写。");
  const [rewriting, setRewriting] = useState(false);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState("");
  const [recipientPanelOpen, setRecipientPanelOpen] = useState(false);
  const [recipientSourceTab, setRecipientSourceTab] = useState<RecipientSourceTab>("crm");
  const [recipientCustomerKind, setRecipientCustomerKind] = useState<RecipientCustomerKind>("company");
  const [gmailAccount, setGmailAccount] = useState<GmailAccountResponse>(emptyGmailAccount);
  const [sendRecords, setSendRecords] = useState<CampaignSendRecord[]>([]);
  const [sending, setSending] = useState(false);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? defaultMailTemplate,
    [selectedTemplateId, templates]
  );
  const fromEmail = gmailAccount.account?.email ?? "Gmail 未授权";
  const gmailAuthorized = gmailAccount.connected && Boolean(gmailAccount.account?.email);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(customTemplateStorageKey);
      const customTemplates = stored ? (JSON.parse(stored) as MailTemplate[]) : [];
      setTemplates([...systemMailTemplates, ...customTemplates]);
    } catch {
      setTemplates(systemMailTemplates);
      setStatus("本地自建模板读取失败，请重新创建。");
    }
  }, []);

  useEffect(() => {
    void loadGmailAccount();
    try {
      const stored = window.localStorage.getItem(campaignSendRecordsKey);
      setSendRecords(stored ? (JSON.parse(stored) as CampaignSendRecord[]) : []);
    } catch {
      setSendRecords([]);
    }
  }, []);

  function applyTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    const rendered = renderMailTemplate(template, demoTemplateVariables);
    setSelectedTemplateId(template.id);
    setSubject(rendered.subject);
    setBody(rendered.body);
    setRewriteResult(rendered.body);
    setStatus(`已应用模板：${template.name}`);
  }

  function resetDraft() {
    applyTemplate(selectedTemplate.id);
    setStatus("已按当前模板重置邮件内容。");
  }

  function saveDraftAsTemplate() {
    const customTemplates = templates.filter((template) => template.type === "custom");
    const nextTemplate: MailTemplate = {
      id: `custom-${Date.now()}`,
      type: "custom",
      name: "当前邮件另存模板",
      subject,
      body,
      owner: "王亚伟",
      createdAt: new Date().toISOString().slice(0, 10),
      summary: "从发邮件页面保存的自建模板。"
    };
    const nextCustomTemplates = [nextTemplate, ...customTemplates];
    window.localStorage.setItem(customTemplateStorageKey, JSON.stringify(nextCustomTemplates));
    setTemplates([...systemMailTemplates, ...nextCustomTemplates]);
    setSelectedTemplateId(nextTemplate.id);
    setStatus("已另存为个人模板。");
  }

  async function loadGmailAccount() {
    try {
      const response = await fetch("/api/gmail/account", { credentials: "include" });
      if (!response.ok) {
        setGmailAccount(emptyGmailAccount);
        return;
      }

      setGmailAccount((await response.json()) as GmailAccountResponse);
    } catch {
      setGmailAccount(emptyGmailAccount);
    }
  }

  function addRecipients(rawValue: string) {
    const candidates = splitRecipientInput(rawValue);
    if (!candidates.length) {
      setStatus("请输入收件人邮箱。");
      return false;
    }

    const validCandidates = uniqueEmails(candidates.filter(isValidEmail));
    if (!validCandidates.length) {
      setStatus("请输入有效的邮箱地址。");
      return false;
    }

    const existing = new Set(recipients.map((email) => email.toLowerCase()));
    const nextEmails = validCandidates.filter((email) => !existing.has(email.toLowerCase()));
    if (!nextEmails.length) {
      setStatus("这些邮箱已经在收件人列表中。");
      setRecipientInput("");
      return false;
    }

    setRecipients((current) => [...current, ...nextEmails]);
    setRecipientInput("");
    setStatus(`已添加 ${nextEmails.length} 个收件人，共 ${recipients.length + nextEmails.length} 个。`);
    return true;
  }

  function removeRecipient(email: string) {
    setRecipients((current) => current.filter((item) => item !== email));
    setStatus(`已移除 ${email}`);
  }

  function handleRecipientKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === ";") {
      event.preventDefault();
      addRecipients(recipientInput);
      return;
    }

    if (event.key === "Backspace" && !recipientInput && recipients.length > 0) {
      removeRecipient(recipients[recipients.length - 1]!);
    }
  }

  function handleRecipientAction() {
    if (recipientInput.trim()) {
      addRecipients(recipientInput);
      return;
    }

    setRecipientPanelOpen(true);
  }

  async function sendCampaignEmail() {
    let recipientsToSend = recipients;
    if (recipientInput.trim()) {
      const inputEmails = splitRecipientInput(recipientInput);
      const validEmails = inputEmails.filter(isValidEmail);
      if (!validEmails.length) {
        setStatus("请输入有效的邮箱地址。");
        return;
      }
      recipientsToSend = uniqueEmails([...recipients, ...validEmails]);
      setRecipients(recipientsToSend);
      setRecipientInput("");
    }

    if (!recipientsToSend.length) {
      setStatus("请先添加收件人。");
      return;
    }
    if (!gmailAuthorized) {
      setStatus("Gmail 未授权，请先到个人邮箱页面重新授权。");
      return;
    }
    if (!subject.trim() || !body.trim()) {
      setStatus("邮件主题或正文不能为空。");
      return;
    }

    setSending(true);
    setStatus(`发送中... 将使用模板「${selectedTemplate.name}」发送 ${recipientsToSend.length} 封邮件。`);
    const sentAt = new Date().toISOString();
    let successCount = 0;
    let lastProviderMessageId: string | null | undefined = null;
    let failureMessage = "";

    try {
      for (const recipient of recipientsToSend) {
        const response = await fetch("/api/gmail/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            to: recipient,
            replyTo: gmailAccount.account?.email,
            subject,
            body,
            confirm: true
          })
        });
        const payload = (await response.json().catch(() => null)) as CampaignSendResult | { message?: string } | null;
        if (!response.ok || !payload || !("ok" in payload)) {
          failureMessage = payload && "message" in payload && payload.message ? payload.message : `发送失败：${recipient}`;
          break;
        }

        successCount += 1;
        lastProviderMessageId = payload.providerMessageId;
      }

      const record: CampaignSendRecord = {
        id: `campaign-${Date.now()}`,
        sentAt,
        recipients: recipientsToSend.slice(0, successCount || recipientsToSend.length),
        subject,
        templateName: selectedTemplate.name,
        status: successCount === recipientsToSend.length ? "sent" : "failed",
        providerMessageId: lastProviderMessageId ?? null
      };
      persistSendRecords([record, ...sendRecords]);
      setStatus(
        successCount === recipientsToSend.length
          ? `Gmail 已接收 ${successCount} 封邮件请求，并写入发送记录；最终投递以退信为准。`
          : `Gmail 已接收 ${successCount}/${recipientsToSend.length} 封请求；${failureMessage}`
      );
      setActiveView("records");
    } catch {
      const record: CampaignSendRecord = {
        id: `campaign-${Date.now()}`,
        sentAt,
        recipients: recipientsToSend,
        subject,
        templateName: selectedTemplate.name,
        status: "failed",
        providerMessageId: null
      };
      persistSendRecords([record, ...sendRecords]);
      setStatus("网络异常，邮件未完成发送。");
      setActiveView("records");
    } finally {
      setSending(false);
    }
  }

  function persistSendRecords(nextRecords: CampaignSendRecord[]) {
    const limited = nextRecords.slice(0, 50);
    setSendRecords(limited);
    window.localStorage.setItem(campaignSendRecordsKey, JSON.stringify(limited));
  }

  async function rewriteEmail() {
    const instruction = rewriteInstruction.trim();
    if (!instruction) {
      setStatus("请输入改写要求。");
      return;
    }

    setRewriting(true);
    setStatus("AI 改写中...");
    try {
      const response = await fetch("/api/gmail/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subject,
          body,
          outputLanguage,
          tone,
          instruction
        })
      });

      if (!response.ok) {
        setStatus("AI 改写失败，请确认后端服务和登录状态。");
        return;
      }

      const payload = (await response.json()) as RewriteResponse;
      setSubject(payload.subject || subject);
      setBody(payload.body);
      setRewriteResult(payload.body);
      setStatus(payload.changes[0] ?? "改写完成，已覆盖邮件正文。");
    } catch {
      setStatus("网络异常，AI 改写未完成。");
    } finally {
      setRewriting(false);
    }
  }

  return (
    <AppShell
      activePath="/campaigns"
      eyebrow="邮件营销"
      hidePageHeader
      mainClassName="campaignMain"
      pageClassName="campaignPage"
      title="邮件营销"
    >
      <section className="campaignShell">
        <header className="campaignHeader">
          <nav className="templatePrimaryTabs" aria-label="邮件营销页面切换">
            <button
              className={activeView === "records" ? "active" : ""}
              type="button"
              onClick={() => setActiveView("records")}
            >
              发送记录
            </button>
            <button
              className={activeView === "compose" ? "active" : ""}
              type="button"
              onClick={() => setActiveView("compose")}
            >
              发邮件
            </button>
            <a href="/templates">邮件模板</a>
          </nav>
          <div className="campaignGmailStatus">
            <span>发件邮箱</span>
            <strong>{fromEmail}</strong>
            <b>{gmailAuthorized ? "已授权" : "未授权"}</b>
            <button type="button">
              <CalendarDays aria-hidden="true" size={15} />
              草稿箱
            </button>
          </div>
        </header>

        {activeView === "records" ? (
          <CampaignSendRecords records={sendRecords} onCompose={() => setActiveView("compose")} />
        ) : (
        <div className="campaignGrid">
          <section className="campaignComposer">
            <InfoRow label="发件邮箱" value={fromEmail} badge={gmailAuthorized ? "Google OAuth 已授权" : "Google OAuth 未授权"} action="重新授权" />
            <CampaignRecipientsRow
              recipients={recipients}
              inputValue={recipientInput}
              onInputChange={setRecipientInput}
              onInputKeyDown={handleRecipientKeyDown}
              onAction={handleRecipientAction}
              onRemove={removeRecipient}
            />
            <InfoRow label="回复邮箱" value={fromEmail} hint="客户回复直接进入个人邮箱" />
            <InfoRow label="邮件模板" action="模板">
              <select
                aria-label="选择邮件模板"
                className="campaignTemplateSelect"
                data-campaign-template-select="true"
                value={selectedTemplateId}
                onChange={(event) => applyTemplate(event.target.value)}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.type === "system" ? "系统" : "个人"} - {template.name}
                  </option>
                ))}
              </select>
            </InfoRow>
            <InfoRow label="邮件主题" hint="共 1 个 | 可添加多主题" action="添加">
              <input
                className="campaignSubjectInput"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </InfoRow>

            <div className="campaignSchedule">
              <span>发送时间</span>
              <label>
                <input defaultChecked name="send-time" type="radio" />
                立即发送
              </label>
              <label>
                <input name="send-time" type="radio" />
                定时发送
              </label>
            </div>

            <div className="campaignEditorHead">
              <span>邮件内容</span>
              <button type="button" onClick={rewriteEmail} disabled={rewriting}>
                {rewriting ? "改写中..." : "AI 一键改写"}
              </button>
              <small className="campaignStatus" aria-live="polite">{status}</small>
            </div>

            <div className="campaignToolbar" aria-label="邮件编辑工具栏">
              {[Undo2, Undo2, Bold, Italic, Underline, Link, Grid2X2, Code2, Eye, MoreHorizontal].map((Icon, index) => (
                <button key={index} type="button">
                  <Icon aria-hidden="true" size={16} />
                </button>
              ))}
              <button type="button">
                系统字体 <ChevronDown aria-hidden="true" size={14} />
              </button>
              <button type="button">
                14px <ChevronDown aria-hidden="true" size={14} />
              </button>
            </div>
            <textarea
              className="campaignEditor campaignEditorInput"
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />

            <footer className="campaignComposerActions">
              <button type="button" onClick={resetDraft}>重置</button>
              <button type="button" onClick={() => setStatus("当前页面已显示预览内容，可继续编辑。")}>预览</button>
              <button type="button" onClick={() => setStatus("测试页未写入 Gmail 草稿箱，请在 AI 外贸员邮件确认弹窗执行存草稿。")}>存草稿</button>
              <button type="button" onClick={saveDraftAsTemplate}>另存为模板</button>
              <button className="primary" type="button" onClick={sendCampaignEmail} disabled={sending || !recipients.length || !gmailAuthorized}>
                <Send aria-hidden="true" size={16} />
                {sending ? "发送中" : "发送"}
              </button>
            </footer>
          </section>

          <aside className="campaignRewrite">
            <header>
              <h2>
                <Sparkles aria-hidden="true" size={20} />
                AI 改写
              </h2>
              <button type="button">×</button>
            </header>
            <div className="rewriteSelectors">
              <label>
                <span>输出邮件使用的语言</span>
                <select value={outputLanguage} onChange={(event) => setOutputLanguage(event.target.value)}>
                  <option>英语 - English</option>
                  <option>阿拉伯语 - Arabic</option>
                  <option>法语 - French</option>
                </select>
              </label>
              <label>
                <span>邮件语气</span>
                <select value={tone} onChange={(event) => setTone(event.target.value)}>
                  <option>尊敬</option>
                  <option>有说服力</option>
                  <option>简洁</option>
                  <option>正式</option>
                </select>
              </label>
            </div>
            <label className="rewriteOriginal">
              <span>原文 <small>今日可使用次数：100次</small></span>
              <textarea
                value={rewriteInstruction}
                onChange={(event) => setRewriteInstruction(event.target.value)}
              />
            </label>
            <div className="rewriteButtons">
              <button className="primary" type="button" onClick={rewriteEmail} disabled={rewriting}>
                {rewriting ? "生成中" : "重新生成"}
              </button>
              <button type="button" onClick={() => setStatus("改写结果已在下方展示。")}>
                <Paperclip aria-hidden="true" size={14} />
                一键复制
              </button>
              <button type="button" onClick={saveDraftAsTemplate}>
                <CalendarDays aria-hidden="true" size={14} />
                存为模板
              </button>
              <button type="button" onClick={() => setBody(rewriteResult)}>应用</button>
            </div>
            <section className="rewriteResult">
              <div>
                <h3>改写结果</h3>
                <span>{rewriting ? "生成中" : "已同步"}</span>
              </div>
              <article>
                <p>Subject: {subject}</p>
                <p>{rewriteResult}</p>
              </article>
            </section>
          </aside>
        </div>
        )}
        {recipientPanelOpen ? (
          <CampaignRecipientPanel
            activeTab={recipientSourceTab}
            customerKind={recipientCustomerKind}
            recipients={recipients}
            onActiveTabChange={setRecipientSourceTab}
            onCustomerKindChange={setRecipientCustomerKind}
            onAddRecipient={(email) => addRecipients(email)}
            onClose={() => setRecipientPanelOpen(false)}
          />
        ) : null}
      </section>
    </AppShell>
  );
}

function CampaignSendRecords({
  records,
  onCompose
}: {
  records: CampaignSendRecord[];
  onCompose: () => void;
}) {
  return (
    <section className="campaignRecords">
      <header>
        <div>
          <h2>发送记录</h2>
          <p>这里记录从邮件营销页发出的测试邮件，包含模板、收件人、主题和发送状态。</p>
        </div>
        <button type="button" onClick={onCompose}>
          <Send aria-hidden="true" size={15} />
          发邮件
        </button>
      </header>

      <div className="campaignRecordsTable">
        <div className="campaignRecordsHead">
          <span>发送时间</span>
          <span>收件人</span>
          <span>模板</span>
          <span>邮件主题</span>
          <span>状态</span>
        </div>
        {records.length ? (
          records.map((record) => (
            <div className="campaignRecordsRow" key={record.id}>
              <span>{formatCampaignRecordDate(record.sentAt)}</span>
              <span>{record.recipients.join(", ")}</span>
              <span>{record.templateName}</span>
              <span>{record.subject}</span>
              <b className={record.status === "sent" ? "sent" : "failed"}>
                {record.status === "sent" ? "Gmail 已接收" : "失败"}
              </b>
            </div>
          ))
        ) : (
          <div className="campaignRecordsEmpty">
            <strong>暂无发送记录</strong>
            <span>提交一次 Gmail 发送后，记录会显示在这里。</span>
          </div>
        )}
      </div>
    </section>
  );
}

function CampaignRecipientsRow({
  recipients,
  inputValue,
  onInputChange,
  onInputKeyDown,
  onRemove,
  onAction
}: {
  recipients: string[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onRemove: (email: string) => void;
  onAction: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleRecipientLimit = 3;
  const hiddenRecipientCount = Math.max(recipients.length - visibleRecipientLimit, 0);
  const canExpand = recipients.length > visibleRecipientLimit;
  const visibleRecipients = expanded ? recipients : recipients.slice(0, visibleRecipientLimit);

  useEffect(() => {
    if (!canExpand) {
      setExpanded(false);
    }
  }, [canExpand]);

  return (
    <div className="campaignInfoRow campaignRecipientsRow">
      <strong>收件人</strong>
      <div className="campaignRecipientControl">
        <div
          aria-expanded={expanded}
          className={`campaignRecipientInputBox ${expanded ? "isExpanded" : "isCollapsed"}`}
        >
          {visibleRecipients.map((email) => (
            <span className="campaignRecipientChip" key={email}>
              <span>{email}</span>
              <button type="button" aria-label={`移除 ${email}`} onClick={() => onRemove(email)}>
                <X aria-hidden="true" size={13} />
              </button>
            </span>
          ))}
          {!expanded && hiddenRecipientCount > 0 ? (
            <button
              className="campaignRecipientOverflow"
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={`展开剩余 ${hiddenRecipientCount} 个收件人`}
            >
              +{hiddenRecipientCount}
            </button>
          ) : null}
          <input
            aria-label="手动输入收件人邮箱"
            value={inputValue}
            placeholder={recipients.length ? "继续输入邮箱" : "输入邮箱，回车添加"}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onInputKeyDown}
          />
        </div>
      </div>
      <small className="campaignRecipientSummary">
        <span>共 {recipients.length} 个 | 支持多个邮箱</span>
        {canExpand ? (
          <button type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
            {expanded ? "收起" : "展开全部"}
            <ChevronDown aria-hidden="true" size={13} />
          </button>
        ) : null}
      </small>
      <div className="campaignRecipientActions">
        <button className="primary" type="button" onClick={onAction}>
          <UserPlus aria-hidden="true" size={14} />
          添加
        </button>
      </div>
    </div>
  );
}

function CampaignRecipientPanel({
  activeTab,
  customerKind,
  recipients,
  onActiveTabChange,
  onCustomerKindChange,
  onAddRecipient,
  onClose
}: {
  activeTab: RecipientSourceTab;
  customerKind: RecipientCustomerKind;
  recipients: string[];
  onActiveTabChange: (tab: RecipientSourceTab) => void;
  onCustomerKindChange: (kind: RecipientCustomerKind) => void;
  onAddRecipient: (email: string) => boolean;
  onClose: () => void;
}) {
  return (
    <div className="campaignRecipientBackdrop">
      <aside className="campaignRecipientPanel" role="dialog" aria-modal="true" aria-label="添加邮箱">
        <header>
          <div>
            <h2>添加邮箱</h2>
            <p>从客户库、搜索记录或本地文件中补充多个收件人。</p>
          </div>
          <button type="button" aria-label="关闭添加邮箱" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <div className="campaignRecipientTabs" role="tablist" aria-label="邮箱来源">
          {recipientSourceTabs.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? "active" : ""}
              type="button"
              onClick={() => onActiveTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="campaignRecipientKinds" aria-label="客户类型">
          {recipientCustomerTabs.map((tab) => (
            <button
              key={tab.id}
              className={customerKind === tab.id ? "active" : ""}
              type="button"
              onClick={() => onCustomerKindChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="campaignRecipientSearch">
          <label>
            <Search aria-hidden="true" size={16} />
            <input placeholder="搜索公司、联系人、邮箱" />
          </label>
          <button type="button">
            <Filter aria-hidden="true" size={15} />
            筛选
          </button>
          <button type="button">清空</button>
        </div>

        {activeTab === "file" ? (
          <div className="campaignRecipientUpload">
            <UploadCloud aria-hidden="true" size={24} />
            <strong>导入 Excel / CSV 邮箱列表</strong>
            <span>支持一列或多列邮箱，导入后会自动去重并加入待发送列表。</span>
            <button type="button">选择文件</button>
          </div>
        ) : activeTab === "queue" ? (
          <div className="campaignRecipientQueue">
            {recipients.length ? (
              recipients.map((email) => (
                <span className="campaignRecipientChip" key={email}>
                  <span>{email}</span>
                </span>
              ))
            ) : (
              <p>待发送列表为空。</p>
            )}
          </div>
        ) : (
          <div className="campaignRecipientTable">
            <div className="campaignRecipientTableHead">
              <span>客户名称</span>
              <span>联系人</span>
              <span>邮箱</span>
              <span>操作</span>
            </div>
            {demoRecipientRows.map((row) => {
              const selected = recipients.some((email) => email.toLowerCase() === row.email.toLowerCase());

              return (
                <div className="campaignRecipientTableRow" key={row.email}>
                  <div>
                    <strong>{row.company}</strong>
                    <small>{row.country} · {row.tag}</small>
                  </div>
                  <span>{row.contact}</span>
                  <code>{row.email}</code>
                  <button type="button" onClick={() => onAddRecipient(row.email)} disabled={selected}>
                    {selected ? "已添加" : "添加"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <footer>
          <span>已选择 {recipients.length} 个邮箱</span>
          <button type="button" onClick={onClose}>确认</button>
        </footer>
      </aside>
    </div>
  );
}

function InfoRow({
  label,
  value,
  badge,
  hint,
  action,
  children
}: {
  label: string;
  value?: string;
  badge?: string;
  hint?: string;
  action?: string;
  children?: ReactNode;
}) {
  return (
    <div className="campaignInfoRow">
      <strong>{label}</strong>
      {children ? <div className="campaignInfoControl">{children}</div> : <p>{value}</p>}
      {badge ? <span>{badge}</span> : null}
      {hint ? <small>{hint}</small> : null}
      {action ? <button type="button">{action}</button> : null}
    </div>
  );
}

function splitRecipientInput(value: string) {
  return value
    .split(/[\s,;，；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function uniqueEmails(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

function formatCampaignRecordDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
