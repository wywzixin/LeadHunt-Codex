"use client";

import type { ChangeEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe2, LockKeyhole, Play, RotateCcw, Save, Sparkles, UploadCloud } from "lucide-react";

type ProductProfileState = {
  productLinksText: string;
  keywords: string;
  documentUrlsText: string;
  notes: string;
};

const initialState: ProductProfileState = {
  productLinksText: "https://telecorenet.com/\nhttps://telecorenet.com/products",
  keywords: "product category, core product, spare parts, components, equipment",
  documentUrlsText: "",
  notes:
    "我们主要做某类产品及相关备件，支持整套项目供货，也能单卖核心产品、板卡、备件和模块。部分产品有现货，可支持紧急补货。"
};

const guideItems = [
  {
    icon: Globe2,
    title: "填写官网或产品页",
    text: "让 AI 读取你的独立站、产品目录和主营产品范围"
  },
  {
    icon: UploadCloud,
    title: "补充产品资料",
    text: "可补充产品目录、库存表、报价表、产品图片或资料链接"
  },
  {
    icon: Sparkles,
    title: "说明产品优势",
    text: "补充官网没有写清楚的品牌范围、现货能力、供货场景和适用客户"
  }
];

export function ProductProfileForm() {
  const router = useRouter();
  const [form, setForm] = useState<ProductProfileState>(initialState);
  const [documentFileNames, setDocumentFileNames] = useState<string[]>([]);
  const [status, setStatus] = useState("");

  const productLinks = useMemo(() => splitLines(form.productLinksText), [form.productLinksText]);
  const documentUrls = useMemo(() => splitLines(form.documentUrlsText), [form.documentUrlsText]);
  const keywordTags = useMemo(() => splitTags(form.keywords), [form.keywords]);
  const brandTags = useMemo(() => extractBrands(form.notes), [form.notes]);
  const advantageTags = useMemo(() => extractAdvantages(form.notes), [form.notes]);

  useEffect(() => {
    let cancelled = false;

    async function loadSavedProfile() {
      try {
        const response = await fetch("/api/profiles/product", { credentials: "include" });
        if (!response.ok) return;
        const profile = (await response.json()) as {
          websiteUrl?: string | null;
          productPageUrl?: string | null;
          documentUrls?: string[] | null;
          notes?: string | null;
        } | null;
        if (!profile || cancelled) return;

        const extractedKeywords = extractMergedNoteValues(profile.notes, "Product keywords");
        setForm({
          productLinksText: [profile.websiteUrl, profile.productPageUrl].filter(Boolean).join("\n") || initialState.productLinksText,
          keywords: extractedKeywords.length ? extractedKeywords.join(", ") : initialState.keywords,
          documentUrlsText: (profile.documentUrls ?? []).join("\n"),
          notes: stripMergedNote(profile.notes, "Product keywords") || initialState.notes
        });
      } catch {
        // Keep defaults if loading fails.
      }
    }

    void loadSavedProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(field: keyof ProductProfileState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateDocumentFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).map((file) => file.name);
    setDocumentFileNames(files);
  }

  async function persistProfile() {
    const response = await fetch("/api/profiles/product", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        websiteUrl: productLinks[0] ?? "",
        productPageUrl: productLinks[1],
        documentUrls,
        notes: mergeProfileNotes(form.notes, "Product keywords", keywordTags)
      })
    });

    return response.ok;
  }

  async function handleSaveOnly() {
    setStatus("保存中...");
    try {
      const ok = await persistProfile();
      setStatus(ok ? "已保存。AI 外贸员会在后续任务中读取这份产品画像。" : "保存失败，请检查链接格式或登录状态。");
    } catch {
      setStatus("网络异常，稍后重试。");
    }
  }

  async function handleSaveAndStart() {
    setStatus("保存中，并准备进入 AI 外贸员...");
    try {
      const ok = await persistProfile();
      if (!ok) {
        setStatus("保存失败，请检查链接格式或登录状态。");
        return;
      }
      setStatus("已保存，正在进入 AI 外贸员开始找客户...");
      router.push("/");
    } catch {
      setStatus("网络异常，稍后重试。");
    }
  }

  return (
    <section className="productProfileShell">
      <header className="productProfileHeader">
        <h1>产品画像</h1>
        <p>告诉 AI 外贸员你卖什么产品，系统会在找客户、写邮件和生成营销内容时使用这些资料。</p>
      </header>

      <section className="productGuide">
        <h2>这个功能是做什么的？</h2>
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
          AI 会基于这些信息生成产品画像，并用于后续找客户与营销内容生成。
        </p>
      </section>

      <section className="productFormCard">
        <aside className="productSteps" aria-label="产品画像填写步骤">
          <StepItem index={1} title="产品基础信息" text="先告诉 AI 你的官网、产品页或主营产品范围" />
          <StepItem index={2} title="补充资料" text="上传资料或导入库存记录，帮助 AI 更准确理解产品能力" />
          <StepItem index={3} title="补充说明" text="补充官网看不出来的优势、现货能力、品牌范围和适用场景" />
        </aside>

        <div className="productFields">
          <label className="productField productLinksField">
            <span>官网 / 产品页链接 *</span>
            <textarea
              value={form.productLinksText}
              onChange={(event) => updateField("productLinksText", event.target.value)}
              placeholder="https://your-domain.com&#10;https://your-domain.com/products"
            />
            <small>建议填写官网首页或核心产品页，AI 会优先读取这些信息。</small>
          </label>

          <label className="productField">
            <span>主营产品关键词（可选）</span>
            <textarea
              value={form.keywords}
              onChange={(event) => updateField("keywords", event.target.value)}
              placeholder="核心产品、备件、模块、材料、设备类别"
            />
          </label>

          <label className="productField productUploadField">
            <span>上传资料（可选）</span>
            <div className="productUploadBox">
              <input type="file" multiple onChange={updateDocumentFiles} />
              <UploadCloud aria-hidden="true" size={21} />
              <strong>点击上传或拖拽文件到此处</strong>
              <small>支持产品目录、库存表、报价表、产品图片</small>
            </div>
            {documentFileNames.length ? <small>已选择：{documentFileNames.join(", ")}</small> : null}
          </label>

          <label className="productField">
            <span>资料链接（可选，每行一个）</span>
            <textarea
              value={form.documentUrlsText}
              onChange={(event) => updateField("documentUrlsText", event.target.value)}
              placeholder="https://your-domain.com/catalog.pdf"
            />
          </label>

          <label className="productField productNotesField">
            <span>补充说明（可选）</span>
            <textarea
              value={form.notes}
              onChange={(event) => updateField("notes", event.target.value)}
              placeholder="例如：我们主要做某类产品及备件，支持项目供货、现货补货和定制需求..."
            />
            <small>{form.notes.length} / 4000</small>
          </label>
        </div>
      </section>

      <section className="productUnderstanding">
        <div className="productUnderstandingHead">
          <h2>
            <Sparkles aria-hidden="true" size={18} />
            AI 将这样理解你的产品画像
          </h2>
          <button type="button" onClick={() => setForm(initialState)}>
            <RotateCcw aria-hidden="true" size={14} />
            清空重填
          </button>
        </div>
        <div className="understandingRows">
          <UnderstandingRow icon="◆" label="核心产品" tags={keywordTags.length ? keywordTags : ["equipment", "spare parts", "components"]} />
          <UnderstandingRow icon="◇" label="支持品牌" tags={brandTags} />
          <UnderstandingRow icon="●" label="产品优势" tags={advantageTags} />
        </div>
      </section>

      <div className="profileActionTips" aria-label="保存方式说明">
        <span>
          <b>保存并开始找客户</b>：保存产品画像后进入 AI 外贸员，用最新资料启动找客户流程。
        </span>
        <span>
          <b>仅保存</b>：只更新产品画像，停留在当前页面，不创建找客户任务。
        </span>
      </div>

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

function StepItem({ index, title, text }: { index: number; title: string; text: string }) {
  return (
    <div className="productStep">
      <span>{index}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
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

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitTags(value: string) {
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function mergeProfileNotes(notes: string, label: string, values: string[]) {
  const cleanNotes = notes.trim();
  const cleanValues = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  if (!cleanValues.length) return cleanNotes;
  return [cleanNotes, `${label}: ${cleanValues.join(", ")}`].filter(Boolean).join("\n");
}

function extractMergedNoteValues(notes: string | null | undefined, label: string) {
  const marker = `${label}:`;
  const line = (notes ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.toLowerCase().startsWith(marker.toLowerCase()));
  if (!line) return [];
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

function extractBrands(value: string) {
  const brands = ["Huawei", "ZTE", "Ericsson", "Nokia", "Eltek", "Alcatel-Lucent"].filter((brand) =>
    value.toLowerCase().includes(brand.toLowerCase())
  );
  return brands.length ? brands : ["Huawei", "ZTE", "Ericsson", "Nokia"];
}

function extractAdvantages(value: string) {
  const options = [
    { keyword: "整套", label: "整套项目供货" },
    { keyword: "现货", label: "现货支持" },
    { keyword: "备件", label: "备件补货" },
    { keyword: "紧急", label: "紧急交付" },
    { keyword: "品牌", label: "多品牌兼容" }
  ];
  const tags = options.filter((item) => value.includes(item.keyword)).map((item) => item.label);
  return tags.length ? tags : ["整套项目供货", "现货支持", "备件补货"];
}
