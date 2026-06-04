"use client";

import {
  Archive,
  ArrowLeft,
  ChevronDown,
  Clock3,
  Edit3,
  Inbox,
  Mail,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Tag,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TableLoadingState } from "../table-loading-state";

type GmailAccount = {
  id: string;
  email: string;
  connectedAt: string;
  revokedAt: string | null;
};

type GmailAccountResponse = {
  connected: boolean;
  account: GmailAccount | null;
  scopes: string[];
};

type MailboxMessage = {
  id: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  unread: boolean;
};

type MailboxMessageDetail = MailboxMessage & {
  body: string;
  bodyHtml: string;
  labelIds: string[];
};

type MailboxFolder = "inbox" | "sent";

const emptyGmailData: GmailAccountResponse = {
  connected: false,
  account: null,
  scopes: []
};

const folderGroups: Array<{
  title: string;
  items: Array<{ icon: typeof Inbox; label: string; folder?: MailboxFolder }>;
}> = [
  {
    title: "收件",
    items: [
      { icon: Inbox, label: "全部收件", folder: "inbox" },
      { icon: Mail, label: "未读邮件" },
      { icon: Clock3, label: "待处理邮件" },
      { icon: Archive, label: "草稿箱" }
    ]
  },
  {
    title: "发件",
    items: [{ icon: Send, label: "全部发件", folder: "sent" }]
  },
  {
    title: "归档",
    items: [
      { icon: Tag, label: "标签邮件" },
      { icon: Trash2, label: "已删除" },
      { icon: ShieldCheck, label: "垃圾邮件" }
    ]
  }
];

export function MailboxClient() {
  const [status, setStatus] = useState("正在检查 Gmail 授权状态...");
  const [data, setData] = useState<GmailAccountResponse>(emptyGmailData);
  const [folder, setFolder] = useState<MailboxFolder>("inbox");
  const [messages, setMessages] = useState<MailboxMessage[]>([]);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [activeMessage, setActiveMessage] = useState<MailboxMessageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const connectedEmail = data.account?.email ?? "未授权";
  const connectedAt = useMemo(() => {
    if (!data.account?.connectedAt) return null;
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(data.account.connectedAt));
  }, [data.account?.connectedAt]);

  async function loadAccount() {
    const returnStatus = getOAuthReturnStatus();
    setLoadingAccount(true);
    setStatus(returnStatus ?? "正在检查 Gmail 授权状态...");
    try {
      const response = await fetch("/api/gmail/account", { credentials: "include" });
      if (!response.ok) {
        setData(emptyGmailData);
        setStatus(returnStatus ?? "尚未授权 Gmail，请先点击右上角按钮完成 Google OAuth。");
        return;
      }

      const payload = (await response.json()) as GmailAccountResponse;
      setData(payload);
      if (payload.connected) {
        setStatus(returnStatus ?? "Gmail 已授权，正在同步真实邮件...");
        void loadMessages(folder, keyword);
        return;
      }

      setStatus(returnStatus ?? "尚未授权 Gmail，请先点击右上角按钮完成 Google OAuth。");
    } catch {
      setData(emptyGmailData);
      setStatus(returnStatus ?? "无法读取 Gmail 授权状态，请稍后重试。");
    } finally {
      setLoadingAccount(false);
    }
  }

  async function loadMessages(nextFolder: MailboxFolder, query: string) {
    setLoadingMessages(true);
    try {
      const params = new URLSearchParams({ folder: nextFolder, limit: "20" });
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/gmail/messages?${params.toString()}`, { credentials: "include" });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { message?: string } | null;
        setMessages([]);
        setStatus(errorBody?.message ? `读取邮件失败：${errorBody.message}` : "读取邮件失败，请重新授权或稍后重试。");
        return;
      }

      const payload = (await response.json()) as { messages: MailboxMessage[]; total: number };
      setMessages(payload.messages);
      setStatus(`已同步 ${payload.messages.length} 封 ${nextFolder === "inbox" ? "收件" : "发件"}邮件`);
    } catch {
      setMessages([]);
      setStatus("网络异常，无法读取邮件。");
    } finally {
      setLoadingMessages(false);
    }
  }

  async function selectMessage(messageId: string) {
    setSelectedMessageId(messageId);
    setLoadingDetail(true);
    try {
      const response = await fetch(`/api/gmail/messages/${encodeURIComponent(messageId)}`, { credentials: "include" });
      if (!response.ok) {
        setActiveMessage(null);
        return;
      }

      const payload = (await response.json()) as { message: MailboxMessageDetail };
      setActiveMessage(payload.message);
    } catch {
      setActiveMessage(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function connectGmail() {
    setStatus("准备跳转到 Google 授权...");
    try {
      const response = await fetch("/api/gmail/oauth/start", { credentials: "include" });
      if (!response.ok) {
        setStatus("无法开始授权");
        return;
      }

      const payload = (await response.json()) as { url: string };
      window.location.href = payload.url;
    } catch {
      setStatus("网络异常，请稍后重试");
    }
  }

  async function revokeGmail() {
    if (!data.connected) return;
    if (typeof window !== "undefined" && !window.confirm("确定要解除当前 Gmail 授权吗？")) return;
    setStatus("撤销中...");
    try {
      const response = await fetch("/api/gmail/account", {
        method: "DELETE",
        credentials: "include"
      });
      if (!response.ok) {
        setStatus("撤销失败");
        return;
      }

      setData({ connected: false, account: null, scopes: data.scopes });
      setMessages([]);
      setActiveMessage(null);
      setSelectedMessageId(null);
      setStatus("已撤销授权");
    } catch {
      setStatus("网络异常，请稍后重试");
    }
  }

  function closeDetail() {
    setActiveMessage(null);
    setSelectedMessageId(null);
  }

  function changeFolder(nextFolder: MailboxFolder) {
    if (nextFolder === folder) return;
    setFolder(nextFolder);
    setSelectedMessageId(null);
    setActiveMessage(null);
    if (data.connected) {
      void loadMessages(nextFolder, keyword);
    }
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data.connected) return;
    setSelectedMessageId(null);
    setActiveMessage(null);
    void loadMessages(folder, keyword);
  }

  useEffect(() => {
    void loadAccount();
  }, []);

  return (
    <section className="mailboxShell">
      {/* Top status / auth bar */}
      <header className="mailboxStatusBar" aria-label="Gmail 授权状态">
        <div className="mailboxStatusLeft">
          <span className="gmailLogo" aria-hidden="true">G</span>
          <div>
            <strong>{connectedEmail}</strong>
            <small>
              {data.connected ? (
                <>
                  <em className="dot connected" aria-hidden="true" />
                  Gmail 已授权 · 通过 Google OAuth 同步真实收发件{connectedAt ? ` · ${connectedAt}` : ""}
                </>
              ) : (
                <>
                  <em className="dot warning" aria-hidden="true" />
                  尚未授权 Gmail · 授权后才能同步真实邮件
                </>
              )}
            </small>
          </div>
        </div>
        <div className="mailboxStatusActions">
          {data.connected ? (
            <>
              <button className="mailboxStatusGhost" onClick={connectGmail} type="button">
                重新授权
              </button>
              <button className="mailboxStatusGhost danger" onClick={revokeGmail} type="button">
                解除授权
              </button>
            </>
          ) : (
            <button className="mailboxStatusPrimary" onClick={connectGmail} type="button">
              <span aria-hidden="true">G</span>
              使用 Google 授权 Gmail
            </button>
          )}
        </div>
      </header>

      <div className="mailboxBody">
        <aside className="mailboxFolderPane">
          <button className="mailboxCompose" type="button">
            <Edit3 aria-hidden="true" size={16} />
            写信
          </button>
          {folderGroups.map((group) => (
            <div className="mailboxFolderGroup" key={group.title}>
              <h2>{group.title}</h2>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = item.folder === folder;
                return (
                  <button
                    aria-current={active ? "page" : undefined}
                    className={active ? "active" : ""}
                    key={item.label}
                    onClick={() => item.folder && changeFolder(item.folder)}
                    type="button"
                  >
                    <Icon aria-hidden="true" size={15} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        <section className={`mailboxListPanel ${activeMessage ? "mailboxDetailMode" : ""}`}>
          {activeMessage ? (
            <>
              <header className="mailboxToolbar mailboxToolbarDetail">
                <button className="mailboxBackBtn" onClick={closeDetail} type="button">
                  <ArrowLeft aria-hidden="true" size={15} />
                  返回邮件列表
                </button>
                <button
                  className="mailboxIconBtn"
                  onClick={() => activeMessage && selectMessage(activeMessage.id)}
                  title="刷新"
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={15} />
                </button>
                <span className="mailboxToolbarSpacer" />
                <small className="mailboxStatusText">{loadingDetail ? "正在加载邮件正文..." : status}</small>
              </header>
              <article className="mailboxDetailArticle">
                <h3>{activeMessage.subject || "(无主题)"}</h3>
                <div className="mailboxDetailMeta">
                  <span className={`mailboxAvatar tone${avatarTone(activeMessage.fromName || activeMessage.fromEmail)}`}>
                    {avatarLetter(activeMessage.fromName || activeMessage.fromEmail)}
                  </span>
                  <div>
                    <strong>{activeMessage.fromName || activeMessage.fromEmail}</strong>
                    <small>&lt;{activeMessage.fromEmail}&gt;</small>
                  </div>
                  <time>{formatMailDateTime(activeMessage.receivedAt)}</time>
                </div>
                <p className="mailboxDetailTo">收件人：{activeMessage.to || connectedEmail}</p>
                <div className="mailboxDetailBody">
                  {activeMessage.bodyHtml ? (
                    <iframe
                      className="mailboxDetailIframe"
                      sandbox=""
                      srcDoc={`<base target="_blank">${activeMessage.bodyHtml}`}
                      title="邮件正文"
                    />
                  ) : (
                    <pre className="mailboxDetailText">{activeMessage.body || activeMessage.snippet}</pre>
                  )}
                </div>
              </article>
            </>
          ) : (
            <>
              <header className="mailboxToolbar">
                <button
                  className="mailboxIconBtn"
                  disabled={!data.connected || loadingMessages}
                  onClick={() => loadMessages(folder, keyword)}
                  title="刷新"
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={15} className={loadingMessages ? "spinning" : ""} />
                </button>
                <button className="mailboxFilter" disabled title="筛选功能开发中" type="button">
                  全部
                  <ChevronDown aria-hidden="true" size={13} />
                </button>
                <form className="mailboxSearch" onSubmit={submitSearch}>
                  <Search aria-hidden="true" size={15} />
                  <input
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索 Gmail 邮件 (支持 from: / has:attachment)"
                    value={keyword}
                  />
                </form>
                <small className="mailboxStatusText">{status}</small>
              </header>
              <div className="mailboxRows">
                {loadingAccount || (loadingMessages && messages.length === 0) ? (
                  <TableLoadingState
                    title={loadingAccount ? "正在检查 Gmail 授权" : "正在加载邮件列表"}
                    description={loadingAccount ? "正在读取 Gmail 授权状态。" : "正在从 Gmail 同步当前文件夹邮件。"}
                    compact
                  />
                ) : messages.length === 0 ? (
                  <div className="mailboxEmptyHint">
                    {data.connected
                      ? "当前文件夹没有邮件，可以换关键字或刷新。"
                      : "尚未授权 Gmail，授权后会显示真实邮件列表。"}
                  </div>
                ) : (
                  messages.map((row) => (
                    <button
                      className={`mailboxRow${row.unread ? " unread" : ""}${row.id === selectedMessageId ? " active" : ""}`}
                      key={row.id}
                      onClick={() => selectMessage(row.id)}
                      type="button"
                    >
                      <span className={`mailboxAvatar tone${avatarTone(row.fromName || row.fromEmail)}`}>
                        {avatarLetter(row.fromName || row.fromEmail)}
                      </span>
                      <div className="mailboxRowSender">
                        <strong>{row.fromName || row.fromEmail}</strong>
                        <small>{row.fromEmail}</small>
                      </div>
                      <div className="mailboxRowSubject">
                        <b>{row.subject}</b>
                        <span className="mailboxSnippet">{row.snippet}</span>
                      </div>
                      <time>{formatMailDate(row.receivedAt)}</time>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function avatarLetter(value: string) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "?";
  const first = trimmed.charAt(0);
  return /[A-Za-z0-9]/.test(first) ? first.toUpperCase() : first;
}

function avatarTone(value: string) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return 1;
  let hash = 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    hash = (hash * 31 + trimmed.charCodeAt(i)) >>> 0;
  }
  return (hash % 6) + 1;
}

function formatMailDate(value: string) {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value.slice(0, 16);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
    }
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  } catch {
    return value.slice(0, 16);
  }
}

function formatMailDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function getOAuthReturnStatus() {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("gmail") === "connected") {
    return "Gmail 授权成功，可以用于发送邮件。";
  }
  if (params.get("gmail") !== "error") {
    return null;
  }

  if (params.get("reason") === "expired") {
    return "Gmail 授权链接已过期，请重新点击右上角按钮发起授权。";
  }
  if (params.get("reason") === "invalid_state") {
    return "Gmail 授权状态无效，请重新点击右上角按钮发起授权。";
  }

  return "Gmail 授权失败，请重新点击右上角按钮发起授权。";
}
