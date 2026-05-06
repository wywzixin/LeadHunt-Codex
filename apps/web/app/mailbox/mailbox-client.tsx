"use client";

import {
  Archive,
  ArrowLeft,
  ChevronDown,
  Clock3,
  Edit3,
  Inbox,
  Info,
  Mail,
  MoreVertical,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Tag,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
    title: "收件箱",
    items: [
      { icon: Inbox, label: "全部收件", folder: "inbox" },
      { icon: Clock3, label: "待处理邮件" },
      { icon: Mail, label: "未读邮件" },
      { icon: Archive, label: "草稿箱" }
    ]
  },
  {
    title: "发件箱",
    items: [{ icon: Send, label: "全部发件", folder: "sent" }]
  },
  {
    title: "文件夹",
    items: [
      { icon: Tag, label: "标签邮件" },
      { icon: Trash2, label: "已删除邮件" },
      { icon: ShieldCheck, label: "垃圾邮件" }
    ]
  }
];

export function MailboxClient() {
  const [status, setStatus] = useState("正在检查 Gmail 授权状态...");
  const [data, setData] = useState<GmailAccountResponse>(emptyGmailData);
  const [folder, setFolder] = useState<MailboxFolder>("inbox");
  const [messages, setMessages] = useState<MailboxMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [activeMessage, setActiveMessage] = useState<MailboxMessageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const connectedEmail = data.account?.email ?? "未授权";
  const connectedAt = useMemo(() => {
    if (!data.account?.connectedAt) return "未连接";
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(data.account.connectedAt));
  }, [data.account?.connectedAt]);

  async function loadAccount() {
    const returnStatus = getOAuthReturnStatus();
    setStatus(returnStatus ?? "正在检查 Gmail 授权状态...");
    try {
      const response = await fetch("/api/gmail/account", { credentials: "include" });
      if (!response.ok) {
        setData(emptyGmailData);
        setStatus(returnStatus ?? "尚未授权 Gmail，请先点击下方按钮完成 Google OAuth。");
        return;
      }

      const payload = (await response.json()) as GmailAccountResponse;
      setData(payload);
      if (payload.connected) {
        setStatus(returnStatus ?? "Gmail 已授权，正在同步真实邮件...");
        void loadMessages(folder, keyword);
        return;
      }

      setStatus(returnStatus ?? "尚未授权 Gmail，请先点击下方按钮完成 Google OAuth。");
    } catch {
      setData(emptyGmailData);
      setStatus(returnStatus ?? "无法读取 Gmail 授权状态，请稍后重试。");
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
      setStatus(`已同步 ${payload.messages.length} 封 ${nextFolder === "inbox" ? "收件箱" : "发件箱"}邮件`);
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
      <aside className="mailboxFolderPane">
        <button className="mailboxCompose" type="button">
          <Edit3 aria-hidden="true" size={18} />
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
                  className={active ? "active" : ""}
                  key={item.label}
                  type="button"
                  onClick={() => item.folder && changeFolder(item.folder)}
                  disabled={!item.folder}
                >
                  <Icon aria-hidden="true" size={17} />
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      <div className="mailboxContent">
        {activeMessage ? (
          <section className="mailboxListPanel mailboxDetailMode">
            <header className="mailboxToolbar">
              <button type="button" className="mailboxBackBtn" onClick={closeDetail}>
                <ArrowLeft aria-hidden="true" size={17} />
                返回邮件列表
              </button>
              <button type="button" onClick={() => activeMessage && selectMessage(activeMessage.id)}>
                <RefreshCw aria-hidden="true" size={17} />
              </button>
              <button type="button">
                <MoreVertical aria-hidden="true" size={17} />
              </button>
              <span className="mailboxToolbarSpacer" />
              <button className="mailboxSettings" type="button">
                <Settings aria-hidden="true" size={18} />
              </button>
            </header>
            <article className="mailboxDetailArticle">
              <h3>{activeMessage.subject}</h3>
              <div className="mailboxDetailMeta">
                <span className="mailboxDetailAvatar">
                  {(activeMessage.fromName || activeMessage.fromEmail || "?").trim().slice(0, 1).toUpperCase()}
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
                    title="邮件正文"
                    srcDoc={`<base target="_blank">${activeMessage.bodyHtml}`}
                  />
                ) : (
                  <pre className="mailboxDetailText">{activeMessage.body || activeMessage.snippet}</pre>
                )}
              </div>
            </article>
          </section>
        ) : (
          <section className="mailboxListPanel">
            <header className="mailboxToolbar">
              <label>
                <input type="checkbox" />
              </label>
              <button type="button" onClick={() => loadMessages(folder, keyword)} disabled={!data.connected || loadingMessages}>
                <RefreshCw aria-hidden="true" size={17} />
              </button>
              <button type="button">
                <MoreVertical aria-hidden="true" size={17} />
              </button>
              <button className="mailboxFilter" type="button">
                全部 <ChevronDown aria-hidden="true" size={14} />
              </button>
              <form className="mailboxSearch" onSubmit={submitSearch}>
                <Search aria-hidden="true" size={17} />
                <input
                  placeholder="搜索 Gmail 邮件 (例如 from:google has:attachment)"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
              </form>
              <button className="mailboxSettings" type="button">
                <Settings aria-hidden="true" size={18} />
              </button>
            </header>
            <div className="mailboxSyncBanner">
              <Info aria-hidden="true" size={16} />
              {loadingDetail ? "正在加载邮件正文..." : status}
            </div>
            <div className="mailboxRows">
              {loadingMessages && messages.length === 0 ? (
                <div className="mailboxEmptyHint">正在从 Gmail 加载邮件...</div>
              ) : messages.length === 0 ? (
                <div className="mailboxEmptyHint">
                  {data.connected
                    ? "当前文件夹没有邮件，可以换关键字或刷新。"
                    : "尚未授权 Gmail，授权后会显示真实邮件列表。"}
                </div>
              ) : (
                messages.map((row) => (
                  <button
                    type="button"
                    className={`mailboxRow ${row.unread ? "unread" : ""} ${row.id === selectedMessageId ? "active" : ""}`}
                    key={row.id}
                    onClick={() => selectMessage(row.id)}
                  >
                    <span className="mailboxRowAvatar">
                      {(row.fromName || row.fromEmail || "?").trim().slice(0, 1).toUpperCase()}
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
          </section>
        )}

        <section className="gmailAuthorizationPanel">
          <h2>发件邮箱授权示意</h2>
          <div className="gmailAuthTable">
            <div>
              <strong>授权方式</strong>
              <p>
                <span>G</span>
                Google OAuth 登录并授权 Gmail
              </p>
            </div>
            <div>
              <strong>当前发件邮箱</strong>
              <p>
                {connectedEmail}
                <b>{data.connected ? "已授权" : "未授权"}</b>
              </p>
            </div>
          </div>
          <div className="gmailAuthNotice">
            <Info aria-hidden="true" size={17} />
            授权后，本页通过 Gmail API（labels=INBOX/SENT）拉取真实邮件列表与正文，不保存邮箱密码。退出授权后立即停止读取。
          </div>
          <div className="gmailAuthActions">
            <button className="primary" type="button" onClick={connectGmail}>
              <span>G</span>
              使用 Google 授权 Gmail
            </button>
            <button type="button" onClick={revokeGmail}>
              解除授权
            </button>
            <small>{connectedAt}</small>
          </div>
        </section>
      </div>
    </section>
  );

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
    return "Gmail 授权链接已过期，请重新点击下方按钮发起授权。";
  }
  if (params.get("reason") === "invalid_state") {
    return "Gmail 授权状态无效，请重新点击下方按钮发起授权。";
  }

  return "Gmail 授权失败，请重新点击下方按钮发起授权。";
}
