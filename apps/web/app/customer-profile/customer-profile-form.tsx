"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  LockKeyhole,
  Play,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Target,
  UserRoundSearch,
  WandSparkles,
  X
} from "lucide-react";
import { getMarketLabel, INITIAL_TARGET_MARKETS, MARKET_OPTIONS, type MarketOption } from "./market-options";

type CustomerProfileState = {
  targetRegions: string[];
  industryKeywords: string;
  referenceCustomerUrlsText: string;
  notes: string;
};

const CUSTOMER_PROFILE_NOTES_MAX_LENGTH = 300;

const initialState: CustomerProfileState = {
  targetRegions: INITIAL_TARGET_MARKETS,
  industryKeywords: "行业关键词、产品应用场景、目标客户行业",
  referenceCustomerUrlsText: "https://spectrummea.com/\nhttps://highcloud.ae/",
  notes: "我想找会使用、维护、安装、集成、采购或运营这类产品的客户，优先有项目交付、备件补货、维护运维或采购需求。"
};

const guideItems = [
  {
    icon: Target,
    title: "填写目标市场",
    text: "告诉 AI 你要找哪些国家/地区、哪些行业的客户"
  },
  {
    icon: UserRoundSearch,
    title: "提供参考客户",
    text: "提供你已有的客户官网，帮助 AI 理解客户特征"
  },
  {
    icon: WandSparkles,
    title: "补充客户偏好",
    text: "补充你的业务场景和需求偏好，越详细越精准"
  }
];

export function CustomerProfileForm() {
  const router = useRouter();
  const [form, setForm] = useState<CustomerProfileState>(initialState);
  const [status, setStatus] = useState("");

  const targetRegions = form.targetRegions;
  const targetRegionLabels = useMemo(() => targetRegions.map(getMarketLabel), [targetRegions]);
  const industryTags = useMemo(() => splitValues(form.industryKeywords), [form.industryKeywords]);
  const referenceCustomerUrls = useMemo(() => splitLines(form.referenceCustomerUrlsText), [form.referenceCustomerUrlsText]);
  const customerTypeTags = useMemo(() => extractCustomerTypes(form.notes), [form.notes]);

  useEffect(() => {
    let cancelled = false;

    async function loadSavedProfile() {
      try {
        const response = await fetch("/api/profiles/customer", { credentials: "include" });
        if (!response.ok) {
          return;
        }
        const profile = (await response.json()) as {
          targetRegions?: string[] | null;
          referenceCustomerUrls?: string[] | null;
          notes?: string | null;
        } | null;
        if (!profile || cancelled) {
          return;
        }
        const extractedIndustryKeywords = extractMergedNoteValues(profile.notes, "Customer industry keywords");
        setForm({
          targetRegions: normalizeTargetRegionSelection(profile.targetRegions?.length ? profile.targetRegions : INITIAL_TARGET_MARKETS),
          industryKeywords: extractedIndustryKeywords.length ? extractedIndustryKeywords.join(", ") : initialState.industryKeywords,
          referenceCustomerUrlsText: (profile.referenceCustomerUrls ?? []).join("\n") || initialState.referenceCustomerUrlsText,
          notes: stripMergedNote(profile.notes, "Customer industry keywords") || initialState.notes
        });
      } catch {
        // Keep local defaults if profile loading fails.
      }
    }

    void loadSavedProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(field: "industryKeywords" | "referenceCustomerUrlsText" | "notes", value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateTargetRegions(targetRegions: string[]) {
    setForm((current) => ({ ...current, targetRegions: normalizeTargetRegionSelection(targetRegions) }));
  }

  async function persistProfile() {
    const normalizedTargetRegions = normalizeTargetRegionSelection(targetRegions);
    if (!normalizedTargetRegions.length) {
      return false;
    }

    const response = await fetch("/api/profiles/customer", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({
        targetRegions: normalizedTargetRegions,
        referenceCustomerUrls,
        notes: mergeProfileNotes(form.notes, "Customer industry keywords", industryTags)
      })
    });
    return response.ok;
  }

  async function handleSaveOnly() {
    if (!targetRegions.length) {
      setStatus("请至少选择一个目标国家/地区。");
      return;
    }
    setStatus("保存中...");
    try {
      const ok = await persistProfile();
      setStatus(ok ? "已保存，AI 外贸员会在后续任务中读取这份客户画像。" : "保存失败，请检查目标市场、参考客户官网或登录状态。");
    } catch {
      setStatus("网络异常，稍后重试。");
    }
  }

  async function handleSaveAndStart() {
    if (!targetRegions.length) {
      setStatus("请至少选择一个目标国家/地区。");
      return;
    }
    setStatus("保存中并准备进入 AI 外贸员...");
    try {
      const ok = await persistProfile();
      if (!ok) {
        setStatus("保存失败，请检查目标市场、参考客户官网或登录状态。");
        return;
      }
      setStatus("已保存，正在进入 AI 外贸员开始找客户...");
      router.push("/");
    } catch {
      setStatus("网络异常，稍后重试。");
    }
  }

  return (
    <section className="productProfileShell customerProfileShell">
      <header className="productProfileHeader">
        <h1>客户画像</h1>
        <p>告诉 AI 外贸员你要找什么客户，系统会根据这些信息自动帮你找潜在客户。</p>
      </header>

      <section className="productGuide">
        <h2>再告诉 AI 你想找什么客户</h2>
        <div className="productGuideGrid">
          {guideItems.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title}>
                <span>
                  <Icon aria-hidden="true" size={19} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </div>
              </article>
            );
          })}
        </div>
        <p className="productGuideHint">
          <Sparkles aria-hidden="true" size={14} />
          AI 将基于这些信息生成客户画像，并自动开始找客户。
        </p>
      </section>

      <section className="productFormCard">
        <div className="productFields customerFields">
          <div className="productField customerShortField targetMarketField">
            <span>
              目标国家 / 地区 <b>*</b>
            </span>
            <MarketMultiSelect
              selectedValues={targetRegions}
              selectedLabels={targetRegionLabels}
              onChange={updateTargetRegions}
            />
          </div>

          <label className="productField">
            <span>行业关键词（可选）</span>
            <textarea
              value={form.industryKeywords}
              onChange={(event) => updateField("industryKeywords", event.target.value)}
              placeholder="例如：行业关键词、产品应用场景、目标客户行业"
            />
          </label>

          <label className="productField customerReferenceField">
            <span>参考客户官网（每行一个）</span>
            <textarea
              value={form.referenceCustomerUrlsText}
              onChange={(event) => updateField("referenceCustomerUrlsText", event.target.value)}
              placeholder={"例如：\nhttps://spectrummea.com/\nhttps://highcloud.ae/"}
            />
            <small>输入的官网仅用于分析客户特征，不会对外公开。</small>
          </label>

          <label className="productField productNotesField">
            <span>补充说明（可选）</span>
            <textarea
              maxLength={CUSTOMER_PROFILE_NOTES_MAX_LENGTH}
              value={form.notes}
              onChange={(event) => updateField("notes", event.target.value)}
              placeholder="例如：我想找会使用、维护、安装、集成、采购或运营这类产品的客户，优先有项目交付、备件补货、维护运维或采购需求。"
            />
            <small>{form.notes.length} / {CUSTOMER_PROFILE_NOTES_MAX_LENGTH}</small>
          </label>
        </div>
      </section>

      <section className="productUnderstanding">
        <div className="productUnderstandingHead">
          <h2>
            <Sparkles aria-hidden="true" size={18} />
            AI 将这样理解你的画像
          </h2>
          <button type="button" onClick={() => setForm(initialState)}>
            <RotateCcw aria-hidden="true" size={14} />
            清空重填
          </button>
        </div>
        <div className="understandingRows">
          <UnderstandingRow icon="♙" label="目标国家/地区" tags={targetRegionLabels.length ? targetRegionLabels : ["全球"]} />
          <UnderstandingRow icon="◇" label="行业关键词" tags={industryTags.length ? industryTags : ["行业关键词", "应用场景"]} />
          <UnderstandingRow icon="♧" label="客户类型（根据补充说明提供）" tags={customerTypeTags} />
        </div>
      </section>

      <div className="productActions">
        <button className="primary productPrimaryAction" type="button" onClick={handleSaveAndStart}>
          <Play aria-hidden="true" size={16} />
          保存并开始找客户
        </button>
        <button className="productSecondaryAction" type="button" onClick={handleSaveOnly}>
          <Save aria-hidden="true" size={16} />
          仅保存
        </button>
        {status ? (
          <p aria-live="polite">
            <LockKeyhole aria-hidden="true" size={14} />
            {status}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function MarketMultiSelect({
  selectedValues,
  selectedLabels,
  onChange
}: {
  selectedValues: string[];
  selectedLabels: string[];
  onChange: (values: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const filteredOptions = useMemo(() => filterMarketOptions(searchText), [searchText]);
  const regionOptions = filteredOptions.filter((option) => option.group === "region");
  const countryOptions = filteredOptions.filter((option) => option.group === "country");
  const summaryText = selectedLabels.length ? `已选择 ${selectedLabels.length} 个目标市场` : "选择目标市场";

  function toggleValue(value: string) {
    const next = new Set(selectedValues);

    if (next.has(value)) {
      next.delete(value);
    } else {
      if (value === "Global") {
        next.clear();
      } else {
        next.delete("Global");
      }
      next.add(value);
    }

    onChange([...next]);
  }

  function removeValue(value: string) {
    onChange(selectedValues.filter((item) => item !== value));
  }

  return (
    <div
      className="targetMarketSelect"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="targetMarketTrigger"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{summaryText}</span>
        <ChevronDown aria-hidden="true" size={16} />
      </button>

      {selectedValues.length ? (
        <div className="targetMarketChips" aria-label="已选择目标市场">
          {selectedValues.map((value) => (
            <button key={value} type="button" onClick={() => removeValue(value)}>
              {getMarketLabel(value)}
              <X aria-hidden="true" size={12} />
            </button>
          ))}
        </div>
      ) : null}

      {isOpen ? (
        <div className="targetMarketMenu" role="listbox" aria-multiselectable="true">
          <label className="targetMarketSearch">
            <Search aria-hidden="true" size={14} />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜索国家/地区"
            />
          </label>
          <div className="targetMarketOptions">
            <MarketOptionGroup title="区域" options={regionOptions} selectedSet={selectedSet} onToggle={toggleValue} />
            <MarketOptionGroup title="国家" options={countryOptions} selectedSet={selectedSet} onToggle={toggleValue} />
            {!filteredOptions.length ? <p className="targetMarketEmpty">没有匹配项</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MarketOptionGroup({
  title,
  options,
  selectedSet,
  onToggle
}: {
  title: string;
  options: MarketOption[];
  selectedSet: Set<string>;
  onToggle: (value: string) => void;
}) {
  if (!options.length) {
    return null;
  }

  return (
    <div className="targetMarketGroup">
      <span>{title}</span>
      {options.map((option) => {
        const selected = selectedSet.has(option.value);

        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={selected}
            className={selected ? "selected" : ""}
            onClick={() => onToggle(option.value)}
          >
            <Check aria-hidden="true" size={14} />
            <strong>{option.label}</strong>
            <small>{option.value}</small>
          </button>
        );
      })}
    </div>
  );
}

function UnderstandingRow({ icon, label, tags }: { icon: string; label: string; tags: string[] }) {
  return (
    <div className="understandingRow">
      <span>{icon}</span>
      <strong>{label}</strong>
      <div>
        {tags.map((tag) => (
          <b key={tag}>{tag}</b>
        ))}
      </div>
    </div>
  );
}

function filterMarketOptions(searchText: string) {
  const normalizedSearch = searchText.trim().toLowerCase();

  if (!normalizedSearch) {
    return MARKET_OPTIONS;
  }

  return MARKET_OPTIONS.filter((option) =>
    [option.label, option.value, ...option.aliases].some((text) => text.toLowerCase().includes(normalizedSearch))
  );
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitValues(value: string) {
  return value
    .split(/[，,、;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function mergeProfileNotes(notes: string, label: string, values: string[]) {
  const cleanNotes = notes.trim();
  const cleanValues = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

  if (!cleanValues.length) {
    return cleanNotes;
  }

  return [cleanNotes, `${label}: ${cleanValues.join(", ")}`].filter(Boolean).join("\n");
}

function normalizeTargetRegionSelection(targetRegions: string[] = []) {
  const uniqueRegions = Array.from(new Set(targetRegions.map((region) => region.trim()).filter(Boolean)));
  if (uniqueRegions.length > 1) {
    return uniqueRegions.filter((region) => region.toLowerCase() !== "global");
  }

  return uniqueRegions;
}

function extractMergedNoteValues(notes: string | null | undefined, label: string) {
  const marker = `${label}:`;
  const line = (notes ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.toLowerCase().startsWith(marker.toLowerCase()));

  if (!line) {
    return [];
  }

  return line
    .slice(marker.length)
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripMergedNote(notes: string | null | undefined, label: string) {
  const marker = `${label}:`;
  return (notes ?? "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().toLowerCase().startsWith(marker.toLowerCase()))
    .join("\n")
    .trim();
}

function extractCustomerTypes(value: string) {
  const options = [
    { keyword: "经销", label: "设备经销商" },
    { keyword: "现货", label: "现货商" },
    { keyword: "系统集成", label: "系统集成商" },
    { keyword: "站点", label: "站点运维服务商" },
    { keyword: "项目交付", label: "项目交付需求" },
    { keyword: "备件", label: "备件补货需求" },
    { keyword: "微波", label: "微波回传需求" },
    { keyword: "电源", label: "电源维护需求" }
  ];
  const tags = options.filter((item) => value.includes(item.keyword)).map((item) => item.label);
  return tags.length ? tags : ["设备经销商", "现货商", "系统集成商"];
}
