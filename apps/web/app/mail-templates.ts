export type MailTemplateType = "system" | "custom";

export type MailTemplate = {
  id: string;
  type: MailTemplateType;
  name: string;
  subject: string;
  body: string;
  owner: string;
  createdAt: string;
  summary: string;
};

export const customTemplateStorageKey = "leadhunt.customMailTemplates.v1";

export const systemMailTemplates: MailTemplate[] = [
  {
    id: "project-supply",
    type: "system",
    name: "项目供货模板",
    subject: "Reliable telecom equipment supply support for {{companyName}}",
    owner: "系统",
    createdAt: "2026-04-27",
    summary: "适用于向系统集成商介绍整体项目供货能力。",
    body: [
      "Dear Procurement Team,",
      "",
      "I noticed {{companyName}} is active in telecom infrastructure projects in {{country}}. Telecorenet can support Huawei, ZTE, Ericsson and Nokia RRU, BBU, microwave backhaul, telecom power and spare parts supply for full project kits or urgent replacement needs.",
      "",
      "We can provide multi-brand equipment, tested modules, boards, power systems and replacement parts with flexible supply options for both complete solutions and single-item purchasing.",
      "",
      "Would you be open to reviewing our current availability list for your upcoming projects or maintenance requirements?",
      "",
      "Best regards,",
      "Telecorenet Sales Team"
    ].join("\n")
  },
  {
    id: "spare-stock",
    type: "system",
    name: "备件现货模板",
    subject: "Multi-brand RRU / BBU / spare parts availability",
    owner: "系统",
    createdAt: "2026-04-27",
    summary: "适用于向经销商推荐现货备件与快速交付能力。",
    body: [
      "Dear Team,",
      "",
      "We are a China-based telecom equipment supplier with available RRU, BBU, power modules, boards and replacement parts for urgent maintenance and stock replenishment.",
      "",
      "If {{companyName}} is currently sourcing spare parts for {{country}}, we can share an availability list and support fast confirmation on model, condition and delivery time.",
      "",
      "Best regards,",
      "Telecorenet Sales Team"
    ].join("\n")
  },
  {
    id: "repair-service",
    type: "system",
    name: "售后维修模板",
    subject: "Telecom module repair and replacement support",
    owner: "系统",
    createdAt: "2026-04-27",
    summary: "适用于设备故障维修与维护服务的专业沟通。",
    body: [
      "Dear Maintenance Team,",
      "",
      "Telecorenet can support telecom module replacement and repair sourcing for network maintenance teams, including radio units, power modules, boards and related parts.",
      "",
      "If you have failed units or urgent replacement needs, please share model numbers and quantities. We can check suitable supply or repair options.",
      "",
      "Best regards,",
      "Telecorenet Sales Team"
    ].join("\n")
  },
  {
    id: "new-product",
    type: "system",
    name: "新品推广模板",
    subject: "New telecom equipment supply options for your market",
    owner: "系统",
    createdAt: "2026-04-27",
    summary: "适用于新产品发布与市场推广的邮件沟通。",
    body: [
      "Dear Team,",
      "",
      "We are expanding supply options for telecom equipment and spare parts used in 4G/5G projects, maintenance and regional distribution.",
      "",
      "If {{companyName}} is evaluating new suppliers, we can share a focused product list based on your market and common project needs in {{country}}.",
      "",
      "Best regards,",
      "Telecorenet Sales Team"
    ].join("\n")
  }
];

export function renderMailTemplate(template: MailTemplate, variables: Record<string, string>) {
  return {
    subject: renderTemplateText(template.subject, variables),
    body: renderTemplateText(template.body, variables)
  };
}

function renderTemplateText(value: string, variables: Record<string, string>) {
  return value.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? "");
}
