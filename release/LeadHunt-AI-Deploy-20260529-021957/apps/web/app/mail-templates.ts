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
    subject: "Reliable project supply support for {{companyName}}",
    owner: "系统",
    createdAt: "2026-04-27",
    summary: "适用于向系统集成商介绍整体项目供货能力。",
    body: [
      "Dear Procurement Team,",
      "",
      "I noticed {{companyName}} is active in relevant projects in {{country}}. We can support product supply, spare parts and urgent replacement needs based on your project or maintenance requirements.",
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
    subject: "Spare parts and product availability",
    owner: "系统",
    createdAt: "2026-04-27",
    summary: "适用于向经销商推荐现货备件与快速交付能力。",
    body: [
      "Dear Team,",
      "",
      "We are a China-based supplier with available products, modules, components and replacement parts for urgent maintenance and stock replenishment.",
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
    subject: "Module repair and replacement support",
    owner: "系统",
    createdAt: "2026-04-27",
    summary: "适用于设备故障维修与维护服务的专业沟通。",
    body: [
      "Dear Maintenance Team,",
      "",
      "We can support module replacement and repair sourcing for maintenance teams, including core products, modules, boards and related parts.",
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
    subject: "New supply options for your market",
    owner: "系统",
    createdAt: "2026-04-27",
    summary: "适用于新产品发布与市场推广的邮件沟通。",
    body: [
      "Dear Team,",
      "",
      "We are expanding supply options for products and spare parts used in projects, maintenance and regional distribution.",
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
