"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Mail,
  Plus,
  Search,
  Star
} from "lucide-react";
import { AppShell } from "../app-shell";
import { TableLoadingState } from "../table-loading-state";

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

type CrmFilters = {
  country: string;
  stage: string;
  icpGrade: string;
  contactStatus: "all" | "with_contacts" | "without_contacts";
  contactType: string;
};

type StageOption = {
  value: string;
  label: string;
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

const defaultFilters: CrmFilters = {
  country: "all",
  stage: "all",
  icpGrade: "all",
  contactStatus: "all",
  contactType: "all"
};

/*
 * Legacy CRM demo data is intentionally kept out of runtime.
 * The customers page must reflect only /api/crm/leads results.
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

*/
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

const icpGradeOptions = [
  { value: "all", label: "全部评分" },
  { value: "high", label: "高评分" },
  { value: "medium", label: "中评分" },
  { value: "low", label: "低评分" },
  { value: "unknown", label: "未评分" }
];

const contactStatusOptions = [
  { value: "all", label: "全部客户" },
  { value: "with_contacts", label: "有联系方式" },
  { value: "without_contacts", label: "无联系方式" }
] satisfies Array<{ value: CrmFilters["contactStatus"]; label: string }>;

const crmPageSize = 10;

export function CustomersClient() {
  const [view, setView] = useState<CrmView>("companies");
  const [group, setGroup] = useState<CrmGroup>("all");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<CrmResponse>(defaultData);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<CrmFilters>(defaultFilters);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ view, group });
        const response = await fetch(`/api/crm/leads?${params.toString()}`, { credentials: "include" });
        if (!response.ok) {
          throw new Error(`CRM request failed with HTTP ${response.status}`);
        }

        const payload = (await response.json()) as CrmResponse;
        if (!cancelled) {
          setData(payload);
        }
      } catch {
        if (!cancelled) {
          setData(defaultData);
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
  }, [view, group, reloadKey]);

  useEffect(() => {
    setPage(1);
  }, [view, group, query, filters]);

  const companyLookup = useMemo(() => new Map(data.companies.map((company) => [company.id, company])), [data.companies]);

  const countryOptions = useMemo(() => {
    const rows = view === "contacts" ? data.contacts : data.companies;
    return uniqueSorted(rows.map((row) => row.country));
  }, [data.companies, data.contacts, view]);

  const stageOptions = useMemo(() => {
    const rows = view === "contacts" ? data.contacts : data.companies;
    const options = new Map<string, string>();
    rows.forEach((row) => {
      if (row.stage) {
        options.set(row.stage, row.stageLabel || row.stage);
      }
    });

    return [...options.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  }, [data.companies, data.contacts, view]);

  const contactTypeOptions = useMemo(() => uniqueSorted(data.contacts.map((contact) => contact.type)), [data.contacts]);

  const companies = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return data.companies.filter(
      (company) => matchesCompanySearch(company, keyword) && matchesCompanyFilters(company, filters)
    );
  }, [data.companies, filters, query]);

  const contacts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return data.contacts.filter((contact) =>
      matchesContactSearch(contact, keyword) && matchesContactFilters(contact, filters, companyLookup.get(contact.companyId))
    );
  }, [companyLookup, data.contacts, filters, query]);

  const title = titleForView(view, group);
  const total = totalForView(data, view, group);
  const tableTotal = view === "contacts" ? contacts.length : companies.length;
  const activeFilterCount = countActiveFilters(filters, view);
  const isFiltering = query.trim().length > 0 || activeFilterCount > 0;
  const pageCount = Math.max(1, Math.ceil(tableTotal / crmPageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStartIndex = (currentPage - 1) * crmPageSize;
  const pageEndIndex = Math.min(pageStartIndex + crmPageSize, tableTotal);
  const visibleCompanies = companies.slice(pageStartIndex, pageEndIndex);
  const visibleContacts = contacts.slice(pageStartIndex, pageEndIndex);
  const pageTokens = paginationTokens(pageCount, currentPage);
  const pagerLabel =
    tableTotal === 0 ? `共 ${tableTotal} 条` : `显示 ${pageStartIndex + 1}-${pageEndIndex} / ${tableTotal} 条`;
  const subline = loading
    ? "正在同步客户信息"
    : isFiltering
      ? `筛选后 ${tableTotal} 条 · 当前列表共 ${total} 条`
      : `共 ${total} 条 · 上次同步刚刚`;

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

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
            <div className="crmSideList">
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
          </div>
        </aside>

        <section className="crmContentPane">
          <header className="crmContentHead">
            <div>
              <h1>
                {title} <span>({isFiltering ? tableTotal : total})</span>
              </h1>
              <p>{subline}</p>
            </div>
            <div className="crmHeadActions">
              <button className="crmGhostButton" type="button">
                <Download aria-hidden="true" size={15} />
                导出客户
              </button>
              <button className="crmPrimaryButton" onClick={() => setShowCreate(true)} type="button">
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
                placeholder="搜索公司名称 / 行业 / 国家 / 网站"
                value={query}
              />
            </label>
            <div className="crmFilterControl">
              <button
                aria-expanded={showFilters}
                className={
                  showFilters || activeFilterCount > 0
                    ? "crmGhostButton crmFilterButton active"
                    : "crmGhostButton crmFilterButton"
                }
                onClick={() => setShowFilters((current) => !current)}
                type="button"
              >
                <Filter aria-hidden="true" size={15} />
                筛选
                {activeFilterCount > 0 ? <span className="crmFilterBadge">{activeFilterCount}</span> : null}
              </button>
              {showFilters ? (
                <CrmFilterMenu
                  activeFilterCount={activeFilterCount}
                  contactTypeOptions={contactTypeOptions}
                  countryOptions={countryOptions}
                  filters={filters}
                  onChange={setFilters}
                  onClose={() => setShowFilters(false)}
                  onReset={() => setFilters(defaultFilters)}
                  stageOptions={stageOptions}
                  view={view}
                />
              ) : null}
            </div>
          </div>

          {view === "contacts" ? (
            <ContactsTable contacts={visibleContacts} loading={loading} />
          ) : (
            <CompaniesTable companies={visibleCompanies} loading={loading} />
          )}

          <footer className="crmPager" aria-label="客户分页">
            <span>{pagerLabel}</span>
            <div className="crmPagerRight">
              <button className="crmPageSize" type="button">
                10 条/页 <ChevronDown aria-hidden="true" size={14} />
              </button>
              <div className="crmPageButtons">
                <button
                  disabled={currentPage <= 1}
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                  type="button"
                >
                  <ChevronLeft aria-hidden="true" size={15} />
                </button>
                {pageTokens.map((token) =>
                  typeof token === "number" ? (
                    <button
                      className={token === currentPage ? "active" : ""}
                      key={token}
                      onClick={() => setPage(token)}
                      type="button"
                    >
                      {token}
                    </button>
                  ) : (
                    <span key={token}>...</span>
                  )
                )}
                <button
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage(Math.min(pageCount, currentPage + 1))}
                  type="button"
                >
                  <ChevronRight aria-hidden="true" size={15} />
                </button>
              </div>
            </div>
          </footer>
        </section>
      </section>

      {showCreate ? (
        <CreateLeadModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setReloadKey((current) => current + 1);
          }}
        />
      ) : null}
    </AppShell>
  );
}

function CrmFilterMenu({
  activeFilterCount,
  contactTypeOptions,
  countryOptions,
  filters,
  onChange,
  onClose,
  onReset,
  stageOptions,
  view
}: {
  activeFilterCount: number;
  contactTypeOptions: string[];
  countryOptions: string[];
  filters: CrmFilters;
  onChange: (filters: CrmFilters) => void;
  onClose: () => void;
  onReset: () => void;
  stageOptions: StageOption[];
  view: CrmView;
}) {
  return (
    <div className="crmFilterMenu" role="dialog" aria-label="筛选客户">
      <div className="crmFilterMenuHead">
        <strong>筛选客户</strong>
        <span>{activeFilterCount > 0 ? `已选 ${activeFilterCount} 项` : "实时生效"}</span>
      </div>

      <label className="crmFilterField">
        <span>国家/地区</span>
        <select onChange={(event) => onChange({ ...filters, country: event.target.value })} value={filters.country}>
          <option value="all">全部国家</option>
          {countryOptions.map((country) => (
            <option key={country} value={country}>
              {country}
            </option>
          ))}
        </select>
      </label>

      <label className="crmFilterField">
        <span>客户阶段</span>
        <select onChange={(event) => onChange({ ...filters, stage: event.target.value })} value={filters.stage}>
          <option value="all">全部阶段</option>
          {stageOptions.map((stage) => (
            <option key={stage.value} value={stage.value}>
              {stage.label}
            </option>
          ))}
        </select>
      </label>

      <label className="crmFilterField">
        <span>ICP评分</span>
        <select onChange={(event) => onChange({ ...filters, icpGrade: event.target.value })} value={filters.icpGrade}>
          {icpGradeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {view === "contacts" ? (
        <label className="crmFilterField">
          <span>联系方式类型</span>
          <select onChange={(event) => onChange({ ...filters, contactType: event.target.value })} value={filters.contactType}>
            <option value="all">全部类型</option>
            {contactTypeOptions.map((type) => (
              <option key={type} value={type}>
                {contactTypeLabel(type)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="crmFilterField">
          <span>联系方式</span>
          <select
            onChange={(event) =>
              onChange({ ...filters, contactStatus: event.target.value as CrmFilters["contactStatus"] })
            }
            value={filters.contactStatus}
          >
            {contactStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="crmFilterMenuActions">
        <button className="crmTextButton" disabled={activeFilterCount === 0} onClick={onReset} type="button">
          清空
        </button>
        <button className="crmFilterDoneButton" onClick={onClose} type="button">
          完成
        </button>
      </div>
    </div>
  );
}

function CompaniesTable({ companies, loading }: { companies: Company[]; loading: boolean }) {
  if (loading) {
    return (
      <TableLoadingState
        title="正在同步客户信息"
        description="正在读取 CRM 客户、联系人和跟进状态。"
      />
    );
  }

  if (companies.length === 0) {
    return <EmptyState text="把客户同步到 CRM 或手动新建客户后，这里会显示 CRM 记录。" />;
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
                  <span className={`crmCompanyMark tone${(index % 6) + 1}`} aria-hidden="true">
                    {initialOf(company.companyName)}
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
              <td>
                <span className="crmIndustryTag">{company.industry}</span>
              </td>
              <td>
                <span className={`crmStage ${stageTone(company.stage)}`}>{company.stageLabel}</span>
              </td>
              <td>
                <span className="crmOwner">
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
                  <button type="button">详情</button>
                  <button type="button">发邮件</button>
                  <button type="button">跟进</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContactsTable({ contacts, loading }: { contacts: Contact[]; loading: boolean }) {
  if (loading) {
    return (
      <TableLoadingState
        title="正在同步联系人信息"
        description="正在读取 CRM 联系方式和客户阶段。"
      />
    );
  }

  if (contacts.length === 0) {
    return <EmptyState text="已同步到 CRM 的客户有邮箱、电话或 LinkedIn 后会显示在这里。" />;
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
                  {contact.owner}
                </span>
              </td>
              <td>
                <div className="crmActions">
                  <button type="button">发邮件</button>
                  <button type="button">跟进</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [country, setCountry] = useState("");
  const [stage, setStage] = useState("new");
  const [tagsText, setTagsText] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    const trimmedName = companyName.trim();
    if (!trimmedName) {
      setError("请填写公司名称");
      return;
    }

    const tags = tagsText
      .split(/[,，、\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    const contacts: Array<{ type: string; value: string }> = [];
    if (email.trim()) contacts.push({ type: "email", value: email.trim() });
    if (phone.trim()) contacts.push({ type: "phone", value: phone.trim() });

    setSubmitting(true);
    try {
      const response = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          companyName: trimmedName,
          website: website.trim() || undefined,
          country: country.trim() || undefined,
          stage,
          tags: tags.length ? tags : undefined,
          contacts: contacts.length ? contacts : undefined
        })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }

      onCreated();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "创建失败";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="crmModalScrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="新建客户"
    >
      <div className="crmModal">
        <header className="crmModalHead">
          <h2>新建客户</h2>
          <button aria-label="关闭" className="crmModalClose" onClick={onClose} type="button">
            ×
          </button>
        </header>
        <div className="crmModalBody">
          <label className="crmModalField">
            <span>
              公司名称 <em>*</em>
            </span>
            <input
              autoFocus
              maxLength={160}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="例如：Emirates Tower Power"
              type="text"
              value={companyName}
            />
          </label>

          <div className="crmModalGrid">
            <label className="crmModalField">
              <span>官网</span>
              <input
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="https://example.com"
                type="text"
                value={website}
              />
            </label>
            <label className="crmModalField">
              <span>国家 / 地区</span>
              <input
                onChange={(event) => setCountry(event.target.value)}
                placeholder="例如：阿联酋"
                type="text"
                value={country}
              />
            </label>
          </div>

          <div className="crmModalGrid">
            <label className="crmModalField">
              <span>邮箱</span>
              <input
                onChange={(event) => setEmail(event.target.value)}
                placeholder="contact@example.com"
                type="email"
                value={email}
              />
            </label>
            <label className="crmModalField">
              <span>电话</span>
              <input
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+971 ..."
                type="text"
                value={phone}
              />
            </label>
          </div>

          <div className="crmModalGrid">
            <label className="crmModalField">
              <span>客户阶段</span>
              <select onChange={(event) => setStage(event.target.value)} value={stage}>
                <option value="new">新客户</option>
                <option value="potential">潜在客户</option>
                <option value="qualified">已确认</option>
                <option value="contacted">已触达</option>
                <option value="interested">感兴趣</option>
                <option value="quoting">报价中</option>
                <option value="closed">已成交</option>
              </select>
            </label>
            <label className="crmModalField">
              <span>标签（逗号分隔）</span>
              <input
                onChange={(event) => setTagsText(event.target.value)}
                placeholder="经销商, 现货商, UAE"
                type="text"
                value={tagsText}
              />
            </label>
          </div>

          {error ? <p className="crmModalError">{error}</p> : null}
        </div>
        <footer className="crmModalFoot">
          <button className="crmGhostButton" disabled={submitting} onClick={onClose} type="button">
            取消
          </button>
          <button className="crmPrimaryButton" disabled={submitting} onClick={handleSubmit} type="button">
            {submitting ? "创建中..." : "创建客户"}
          </button>
        </footer>
      </div>
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

function matchesCompanySearch(company: Company, keyword: string) {
  if (!keyword) {
    return true;
  }

  const fields = [
    company.companyName,
    company.country,
    company.industry,
    company.stageLabel,
    company.owner,
    company.website,
    company.sourceUrl,
    ...company.tags
  ].filter(isNonEmptyString);

  return (
    fields.some((value) => value.toLowerCase().includes(keyword)) ||
    company.contacts.some((contact) =>
      [contact.type, contact.value, contact.sourceUrl]
        .filter(isNonEmptyString)
        .some((value) => value.toLowerCase().includes(keyword))
    )
  );
}

function matchesContactSearch(contact: Contact, keyword: string) {
  if (!keyword) {
    return true;
  }

  return [contact.companyName, contact.country, contact.type, contact.value, contact.stageLabel, contact.owner, contact.sourceUrl]
    .filter(isNonEmptyString)
    .some((value) => value.toLowerCase().includes(keyword));
}

function matchesCompanyFilters(company: Company, filters: CrmFilters) {
  if (filters.country !== "all" && company.country !== filters.country) {
    return false;
  }

  if (filters.stage !== "all" && company.stage !== filters.stage) {
    return false;
  }

  if (!matchesIcpGrade(company, filters.icpGrade)) {
    return false;
  }

  if (filters.contactStatus === "with_contacts" && company.contacts.length === 0) {
    return false;
  }

  if (filters.contactStatus === "without_contacts" && company.contacts.length > 0) {
    return false;
  }

  return true;
}

function matchesContactFilters(contact: Contact, filters: CrmFilters, company?: Company) {
  if (filters.country !== "all" && contact.country !== filters.country) {
    return false;
  }

  if (filters.stage !== "all" && contact.stage !== filters.stage) {
    return false;
  }

  if (filters.contactType !== "all" && contact.type !== filters.contactType) {
    return false;
  }

  return matchesIcpGrade(company, filters.icpGrade);
}

function matchesIcpGrade(company: Company | undefined, grade: string) {
  if (grade === "all") {
    return true;
  }

  if (grade === "unknown") {
    return !company?.icpScore?.grade;
  }

  return company?.icpScore?.grade === grade;
}

function countActiveFilters(filters: CrmFilters, view: CrmView) {
  return [
    filters.country !== "all",
    filters.stage !== "all",
    filters.icpGrade !== "all",
    view === "contacts" ? filters.contactType !== "all" : filters.contactStatus !== "all"
  ].filter(Boolean).length;
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return Boolean(value);
}

function contactTypeLabel(type: string) {
  if (type === "email") {
    return "邮箱";
  }

  if (type === "phone") {
    return "电话";
  }

  if (type === "linkedin") {
    return "LinkedIn";
  }

  return type;
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

function paginationTokens(pageCount: number, currentPage: number): Array<number | "left-ellipsis" | "right-ellipsis"> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const tokens: Array<number | "left-ellipsis" | "right-ellipsis"> = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(pageCount - 1, currentPage + 1);

  if (start > 2) {
    tokens.push("left-ellipsis");
  }

  for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
    tokens.push(pageNumber);
  }

  if (end < pageCount - 1) {
    tokens.push("right-ellipsis");
  }

  tokens.push(pageCount);
  return tokens;
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

function initialOf(value: string) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "•";
  const first = trimmed.charAt(0);
  return /[A-Za-z0-9]/.test(first) ? first.toUpperCase() : first;
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
