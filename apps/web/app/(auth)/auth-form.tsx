"use client";

import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  ContactRound,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Search,
  Send,
  ServerCog,
  ShieldCheck,
  UserRound
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

type AuthMode = "login" | "register" | "forgot";

type AuthFormProps = {
  mode: AuthMode;
};

const copy = {
  login: {
    head: "欢迎回来",
    lead: "登录您的 LeadHunt AI 账户",
    button: "登录",
    endpoint: "/api/auth/login",
    switchText: "还没有账号？",
    switchHref: "/register",
    switchLabel: "立即注册",
    divider: "或使用其他方式登录",
    google: "Google 登录"
  },
  register: {
    head: "创建您的账户",
    lead: "加入 LeadHunt AI，开启智能外贸获客之旅",
    button: "注册",
    endpoint: "/api/auth/register",
    switchText: "已有账号？",
    switchHref: "/login",
    switchLabel: "立即登录",
    divider: "或使用其他方式注册",
    google: "Google 注册"
  },
  forgot: {
    head: "忘记密码？",
    lead: "输入您的注册邮箱，我们将发送重置密码的链接到您的邮箱",
    button: "发送重置链接",
    endpoint: "/api/auth/forgot-password",
    switchText: "想起密码了？",
    switchHref: "/login",
    switchLabel: "立即登录",
    divider: "",
    google: ""
  }
};

export function AuthForm({ mode }: AuthFormProps) {
  const content = copy[mode];
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    const googleStatus = readGoogleAuthStatus();
    if (googleStatus) {
      setStatus(googleStatus);
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setStatus("处理中...");
    setSubmitting(true);
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData);

    if (mode === "register" && payload.password !== payload.confirmPassword) {
      setStatus("两次输入的密码不一致。");
      setSubmitting(false);
      return;
    }

    delete payload.confirmPassword;

    try {
      const response = await fetch(content.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        setStatus("请求失败，请检查输入后重试。");
        return;
      }

      setStatus(mode === "forgot" ? "重置请求已记录。" : "成功，正在进入系统。");
      if (mode !== "forgot") {
        window.location.assign(getSafeNextPath());
      }
    } catch {
      setStatus("网络异常，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={`authShell authShell-${mode}`}>
      <section className="authFrame">
        <aside className="authBrandSide">
          <div className="authBrand">
            <div className="authBrandMark">L</div>
            <div>
              <strong>
                LeadHunt <span>AI</span>
              </strong>
              <span>B2B 外贸获客工具</span>
            </div>
          </div>

          <div className="authHeroCopy">
            <h2>
              AI 驱动的外贸<span>获客与营销</span>平台
            </h2>
            <p>通过 AI 搜索、客户触达、邮件营销和 CRM 管理，帮助您高效获取海外客户，提升转化率。</p>
          </div>

          <div className="authFeatureList">
            <Feature
              icon={<Search />}
              title="精准获客"
              text="AI 高级搜索，快速找到高意向海外客户"
            />
            <Feature icon={<Send />} title="智能触达" text="个性化邮件触达，提高打开率与回复率" />
            <Feature icon={<ContactRound />} title="客户管理" text="CRM 全流程管理，跟进更高效" />
            <Feature
              icon={<BarChart3 />}
              title="数据驱动"
              text="多维度数据看板，优化您的营销策略"
            />
          </div>

          <div className="trustStrip">
            <div className="trustItem">
              <ShieldCheck /> 数据安全保障
            </div>
            <div className="trustItem">
              <ServerCog /> 全球服务器部署
            </div>
            <div className="trustItem">
              <BadgeCheck /> 符合 GDPR 要求
            </div>
          </div>

          <div className="authGlobe" aria-hidden="true">
            <img alt="" src="/images/login.png" />
          </div>
        </aside>

        <aside className="authSide">
          <section className={`authCard authCard-${mode}`}>
            {mode === "forgot" ? (
              <Link className="authBackLink" href="/login">
                <ArrowLeft /> 返回登录
              </Link>
            ) : (
              <div className="authSwitchTop">
                {content.switchText} <Link href={content.switchHref}>{content.switchLabel}</Link>
              </div>
            )}

            <div className={mode === "forgot" ? "authHead compact" : "authHead"}>
              {mode === "forgot" ? (
                <div className="lockHero">
                  <LockKeyhole />
                </div>
              ) : null}
              <h1>{content.head}</h1>
              <p>{content.lead}</p>
            </div>

            <form className={`authForm authForm-${mode}`} onSubmit={handleSubmit}>
              {mode === "register" ? (
                <label className="authField">
                  <span>姓名</span>
                  <div className="authInputShell">
                    <span className="authInputIcon">
                      <UserRound />
                    </span>
                    <input autoComplete="name" name="name" placeholder="请输入您的姓名" />
                    <span />
                  </div>
                </label>
              ) : null}

              <label className="authField">
                <span>邮箱地址</span>
                <div className="authInputShell">
                  <span className="authInputIcon">
                    <Mail />
                  </span>
                  <input
                    autoComplete="email"
                    name="email"
                    placeholder="请输入您的邮箱地址"
                    required
                    type="email"
                  />
                  <span />
                </div>
              </label>

              {mode !== "forgot" ? (
                <label className="authField">
                  <span>{mode === "register" ? "设置密码" : "密码"}</span>
                  <div className="authInputShell">
                    <span className="authInputIcon">
                      <LockKeyhole />
                    </span>
                    <input
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      minLength={mode === "register" ? 8 : 1}
                      name="password"
                      placeholder={mode === "register" ? "请设置 8 位以上密码" : "请输入密码"}
                      required
                      type={showPassword ? "text" : "password"}
                    />
                    <button
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      aria-pressed={showPassword}
                      className="authInputAction"
                      onClick={() => setShowPassword((visible) => !visible)}
                      title={showPassword ? "隐藏密码" : "显示密码"}
                      type="button"
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </button>
                  </div>
                </label>
              ) : null}

              {mode === "register" ? (
                <label className="authField">
                  <span>确认密码</span>
                  <div className="authInputShell">
                    <span className="authInputIcon">
                      <LockKeyhole />
                    </span>
                    <input
                      autoComplete="new-password"
                      minLength={8}
                      name="confirmPassword"
                      placeholder="请再次输入密码"
                      required
                      type={showConfirmPassword ? "text" : "password"}
                    />
                    <button
                      aria-label={showConfirmPassword ? "隐藏确认密码" : "显示确认密码"}
                      aria-pressed={showConfirmPassword}
                      className="authInputAction"
                      onClick={() => setShowConfirmPassword((visible) => !visible)}
                      title={showConfirmPassword ? "隐藏确认密码" : "显示确认密码"}
                      type="button"
                    >
                      {showConfirmPassword ? <EyeOff /> : <Eye />}
                    </button>
                  </div>
                </label>
              ) : null}

              {mode === "login" ? (
                <div className="authFormRow">
                  <label className="authCheckbox">
                    <input defaultChecked type="checkbox" />
                    记住我
                  </label>
                  <Link href="/forgot-password">忘记密码？</Link>
                </div>
              ) : null}

              {mode === "register" ? (
                <label className="authAgreement">
                  <input defaultChecked type="checkbox" />
                  <span>
                    我已阅读并同意 <a>服务条款</a> 和 <a>隐私政策</a>
                  </span>
                </label>
              ) : null}

              <button className="authButton" disabled={submitting} type="submit">
                {submitting ? "处理中..." : content.button}
              </button>

              <p className="authStatus" aria-live="polite">
                {status}
              </p>
            </form>

            {mode !== "forgot" ? (
              <>
                <div className="authDivider">{content.divider}</div>
                <a className="authSocialButton" href="/api/auth/google">
                  <span className="socialMark google">G</span>
                  {content.google}
                </a>
              </>
            ) : (
              <p className="forgotNote">如果您没有收到邮件，请检查垃圾邮件箱，或稍后重试。</p>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="authFeature">
      <div className="authFeatureIcon">{icon}</div>
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </div>
  );
}

function getSafeNextPath() {
  const next = new URLSearchParams(window.location.search).get("next");

  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/";
  }

  return next;
}

function readGoogleAuthStatus() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("google") !== "error") {
    return "";
  }

  const reason = params.get("reason");
  if (reason === "network") {
    return "Google 登录失败：后端无法连接 Google 服务，请检查代理后重试。";
  }
  if (reason === "config" || reason === "redirect_uri") {
    return "Google 登录配置异常，请检查 OAuth 客户端和回调地址。";
  }
  if (reason === "state") {
    return "Google 登录状态已过期，请重新点击 Google 登录。";
  }
  if (reason === "profile") {
    return "Google 账号资料读取失败，请换一个账号或稍后重试。";
  }

  return "Google 登录失败，请稍后重试。";
}
