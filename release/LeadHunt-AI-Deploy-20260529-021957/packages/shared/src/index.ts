export const productName = "LeadHunt AI";

export const appNavigation = [
  { label: "AI 外贸员", href: "/", icon: "Bot" },
  { label: "数据看板", href: "/dashboard", icon: "BarChart3" },
  { label: "我的产品画像", href: "/product-profile", icon: "PackageSearch" },
  { label: "客户画像", href: "/customer-profile", icon: "ContactRound" },
  { label: "模板配置", href: "/templates", icon: "FileText" },
  { label: "邮件营销", href: "/campaigns", icon: "Send" },
  { label: "个人邮箱", href: "/mailbox", icon: "Mail" },
  { label: "邮寄宣传册", href: "/brochures", icon: "Truck" },
  { label: "我的客户", href: "/customers", icon: "Boxes" }
] as const;

export type AppNavigationItem = (typeof appNavigation)[number];

export const healthCheckPath = "/health";
