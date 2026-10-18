"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption, EChartsType } from "echarts/core";
import { Building2, Mail, MessageSquare, RefreshCw, Search, Star, Users } from "lucide-react";
import { AppShell } from "../app-shell";

echarts.use([GridComponent, TooltipComponent, LineChart, CanvasRenderer]);

type DashboardRange = "all" | "month" | "week" | "day";

type DashboardAnalytics = {
  range: DashboardRange;
  overview: {
    emailTasks: number;
    emailMessages: number;
    replyMessages: number;
    openMessages: number;
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
    replyMessages: 0,
    openMessages: 0,
    smsTasks: 0,
    smsMessages: 0,
    favoriteCompanies: 0,
    favoritePeople: 0
  },
  reach: {
    email: { delivered: 0, total: 0, rate: 0 },
    sms: { delivered: 0, total: 0, rate: 0 }
  },
  searchPreference: [],
  searchTimes: [
    { key: "global_database", label: "全球企业库", count: 0 },
    { key: "maps", label: "地图获客", count: 0 },
    { key: "customs", label: "海关数据", count: 0 }
  ],
  series: [
    { date: "05-18", search: 0, outreach: 0, reply: 0, favorite: 0 },
    { date: "05-19", search: 0, outreach: 0, reply: 0, favorite: 0 },
    { date: "05-20", search: 0, outreach: 0, reply: 0, favorite: 0 },
    { date: "05-21", search: 0, outreach: 0, reply: 0, favorite: 0 },
    { date: "05-22", search: 0, outreach: 0, reply: 0, favorite: 0 },
    { date: "05-23", search: 0, outreach: 0, reply: 0, favorite: 0 },
    { date: "05-24", search: 0, outreach: 0, reply: 0, favorite: 0 }
  ]
};

const seriesConfig: Array<{
  key: keyof Pick<DashboardAnalytics["series"][number], "search" | "outreach" | "reply" | "favorite">;
  label: string;
  color: string;
}> = [
  { key: "search", label: "搜索次数", color: "#2f6bff" },
  { key: "outreach", label: "触达次数", color: "#13a874" },
  { key: "reply", label: "回复次数", color: "#6b4eff" },
  { key: "favorite", label: "收藏次数", color: "#ff7d00" }
];

const rangeOptions: Array<{ value: DashboardRange; label: string }> = [
  { value: "all", label: "全部" },
  { value: "month", label: "本月" },
  { value: "week", label: "本周" },
  { value: "day", label: "本日" }
];

const SOURCE_ICON: Record<string, typeof Search> = {
  global_database: Building2,
  maps: Search,
  customs: Users
};

export default function DashboardPage() {
  const [range, setRange] = useState<DashboardRange>("all");
  const [analytics, setAnalytics] = useState<DashboardAnalytics>(emptyAnalytics);
  const [status, setStatus] = useState("数据来自 CRM 统计接口");
  const [reloadSeed, setReloadSeed] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function loadAnalytics() {
      setLoading(true);
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
        setAnalytics(normalizeDashboardAnalytics(nextData));
        setStatus("数据已同步");
      } catch {
        if (!controller.signal.aborted) {
          setAnalytics(emptyAnalytics);
          setStatus("数据接口请求失败，请检查后端服务");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadAnalytics();

    return () => controller.abort();
  }, [range, reloadSeed]);

  const kpiCards = useMemo(() => {
    const emailDelivered = analytics.reach.email.delivered;
    const emailTotal = Math.max(analytics.reach.email.total, analytics.overview.emailMessages);
    const replyMessages =
      analytics.overview.replyMessages || analytics.series.reduce((sum, item) => sum + item.reply, 0);
    const searchCount = analytics.searchTimes.reduce((sum, item) => sum + item.count, 0);

    return [
      {
        key: "email",
        icon: Mail,
        tone: "blue" as const,
        label: "邮件触达",
        value: formatNumber(emailDelivered),
        helper: emailTotal > 0 ? `共 ${formatNumber(emailTotal)} 封 · 成功率 ${analytics.reach.email.rate}%` : "尚未发送"
      },
      {
        key: "reply",
        icon: MessageSquare,
        tone: "purple" as const,
        label: "客户回复",
        value: formatNumber(replyMessages),
        helper: "Gmail 同步收件箱"
      },
      {
        key: "favorite",
        icon: Star,
        tone: "orange" as const,
        label: "收藏客户",
        value: formatNumber(analytics.overview.favoriteCompanies),
        helper: analytics.overview.favoritePeople > 0 ? `含 ${analytics.overview.favoritePeople} 位联系人` : "暂无联系人"
      },
      {
        key: "search",
        icon: Search,
        tone: "green" as const,
        label: "搜索次数",
        value: formatNumber(searchCount),
        helper: analytics.searchPreference[0] ? `最常用：${analytics.searchPreference[0].keyword}` : "暂无搜索"
      }
    ];
  }, [analytics]);

  const hasSeriesData = analytics.series.some((point) =>
    seriesConfig.some((config) => point[config.key] > 0)
  );
  const hasSearchPreference = analytics.searchPreference.length > 0;
  const hasSearchTimes = analytics.searchTimes.some((item) => item.count > 0);
  const chartSeries = analytics.series;
  const searchPreferenceRows = analytics.searchPreference;
  const searchTimesRows = analytics.searchTimes;
  const searchTimesMax = Math.max(1, ...searchTimesRows.map((item) => item.count));

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
          <div className="dashboardHeadActions">
            <RangeSegment active={range} onChange={setRange} />
            <button
              className="dashboardRefresh"
              onClick={() => setReloadSeed((value) => value + 1)}
              type="button"
              disabled={loading}
            >
              <RefreshCw aria-hidden="true" size={14} />
              {loading ? "刷新中" : "刷新数据"}
            </button>
          </div>
        </header>

        <section className="dashboardKpiRow" aria-label="数据概览">
          {kpiCards.map((card) => {
            const Icon = card.icon;
            return (
              <article className={`kpiCard tone-${card.tone}`} key={card.key}>
                <span className="kpiIcon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <p className="kpiLabel">{card.label}</p>
                <strong className="kpiValue">{card.value}</strong>
                <small className="kpiHelper">{card.helper}</small>
              </article>
            );
          })}
        </section>

        <div className="dashboardGrid">
          <article className="dashboardCard dashboardChartCard">
            <header className="dashboardCardHead">
              <CardHead title="趋势" subtitle="搜索 / 触达 / 回复 / 收藏 的过去 7 天分布" />
              <div className="chartLegend">
                {seriesConfig.map((config) => (
                  <span key={config.key} style={{ ["--legend-color" as string]: config.color }}>
                    {config.label}
                  </span>
                ))}
              </div>
            </header>
            <div className="lineChart" aria-label="趋势折线图">
              {hasSeriesData ? (
                <DashboardLineChart series={chartSeries} />
              ) : (
                <EmptyDashboardState title="暂无趋势数据" description="运行搜索、同步 CRM 或发送邮件后会生成趋势。" />
              )}
            </div>
          </article>

          <aside className="dashboardSide">
            <article className="dashboardCard dashboardPreference">
              <CardHead title="搜索偏好" subtitle="出现频次最高的搜索策略" />
              <div className="preferenceList">
                {hasSearchPreference ? (
                  searchPreferenceRows.map((item) => (
                    <div className="preferenceRow" key={`${item.rank}-${item.keyword}`}>
                      <strong>{item.rank}</strong>
                      <span title={item.keyword}>{item.keyword}</span>
                      <b>{formatNumber(item.count)} 次</b>
                    </div>
                  ))
                ) : (
                  <EmptyDashboardState compact title="暂无搜索偏好" description="完成搜索任务后这里会显示高频策略。" />
                )}
              </div>
            </article>

            <article className="dashboardCard dashboardSearchTimes">
              <CardHead title="搜索来源" subtitle="不同获客渠道的累计搜索次数" />
              <div className="searchTimesList">
                {hasSearchTimes ? (
                  searchTimesRows.map((item) => {
                    const Icon = SOURCE_ICON[item.key] ?? Building2;
                    const ratio = item.count / searchTimesMax;
                    return (
                      <div className="searchTimesRow" key={item.key}>
                        <span>
                          <Icon aria-hidden="true" size={16} />
                        </span>
                        <p>{item.label}</p>
                        <div>
                          <i style={{ width: `${Math.max(ratio * 100, item.count > 0 ? 6 : 0)}%` }} />
                        </div>
                        <strong>{formatNumber(item.count)}</strong>
                      </div>
                    );
                  })
                ) : (
                  <EmptyDashboardState compact title="暂无来源数据" description="搜索执行后会按渠道汇总次数。" />
                )}
              </div>
            </article>
          </aside>
        </div>

        <div className="dashboardNotice">
          <span aria-hidden="true">i</span>
          {status}，统计口径为系统内所有任务与活动的实时汇总，可能存在延迟，请以实际数据为准。
        </div>
      </section>
    </AppShell>
  );
}

function RangeSegment({ active, onChange }: { active: DashboardRange; onChange: (range: DashboardRange) => void }) {
  return (
    <div className="rangeSegment" role="tablist" aria-label="时间范围">
      {rangeOptions.map((option) => (
        <button
          aria-selected={active === option.value}
          className={active === option.value ? "active" : ""}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="tab"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CardHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="dashboardCardTitle">
      <span />
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
    </div>
  );
}

function EmptyDashboardState({
  title,
  description,
  compact = false
}: {
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <div className={`dashboardEmpty${compact ? " compact" : ""}`}>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function normalizeDashboardAnalytics(data: DashboardAnalytics): DashboardAnalytics {
  return {
    ...emptyAnalytics,
    ...data,
    overview: {
      ...emptyAnalytics.overview,
      ...data.overview
    },
    reach: {
      email: {
        ...emptyAnalytics.reach.email,
        ...data.reach?.email
      },
      sms: {
        ...emptyAnalytics.reach.sms,
        ...data.reach?.sms
      }
    },
    searchPreference: Array.isArray(data.searchPreference) ? data.searchPreference : [],
    searchTimes: Array.isArray(data.searchTimes) ? data.searchTimes : emptyAnalytics.searchTimes,
    series: Array.isArray(data.series) && data.series.length ? data.series : emptyAnalytics.series
  };
}


function DashboardLineChart({ series }: { series: DashboardAnalytics["series"] }) {
  const chartElementRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<EChartsType | null>(null);

  const chartOption = useMemo<EChartsCoreOption>(() => {
    const maxValue = Math.max(
      1,
      ...series.flatMap((point) => seriesConfig.map((config) => point[config.key]))
    );
    const yAxisMax = Math.ceil(maxValue * 1.18);

    return {
      animationDuration: 520,
      animationEasing: "cubicOut",
      color: seriesConfig.map((config) => config.color),
      grid: {
        top: 20,
        right: 24,
        bottom: 34,
        left: 48
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: "#fff",
        borderColor: "#e6ecf6",
        borderWidth: 1,
        padding: [8, 10],
        textStyle: {
          color: "#344054",
          fontSize: 12
        },
        axisPointer: {
          type: "line",
          lineStyle: {
            color: "#d7deea",
            type: "dashed"
          }
        }
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: series.map((point) => point.date),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "#98a2b3",
          fontSize: 12,
          margin: 14
        }
      },
      yAxis: {
        type: "value",
        min: 0,
        max: yAxisMax,
        splitNumber: 4,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "#98a2b3",
          fontSize: 12,
          formatter: (value: number) => formatNumber(value)
        },
        splitLine: {
          lineStyle: {
            color: "#eef2f7",
            type: "dashed"
          }
        }
      },
      series: seriesConfig.map((config) => ({
        name: config.label,
        type: "line",
        data: series.map((point) => point[config.key]),
        smooth: true,
        connectNulls: true,
        symbol: "circle",
        symbolSize: 7,
        showSymbol: false,
        lineStyle: {
          width: config.key === "search" ? 3.2 : 2.4
        },
        areaStyle: {
          opacity: config.key === "search" ? 0.08 : 0.025
        },
        itemStyle: {
          color: config.color,
          borderColor: "#fff",
          borderWidth: 2
        },
        emphasis: {
          focus: "series",
          scale: true
        }
      }))
    };
  }, [series]);

  useEffect(() => {
    const element = chartElementRef.current;
    if (!element) return;

    const chart = echarts.init(element, undefined, { renderer: "canvas" });
    chartInstanceRef.current = chart;

    const resizeChart = () => chart.resize();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resizeChart) : null;

    resizeObserver?.observe(element);
    window.addEventListener("resize", resizeChart);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resizeChart);
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartInstanceRef.current?.setOption(chartOption, true);
  }, [chartOption]);

  return (
    <div
      ref={chartElementRef}
      className="lineChartEcharts"
      role="img"
      aria-label="趋势折线图"
    />
  );
}

function formatNumber(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  if (value >= 10000) return `${(value / 10000).toFixed(1)}w`;
  if (value >= 1000) return value.toLocaleString();
  return String(value);
}
