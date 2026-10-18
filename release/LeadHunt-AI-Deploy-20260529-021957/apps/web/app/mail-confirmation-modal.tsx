"use client";

import ColorExtension from "@tiptap/extension-color";
import HighlightExtension from "@tiptap/extension-highlight";
import LinkExtension from "@tiptap/extension-link";
import TextAlignExtension from "@tiptap/extension-text-align";
import { FontSize, LineHeight, TextStyle } from "@tiptap/extension-text-style";
import UnderlineExtension from "@tiptap/extension-underline";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  ChevronUp,
  Eye,
  Highlighter,
  Indent,
  Italic,
  Link2Off,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Outdent,
  Palette,
  Quote,
  Redo2,
  RemoveFormatting,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Strikethrough,
  Underline,
  Undo2,
  UserPlus,
  X
} from "lucide-react";
import { zhCN } from "date-fns/locale/zh-CN";
import { useEffect, useMemo, useRef, useState } from "react";
import DatePicker from "react-datepicker";
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

export type MailSingleSendResult = {
  ok: boolean;
  scheduled?: boolean;
  scheduledAt?: string | Date | null;
  providerMessageId?: string | null;
  threadId?: string | null;
  sendLog?: {
    id: string;
    status: string;
    scheduledAt?: string | Date | null;
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

export type MailSendResult = MailSingleSendResult & {
  failureCount?: number;
  results?: Array<{
    leadId?: string | null;
    message?: string;
    ok: boolean;
    recipient: string;
    result?: MailSingleSendResult;
  }>;
  successCount?: number;
  totalCount?: number;
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
  scheduledAt: string;
  body: string;
};

const emptyGmailAccount: GmailAccountResponse = {
  connected: false,
  account: null
};

const textColorOptions = [
  { label: "深色", value: "#101828" },
  { label: "蓝色", value: "#2f6bff" },
  { label: "绿色", value: "#0a8f3c" },
  { label: "红色", value: "#d92d20" }
];

const highlightColorOptions = [
  { label: "黄色高亮", value: "#fff3bf" },
  { label: "蓝色高亮", value: "#dbeafe" },
  { label: "绿色高亮", value: "#dcfce7" }
];

const defaultScheduleDelayMs = 30 * 60 * 1000;

const mailEditorExtensions = [
  TextStyle,
  ColorExtension,
  FontSize,
  LineHeight,
  StarterKit.configure({
    heading: {
      levels: [1, 2, 3]
    },
    code: false,
    codeBlock: false
  }),
  TextAlignExtension.configure({
    types: ["heading", "paragraph"]
  }),
  HighlightExtension.configure({
    multicolor: true
  }),
  UnderlineExtension,
  LinkExtension.configure({
    autolink: true,
    linkOnPaste: true,
    openOnClick: false,
    HTMLAttributes: {
      rel: "noopener noreferrer nofollow",
      target: "_blank"
    }
  })
];

export function MailConfirmationModal({
  lead,
  recipients,
  open,
  onClose,
  onSent
}: MailConfirmationModalProps) {
  const [status, setStatus] = useState("等待确认发送");
  const [account, setAccount] = useState<GmailAccountResponse>(emptyGmailAccount);
  const initialRecipients = useMemo(
    () => buildInitialRecipients(lead, recipients),
    [lead, recipients]
  );
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
  const recipientMenuRef = useRef<HTMLDivElement | null>(null);

  const gmailAuthorized = account.connected && Boolean(account.account?.email);
  const fromEmail = account.account?.email ?? "Gmail 未授权";
  const oauthLabel = gmailAuthorized ? "Google OAuth 已授权" : "Google OAuth 未授权";
  const recipientList = draft.recipients;
  const visibleRecipients = recipientList.slice(0, 2);
  const scheduledSendAt = useMemo(
    () => (draft.sendMode === "scheduled" ? parseLocalDateTime(draft.scheduledAt) : null),
    [draft.scheduledAt, draft.sendMode]
  );
  const scheduledTimeValid =
    draft.sendMode === "now" ||
    Boolean(scheduledSendAt && scheduledSendAt.getTime() > Date.now() + 60_000);
  const canSend =
    gmailAuthorized &&
    recipientList.length > 0 &&
    Boolean(draft.subject && draft.body) &&
    scheduledTimeValid &&
    !sending;
  const statusClassName = getMailHeaderStatusClassName(status, gmailAuthorized);
  const previewLine = useMemo(() => {
    return draft.sendMode === "now"
      ? "立即发送"
      : `定时发送：${formatScheduledPreview(scheduledSendAt)}`;
  }, [draft.sendMode, scheduledSendAt]);
  const sendingTitle = draft.sendMode === "scheduled" ? "正在安排定时发送" : "正在发送邮件";
  const sendingDescription =
    draft.sendMode === "scheduled"
      ? `正在为 ${recipientList.length} 位收件人创建定时发送任务。`
      : `正在通过 Gmail 发送给 ${recipientList.length} 位收件人。`;
  const editor = useEditor({
    extensions: mailEditorExtensions,
    content: plainTextToEditorHtml(draft.body),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": "邮件内容",
        class: "mailEditorContent"
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      const nextBody = editorToPlainText(currentEditor);
      setDraft((current) => (current.body === nextBody ? current : { ...current, body: nextBody }));
    }
  });

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
    setDraft((current) => ({
      ...current,
      recipients: current.recipients.filter((item) => item !== email)
    }));
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
      setStatus(
        payload.connected && payload.account?.email
          ? "Gmail 已授权，可以确认发送"
          : "请先授权 Gmail"
      );
    } catch {
      setAccount(emptyGmailAccount);
      setDraft(buildDraft(lead, "", initialRecipients));
      setStatus("无法读取 Gmail 授权状态");
    }
  }

  function resetDraft() {
    const template =
      templates.find((item) => item.id === selectedTemplateId) ?? systemMailTemplates[0];
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
      owner: "当前账号",
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
      setStatus(
        draft.sendMode === "scheduled" && !scheduledTimeValid
          ? "请选择至少 1 分钟后的定时发送时间"
          : "Gmail 授权或邮件内容不完整"
      );
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

    const recipientMessages = recipientList.map((recipient) => ({
      leadId: recipientLeadMap.get(recipient.toLowerCase()) ?? lead.id,
      to: recipient
    }));
    const scheduledAtIso =
      draft.sendMode === "scheduled" && scheduledSendAt ? scheduledSendAt.toISOString() : undefined;

    setSending(true);
    setStatus(
      draft.sendMode === "scheduled"
        ? `正在安排定时发送... 共 ${recipientList.length} 位收件人`
        : `发送中... 共 ${recipientList.length} 位收件人`
    );
    try {
      const response =
        recipientMessages.length > 1
          ? await fetch("/api/gmail/send-batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                recipients: recipientMessages,
                replyTo: draft.replyTo,
                subject: draft.subject,
                body: draft.body,
                scheduledAt: scheduledAtIso,
                confirm: true
              })
            })
          : await fetch("/api/gmail/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                leadId: recipientMessages[0]?.leadId,
                to: recipientMessages[0]?.to,
                replyTo: draft.replyTo,
                subject: draft.subject,
                body: draft.body,
                scheduledAt: scheduledAtIso,
                confirm: true
              })
            });
      const payload = (await response.json().catch(() => null)) as
        | MailSendResult
        | { message?: string }
        | null;
      if (!response.ok || !payload || !("ok" in payload)) {
        setStatus(readSendError(payload) || "发送失败");
        return;
      }

      const totalCount = payload.totalCount ?? recipientList.length;
      const successCount = payload.successCount ?? (payload.ok ? totalCount : 0);
      const failureCount = payload.failureCount ?? Math.max(0, totalCount - successCount);

      if (successCount > 0 && failureCount === 0) {
        onSent?.({
          ...payload,
          successCount,
          totalCount
        });
        onClose();
        return;
      }

      setStatus(
        successCount > 0
          ? formatPartialSendStatus(payload, successCount, totalCount)
          : formatFailedSendStatus(payload)
      );
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

  useEffect(() => {
    if (!editor || !open) return;
    const currentBody = editorToPlainText(editor);
    if (currentBody !== draft.body) {
      editor.commands.setContent(plainTextToEditorHtml(draft.body), { emitUpdate: false });
    }
  }, [draft.body, editor, open]);

  useEffect(() => {
    if (!open || !recipientsExpanded) return undefined;

    const closeWhenOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!recipientMenuRef.current?.contains(target)) {
        setRecipientsExpanded(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRecipientsExpanded(false);
      }
    };

    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, recipientsExpanded]);

  if (!open) return null;

  return (
    <div className="modalBackdrop">
      <section className="mailModalProto" role="dialog" aria-modal="true" aria-label="邮件确认">
        <div className="mailMain">
          <div className="mailHead">
            <div>
              <div className="mailTitle">发邮件</div>
              <p className="mailHeaderMeta">
                {lead.companyName} ·{" "}
                {recipientList.length > 0 ? `${recipientList.length} 位收件人` : "未添加收件人"}
              </p>
            </div>
            <span className={statusClassName} aria-live="polite" title={status}>
              {status}
            </span>
          </div>

          <div className="mailBody">
            <div className="formRow">
              <div className="formLabel">发件邮箱：</div>
              <div className="formValue">
                <span className="pill">{fromEmail}</span>
                <span className={gmailAuthorized ? "pill success" : "pill"}>{oauthLabel}</span>
                <span>仅使用当前登录用户邮箱发送</span>
              </div>
              <a className="rowLink" href="/mailbox">
                重新授权
              </a>
            </div>

            <div className="formRow recipientRow">
              <label htmlFor="mail-to">收件人：</label>
              <div className="formValue recipientValue" ref={recipientMenuRef}>
                <div className="recipientInlineChips" aria-label="已选收件人预览">
                  {visibleRecipients.length === 0 ? (
                    <span className="recipientEmpty inline">尚未添加收件人</span>
                  ) : (
                    visibleRecipients.map((email) => (
                      <span key={email} className="recipientChip inline">
                        <span>{email}</span>
                        <button
                          type="button"
                          aria-label={`移除 ${email}`}
                          onClick={() => removeRecipient(email)}
                        >
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
                  {recipientsExpanded ? (
                    <ChevronUp size={14} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={14} aria-hidden="true" />
                  )}
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
                          <button
                            type="button"
                            aria-label={`移除 ${email}`}
                            onClick={() => removeRecipient(email)}
                          >
                            <X size={13} aria-hidden="true" />
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </div>
              <button
                type="button"
                className="rowLink rowLinkAdd"
                onClick={handleManualAdd}
                disabled={!manualRecipient.trim()}
              >
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
              </div>
              <span />
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
                {draft.sendMode === "scheduled" ? (
                  <DatePicker
                    aria-label="定时发送时间"
                    calendarClassName="mailDatePickerCalendar"
                    className="mailScheduleInput"
                    dateFormat="yyyy-MM-dd HH:mm"
                    dateFormatCalendar="yyyy年M月"
                    filterTime={isSelectableScheduleTime}
                    locale={zhCN}
                    minDate={minimumScheduleDate()}
                    nextMonthButtonLabel="下个月"
                    nextYearButtonLabel="下一年"
                    onChange={(value: Date | null) =>
                      setDraft({
                        ...draft,
                        scheduledAt: value
                          ? toLocalDateTimeValue(value)
                          : minScheduleDateTimeValue(new Date(Date.now() + defaultScheduleDelayMs)),
                        sendMode: "scheduled"
                      })
                    }
                    placeholderText="选择日期和时间"
                    popperClassName="mailDatePickerPopper"
                    previousMonthButtonLabel="上个月"
                    previousYearButtonLabel="上一年"
                    selected={scheduledSendAt}
                    showTimeSelect
                    timeCaption="时间"
                    timeFormat="HH:mm"
                    timeIntervals={15}
                  />
                ) : null}
              </div>
              <span>{draft.sendMode === "scheduled" ? "到点自动发送" : ""}</span>
            </div>

            <div className="editorLabel">
              <label htmlFor="mail-body">邮件内容：</label>
            </div>

            <MailRichTextEditor editor={editor} />

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
              <RotateCcw size={15} aria-hidden="true" />
              重置
            </button>
            <div className="footerActions">
              <button
                className="btnPlain"
                type="button"
                onClick={() => setPreviewOpen((current) => !current)}
              >
                <Eye size={15} aria-hidden="true" />
                预览
              </button>
              <button className="btnPlain" type="button" onClick={saveDraftToGmail}>
                <Save size={15} aria-hidden="true" />
                存草稿
              </button>
              <button className="btnPlain" type="button" onClick={saveDraftAsTemplate}>
                另存为模板
              </button>
              <button className="btnPrimary" disabled={!canSend} type="button" onClick={sendEmail}>
                <Send size={15} aria-hidden="true" />
                {draft.sendMode === "scheduled" ? "确认定时" : "确认发送"}
              </button>
            </div>
          </div>
        </div>

        <aside className="rewritePane">
          <div className="rewriteHead">
            <div className="rewriteHeadTitle">
              <span aria-hidden="true">
                <Sparkles size={17} />
              </span>
              <h3>AI 改写</h3>
            </div>
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
              <Sparkles size={15} aria-hidden="true" />
              一键改写
            </button>
          </div>
        </aside>
      </section>
      {sending ? (
        <div
          className="mailSendingLayer"
          role="status"
          aria-live="assertive"
          aria-label={sendingTitle}
        >
          <section className="mailSendingDialog">
            <span className="mailSendingSpinner" aria-hidden="true" />
            <h2>{sendingTitle}</h2>
            <p>{sendingDescription}</p>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function MailRichTextEditor({ editor }: { editor: Editor | null }) {
  const [, setUpdateSeed] = useState(0);

  useEffect(() => {
    if (!editor) return undefined;
    const refresh = () => setUpdateSeed((value) => value + 1);
    editor.on("selectionUpdate", refresh);
    editor.on("transaction", refresh);
    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("transaction", refresh);
    };
  }, [editor]);

  function setLink() {
    if (!editor) return;
    const previousUrl = (editor.getAttributes("link").href as string | undefined) ?? "";
    const nextUrl = window.prompt("输入链接地址", previousUrl || "https://");
    if (nextUrl === null) return;
    if (!nextUrl.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: nextUrl.trim() }).run();
  }

  const canUseEditor = Boolean(editor);
  const blockFormat = getCurrentBlockFormat(editor);
  const selectedFontSize =
    (editor?.getAttributes("textStyle").fontSize as string | undefined) ?? "";
  const selectedLineHeight =
    (editor?.getAttributes("textStyle").lineHeight as string | undefined) ?? "";
  const selectedColor = (
    (editor?.getAttributes("textStyle").color as string | undefined) ?? ""
  ).toLowerCase();
  const selectedHighlight = (
    (editor?.getAttributes("highlight").color as string | undefined) ?? ""
  ).toLowerCase();

  function applyBlockFormat(value: string) {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (value === "paragraph") {
      chain.setParagraph().run();
      return;
    }
    if (value === "heading-1") {
      chain.toggleHeading({ level: 1 }).run();
      return;
    }
    if (value === "heading-2") {
      chain.toggleHeading({ level: 2 }).run();
      return;
    }
    if (value === "heading-3") {
      chain.toggleHeading({ level: 3 }).run();
    }
  }

  function applyFontSize(value: string) {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (!value) {
      chain.unsetFontSize().run();
      return;
    }
    chain.setFontSize(value).run();
  }

  function applyLineHeight(value: string) {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (!value) {
      chain.unsetLineHeight().run();
      return;
    }
    chain.setLineHeight(value).run();
  }

  return (
    <div className="richMailEditor" id="mail-body">
      <div className="richMailToolbar" aria-label="邮件正文格式工具栏">
        <select
          aria-label="段落样式"
          className="richFormatSelect"
          disabled={!canUseEditor}
          onChange={(event) => applyBlockFormat(event.target.value)}
          value={blockFormat}
        >
          <option value="paragraph">正文</option>
          <option value="heading-1">标题 1</option>
          <option value="heading-2">标题 2</option>
          <option value="heading-3">标题 3</option>
        </select>
        <select
          aria-label="字号"
          className="richFormatSelect compact"
          disabled={!canUseEditor}
          onChange={(event) => applyFontSize(event.target.value)}
          value={selectedFontSize}
        >
          <option value="">字号</option>
          <option value="13px">13</option>
          <option value="15px">15</option>
          <option value="17px">17</option>
          <option value="19px">19</option>
        </select>
        <select
          aria-label="行高"
          className="richFormatSelect compact"
          disabled={!canUseEditor}
          onChange={(event) => applyLineHeight(event.target.value)}
          value={selectedLineHeight}
        >
          <option value="">行高</option>
          <option value="1.45">1.45</option>
          <option value="1.65">1.65</option>
          <option value="1.85">1.85</option>
        </select>
        <span className="richToolDivider" aria-hidden="true" />
        <button
          aria-label="撤销"
          className="richTool"
          disabled={!canUseEditor || !editor?.can().chain().focus().undo().run()}
          onClick={() => editor?.chain().focus().undo().run()}
          title="撤销"
          type="button"
        >
          <Undo2 size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="重做"
          className="richTool"
          disabled={!canUseEditor || !editor?.can().chain().focus().redo().run()}
          onClick={() => editor?.chain().focus().redo().run()}
          title="重做"
          type="button"
        >
          <Redo2 size={16} aria-hidden="true" />
        </button>
        <span className="richToolDivider" aria-hidden="true" />
        <button
          aria-label="加粗"
          aria-pressed={editor?.isActive("bold") ?? false}
          className={editor?.isActive("bold") ? "richTool active" : "richTool"}
          disabled={!canUseEditor}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          title="加粗"
          type="button"
        >
          <Bold size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="斜体"
          aria-pressed={editor?.isActive("italic") ?? false}
          className={editor?.isActive("italic") ? "richTool active" : "richTool"}
          disabled={!canUseEditor}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          title="斜体"
          type="button"
        >
          <Italic size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="下划线"
          aria-pressed={editor?.isActive("underline") ?? false}
          className={editor?.isActive("underline") ? "richTool active" : "richTool"}
          disabled={!canUseEditor}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          title="下划线"
          type="button"
        >
          <Underline size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="删除线"
          aria-pressed={editor?.isActive("strike") ?? false}
          className={editor?.isActive("strike") ? "richTool active" : "richTool"}
          disabled={!canUseEditor}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
          title="删除线"
          type="button"
        >
          <Strikethrough size={16} aria-hidden="true" />
        </button>
        <span className="richToolDivider" aria-hidden="true" />
        <div className="richSwatchGroup" aria-label="文字颜色">
          <Palette size={15} aria-hidden="true" />
          {textColorOptions.map((option) => (
            <button
              key={option.value}
              aria-label={`文字颜色：${option.label}`}
              aria-pressed={selectedColor === option.value}
              className={selectedColor === option.value ? "richSwatch active" : "richSwatch"}
              disabled={!canUseEditor}
              onClick={() => editor?.chain().focus().setColor(option.value).run()}
              title={`文字颜色：${option.label}`}
              type="button"
            >
              <span className="richSwatchDot" style={{ backgroundColor: option.value }} />
            </button>
          ))}
        </div>
        <div className="richSwatchGroup" aria-label="高亮颜色">
          <Highlighter size={15} aria-hidden="true" />
          {highlightColorOptions.map((option) => (
            <button
              key={option.value}
              aria-label={option.label}
              aria-pressed={selectedHighlight === option.value}
              className={selectedHighlight === option.value ? "richSwatch active" : "richSwatch"}
              disabled={!canUseEditor}
              onClick={() => editor?.chain().focus().toggleHighlight({ color: option.value }).run()}
              title={option.label}
              type="button"
            >
              <span className="richSwatchDot" style={{ backgroundColor: option.value }} />
            </button>
          ))}
        </div>
        <span className="richToolDivider" aria-hidden="true" />
        <button
          aria-label="左对齐"
          aria-pressed={editor?.isActive({ textAlign: "left" }) ?? false}
          className={editor?.isActive({ textAlign: "left" }) ? "richTool active" : "richTool"}
          disabled={!canUseEditor}
          onClick={() => editor?.chain().focus().setTextAlign("left").run()}
          title="左对齐"
          type="button"
        >
          <AlignLeft size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="居中"
          aria-pressed={editor?.isActive({ textAlign: "center" }) ?? false}
          className={editor?.isActive({ textAlign: "center" }) ? "richTool active" : "richTool"}
          disabled={!canUseEditor}
          onClick={() => editor?.chain().focus().setTextAlign("center").run()}
          title="居中"
          type="button"
        >
          <AlignCenter size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="右对齐"
          aria-pressed={editor?.isActive({ textAlign: "right" }) ?? false}
          className={editor?.isActive({ textAlign: "right" }) ? "richTool active" : "richTool"}
          disabled={!canUseEditor}
          onClick={() => editor?.chain().focus().setTextAlign("right").run()}
          title="右对齐"
          type="button"
        >
          <AlignRight size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="两端对齐"
          aria-pressed={editor?.isActive({ textAlign: "justify" }) ?? false}
          className={editor?.isActive({ textAlign: "justify" }) ? "richTool active" : "richTool"}
          disabled={!canUseEditor}
          onClick={() => editor?.chain().focus().setTextAlign("justify").run()}
          title="两端对齐"
          type="button"
        >
          <AlignJustify size={16} aria-hidden="true" />
        </button>
        <span className="richToolDivider" aria-hidden="true" />
        <button
          aria-label="项目符号列表"
          aria-pressed={editor?.isActive("bulletList") ?? false}
          className={editor?.isActive("bulletList") ? "richTool active" : "richTool"}
          disabled={!canUseEditor}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          title="项目符号列表"
          type="button"
        >
          <List size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="编号列表"
          aria-pressed={editor?.isActive("orderedList") ?? false}
          className={editor?.isActive("orderedList") ? "richTool active" : "richTool"}
          disabled={!canUseEditor}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          title="编号列表"
          type="button"
        >
          <ListOrdered size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="减少缩进"
          className="richTool"
          disabled={!canUseEditor || !editor?.can().chain().focus().liftListItem("listItem").run()}
          onClick={() => editor?.chain().focus().liftListItem("listItem").run()}
          title="减少缩进"
          type="button"
        >
          <Outdent size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="增加缩进"
          className="richTool"
          disabled={!canUseEditor || !editor?.can().chain().focus().sinkListItem("listItem").run()}
          onClick={() => editor?.chain().focus().sinkListItem("listItem").run()}
          title="增加缩进"
          type="button"
        >
          <Indent size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="引用"
          aria-pressed={editor?.isActive("blockquote") ?? false}
          className={editor?.isActive("blockquote") ? "richTool active" : "richTool"}
          disabled={!canUseEditor}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          title="引用"
          type="button"
        >
          <Quote size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="插入链接"
          aria-pressed={editor?.isActive("link") ?? false}
          className={editor?.isActive("link") ? "richTool active" : "richTool"}
          disabled={!canUseEditor}
          onClick={setLink}
          title="插入链接"
          type="button"
        >
          <LinkIcon size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="取消链接"
          className="richTool"
          disabled={!canUseEditor || !editor?.isActive("link")}
          onClick={() => editor?.chain().focus().extendMarkRange("link").unsetLink().run()}
          title="取消链接"
          type="button"
        >
          <Link2Off size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="分隔线"
          className="richTool"
          disabled={!canUseEditor}
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          title="分隔线"
          type="button"
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <button
          aria-label="清除格式"
          className="richTool"
          disabled={!canUseEditor}
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .unsetAllMarks()
              .clearNodes()
              .unsetColor()
              .unsetHighlight()
              .unsetFontSize()
              .unsetLineHeight()
              .run()
          }
          title="清除格式"
          type="button"
        >
          <RemoveFormatting size={16} aria-hidden="true" />
        </button>
      </div>
      {editor ? (
        <EditorContent editor={editor} />
      ) : (
        <div className="mailEditorContent loading">正在加载编辑器</div>
      )}
    </div>
  );
}

function getCurrentBlockFormat(editor: Editor | null) {
  if (!editor) return "paragraph";
  if (editor.isActive("heading", { level: 1 })) return "heading-1";
  if (editor.isActive("heading", { level: 2 })) return "heading-2";
  if (editor.isActive("heading", { level: 3 })) return "heading-3";
  return "paragraph";
}

function formatPartialSendStatus(result: MailSendResult, successCount: number, totalCount: number) {
  const failed = result.results?.filter((item) => !item.ok) ?? [];
  const failedText = failed
    .map((item) => `${item.recipient}${item.message ? `：${item.message}` : ""}`)
    .join("；");
  const actionText = result.scheduled ? "已安排" : "已发送";

  return `${actionText} ${successCount}/${totalCount} 位收件人${failedText ? `；失败：${failedText}` : ""}`;
}

function formatFailedSendStatus(result: MailSendResult | { message?: string } | null) {
  if (!result) return "发送失败";
  if ("results" in result && result.results?.length) {
    const failedText = result.results
      .filter((item) => !item.ok)
      .map((item) => `${item.recipient}${item.message ? `：${item.message}` : ""}`)
      .join("；");
    return failedText ? `发送失败：${failedText}` : "发送失败";
  }

  return readSendError(result) || "发送失败";
}

function readSendError(payload: MailSendResult | { message?: string } | null) {
  return payload && "message" in payload ? payload.message : "";
}

function getMailHeaderStatusClassName(status: string, gmailAuthorized: boolean) {
  if (
    /失败|无法|无效|不可用|异常|取消|不完整|failed|invalid|rate limited|limit reached|recipient domain/i.test(
      status
    )
  ) {
    return "mailHeaderStatus danger";
  }

  return gmailAuthorized ? "mailHeaderStatus success" : "mailHeaderStatus";
}

function editorToPlainText(editor: Editor) {
  return editor
    .getText({ blockSeparator: "\n\n" })
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function plainTextToEditorHtml(value: string) {
  const paragraphs = value
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trimEnd());

  if (!paragraphs.length) {
    return "<p></p>";
  }

  return paragraphs
    .map((paragraph) => `<p>${escapeEditorHtml(paragraph).replace(/\n/g, "<br>") || "<br>"}</p>`)
    .join("");
}

function escapeEditorHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    scheduledAt: minScheduleDateTimeValue(new Date(Date.now() + defaultScheduleDelayMs)),
    body: rendered.body
  };
}

function parseLocalDateTime(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatScheduledPreview(value: Date | null) {
  if (!value) return "请选择时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}

function minScheduleDateTimeValue(value = new Date(Date.now() + 2 * 60 * 1000)) {
  return toLocalDateTimeValue(value);
}

function toLocalDateTimeValue(value: Date) {
  const localTime = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

function minimumScheduleDate() {
  return new Date(Date.now() + 60_000);
}

function isSelectableScheduleTime(value: Date) {
  return value.getTime() > Date.now() + 60_000;
}

function buildTemplateVariables(lead: MailConfirmationLead) {
  return {
    companyName: lead.companyName,
    country: lead.country,
    website: lead.website,
    score: String(lead.score)
  };
}
