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

export default function TemplatesPage() {
  const [customTemplates, setCustomTemplates] = useState<MailTemplate[]>([]);
  const [activeType, setActiveType] = useState<"system" | "custom">("system");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(systemMailTemplates[0]?.id ?? "");
  const [editingTemplate, setEditingTemplate] = useState<MailTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<MailTemplate | null>(null);
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft);
  const [status, setStatus] = useState("系统模板可直接用于邮件生成，自建模板会保存在本机开发环境。");

  const templates = activeType === "system" ? systemMailTemplates : customTemplates;
  const cardTemplates = activeType === "system" ? systemMailTemplates : customTemplates;
  const filteredTemplates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return templates;
    return templates.filter((template) =>
      [template.name, template.subject, template.summary].some((value) => value.toLowerCase().includes(keyword))
    );
  }, [search, templates]);
  const selectedTemplate = [...systemMailTemplates, ...customTemplates].find((template) => template.id === selectedId);

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
    setDraft({
      name: "UAE 经销商跟进模板",
      subject: "Telecom spare parts availability for your team",
      summary: "适用于自建经销商或现货商跟进邮件。",
      body: [
        "Dear Team,",
        "",
        "Telecorenet can support RRU, BBU, power modules, boards and spare parts for your telecom equipment sourcing needs.",
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
    setDraft({
      name: template.name,
      subject: template.subject,
      body: template.body,
      summary: template.summary
    });
  }

  function closeEditor() {
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
      setStatus("自建模板已保存，邮件确认弹窗可以选择使用。");
    }

    setEditingTemplate(null);
    setDraft(emptyDraft);
  }

  function deleteSelectedTemplate() {
    const template = customTemplates.find((item) => item.id === selectedId);
    if (!template) {
      setStatus("系统模板不能删除，请切换到自建模板后再删除。");
      return;
    }
    const nextTemplates = customTemplates.filter((item) => item.id !== selectedId);
    persistCustomTemplates(nextTemplates);
    setSelectedId(nextTemplates[0]?.id ?? "");
    setStatus("自建模板已删除。");
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
        <header className="templateTop">
          <nav className="templatePrimaryTabs" aria-label="邮件模板页面切换">
            <a href="/campaigns">发送记录</a>
            <a href="/campaigns">发邮件</a>
            <a className="active" href="/templates">
              邮件模板
            </a>
          </nav>
          <div className="templateTopActions">
            <button className="templateCreate" type="button" data-create-template="true" onClick={openCreate}>
              <Plus aria-hidden="true" size={16} />
              新建模板
            </button>
            <button className="templateDelete" type="button" onClick={deleteSelectedTemplate}>
              <Trash2 aria-hidden="true" size={16} />
              删除模板
            </button>
          </div>
        </header>

        <section className="templateTablePanel">
          <div className="templateToolbar">
            <div className="templateSegmented">
              <button className={activeType === "system" ? "active" : ""} type="button" onClick={() => setActiveType("system")}>
                系统模板
              </button>
              <button className={activeType === "custom" ? "active" : ""} type="button" onClick={() => setActiveType("custom")}>
                自建模板
              </button>
            </div>
            <label className="templateSearch">
              <Search aria-hidden="true" size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索模板名称 / 主题" />
            </label>
          </div>

          <div className="templateTable">
            <div className="templateTableHead">
              <span />
              <span>模板名称</span>
              <span>模板主题</span>
              <span>创建时间</span>
              <span>创建用户</span>
              <span>操作</span>
            </div>
            {filteredTemplates.map((template) => (
              <div className="templateTableRow" key={template.id} data-template-row={template.id}>
                <label>
                  <input
                    checked={selectedId === template.id}
                    onChange={() => setSelectedId(template.id)}
                    type="checkbox"
                  />
                </label>
                <strong>{template.name}</strong>
                <span>{template.subject}</span>
                <span>{template.createdAt}</span>
                <span>{template.owner}</span>
                <div>
                  <button type="button" onClick={() => openEdit(template)}>
                    <Pencil aria-hidden="true" size={14} /> 编辑
                  </button>
                  <button type="button" onClick={() => setPreviewTemplate(template)}>
                    <Eye aria-hidden="true" size={14} /> 预览
                  </button>
                </div>
              </div>
            ))}
            {!filteredTemplates.length ? <div className="templateEmpty">当前没有匹配的模板。</div> : null}
            <footer className="templateTableFooter">
              <span>共 {filteredTemplates.length} 条</span>
              <button type="button">10 条 / 页</button>
              <div>
                <button aria-label="上一页" disabled type="button">
                  <ChevronLeft aria-hidden="true" size={16} />
                </button>
                <button className="active" type="button">
                  1
                </button>
                <button aria-label="下一页" disabled type="button">
                  <ChevronRight aria-hidden="true" size={16} />
                </button>
              </div>
            </footer>
          </div>
        </section>

        <section className="templatePreviewPanel">
          <div className="templatePreviewHead">
            <div>
              <h2>邮件生成模板库</h2>
              <p aria-live="polite">{status}</p>
            </div>
            <button type="button" onClick={() => selectedTemplate && setPreviewTemplate(selectedTemplate)}>
              <Eye aria-hidden="true" size={15} /> 预览选中模板
            </button>
          </div>
          <div className="templateMiniTabs">
            <button className={activeType === "system" ? "active" : ""} type="button" onClick={() => setActiveType("system")}>
              系统模板
            </button>
            <button className={activeType === "custom" ? "active" : ""} type="button" onClick={() => setActiveType("custom")}>
              个人模板
            </button>
          </div>
          <div className="templateCards">
            {cardTemplates.map((sample, index) => (
              <article
                className={selectedId === sample.id ? "active" : ""}
                key={sample.id}
                onClick={() => setSelectedId(sample.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedId(sample.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <TemplateCover template={sample} index={index} />
                <h3>{sample.name}</h3>
                <p>{sample.summary}</p>
              </article>
            ))}
            {!cardTemplates.length ? <div className="templateCardsEmpty">还没有个人模板，点击右上角新建一个。</div> : null}
          </div>
        </section>
      </section>

      {draft.name || editingTemplate ? (
        <div className="templateModalBackdrop">
          <section className="templateModal" role="dialog" aria-modal="true" aria-label="编辑邮件模板">
            <header>
              <div>
                <span>{editingTemplate ? "编辑模板" : "新建模板"}</span>
                <h2>{editingTemplate ? editingTemplate.name : "自建邮件模板"}</h2>
              </div>
              <button type="button" aria-label="关闭" onClick={closeEditor}>
                <X aria-hidden="true" size={18} />
              </button>
            </header>
            <label>
              <span>模板名称</span>
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label>
              <span>邮件主题</span>
              <input value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} />
            </label>
            <label>
              <span>模板说明</span>
              <input value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
            </label>
            <label className="templateBodyField">
              <span>邮件正文</span>
              <textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
            </label>
            <footer>
              <button type="button" onClick={closeEditor}>
                取消
              </button>
              <button className="primary" type="button" data-save-template="true" onClick={saveTemplate}>
                保存模板
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {previewTemplate ? (
        <div className="templateModalBackdrop">
          <section className="templateModal templatePreviewModal" role="dialog" aria-modal="true" aria-label="预览邮件模板">
            <header>
              <div>
                <span>预览模板</span>
                <h2>{previewTemplate.name}</h2>
              </div>
              <button type="button" aria-label="关闭预览" onClick={() => setPreviewTemplate(null)}>
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
  const tone = template.type === "custom" ? "custom" : systemTemplateCoverTones[template.id] ?? coverToneByIndex(index);
  return (
    <div className={`templateCover templateCover-${tone}`} aria-hidden="true">
      <div className="templateCoverTop">
        <span />
        <span />
        <span />
      </div>
      <div className="templateCoverMain">
        <i />
        <i />
        <i />
        <em />
      </div>
      <div className="templateCoverPanel">
        <span />
        <span />
        <span />
      </div>
      <b />
    </div>
  );
}

function coverToneByIndex(index: number): CoverTone {
  return (["project", "spare", "repair", "launch"] as CoverTone[])[index % 4] ?? "project";
}
