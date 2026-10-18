"use client";

import { ChevronLeft, ChevronRight, Eye, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../app-shell";
import { customTemplateStorageKey, systemMailTemplates, type MailTemplate } from "../mail-templates";

type TemplateDraft = Pick<MailTemplate, "name" | "subject" | "body" | "summary">;
type CoverTone = "project" | "spare" | "repair" | "launch" | "custom";

const emptyDraft: TemplateDraft = {
  name: "",
  subject: "",
  body: "",
  summary: ""
};

const systemTemplateCoverTones: Record<string, CoverTone> = {
  "project-supply": "project",
  "spare-stock": "spare",
  "repair-service": "repair",
  "new-product": "launch"
};

const systemTemplateCoverImages: Record<string, string> = {
  "project-supply": "/images/template-covers/project-supply.webp",
  "spare-stock": "/images/template-covers/spare-stock.webp",
  "repair-service": "/images/template-covers/repair-service.webp",
  "new-product": "/images/template-covers/new-product.webp"
};

function coverToneByIndex(index: number): CoverTone {
  return (["project", "spare", "repair", "launch"] as CoverTone[])[index % 4] ?? "project";
}

function templateCoverTone(template: MailTemplate, index: number): CoverTone {
  if (template.type === "custom") return "custom";
  return systemTemplateCoverTones[template.id] ?? coverToneByIndex(index);
}

export default function TemplatesPage() {
  const [customTemplates, setCustomTemplates] = useState<MailTemplate[]>([]);
  const [activeType, setActiveType] = useState<"system" | "custom">("system");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(systemMailTemplates[0]?.id ?? "");
  const [editingTemplate, setEditingTemplate] = useState<MailTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<MailTemplate | null>(null);
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [status, setStatus] = useState("");

  const templates = activeType === "system" ? systemMailTemplates : customTemplates;
  const filteredTemplates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return templates;
    return templates.filter((template) =>
      [template.name, template.subject, template.summary].some((value) => value.toLowerCase().includes(keyword))
    );
  }, [search, templates]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(customTemplateStorageKey);
      if (stored) {
        setCustomTemplates(JSON.parse(stored) as MailTemplate[]);
      }
    } catch {
      setStatus("本地模板读取失败，请重新创建。");
    }
  }, []);

  useEffect(() => {
    if (activeType === "system") {
      setSelectedId(systemMailTemplates[0]?.id ?? "");
      return;
    }
    setSelectedId(customTemplates[0]?.id ?? "");
  }, [activeType, customTemplates]);

  function persistCustomTemplates(nextTemplates: MailTemplate[]) {
    setCustomTemplates(nextTemplates);
    window.localStorage.setItem(customTemplateStorageKey, JSON.stringify(nextTemplates));
  }

  function openCreate() {
    setEditingTemplate(null);
    setEditorOpen(true);
    setDraft({
      name: "UAE 经销商跟进模板",
      subject: "Product availability for your team",
      summary: "适用于自建经销商或现货商跟进邮件。",
      body: [
        "Dear Team,",
        "",
        "We can support products, modules, boards and spare parts for your sourcing needs.",
        "",
        "If you are checking availability for upcoming projects, please share the model list and quantity. We will reply with stock status and delivery options.",
        "",
        "Best regards,",
        "Telecorenet Sales Team"
      ].join("\n")
    });
  }

  function openEdit(template: MailTemplate) {
    if (template.type === "system") {
      setPreviewTemplate(template);
      setStatus("系统模板不可直接编辑，可预览后新建自建模板。");
      return;
    }
    setEditingTemplate(template);
    setEditorOpen(true);
    setDraft({
      name: template.name,
      subject: template.subject,
      body: template.body,
      summary: template.summary
    });
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditingTemplate(null);
    setDraft(emptyDraft);
  }

  function saveTemplate() {
    const cleanDraft = {
      name: draft.name.trim(),
      subject: draft.subject.trim(),
      summary: draft.summary.trim(),
      body: draft.body.trim()
    };
    if (!cleanDraft.name || !cleanDraft.subject || !cleanDraft.body) {
      setStatus("请填写模板名称、主题和正文。");
      return;
    }

    if (editingTemplate) {
      const nextTemplates = customTemplates.map((template) =>
        template.id === editingTemplate.id ? { ...template, ...cleanDraft } : template
      );
      persistCustomTemplates(nextTemplates);
      setSelectedId(editingTemplate.id);
      setStatus("模板已更新，邮件确认弹窗可以读取最新内容。");
    } else {
      const nextTemplate: MailTemplate = {
        id: `custom-${Date.now()}`,
        type: "custom",
        owner: "王亚伟",
        createdAt: new Date().toISOString().slice(0, 10),
        ...cleanDraft
      };
      persistCustomTemplates([nextTemplate, ...customTemplates]);
      setActiveType("custom");
      setSelectedId(nextTemplate.id);
      setStatus("自建模板已保存。");
    }

    closeEditor();
  }

  function deleteTemplate(template: MailTemplate) {
    if (template.type === "system") {
      setStatus("系统模板不能删除。");
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(`确定删除模板「${template.name}」？`)) {
      return;
    }
    const nextTemplates = customTemplates.filter((item) => item.id !== template.id);
    persistCustomTemplates(nextTemplates);
    setSelectedId(nextTemplates[0]?.id ?? "");
    setStatus(`已删除「${template.name}」。`);
  }

  return (
    <AppShell
      activePath="/templates"
      eyebrow="模板配置"
      hidePageHeader
      mainClassName="templateMain"
      pageClassName="templatePage"
      title="邮件模板"
    >
      <section className="templateShell">
        <header className="templateTopBar">
          <nav className="templateTopTabs" role="tablist" aria-label="邮件营销页面切换">
            <a className="templateTopLink" href="/campaigns">
              发邮件
            </a>
            <a className="templateTopLink" href="/campaigns">
              发送记录
            </a>
            <a className="templateTopLink active" href="/templates" aria-current="page">
              邮件模板
            </a>
          </nav>
          {status ? <p className="templateStatus" aria-live="polite">{status}</p> : null}
        </header>

        <section className="templateTablePanel">
          <header className="templateToolbar">
            <div className="templateSegmented" role="tablist" aria-label="模板类型">
              <button
                aria-selected={activeType === "system"}
                className={activeType === "system" ? "active" : ""}
                onClick={() => setActiveType("system")}
                role="tab"
                type="button"
              >
                系统模板
              </button>
              <button
                aria-selected={activeType === "custom"}
                className={activeType === "custom" ? "active" : ""}
                onClick={() => setActiveType("custom")}
                role="tab"
                type="button"
              >
                自建模板
              </button>
            </div>
            <label className="templateSearch">
              <Search aria-hidden="true" size={15} />
              <input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索模板名称 / 主题"
                value={search}
              />
            </label>
            <button className="templatePrimaryAction" data-create-template="true" onClick={openCreate} type="button">
              <Plus aria-hidden="true" size={15} />
              新建模板
            </button>
          </header>

          <div className="templateTableWrap">
            <table className="templateTable">
              <thead>
                <tr>
                  <th>模板名称</th>
                  <th>邮件主题</th>
                  <th>创建时间</th>
                  <th>创建者</th>
                  <th className="templateColAction">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredTemplates.length ? (
                  filteredTemplates.map((template) => (
                    <tr
                      className={selectedId === template.id ? "active" : ""}
                      data-template-row={template.id}
                      key={template.id}
                      onClick={() => setSelectedId(template.id)}
                    >
                      <td className="templateNameCell">
                        <strong>{template.name}</strong>
                        {template.summary ? <small>{template.summary}</small> : null}
                      </td>
                      <td className="templateSubjectCell" title={template.subject}>
                        {template.subject}
                      </td>
                      <td className="templateDateCell">{template.createdAt}</td>
                      <td className="templateOwnerCell">{template.owner}</td>
                      <td className="templateColAction">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            setPreviewTemplate(template);
                          }}
                          type="button"
                        >
                          <Eye aria-hidden="true" size={13} />
                          预览
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            openEdit(template);
                          }}
                          type="button"
                        >
                          <Pencil aria-hidden="true" size={13} />
                          {template.type === "system" ? "另存为自建" : "编辑"}
                        </button>
                        {template.type === "custom" ? (
                          <button
                            className="templateRowDanger"
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteTemplate(template);
                            }}
                            type="button"
                          >
                            <Trash2 aria-hidden="true" size={13} />
                            删除
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="templateEmpty" colSpan={5}>
                      {search ? "没有匹配的模板，换一个关键词试试。" : activeType === "custom" ? "还没有自建模板，点击右上角新建一个。" : "没有匹配的系统模板。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <footer className="templatePager">
            <span>共 {filteredTemplates.length} 条</span>
            <div className="templatePagerRight">
              <button className="templatePageSize" type="button">
                10 条/页
              </button>
              <div className="templatePageButtons">
                <button aria-label="上一页" disabled type="button">
                  <ChevronLeft aria-hidden="true" size={14} />
                </button>
                <button className="active" type="button">
                  1
                </button>
                <button aria-label="下一页" disabled type="button">
                  <ChevronRight aria-hidden="true" size={14} />
                </button>
              </div>
            </div>
          </footer>
        </section>

        <section className="templateGalleryPanel" aria-label="模板预览画廊">
          <header className="templateGalleryHead">
            <div>
              <h2>模板预览</h2>
              <p>点击卡片快速预览模板正文，适合通过封面快速识别。</p>
            </div>
          </header>
          <div className="templateCards">
            {filteredTemplates.length ? (
              filteredTemplates.map((template, index) => (
                <article
                  className={selectedId === template.id ? "active" : ""}
                  key={template.id}
                  onClick={() => {
                    setSelectedId(template.id);
                    setPreviewTemplate(template);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(template.id);
                      setPreviewTemplate(template);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <TemplateCover template={template} index={index} />
                  <h3>{template.name}</h3>
                  <p>{template.summary || template.subject}</p>
                </article>
              ))
            ) : (
              <div className="templateCardsEmpty">
                {activeType === "custom" ? "还没有自建模板，可在上方表格中点击新建。" : "没有匹配的模板。"}
              </div>
            )}
          </div>
        </section>
      </section>

      {editorOpen ? (
        <div className="templateModalBackdrop" onClick={(event) => event.target === event.currentTarget && closeEditor()}>
          <section className="templateModal" role="dialog" aria-modal="true" aria-label="编辑邮件模板">
            <header>
              <div>
                <span>{editingTemplate ? "编辑模板" : "新建模板"}</span>
                <h2>{editingTemplate ? editingTemplate.name : "自建邮件模板"}</h2>
              </div>
              <button aria-label="关闭" onClick={closeEditor} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </header>
            <label>
              <span>
                模板名称 <em>*</em>
              </span>
              <input
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="例如：UAE 经销商跟进模板"
                value={draft.name}
              />
            </label>
            <label>
              <span>
                邮件主题 <em>*</em>
              </span>
              <input
                onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
                placeholder="例如：Product availability for your team"
                value={draft.subject}
              />
            </label>
            <label>
              <span>模板说明</span>
              <input
                onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                placeholder="一句话描述什么场景适合用这个模板"
                value={draft.summary}
              />
            </label>
            <label className="templateBodyField">
              <span>
                邮件正文 <em>*</em>
              </span>
              <textarea
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                placeholder="支持 {{companyName}} {{country}} 等变量"
                value={draft.body}
              />
            </label>
            <footer>
              <button onClick={closeEditor} type="button">
                取消
              </button>
              <button className="primary" data-save-template="true" onClick={saveTemplate} type="button">
                保存模板
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {previewTemplate ? (
        <div
          className="templateModalBackdrop"
          onClick={(event) => event.target === event.currentTarget && setPreviewTemplate(null)}
        >
          <section className="templateModal templatePreviewModal" role="dialog" aria-modal="true" aria-label="预览邮件模板">
            <header>
              <div>
                <span>预览模板</span>
                <h2>{previewTemplate.name}</h2>
              </div>
              <button aria-label="关闭预览" onClick={() => setPreviewTemplate(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </header>
            <div className="templatePreviewSubject">{previewTemplate.subject}</div>
            <pre>{previewTemplate.body}</pre>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}

function TemplateCover({ template, index }: { template: MailTemplate; index: number }) {
  const coverImage = template.type === "system" ? systemTemplateCoverImages[template.id] : undefined;
  if (coverImage) {
    return (
      <div className="mailTemplateCover mailTemplateCoverImage" aria-hidden="true">
        <img alt="" src={coverImage} />
      </div>
    );
  }

  const tone = templateCoverTone(template, index);
  return (
    <div className={`mailTemplateCover mailTemplateCover-${tone}`} aria-hidden="true">
      <div className="mailTemplateCoverTop">
        <span />
        <span />
        <span />
      </div>
      <div className="mailTemplateCoverMain">
        <i />
        <i />
        <i />
        <em />
      </div>
      <div className="mailTemplateCoverPanel">
        <span />
        <span />
        <span />
      </div>
      <b />
    </div>
  );
}
