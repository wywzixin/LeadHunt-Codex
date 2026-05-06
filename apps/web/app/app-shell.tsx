"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Bell,
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
    items: [
      { label: "AI 外贸员", href: "/", icon: Bot, letter: "A", badge: "New", featured: true }
    ]
  },
  {
    label: "线索中心",
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
  const accountInitial = getAccountInitial(accountName);
  const shellClasses = [
    "leadApp",
    isLetterFrame ? "letterFrame" : "",
    sidebarCollapsed ? "sidebarCollapsed" : ""
  ].filter(Boolean).join(" ");

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
            <small>{isLetterFrame ? "AI 外贸员工作台" : "通信设备外贸工具"}</small>
          </div>
        </div>

        <div className="appTopActions">
          <div className="topAction">
            <span className="topIcon hasDot">
              <Bell aria-hidden="true" size={18} />
            </span>
            <span>消息</span>
          </div>
          <button className="toolboxButton" type="button">
            <BriefcaseBusiness aria-hidden="true" size={18} />
            工具箱
          </button>
          <div className="creditPill" aria-label="账户积分">
            <span>积分 0</span>
            <span className="creditDivider" aria-hidden="true">|</span>
            <a className="creditUpgrade" href="#upgrade">升级</a>
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
              <div className="avatarImg">{accountInitial}</div>
              <div>
                <strong>{accountName}</strong>
                <small>通信设备出口商</small>
              </div>
              <ChevronDown aria-hidden="true" size={16} />
            </button>
            {accountMenuOpen ? (
              <div className="accountDropdown" role="menu" aria-label="账号菜单">
                <div className="accountDropdownHead">
                  <span className="avatarImg">{accountInitial}</span>
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
                  <a
                    className={classes.join(" ")}
                    href={item.href}
                    key={item.href}
                  >
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
          {sidebarCollapsed ? <ChevronRight aria-hidden="true" size={16} /> : <ChevronLeft aria-hidden="true" size={16} />}
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
