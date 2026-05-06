"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Mail, MessageSquare, RefreshCw, Search, User, Users } from "lucide-react";
import { AppShell } from "../app-shell";

type DashboardRange = "all" | "month" | "week" | "day";
type LucideIcon = typeof Mail;

type DashboardAnalytics = {
  range: DashboardRange;
  overview: {
    emailTasks: number;
    emailMessages: number;
    smsTasks: number;
    smsMessages: number;
    favoriteCompanies: number;
    favoritePeople: number;
  };
  reach: {
    email: {
      delivered: number;
      total: number;
      rate: number;
    };
    sms: {
      delivered: number;
      total: number;
      rate: number;
    };
  };
  searchPreference: Array<{
    rank: number;
    keyword: string;
    count: number;
  }>;
  searchTimes: Array<{
    key: string;
    label: string;
    count: number;
  }>;
  series: Array<{
    date: string;
    search: number;
    outreach: number;
    reply: number;
    favorite: number;
  }>;
};

const emptyAnalytics: DashboardAnalytics = {
  range: "all",
  overview: {
    emailTasks: 0,
    emailMessages: 0,
    smsTasks: 0,
    smsMessages: 0,
    favoriteCompanies: 0,
    favoritePeople: 0
  },
  reach: {
    email: {
      delivered: 0,
      total: 0,
      rate: 0
    },
    sms: {
      delivered: 0,
      total: 0,
      rate: 0
    }
  },
  searchPreference: [{ rank: 1, keyword: "通信5G", count: 1 }],
  searchTimes: [
    { key: "global_database", label: "全球企业库", count: 0 },
    { key: "maps", label: "地图获客", count: 0 },
    { key: "customs", label: "海关数据", count: 0 }
  ],
  series: ["04-18", "04-19", "04-20", "04-21", "04-22", "04-23", "04-24"].map((date) => ({
    date,
    search: 0,
    outreach: 0,
    reply: 0,
    favorite: 0
  }))
};

export default function DashboardPage() {
  const [range, setRange] = useState<DashboardRange>("all");
  const [analytics, setAnalytics] = useState<DashboardAnalytics>(emptyAnalytics);
  const [status, setStatus] = useState("数据每日更新");
  const [reloadSeed, setReloadSeed] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadAnalytics() {
      setStatus("正在刷新数据");

      try {
        const response = await fetch(`/api/crm/analytics?range=${range}`, {
          credentials: "include",
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Analytics request failed with HTTP ${response.status}`);
        }

        const nextData = (await response.json()) as DashboardAnalytics;
        setAnalytics(nextData);
        setStatus("数据每日更新");
      } catch {
        if (!controller.signal.aborted) {
          setAnalytics(emptyAnalytics);
          setStatus("数据每日更新");
        }
      }
    }

    void loadAnalytics();

    return () => controller.abort();
  }, [range, reloadSeed]);

  const overviewMetrics = useMemo(
    () => [
      {
        icon: Mail,
        value: `${analytics.overview.emailTasks}/${analytics.overview.emailMessages}`,
        label: "邮件联系",
        note: "任务数/邮件数"
      },
      {
        icon: Building2,
        value: `${analytics.overview.favoriteCompanies}`,
        label: "收藏企业",
        note: "—"
      },
      {
        icon: MessageSquare,
        value: `${analytics.overview.smsTasks}/${analytics.overview.smsMessages}`,
        label: "短信联系",
        note: "任务数/短信数"
      },
      {
        icon: User,
        value: `${analytics.overview.favoritePeople}`,
        label: "收藏个人",
        note: "—"
      }
    ],
    [analytics]
  );

  const searchRows = useMemo(
    () =>
      analytics.searchTimes.map((item) => ({
        ...item,
        icon: item.key === "maps" ? Search : item.key === "customs" ? Users : Building2
      })),
    [analytics.searchTimes]
  );

  const chartMax = Math.max(
    2,
    ...analytics.series.flatMap((point) => [point.search, point.outreach, point.reply, point.favorite])
  );
  const chartYAxis = [0, Math.ceil(chartMax / 2), chartMax];

  return (
    <AppShell
      activePath="/dashboard"
      eyebrow="数据看板"
      hidePageHeader
      mainClassName="dashboardMain"
      pageClassName="dashboardPage"
      title="数据看板"
    >
      <section className="dashboardShell">
        <header className="dashboardHeader">
          <div>
            <h1>数据看板</h1>
            <p>查看搜索、触达、收集和客户沉淀的整体数据。</p>
          </div>
          <button className="dashboardSwitch" type="button">
            切换到个人数据
          </button>
        </header>

        <div className="dashboardGrid">
          <div className="dashboardLeft">
            <article className="dashboardCard dashboardOverview">
              <CardHead title="数据概况" />
              <TimeTabs active={range} onChange={setRange} />
              <div className="overviewMetrics">
                {overviewMetrics.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div className="overviewMetric" key={item.label}>
                      <span>
                        <Icon aria-hidden="true" size={24} />
                      </span>
                      <strong>{item.value}</strong>
                      <p>{item.label}</p>
                      <small>{item.note}</small>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="dashboardCard dashboardReach">
              <CardHead title="到达率" />
              <div className="reachMeters">
                <Gauge
                  icon={Mail}
                  label="邮件达到率"
                  value={`${analytics.reach.email.rate}%`}
                  detail={`${analytics.reach.email.delivered}/${analytics.reach.email.total}`}
                />
                <Gauge
                  icon={MessageSquare}
                  label="短信达到率"
                  value={`${analytics.reach.sms.rate}%`}
                  detail={`${analytics.reach.sms.delivered}/${analytics.reach.sms.total}`}
                />
              </div>
            </article>

            <article className="dashboardCard dashboardChartCard">
              <div className="chartHead">
                <CardHead title="我的数据" />
                <button className="chartSelect" type="button">
                  查询次数
                  <span>⌄</span>
                </button>
              </div>
              <div className="chartLegend">
                <span className="blue">搜索次数</span>
                <span className="green">触达次数</span>
                <span className="purple">回复次数</span>
                <span className="orange">收藏次数</span>
              </div>
              <div className="lineChart" aria-label="我的数据折线图">
                <div className="chartGridLines" />
                {analytics.series.map((point, index) => (
                  <span className="chartTick" key={point.date} style={{ left: `${7 + index * 14.3}%` }}>
                    {point.date}
                  </span>
                ))}
                {chartYAxis.map((value, index) => (
                  <span className="chartYAxis" key={value} style={{ bottom: `${16 + index * 32}%` }}>
                    {value}
                  </span>
                ))}
                <div className="chartZeroLine" />
                {analytics.series.map((point, index) => (
                  <span
                    className="chartDot"
                    key={`${point.date}-${point.search}`}
                    style={{
                      left: `${7 + index * 14.3}%`,
                      bottom: `calc(25px + ${(point.search / chartMax) * 62}%)`
                    }}
                  />
                ))}
              </div>
            </article>

            <div className="dashboardNotice">
              <span aria-hidden="true">i</span>
              {status}，统计口径为系统内所有任务与活动的实时汇总，可能存在延迟，请以实际数据为准。
              <button type="button" onClick={() => setReloadSeed((value) => value + 1)}>
                <RefreshCw aria-hidden="true" size={14} />
                刷新数据
              </button>
            </div>
          </div>

          <aside className="dashboardRight">
            <article className="dashboardCard dashboardPreference">
              <CardHead title="搜索偏好" />
              <TimeTabs active={range} compact onChange={setRange} />
              <div className="preferenceList">
                {analytics.searchPreference.map((item) => (
                  <div className="preferenceRow" key={`${item.rank}-${item.keyword}`}>
                    <strong>{item.rank}</strong>
                    <span>{item.keyword}</span>
                    <b>{item.count}次</b>
                  </div>
                ))}
              </div>
            </article>

            <article className="dashboardCard dashboardSearchTimes">
              <CardHead title="搜索次数" />
              <TimeTabs active={range} compact onChange={setRange} />
              <div className="searchTimesList">
                {searchRows.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div className="searchTimesRow" key={item.key}>
                      <span>
                        <Icon aria-hidden="true" size={18} />
                      </span>
                      <p>{item.label}</p>
                      <div>
                        <i style={{ width: `${Math.min(100, item.count * 18)}%` }} />
                      </div>
                      <strong>{item.count}</strong>
                    </div>
                  );
                })}
              </div>
            </article>
          </aside>
        </div>
      </section>
    </AppShell>
  );
}

function CardHead({ title }: { title: string }) {
  return (
    <div className="dashboardCardTitle">
      <span />
      <h2>{title}</h2>
    </div>
  );
}

function TimeTabs({
  active,
  compact = false,
  onChange
}: {
  active: DashboardRange;
  compact?: boolean;
  onChange: (range: DashboardRange) => void;
}) {
  const items: Array<{ label: string; value: DashboardRange }> = compact
    ? [
        { label: "今天", value: "day" },
        { label: "近7天", value: "week" },
        { label: "全部", value: "all" }
      ]
    : [
        { label: "全部", value: "all" },
        { label: "本月", value: "month" },
        { label: "本周", value: "week" },
        { label: "本日", value: "day" }
      ];

  return (
    <div className={compact ? "timeTabs compact" : "timeTabs"}>
      {items.map((item) => (
        <button className={active === item.value ? "active" : ""} key={item.value} type="button" onClick={() => onChange(item.value)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Gauge({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string; detail: string }) {
  return (
    <div className="gaugeBlock">
      <div className="gaugeArc">
        <div>
          <Icon aria-hidden="true" size={18} />
          <strong>{value}</strong>
          <span>{detail}</span>
        </div>
      </div>
      <p>
        {label}：<strong>{value}</strong>
      </p>
    </div>
  );
}
