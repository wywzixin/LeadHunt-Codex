"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Filter,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  Star,
  Users
} from "lucide-react";
import { AppShell } from "../app-shell";

type CrmView = "companies" | "contacts" | "favorites";
type CrmGroup = "all" | "potential" | "contacted_7_days" | "uncontacted";

type Company = {
  id: string;
  leadId: string;
  companyName: string;
  website: string | null;
  sourceUrl: string | null;
  country: string;
  industry: string;
  stage: string;
  stageLabel: string;
  owner: string;
  recentFollowup: string;
  recentAction?: string;
  lastContactedAt: string | null;
  tags: string[];
  contacts: Array<{
    id: string;
    type: string;
    value: string;
    sourceUrl: string | null;
  }>;
  icpScore: {
    score: number;
    grade: string;
  } | null;
};

type Contact = {
  id: string;
  companyId: string;
  companyName: string;
  country: string;
  type: string;
  value: string;
  sourceUrl: string | null;
  stage: string;
  stageLabel: string;
  owner: string;
  recentFollowup: string;
  recentAction?: string;
};

type CrmResponse = {
  view: CrmView;
  group: CrmGroup;
  stats: {
    companies: number;
    contacts: number;
    favorites: number;
    contacted7: number;
    uncontacted: number;
  };
  groups: {
    all: number;
    potential: number;
    contacted7: number;
    uncontacted: number;
  };
  companies: Company[];
  contacts: Contact[];
};

const defaultData: CrmResponse = {
  view: "companies",
  group: "all",
  stats: {
    companies: 0,
    contacts: 0,
    favorites: 0,
    contacted7: 0,
    uncontacted: 0
  },
  groups: {
    all: 0,
    potential: 0,
    contacted7: 0,
    uncontacted: 0
  },
  companies: [],
  contacts: []
};

const sampleCompanies: Company[] = [
  {
    id: "sample-emirates-tower-power",
    leadId: "sample-lead-1",
    companyName: "Emirates Tower Power",
    website: "emiratestowerpower.ae",
    sourceUrl: "https://emiratestowerpower.ae",
    country: "阿联酋",
    industry: "通信设备制造",
    stage: "contacted",
    stageLabel: "跟进中",
    owner: "老梁",
    recentFollowup: "2026-04-27",
    recentAction: "发送邮件",
    lastContactedAt: "2026-04-27T08:00:00.000Z",
    tags: ["通信设备", "电源运维"],
    contacts: [
      { id: "sample-contact-1", type: "email", value: "sales@emiratestowerpower.ae", sourceUrl: "https://emiratestowerpower.ae" }
    ],
    icpScore: { score: 88, grade: "high" }
  },
  {
    id: "sample-gulf-telecom",
    leadId: "sample-lead-2",
    companyName: "Gulf Telecom Supplies FZE",
    website: "gulftelecom.ae",
    sourceUrl: "https://gulftelecom.ae",
    country: "阿联酋",
    industry: "通信设备分销",
    stage: "potential",
    stageLabel: "潜在客户",
    owner: "老梁",
    recentFollowup: "2026-04-26",
    recentAction: "打开邮件",
    lastContactedAt: "2026-04-26T08:00:00.000Z",
    tags: ["现货商", "多品牌备件"],
    contacts: [{ id: "sample-contact-2", type: "email", value: "procurement@gulftelecom.ae", sourceUrl: "https://gulftelecom.ae" }],
    icpScore: { score: 86, grade: "high" }
  },
  {
    id: "sample-riyadh-radio",
    leadId: "sample-lead-3",
    companyName: "Riyadh Radio Parts",
    website: "riyadhradio.sa",
    sourceUrl: "https://riyadhradio.sa",
    country: "沙特阿拉伯",
    industry: "无线通信设备",
    stage: "contacted",
    stageLabel: "跟进中",
    owner: "老梁",
    recentFollowup: "2026-04-25",
    recentAction: "回复邮件",
    lastContactedAt: "2026-04-25T08:00:00.000Z",
    tags: ["无线", "备件"],
    contacts: [{ id: "sample-contact-3", type: "email", value: "sales@riyadhradio.sa", sourceUrl: "https://riyadhradio.sa" }],
    icpScore: { score: 82, grade: "high" }
  },
  {
    id: "sample-metro-network",
    leadId: "sample-lead-4",
    companyName: "Metro Network Systems",
    website: "metronetwork.ae",
    sourceUrl: "https://metronetwork.ae",
    country: "阿联酋",
    industry: "网络设备集成",
    stage: "new",
    stageLabel: "新客户",
    owner: "老梁",
    recentFollowup: "2026-04-24",
    recentAction: "首次联系",
    lastContactedAt: null,
    tags: ["系统集成商"],
    contacts: [{ id: "sample-contact-4", type: "email", value: "info@metronetwork.ae", sourceUrl: "https://metronetwork.ae" }],
    icpScore: { score: 79, grade: "medium" }
  },
  {
    id: "sample-saudi-system",
    leadId: "sample-lead-5",
    companyName: "Saudi System Integrator",
    website: "saudisystem.sa",
    sourceUrl: "https://saudisystem.sa",
    country: "沙特阿拉伯",
    industry: "系统集成商",
    stage: "potential",
    stageLabel: "潜在客户",
    owner: "老梁",
    recentFollowup: "2026-04-23",
    recentAction: "发送邮件",
    lastContactedAt: "2026-04-23T08:00:00.000Z",
    tags: ["项目供货"],
    contacts: [{ id: "sample-contact-5", type: "email", value: "contact@saudisystem.sa", sourceUrl: "https://saudisystem.sa" }],
    icpScore: { score: 81, grade: "high" }
  },
  {
    id: "sample-oman-communication",
    leadId: "sample-lead-6",
    companyName: "Oman Communication Co.",
    website: "omancom.om",
    sourceUrl: "https://omancom.om",
    country: "阿曼",
    industry: "通信运营商",
    stage: "contacted",
    stageLabel: "跟进中",
    owner: "老梁",
    recentFollowup: "2026-04-22",
    recentAction: "打开邮件",
    lastContactedAt: "2026-04-22T08:00:00.000Z",
    tags: ["运营商"],
    contacts: [{ id: "sample-contact-6", type: "email", value: "contact@omancom.om", sourceUrl: "https://omancom.om" }],
    icpScore: { score: 75, grade: "medium" }
  },
  {
    id: "sample-qatar-telecom",
    leadId: "sample-lead-7",
    companyName: "Qatar Telecom Solutions",
    website: "qatartelecom.qa",
    sourceUrl: "https://qatartelecom.qa",
    country: "卡塔尔",
    industry: "通信解决方案",
    stage: "invalid",
    stageLabel: "无效客户",
    owner: "老梁",
    recentFollowup: "2026-04-20",
    recentAction: "标记无效",
    lastContactedAt: null,
    tags: ["待排除"],
    contacts: [{ id: "sample-contact-7", type: "email", value: "info@qatartelecom.qa", sourceUrl: "https://qatartelecom.qa" }],
    icpScore: { score: 48, grade: "low" }
  },
  {
    id: "sample-bahrain-network",
    leadId: "sample-lead-8",
    companyName: "Bahrain Network Services",
    website: "bahrainnet.bh",
    sourceUrl: "https://bahrainnet.bh",
    country: "巴林",
    industry: "网络服务",
    stage: "potential",
    stageLabel: "潜在客户",
    owner: "老梁",
    recentFollowup: "2026-04-19",
    recentAction: "发送邮件",
    lastContactedAt: "2026-04-19T08:00:00.000Z",
    tags: ["网络服务"],
    contacts: [{ id: "sample-contact-8", type: "email", value: "sales@bahrainnet.bh", sourceUrl: "https://bahrainnet.bh" }],
    icpScore: { score: 73, grade: "medium" }
  }
];

const sampleContacts: Contact[] = sampleCompanies.flatMap((company) =>
  company.contacts.map((contact) => ({
    id: contact.id,
    companyId: company.id,
    companyName: company.companyName,
    country: company.country,
    type: contact.type,
    value: contact.value,
    sourceUrl: contact.sourceUrl,
    stage: company.stage,
    stageLabel: company.stageLabel,
    owner: company.owner,
    recentFollowup: company.recentFollowup,
    recentAction: company.recentAction
  }))
);

const sampleData: CrmResponse = {
  view: "companies",
  group: "all",
  stats: {
    companies: 156,
    contacts: 214,
    favorites: 5,
    contacted7: 23,
    uncontacted: 85
  },
  groups: {
    all: 156,
    potential: 48,
    contacted7: 23,
    uncontacted: 85
  },
  companies: sampleCompanies,
  contacts: sampleContacts
};

const viewOptions: Array<{ value: Exclude<CrmView, "favorites">; label: string }> = [
  { value: "companies", label: "公司列表" },
  { value: "contacts", label: "联系人列表" }
];

const groupOptions: Array<{ value: CrmGroup; label: string; key: keyof CrmResponse["groups"] }> = [
  { value: "all", label: "全部客户", key: "all" },
  { value: "potential", label: "潜在客户", key: "potential" },
  { value: "contacted_7_days", label: "7天内联系客户", key: "contacted7" },
  { value: "uncontacted", label: "未联系客户", key: "uncontacted" }
];

const summaryItems: Array<{
  label: string;
  getValue: (data: CrmResponse) => number;
  icon: typeof Users;
  tone: "blue" | "orange" | "green" | "gray";
}> = [
  { label: "客户总数", getValue: (data) => data.stats.companies, icon: Users, tone: "blue" },
  { label: "潜在客户", getValue: (data) => data.groups.potential, icon: Star, tone: "orange" },
  { label: "跟进中", getValue: (data) => data.stats.contacted7, icon: Clock3, tone: "green" },
  { label: "无效客户", getValue: (data) => data.groups.uncontacted, icon: Building2, tone: "gray" }
];

export function CustomersClient() {
  const [view, setView] = useState<CrmView>("companies");
  const [group, setGroup] = useState<CrmGroup>("all");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<CrmResponse>(defaultData);
  const [status, setStatus] = useState("正在读取 CRM 客户...");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setStatus("正在读取 CRM 客户...");
      try {
        const params = new URLSearchParams({ view, group });
        const response = await fetch(`/api/crm/leads?${params.toString()}`, { credentials: "include" });
        if (!response.ok) {
          throw new Error(`CRM request failed with HTTP ${response.status}`);
        }

        const payload = (await response.json()) as CrmResponse;
        const nextData = payload.stats.companies > 0 || payload.companies.length > 0 ? payload : sampleData;
        if (!cancelled) {
          setData(nextData);
          setStatus("管理和查看所有客户信息");
        }
      } catch {
        if (!cancelled) {
          setData(sampleData);
          setStatus("管理和查看所有客户信息");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [view, group]);

  const companies = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return data.companies;
    }

    return data.companies.filter((company) =>
      [company.companyName, company.country, company.industry, company.stageLabel, company.owner, ...company.tags]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(keyword))
    );
  }, [data.companies, query]);

  const contacts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return data.contacts;
    }

    return data.contacts.filter((contact) =>
      [contact.companyName, contact.country, contact.type, contact.value, contact.stageLabel, contact.owner]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(keyword))
    );
  }, [data.contacts, query]);

  const title = titleForView(view, group);
  const total = totalForView(data, view, group);

  return (
    <AppShell
      activePath="/customers"
      eyebrow="我的客户"
      hidePageHeader
      mainClassName="crmMain"
      pageClassName="crmPage"
      title="CRM 客户库"
    >
      <section className="crmPrototype">
        <aside className="crmFilterPane" aria-label="客户列表筛选">
          <div className="crmViewTabs" aria-label="CRM 视图">
            {viewOptions.map((item) => (
              <button
                className={view === item.value ? "active" : ""}
                key={item.value}
                onClick={() => setView(item.value)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="crmFilterScroll">
            <button
              className={view === "favorites" ? "crmFavoriteRow active" : "crmFavoriteRow"}
              onClick={() => {
                setView("favorites");
                setGroup("all");
              }}
              type="button"
            >
              <span>
                <Star aria-hidden="true" size={14} />
                收藏列表
              </span>
              <strong>{data.stats.favorites}</strong>
            </button>

            <section className="crmSideSection">
              <div className="crmSideTitle">
                <span>
                  <ChevronDown aria-hidden="true" size={14} />
                  自动分组
                </span>
                <button aria-label="添加自动分组" type="button">
                  +
                </button>
              </div>
              <div className="crmSideList">
                {groupOptions.map((item) => (
                  <button
                    className={view !== "favorites" && group === item.value ? "active" : ""}
                    key={item.value}
                    onClick={() => {
                      setView("companies");
                      setGroup(item.value);
                    }}
                    type="button"
                  >
                    <span>{item.label}</span>
                    <strong>{data.groups[item.key]}</strong>
                  </button>
                ))}
              </div>
            </section>

            <section className="crmSideSection">
              <div className="crmSideTitle">
                <span>
                  <ChevronDown aria-hidden="true" size={14} />
                  我的列表
                </span>
                <button aria-label="添加我的列表" type="button">
                  +
                </button>
              </div>
            </section>
          </div>

          <section className="crmSummaryCard" aria-label="客户总览">
            <h2>客户总览</h2>
            {summaryItems.map((item) => {
              const Icon = item.icon;
              return (
                <div className={`crmSummaryItem ${item.tone}`} key={item.label}>
                  <span>
                    <Icon aria-hidden="true" size={13} />
                  </span>
                  <p>{item.label}</p>
                  <strong>{item.getValue(data)}</strong>
                </div>
              );
            })}
          </section>
        </aside>

        <section className="crmContentPane">
          <header className="crmContentHead">
            <div>
              <h1>
                {title} <span>({total})</span>
              </h1>
              <p>{loading ? "正在同步客户信息" : status}</p>
            </div>
            <div className="crmHeadActions">
              <button className="crmGhostButton" type="button">
                <Download aria-hidden="true" size={15} />
                导出客户
              </button>
              <button className="crmPrimaryButton" type="button">
                <Plus aria-hidden="true" size={16} />
                新建客户
              </button>
            </div>
          </header>

          <div className="crmContentTools">
            <label className="crmSearchBox">
              <Search aria-hidden="true" size={17} />
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索公司名称 / 行业 / 国家"
                value={query}
              />
            </label>
            <button className="crmGhostButton" type="button">
              <Filter aria-hidden="true" size={15} />
              筛选
            </button>
          </div>

          {view === "contacts" ? <ContactsTable contacts={contacts} /> : <CompaniesTable companies={companies} />}

          <footer className="crmPager" aria-label="客户分页">
            <span>共 {total} 条</span>
            <button className="crmPageSize" type="button">
              10 条/页 <ChevronDown aria-hidden="true" size={14} />
            </button>
            <div className="crmPageButtons">
              <button disabled type="button">
                <ChevronLeft aria-hidden="true" size={15} />
              </button>
              <button className="active" type="button">
                1
              </button>
              <button type="button">2</button>
              <button type="button">3</button>
              <button type="button">4</button>
              <button type="button">5</button>
              <span>...</span>
              <button type="button">16</button>
              <button type="button">
                <ChevronRight aria-hidden="true" size={15} />
              </button>
            </div>
          </footer>
        </section>
      </section>
    </AppShell>
  );
}

function CompaniesTable({ companies }: { companies: Company[] }) {
  if (companies.length === 0) {
    return <EmptyState text="发送开发信或手动同步客户后，这里会显示 CRM 记录。" />;
  }

  return (
    <div className="crmTableWrap">
      <table className="crmTable">
        <thead>
          <tr>
            <th className="crmCheckCell">
              <span aria-hidden="true" />
            </th>
            <th>公司名称</th>
            <th>国家/地区</th>
            <th>行业</th>
            <th>客户阶段</th>
            <th>负责人</th>
            <th>最近跟进</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company, index) => (
            <tr key={company.id}>
              <td className="crmCheckCell">
                <span aria-hidden="true" />
              </td>
              <td>
                <div className="crmCompanyCell">
                  <span className={`crmCompanyMark tone${(index % 6) + 1}`}>
                    <Building2 aria-hidden="true" size={16} />
                  </span>
                  <div>
                    <strong>{company.companyName}</strong>
                  <small>{company.website ?? company.sourceUrl ?? "暂无网址"}</small>
                  </div>
                </div>
              </td>
              <td>
                <span className="crmCountry">
                  <span aria-hidden="true">{flagForCountry(company.country)}</span>
                  {company.country}
                </span>
              </td>
              <td>{company.industry}</td>
              <td>
                <span className={`crmStage ${stageTone(company.stage)}`}>{company.stageLabel}</span>
              </td>
              <td>
                <span className="crmOwner">
                  <span>梁</span>
                  {company.owner}
                </span>
              </td>
              <td>
                <div className="crmFollowup">
                  <strong>{company.recentFollowup}</strong>
                  <small>{company.recentAction ?? (company.lastContactedAt ? "发送邮件" : "首次联系")}</small>
                </div>
              </td>
              <td>
                <div className="crmActions">
                  <button type="button">查看</button>
                  <button aria-label="更多操作" className="iconOnly" type="button">
                    <MoreHorizontal aria-hidden="true" size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContactsTable({ contacts }: { contacts: Contact[] }) {
  if (contacts.length === 0) {
    return <EmptyState text="客户邮箱、电话或 LinkedIn 联系方式入库后会显示在这里。" />;
  }

  return (
    <div className="crmTableWrap">
      <table className="crmTable">
        <thead>
          <tr>
            <th className="crmCheckCell">
              <span aria-hidden="true" />
            </th>
            <th>联系人</th>
            <th>公司</th>
            <th>国家/地区</th>
            <th>类型</th>
            <th>客户阶段</th>
            <th>负责人</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((contact, index) => (
            <tr key={contact.id}>
              <td className="crmCheckCell">
                <span aria-hidden="true" />
              </td>
              <td>
                <div className="crmCompanyCell">
                  <span className={`crmCompanyMark tone${(index % 6) + 1}`}>
                    <Mail aria-hidden="true" size={16} />
                  </span>
                  <div>
                    <strong>{contact.value}</strong>
                    <small>{contact.sourceUrl ?? "来源待补充"}</small>
                  </div>
                </div>
              </td>
              <td>{contact.companyName}</td>
              <td>
                <span className="crmCountry">
                  <span aria-hidden="true">{flagForCountry(contact.country)}</span>
                  {contact.country}
                </span>
              </td>
              <td>
                <span className="contactType">{contact.type}</span>
              </td>
              <td>
                <span className={`crmStage ${stageTone(contact.stage)}`}>{contact.stageLabel}</span>
              </td>
              <td>
                <span className="crmOwner">
                  <span>梁</span>
                  {contact.owner}
                </span>
              </td>
              <td>
                <div className="crmActions">
                  <button type="button">发邮件</button>
                  <button aria-label="更多操作" className="iconOnly" type="button">
                    <MoreHorizontal aria-hidden="true" size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="crmEmpty">
      <Building2 aria-hidden="true" size={28} />
      <strong>等待客户同步</strong>
      <p>{text}</p>
    </div>
  );
}

function titleForView(view: CrmView, group: CrmGroup) {
  if (view === "contacts") {
    return "联系人列表";
  }

  if (view === "favorites") {
    return "收藏列表";
  }

  return groupOptions.find((item) => item.value === group)?.label ?? "全部客户";
}

function totalForView(data: CrmResponse, view: CrmView, group: CrmGroup) {
  if (view === "contacts") {
    return data.stats.contacts;
  }

  if (view === "favorites") {
    return data.stats.favorites;
  }

  return data.groups[groupOptions.find((item) => item.value === group)?.key ?? "all"];
}

function stageTone(stage: string) {
  if (["contacted", "interested", "quoting"].includes(stage)) {
    return "blue";
  }

  if (["new", "potential", "qualified"].includes(stage)) {
    return "green";
  }

  if (stage === "closed") {
    return "success";
  }

  return "gray";
}

function flagForCountry(country: string) {
  const lower = country.toLowerCase();
  if (lower.includes("germany")) {
    return "🇩🇪";
  }
  if (lower.includes("saudi")) {
    return "🇸🇦";
  }
  if (lower.includes("uae") || lower.includes("emirates")) {
    return "🇦🇪";
  }
  if (country.includes("阿联酋")) {
    return "🇦🇪";
  }
  if (country.includes("沙特")) {
    return "🇸🇦";
  }
  if (country.includes("阿曼")) {
    return "🇴🇲";
  }
  if (country.includes("卡塔尔")) {
    return "🇶🇦";
  }
  if (country.includes("巴林")) {
    return "🇧🇭";
  }
  if (lower.includes("oman")) {
    return "🇴🇲";
  }
  if (lower.includes("qatar")) {
    return "🇶🇦";
  }
  if (lower.includes("bahrain")) {
    return "🇧🇭";
  }

  return "🌐";
}
