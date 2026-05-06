"use client";

import { ChevronDown, ChevronUp, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  customTemplateStorageKey,
  renderMailTemplate,
  systemMailTemplates,
  type MailTemplate
} from "./mail-templates";

export type MailConfirmationLead = {
  id?: string;
  companyName: string;
  country: string;
  website: string;
  email: string;
  score: number;
};

export type MailConfirmationRecipient = {
  email: string;
  leadId?: string;
  companyName?: string;
};

type GmailAccount = {
  email: string;
};

type GmailAccountResponse = {
  connected: boolean;
  account: GmailAccount | null;
};

type RewriteResponse = {
  subject?: string;
  body: string;
  changes: string[];
};

export type MailSendResult = {
  ok: boolean;
  providerMessageId?: string | null;
  threadId?: string | null;
  sendLog?: {
    id: string;
    status: string;
    sentAt?: string | null;
  } | null;
  crmLead?: {
    id: string;
    stage: string;
  } | null;
  followupTask?: {
    id: string;
    type: string;
    status: string;
    dueAt?: string | null;
    note?: string | null;
  } | null;
};

type MailConfirmationModalProps = {
  lead: MailConfirmationLead;
  recipients?: MailConfirmationRecipient[];
  open: boolean;
  onClose: () => void;
  onSent?: (result: MailSendResult) => void;
};

type MailDraft = {
  recipients: string[];
  replyTo: string;
  subject: string;
  sendMode: "now" | "scheduled";
  body: string;
};

const emptyGmailAccount: GmailAccountResponse = {
  connected: false,
  account: null
};

export function MailConfirmationModal({ lead, recipients, open, onClose, onSent }: MailConfirmationModalProps) {
  const [status, setStatus] = useState("等待确认发送");
  const [account, setAccount] = useState<GmailAccountResponse>(emptyGmailAccount);
  const initialRecipients = useMemo(() => buildInitialRecipients(lead, recipients), [lead, recipients]);
  const [draft, setDraft] = useState<MailDraft>(() => buildDraft(lead, "", initialRecipients));
  const [templates, setTemplates] = useState<MailTemplate[]>(systemMailTemplates);
  const [selectedTemplateId, setSelectedTemplateId] = useState(systemMailTemplates[0]?.id ?? "");
  const [outputLanguage, setOutputLanguage] = useState("英语 - English");
  const [tone, setTone] = useState("有说服力");
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recipientsExpanded, setRecipientsExpanded] = useState(false);
  const [manualRecipient, setManualRecipient] = useState("");
  const [sending, setSending] = useState(false);

  const gmailAuthorized = account.connected && Boolean(account.account?.email);
  const fromEmail = account.account?.email ?? "Gmail 未授权";
  const oauthLabel = gmailAuthorized ? "Google OAuth 已授权" : "Google OAuth 未授权";
  const recipientList = draft.recipients;
  const visibleRecipients = recipientList.slice(0, 2);
  const canSend = gmailAuthorized && recipientList.length > 0 && Boolean(draft.subject && draft.body) && !sending;
  const previewLine = useMemo(() => {
    return draft.sendMode === "now" ? "立即发送" : "定时发送";
  }, [draft.sendMode]);

  function addRecipient(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus("请输入有效的邮箱地址");
      return false;
    }
    if (draft.recipients.includes(trimmed)) {
      setStatus("该收件人已添加");
      return false;
    }
    setDraft((current) => ({ ...current, recipients: [...current.recipients, trimmed] }));
    setStatus(`已添加收件人 ${trimmed}`);
    return true;
  }

  function removeRecipient(email: string) {
    setDraft((current) => ({ ...current, recipients: current.recipients.filter((item) => item !== email) }));
  }

  function handleManualAdd() {
    if (addRecipient(manualRecipient)) {
      setManualRecipient("");
    }
  }

  async function loadAccount() {
    setStatus("读取邮箱状态...");
    try {
      const response = await fetch("/api/gmail/account", { credentials: "include" });
      if (!response.ok) {
        setAccount(emptyGmailAccount);
        setDraft(buildDraft(lead, "", initialRecipients));
        setStatus("请先授权 Gmail");
        return;
      }

      const payload = (await response.json()) as GmailAccountResponse;
      setAccount(payload);
      setDraft(buildDraft(lead, payload.account?.email ?? "", initialRecipients));
      setStatus(payload.connected && payload.account?.email ? "Gmail 已授权，可以确认发送" : "请先授权 Gmail");
    } catch {
      setAccount(emptyGmailAccount);
      setDraft(buildDraft(lead, "", initialRecipients));
      setStatus("无法读取 Gmail 授权状态");
    }
  }

  function resetDraft() {
    const template = templates.find((item) => item.id === selectedTemplateId) ?? systemMailTemplates[0];
    setDraft(buildDraft(lead, account.account?.email ?? "", initialRecipients, template));
    setRewriteInstruction("");
    setPreviewOpen(false);
    setRecipientsExpanded(false);
    setManualRecipient("");
    setStatus("已重置");
  }

  function loadTemplates() {
    try {
      const stored = window.localStorage.getItem(customTemplateStorageKey);
      const customTemplates = stored ? (JSON.parse(stored) as MailTemplate[]) : [];
      setTemplates([...systemMailTemplates, ...customTemplates]);
    } catch {
      setTemplates(systemMailTemplates);
    }
  }

  function applyTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    const rendered = renderMailTemplate(template, buildTemplateVariables(lead));
    setSelectedTemplateId(template.id);
    setDraft((current) => ({
      ...current,
      subject: rendered.subject,
      body: rendered.body
    }));
    setStatus(`已应用模板：${template.name}`);
  }

  function saveDraftAsTemplate() {
    const customTemplates = templates.filter((template) => template.type === "custom");
    const nextTemplate: MailTemplate = {
      id: `custom-${Date.now()}`,
      type: "custom",
      name: `${lead.companyName} 开发信模板`,
      subject: draft.subject,
      body: draft.body,
      owner: "王亚伟",
      createdAt: new Date().toISOString().slice(0, 10),
      summary: "从邮件确认弹窗另存的自建模板。"
    };
    const nextCustomTemplates = [nextTemplate, ...customTemplates];
    window.localStorage.setItem(customTemplateStorageKey, JSON.stringify(nextCustomTemplates));
    setTemplates([...systemMailTemplates, ...nextCustomTemplates]);
    setSelectedTemplateId(nextTemplate.id);
    setStatus("模板已保存，可在模板配置页编辑。");
  }

  async function rewriteEmail() {
    const instruction = rewriteInstruction.trim();
    if (!instruction) {
      setStatus("请输入改写要求");
      return;
    }

    setStatus("AI 改写中...");
    try {
      const response = await fetch("/api/gmail/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subject: draft.subject,
          body: draft.body,
          outputLanguage,
          tone,
          instruction
        })
      });

      if (!response.ok) {
        setStatus("AI 改写失败");
        return;
      }

      const payload = (await response.json()) as RewriteResponse;
      setDraft((current) => ({
        ...current,
        subject: payload.subject || current.subject,
        body: payload.body
      }));
      setStatus(payload.changes[0] ?? "改写完成，已覆盖正文");
    } catch {
      setStatus("网络异常");
    }
  }

  async function saveDraftToGmail() {
    if (!gmailAuthorized) {
      setStatus("请先授权 Gmail");
      return;
    }
    if (recipientList.length === 0) {
      setStatus("请先添加收件人");
      return;
    }

    setStatus("保存草稿中...");
    try {
      const response = await fetch("/api/gmail/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          leadId: lead.id,
          to: recipientList[0],
          replyTo: draft.replyTo,
          subject: draft.subject,
          body: draft.body
        })
      });
      setStatus(response.ok ? "已保存到 Gmail 草稿箱" : "保存草稿失败");
    } catch {
      setStatus("网络异常");
    }
  }

  async function sendEmail() {
    if (!canSend) {
      setStatus("Gmail 授权或邮件内容不完整");
      return;
    }

    const recipientLeadMap = new Map<string, string | undefined>();
    if (recipients) {
      for (const item of recipients) {
        if (item.email) {
          recipientLeadMap.set(item.email.toLowerCase(), item.leadId);
        }
      }
    }
    if (lead.email && lead.id) {
      recipientLeadMap.set(lead.email.toLowerCase(), lead.id);
    }

    setSending(true);
    setStatus(`发送中... 共 ${recipientList.length} 位收件人`);
    let lastResult: MailSendResult | null = null;
    let successCount = 0;
    let errorMessage = "";
    try {
      for (const recipient of recipientList) {
        const linkedLeadId = recipientLeadMap.get(recipient.toLowerCase()) ?? lead.id;
        const response = await fetch("/api/gmail/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            leadId: linkedLeadId,
            to: recipient,
            replyTo: draft.replyTo,
            subject: draft.subject,
            body: draft.body,
            confirm: true
          })
        });
        const payload = (await response.json().catch(() => null)) as MailSendResult | { message?: string } | null;
        if (!response.ok || !payload || !("ok" in payload)) {
          errorMessage = readSendError(payload) || `发送失败 (${recipient})`;
          break;
        }
        lastResult = payload;
        successCount += 1;
      }

      if (lastResult && successCount > 0) {
        const summary = recipientList.length > 1
          ? `${formatSendStatus(lastResult)} · 已成功发送 ${successCount}/${recipientList.length} 位收件人${errorMessage ? `；剩余失败：${errorMessage}` : ""}`
          : formatSendStatus(lastResult);
        setStatus(summary);
        onSent?.(lastResult);
      } else {
        setStatus(errorMessage || "发送失败");
      }
    } catch {
      setStatus("网络异常");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (open) {
      loadTemplates();
      setSending(false);
      void loadAccount();
    }
  }, [open, lead.companyName]);

  if (!open) return null;

  return (
    <div className="modalBackdrop">
      <section className="mailModalProto" role="dialog" aria-modal="true" aria-label="邮件确认">
        <div className="mailMain">
          <div className="mailHead">
            <div className="mailTitle">发邮件</div>
          </div>

          <div className="mailBody">
            <div className="formRow">
              <div className="formLabel">发件邮箱：</div>
              <div className="formValue">
                <span className="pill">{fromEmail}</span>
                <span className={gmailAuthorized ? "pill success" : "pill"}>{oauthLabel}</span>
                <span>仅使用当前登录用户邮箱发送</span>
              </div>
              <a className="rowLink" href="/mailbox">重新授权</a>
            </div>

            <div className="formRow recipientRow">
              <label htmlFor="mail-to">收件人：</label>
              <div className="formValue recipientValue">
                <div className="recipientInlineChips" aria-label="已选收件人预览">
                  {visibleRecipients.length === 0 ? (
                    <span className="recipientEmpty inline">尚未添加收件人</span>
                  ) : (
                    visibleRecipients.map((email) => (
                      <span key={email} className="recipientChip inline">
                        <span>{email}</span>
                        <button type="button" aria-label={`移除 ${email}`} onClick={() => removeRecipient(email)}>
                          <X size={13} aria-hidden="true" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  className="pill count recipientCount"
                  aria-expanded={recipientsExpanded}
                  onClick={() => setRecipientsExpanded((current) => !current)}
                >
                  共 {recipientList.length} 个
                  {recipientsExpanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                </button>
                <input
                  id="mail-to"
                  name="to"
                  value={manualRecipient}
                  placeholder="手动输入"
                  onChange={(event) => setManualRecipient(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      handleManualAdd();
                    }
                  }}
                />
                {recipientsExpanded ? (
                  <ul className="recipientList" aria-label="收件人列表">
                    {recipientList.length === 0 ? (
                      <li className="recipientEmpty">尚未添加收件人</li>
                    ) : (
                      recipientList.map((email) => (
                        <li key={email} className="recipientChip">
                          <span>{email}</span>
                          <button type="button" aria-label={`移除 ${email}`} onClick={() => removeRecipient(email)}>
                            <X size={13} aria-hidden="true" />
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </div>
              <button type="button" className="rowLink rowLinkAdd" onClick={handleManualAdd} disabled={!manualRecipient.trim()}>
                <UserPlus size={18} aria-hidden="true" />
                添加
              </button>
            </div>

            <div className="formRow">
              <label htmlFor="mail-reply-to">回复邮箱：</label>
              <div className="formValue">
                <input
                  id="mail-reply-to"
                  name="replyTo"
                  value={draft.replyTo}
                  onChange={(event) => setDraft({ ...draft, replyTo: event.target.value })}
                />
                <span>客户回复直接进入个人邮箱</span>
              </div>
              <span />
            </div>

            <div className="formRow">
              <label htmlFor="mail-template">使用模板：</label>
              <div className="formValue">
                <select
                  id="mail-template"
                  name="templateId"
                  aria-label="选择邮件模板"
                  data-mail-template-select="true"
                  value={selectedTemplateId}
                  onChange={(event) => applyTemplate(event.target.value)}
                >
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.type === "system" ? "系统" : "个人"} - {template.name}
                    </option>
                  ))}
                </select>
              </div>
              <span />

            </div>

            <div className="formRow">
              <label htmlFor="mail-subject">邮件主题：</label>
              <div className="formValue">
                <input
                  id="mail-subject"
                  name="subject"
                  value={draft.subject}
                  onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
                />
                <span className="pill count">共1个⌄</span>
              </div>
              <span className="rowLink">添加</span>
            </div>

            <div className="formRow">
              <div className="formLabel">发送时间：</div>
              <div className="formValue">
                <button
                  aria-pressed={draft.sendMode === "now"}
                  className={draft.sendMode === "now" ? "radio active" : "radio muted"}
                  type="button"
                  onClick={() => setDraft({ ...draft, sendMode: "now" })}
                >
                  立即发送
                </button>
                <button
                  aria-pressed={draft.sendMode === "scheduled"}
                  className={draft.sendMode === "scheduled" ? "radio active" : "radio muted"}
                  type="button"
                  onClick={() => setDraft({ ...draft, sendMode: "scheduled" })}
                >
                  定时发送
                </button>
              </div>
              <span />
            </div>

            <div className="editorLabel">
              <label htmlFor="mail-body">邮件内容：</label>
              <span>右侧输入改写要求后，改写结果将覆盖当前邮件正文</span>
            </div>

            <div className="mailToolbar">
              {["↶", "↷", "T", "系统字体⌄", "16px⌄", "B", "I", "U", "A", "Link", "☷", "⊕", "▦", "◉"].map((item) => (
                <span className={item.includes("⌄") ? "tool select" : "tool"} key={item}>
                  {item}
                </span>
              ))}
            </div>

            <textarea
              className="mailEditor"
              id="mail-body"
              name="body"
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />

            {previewOpen ? (
              <div className="mailPreviewBox">
                <strong>{draft.subject}</strong>
                <span>
                  {fromEmail} → {recipientList.join(", ") || "未填写收件人"} · {previewLine}
                </span>
                <p>{draft.body}</p>
              </div>
            ) : null}
          </div>

          <div className="mailFooter">
            <button className="btnPlain" type="button" onClick={resetDraft}>
              重置
            </button>
            <div className="footerActions">
              <button className="btnPlain" type="button" onClick={() => setPreviewOpen((current) => !current)}>
                预览
              </button>
              <button className="btnPlain" type="button" onClick={saveDraftToGmail}>
                存草稿
              </button>
              <button className="btnPlain" type="button" onClick={saveDraftAsTemplate}>
                另存为模板
              </button>
              <button className="btnPrimary" disabled={!canSend} type="button" onClick={sendEmail}>
                确认发送
              </button>
            </div>
          </div>
        </div>

        <aside className="rewritePane">
          <div className="rewriteHead">
            <h3>AI 改写</h3>
            <button className="closeButton" type="button" onClick={onClose} aria-label="关闭">
              ×
            </button>
          </div>
          <div className="rewriteBody">
            <div className="rewriteOptions">
              <div className="selectBox">
                <label htmlFor="mail-output-language">输出邮件使用的语言</label>
                <select
                  id="mail-output-language"
                  name="outputLanguage"
                  value={outputLanguage}
                  onChange={(event) => setOutputLanguage(event.target.value)}
                >
                  <option>英语 - English</option>
                  <option>阿拉伯语 - Arabic</option>
                  <option>法语 - French</option>
                </select>
              </div>
              <div className="selectBox">
                <label htmlFor="mail-tone">邮件语气</label>
                <select
                  id="mail-tone"
                  name="tone"
                  value={tone}
                  onChange={(event) => setTone(event.target.value)}
                >
                  <option>有说服力</option>
                  <option>尊敬</option>
                  <option>简洁</option>
                  <option>正式</option>
                </select>
              </div>
            </div>
            <label className="rewriteLabel" htmlFor="mail-rewrite-instruction">
              输入需要改写的内容
            </label>
            <textarea
              className="rewriteInput"
              id="mail-rewrite-instruction"
              name="rewriteInstruction"
              placeholder="例如：把当前开发信改得更正式，突出 Telecorenet 可以整套项目供货，也可以单个设备、模块、板卡、备件供应。"
              value={rewriteInstruction}
              onChange={(event) => setRewriteInstruction(event.target.value)}
            />
            <button className="btnPrimary rewriteAction" type="button" onClick={rewriteEmail}>
              一键改写
            </button>
            <p className="hint">改写完成后会直接覆盖左侧邮件正文，你再检查并确认发送。</p>
            <p className="hint" aria-live="polite">
              {status}
            </p>
          </div>
        </aside>
      </section>
    </div>
  );
}

function formatSendStatus(result: MailSendResult) {
  if (result.crmLead && result.followupTask) {
    return `已确认发送，已同步 CRM，并创建 ${formatFollowupDue(result.followupTask.dueAt)} 跟进提醒`;
  }
  if (result.crmLead) {
    return "已确认发送，并同步 CRM";
  }

  return "已确认发送";
}

function readSendError(payload: MailSendResult | { message?: string } | null) {
  return payload && "message" in payload ? payload.message : "";
}

function formatFollowupDue(value?: string | null) {
  if (!value) {
    return "3 天后";
  }

  const dueAt = new Date(value);
  if (Number.isNaN(dueAt.getTime())) {
    return "3 天后";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(dueAt);
}

function buildInitialRecipients(
  lead: MailConfirmationLead,
  recipients: MailConfirmationRecipient[] | undefined
): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  const consider = (value?: string) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-") return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    next.push(trimmed);
  };

  if (recipients) {
    for (const item of recipients) {
      consider(item.email);
    }
  }
  consider(lead.email);
  return next;
}

function buildDraft(
  lead: MailConfirmationLead,
  fromEmail: string,
  initialRecipients: string[],
  template = systemMailTemplates[0]!
): MailDraft {
  const rendered = renderMailTemplate(template, buildTemplateVariables(lead));
  return {
    recipients: initialRecipients,
    replyTo: fromEmail,
    subject: rendered.subject,
    sendMode: "now",
    body: rendered.body
  };
}

function buildTemplateVariables(lead: MailConfirmationLead) {
  return {
    companyName: lead.companyName,
    country: lead.country,
    website: lead.website,
    score: String(lead.score)
  };
}
