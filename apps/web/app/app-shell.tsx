"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  BarChart3,
  Bot,
  BriefcaseBusiness,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Inbox,
  LogOut,
  Mail,
  PackageSearch,
  Send,
  UserRoundCog,
  UsersRound
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { productName } from "@leadhunt/shared";

type AppShellProps = {
  activePath: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  frameVariant?: "paper" | "letter";
  hidePageHeader?: boolean;
  mainClassName?: string;
  pageClassName?: string;
  children: ReactNode;
};

type CurrentUser = {
  id?: string;
  email: string;
  name: string | null;
};

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  letter: string;
  badge?: string;
  featured?: boolean;
};

const navGroups: Array<{ label?: string; items: NavItem[] }> = [
  {
    items: [{ label: "AI 外贸员", href: "/", icon: Bot, letter: "A", badge: "New", featured: true }]
  },
  {
    label: "获客配置",
    items: [
      { label: "产品画像", href: "/product-profile", icon: PackageSearch, letter: "P" },
      { label: "客户画像", href: "/customer-profile", icon: UsersRound, letter: "C" }
    ]
  },
  {
    label: "转化工具",
    items: [
      { label: "模板配置", href: "/templates", icon: FileText, letter: "T" },
      { label: "邮件营销", href: "/campaigns", icon: Mail, letter: "M" },
      { label: "个人邮箱", href: "/mailbox", icon: Inbox, letter: "P" },
      { label: "邮寄明信片", href: "/brochures", icon: BriefcaseBusiness, letter: "Y" }
    ]
  },
  {
    label: "CRM 客户管理",
    items: [
      { label: "我的客户", href: "/customers", icon: UserRoundCog, letter: "P" },
      { label: "数据看板", href: "/dashboard", icon: BarChart3, letter: "D" }
    ]
  }
];

export function AppShell({
  activePath,
  eyebrow,
  title,
  subtitle,
  frameVariant = "paper",
  hidePageHeader = false,
  mainClassName,
  pageClassName,
  children
}: AppShellProps) {
  const isLetterFrame = frameVariant === "letter";
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountName = currentUser ? displayAccountName(currentUser) : "用户";
  const shellClasses = [
    "leadApp",
    isLetterFrame ? "letterFrame" : "",
    sidebarCollapsed ? "sidebarCollapsed" : ""
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/auth/me", {
      credentials: "include",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        return (await response.json()) as { user?: CurrentUser };
      })
      .then((payload) => {
        if (payload?.user) {
          setCurrentUser(payload.user);
        }
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include"
      });
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <main className={shellClasses}>
      <header className="appTopbar">
        <div className="appBrand">
          <div className="brandMark">
            {isLetterFrame ? "L" : <Send aria-hidden="true" size={34} />}
          </div>
          <div>
            <strong>
              LeadHunt <span>AI</span>
            </strong>
            <small>{isLetterFrame ? "AI 外贸员工作台" : "B2B 外贸获客工具"}</small>
          </div>
        </div>

        <div className="appTopActions">
          <div className="creditPill" aria-label="账户积分">
            <span>积分 0</span>
            <span className="creditDivider" aria-hidden="true">
              |
            </span>
            <a className="creditUpgrade" href="#upgrade">
              升级
            </a>
          </div>
          <div className="accountMenu" ref={accountMenuRef}>
            <button
              className="appAvatar"
              type="button"
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              aria-label={`当前用户：${accountName}`}
              onClick={() => setAccountMenuOpen((current) => !current)}
            >
              <AccountAvatar user={currentUser} name={accountName} />
              <div>
                <strong>{accountName}</strong>
                <small>B2B 出口业务员</small>
              </div>
              <ChevronDown aria-hidden="true" size={16} />
            </button>
            {accountMenuOpen ? (
              <div className="accountDropdown" role="menu" aria-label="账号菜单">
                <div className="accountDropdownHead">
                  <AccountAvatar user={currentUser} name={accountName} />
                  <div>
                    <strong>{accountName}</strong>
                    <small>{currentUser?.email ?? "未读取到邮箱"}</small>
                  </div>
                </div>
                <button
                  className="accountLogoutButton"
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  disabled={loggingOut}
                >
                  <LogOut aria-hidden="true" size={16} />
                  {loggingOut ? "退出中..." : "退出登录"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <aside className="appSidebar">
        <nav className="appNav" aria-label="Primary navigation">
          {navGroups.map((group, index) => (
            <div className="navSection" key={group.label ?? `top-${index}`}>
              {group.label ? <div className="navLabel">{group.label}</div> : null}
              {group.items.map((item) => {
                const Icon = item.icon;
                const classes = ["navItem"];
                if (item.featured) classes.push("featured");
                if (item.href === activePath) classes.push("active");

                return (
                  <a className={classes.join(" ")} href={item.href} key={item.href}>
                    <span className={isLetterFrame ? "navIcon letterNavIcon" : "navIcon"}>
                      {isLetterFrame ? item.letter : <Icon aria-hidden="true" size={18} />}
                    </span>
                    <span className="navText">{item.label}</span>
                    {item.badge ? <span className="badgeNew">{item.badge}</span> : null}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
        <button
          className="sidebarCollapse"
          type="button"
          aria-pressed={sidebarCollapsed}
          title={sidebarCollapsed ? "展开菜单" : "收起菜单"}
          onClick={() => setSidebarCollapsed((current) => !current)}
        >
          {sidebarCollapsed ? (
            <ChevronRight aria-hidden="true" size={16} />
          ) : (
            <ChevronLeft aria-hidden="true" size={16} />
          )}
          <span>{sidebarCollapsed ? "展开" : "收起菜单"}</span>
        </button>
      </aside>

      <section className={mainClassName ? `appMain ${mainClassName}` : "appMain"}>
        <div className={pageClassName ? `page ${pageClassName}` : "page"}>
          {hidePageHeader ? null : (
            <header className="pageHead">
              <div>
                <p className="eyebrow">{eyebrow}</p>
                <h1>{title || productName}</h1>
                {subtitle ? <p>{subtitle}</p> : null}
              </div>
            </header>
          )}
          {children}
        </div>
      </section>
    </main>
  );
}

function AccountAvatar({ user, name }: { user: CurrentUser | null; name: string }) {
  const palette = getAvatarPalette(user, name);
  const initial = getAccountInitial(name);
  const style = {
    "--avatar-from": palette.from,
    "--avatar-to": palette.to,
    "--avatar-glow": palette.glow
  } as CSSProperties;

  return (
    <span className="avatarImg" style={style} aria-hidden="true">
      <span className="avatarLetter">{initial}</span>
    </span>
  );
}

function displayAccountName(user: CurrentUser) {
  const name = user.name?.trim();
  if (name) {
    return name;
  }

  return user.email.split("@")[0] || "用户";
}

function getAccountInitial(name: string) {
  return [...name.trim()][0]?.toUpperCase() ?? "用";
}

const defaultAvatarPalette = {
  from: "#3b5bdb",
  to: "#6366f1",
  glow: "rgba(99, 102, 241, 0.32)"
};

const avatarPalettes = [
  defaultAvatarPalette,
  { from: "#2563eb", to: "#0ea5e9", glow: "rgba(37, 99, 235, 0.32)" },
  { from: "#4f46e5", to: "#7c3aed", glow: "rgba(124, 58, 237, 0.32)" },
  { from: "#0891b2", to: "#0369a1", glow: "rgba(8, 145, 178, 0.30)" },
  { from: "#1e3a8a", to: "#3b82f6", glow: "rgba(59, 130, 246, 0.32)" },
  { from: "#6366f1", to: "#a855f7", glow: "rgba(168, 85, 247, 0.30)" }
];

function getAvatarPalette(user: CurrentUser | null, displayName: string) {
  const seed = `${user?.id ?? ""}|${user?.email ?? ""}|${displayName}`;
  const hash = hashString(seed || "LeadHunt");
  return avatarPalettes[hash % avatarPalettes.length] ?? defaultAvatarPalette;
}

function hashString(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash;
}
