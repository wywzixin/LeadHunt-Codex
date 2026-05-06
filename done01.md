# LeadHunt AI 已完成工作记录

更新时间：2026-04-30 10:55 +08:00

说明：本文件用于防止中途断开后丢失上下文。之后每完成一个页面、接口或关键测试，都会追加更新。本文档只记录进度、文件和验证结果，不记录数据库密码、Redis 密码、API Key、OAuth Client Secret 等敏感信息。

## 当前环境

- 本地代码目录：`E:\money\LeadHunt-Codex`
- Web：`http://localhost:3000`
- API：`http://localhost:4000`
- 浏览器验证：Chrome DevTools Protocol `127.0.0.1:9222`
- 真实 CSS 视口口径：`1707x932`，按 100% 页面宽高验证，不允许外层滚动条
- 数据库策略：代码在本地开发，PostgreSQL / Redis 在远程服务器，`.env` 本地连接远程服务

## 已完成

### 1. 服务器数据库环境

- 远程服务器 Docker / Docker Compose 已由远程 Codex 安装。
- PostgreSQL 容器已启动并健康。
- Redis 容器已启动并健康。
- 本地 `.env` 已按远程 PostgreSQL / Redis 连接方式配置。
- 注意：真实密码只保存在环境文件和服务器文件中，不写入本文档。

### 2. 后端基础链路

- Auth 登录链路已可用于本地开发账号。
- Nest 在 `tsx watch` 下的 DI 元数据问题已修复，关键 Controller / Service 已补显式 `@Inject(...)`。
- Prisma migration 状态已检查，远程开发库可用。
- 全仓关键后端测试曾通过，包括 Auth、Profiles、Search、Agent、Gmail、CRM 相关测试。

### 3. Gmail OAuth / 邮件 / CRM 同步

- Gmail OAuth 后端接口已实现。
- Refresh Token 加密保存和撤销授权已实现。
- Gmail 草稿、发送、AI 改写接口已实现。
- 邮件发送后同步客户到 CRM 的逻辑已实现。
- CRM lead 查询、同步、阶段事件、3 天后跟进任务已实现。

### 4. CRM Analytics / 数据看板

- 新增 `GET /api/crm/analytics?range=all|month|week|day`。
- `/dashboard` 已按 `design/数据面板.png` 重构。
- 数据看板已接入真实 CRM / 搜索 / 邮件统计聚合。
- 已通过 CDP 9222 在 `1707x932` 视口验证无外层滚动条。
- 截图：`tmp/dashboard-analytics-design-aligned-100-percent.png`

### 5. 我的客户

- `/customers` 已按 `design/我的客户.png` 重构。
- 已接入真实 `GET /api/crm/leads` 数据。
- 公司 / 联系人切换、统计、阶段展示可用。
- 已通过 CDP 9222 在 `1707x932` 视口验证无外层滚动条。
- 截图：`tmp/customers-design-aligned-100-percent.png`

### 6. 登录 / AI 外贸员首页 / 邮件确认弹窗

- `/login` 已按登录原型重构，重点修复用户反馈的 100% 宽高和外层滚动问题。
- AI 外贸员首页已按主系统原型重构。
- AI 外贸员邮件确认弹窗已按 `design/leadhunt-ai-project-email-modal.html` 对齐。
- 已生成对应截图：
  - `tmp/login-current-100-percent-final.png`
  - `tmp/home-current-100-percent.png`
  - `tmp/mail-modal-current-100-percent.png`

### 7. 产品画像

- `/product-profile` 已按 `design/产品画像.png` 重构。
- 页面保留资料保存职责，不在页面直接展示 AI 推理结果。
- 保存接口沿用 `PUT /api/profiles/product`。
- 已通过浏览器保存测试和 CDP 9222 视口验证。
- 截图：`tmp/product-profile-design-aligned-100-percent.png`

### 8. 客户画像

- `/customer-profile` 已按 `design/客户画像.png` 重构。
- 页面保留资料保存职责，不在页面直接展示 AI 推理结果。
- 保存接口沿用 `PUT /api/profiles/customer`。
- 已通过浏览器保存测试和 CDP 9222 视口验证。
- 截图：`tmp/customer-profile-design-aligned-100-percent.png`

### 9. 模板配置

- `/templates` 已按 `design/模板配置.png` 重构。
- 已实现系统模板 / 自建模板入口、搜索框、模板表格和模板卡片展示。
- 当前真实新增 / 编辑 / 预览 / 邮件读取模板还未接后端，已在 `Task.md` 和 `Test_Report.md` 标为后续项。
- 已通过 Web lint / typecheck 和 CDP 9222 视口验证。
- 截图：`tmp/templates-design-aligned-100-percent.png`

### 10. 邮件营销

- `/campaigns` 已按 `design/邮件营销.png` 重构。
- 已实现发件表单、邮件编辑器、AI 改写面板和弱化发邮件入口。
- 当前真实发信主链路仍以 AI 外贸员邮件确认弹窗为准，本页发送和改写按钮暂未接真实接口。
- 已通过 Web lint / typecheck 和 CDP 9222 视口验证。
- 截图：`tmp/campaigns-design-aligned-100-percent.png`

### 11. 个人邮箱

- `/mailbox` 已按 `design/个人邮箱.png` 重构。
- 保留真实 Gmail 授权状态读取、开始授权、撤销授权接口。
- 当前开发账号如果未连接 Gmail，会显示未授权状态；OAuth 按钮入口保留。
- 已通过 Web lint / typecheck 和 CDP 9222 视口验证。
- 截图：`tmp/mailbox-design-aligned-100-percent.png`

### 12. 邮寄宣传册

- `/brochures` 已按 `design/邮寄宣传册.png` 从旧占位页重构为邮寄宣传册任务工作台。
- 页面包含二级导航、时间筛选、4 个统计卡、5 步创建任务进度、任务名称、收件人、国家 / 规格选择和上传区域。
- V1 仅作为低优先级静态入口，不接入 AI 外贸员主流程。
- 已完成页面代码和 CSS：
  - `apps/web/app/brochures/page.tsx`
  - `apps/web/app/globals.css`
- 已通过 Web lint / typecheck 和 CDP 9222 视口验证。
- CDP 9222 验证结果：`1707x932` 视口下 `overflowX=0`、`overflowY=0`，统计卡 4 个、步骤 5 个、二级导航 5 个。
- 截图：`tmp/brochures-design-aligned-100-percent.png`

### 13. 注册和忘记密码页面复测

- `/register` 已按 `design/注册页面.png` 复测，当前 100% 视口无外层滚动条。
- `/forgot-password` 已按 `design/忘记密码.png` 复测，当前 100% 视口无外层滚动条。
- CDP 9222 验证结果：
  - `/register`：`1707x932` 视口下 `overflowX=0`、`overflowY=0`，4 个输入框、4 个左侧卖点。
  - `/forgot-password`：`1707x932` 视口下 `overflowX=0`、`overflowY=0`，1 个邮箱输入框、4 个左侧卖点。
- 截图：
  - `tmp/register-current-100-percent.png`
  - `tmp/forgot-current-100-percent.png`

### 14. 线索中心缺失路由补齐

- 新增共享页面组件：`apps/web/app/lead-center-page.tsx`
- 新增四个导航入口页面：
  - `apps/web/app/lead-search/page.tsx`
  - `apps/web/app/icp/page.tsx`
  - `apps/web/app/qualified-customers/page.tsx`
  - `apps/web/app/google-commands/page.tsx`
- 新增样式：`apps/web/app/globals.css` 中的 `.leadCenter*` 页面样式。
- 四个入口现在都能正常打开，不再 404：
  - `/lead-search`
  - `/icp`
  - `/qualified-customers`
  - `/google-commands`
- 已通过 Web lint / typecheck。
- 已通过全仓 `pnpm build`，生产构建路由清单包含四个新页面。
- CDP 9222 验证结果：四个页面在 `1707x932` 视口下均为 `overflowX=0`、`overflowY=0`，每页 4 个统计卡、3 个说明卡、3 条表格样例。
- 截图：
  - `tmp/lead-search-100-percent.png`
  - `tmp/icp-100-percent.png`
  - `tmp/qualified-customers-100-percent.png`
  - `tmp/google-commands-100-percent.png`

### 15. 全页面 100% 视口外层滚动扫描

- 使用 Chrome DevTools Protocol 9222 批量打开当前 16 个实际页面：
  - `/login`
  - `/register`
  - `/forgot-password`
  - `/`
  - `/product-profile`
  - `/customer-profile`
  - `/lead-search`
  - `/icp`
  - `/qualified-customers`
  - `/google-commands`
  - `/templates`
  - `/campaigns`
  - `/mailbox`
  - `/brochures`
  - `/customers`
  - `/dashboard`
- 检查结果：16 个页面在 `1707x932` 真实 CSS 视口下均为 `overflowX=0`、`overflowY=0`。
- 这轮扫描确认当前页面不会再出现登录页那种浏览器级横向或纵向滚动条问题。

### 16. CRM 数据查看弹窗

- 已完成 `Task.md` 2.14 CRM 数据查看弹窗。
- 修改文件：
  - `apps/web/app/ai-worker-client.tsx`
  - `apps/web/app/globals.css`
  - `Task.md`
  - `Test_Report.md`
  - `done01.md`
- AI 外贸员首页新增 CRM 同步预览卡片，包含待同步客户、ICP 高分客户、跟进提醒和 3 条缩略客户记录。
- 点击 CRM 缩略表或 `查看 CRM 数据` 后会打开当前页面遮罩弹窗，不跳转 `/customers`。
- 弹窗字段覆盖：公司名称、国家、行业、电话、邮箱、数据来源、AI 标签、客户阶段、负责人、评分。
- 弹窗分页已完成：第一页 3 条，第二页 2 条，支持上一页 / 下一页 / 页码和关闭。
- 已通过：
  - `pnpm --filter @leadhunt/web typecheck`
  - `pnpm --filter @leadhunt/web lint`
  - `pnpm build`
  - Chrome DevTools Protocol 9222 真实视口验证
  - 本次改动文件敏感字段扫描，无密钥命中
- CDP 9222 验证结果：
  - 首页 `1707x932` 视口下 `overflowX=0`、`overflowY=0`。
  - 弹窗打开后 `overflowX=0`、`overflowY=0`。
  - 弹窗第一页 3 条，第二页 2 条，关闭后 `.crmDataModal` 不存在。
- 截图：`tmp/ai-crm-modal-100-percent.png`

### 17. Gmail 回复同步和跟进闭环

- 已完成 `Task.md` 2.15 回复和跟进闭环，并补齐 `Task.md` 3.4 的 `POST /api/gmail/sync`。
- 修改文件：
  - `apps/api/src/gmail/gmail-message.service.ts`
  - `apps/api/src/gmail/gmail.controller.ts`
  - `apps/api/src/gmail/gmail-message.service.spec.ts`
  - `apps/api/src/gmail/gmail.controller.spec.ts`
  - `Task.md`
  - `Test_Report.md`
  - `done01.md`
- Gmail 发信成功后现在会保存 Gmail `threadId` 到 `inbox_threads`，用于后续回复同步。
- 新增 `POST /api/gmail/sync`，支持同步全部线程或指定 `threadId`。
- 新增可配置后台轮询：设置 `GMAIL_SYNC_INTERVAL_MS >= 60000` 时自动同步所有已授权 Gmail 用户；默认关闭。
- 同步逻辑会：
  - 拉取 Gmail thread。
  - 跳过本账号发出的消息。
  - 新回复写入 `inbound_messages`。
  - 调用 AI 回复分类，失败时用本地规则兜底。
  - 写入 `reply_classifications`。
  - 根据分类更新 CRM 阶段并写入 `lead_stage_events`。
  - 为高意向、报价、目录、自动回复等创建对应跟进任务。
  - 拒绝 / 退订取消待处理跟进，避免继续触达。
  - 写入 `campaign_analytics`。
- 已通过：
  - `pnpm --filter @leadhunt/api typecheck`
  - `pnpm --filter @leadhunt/api test -- src/gmail`，5 个文件 29 条测试通过。
  - `pnpm --filter @leadhunt/api lint`
  - `pnpm --filter @leadhunt/api build`
  - `pnpm build`
  - 远程 PostgreSQL 真实写入 / 读取 / 级联删除冒烟。
- 真实库冒烟结果：`newReplies=1`、`classifiedReplies=1`、`followupsCreated=1`、`stageEventsWritten=1`、`analyticsWritten=1`，CRM 阶段更新为 `catalog_requested`。
- 本次敏感字段扫描无真实密钥；只出现源码中的 Google OAuth secret 环境变量读取和 OAuth 标准参数名。

### 18. 模板配置 CRUD 和邮件模板选择

- 已完成 `Task.md` 2.17 模板配置。
- 修改文件：
  - `apps/web/app/mail-templates.ts`
  - `apps/web/app/templates/page.tsx`
  - `apps/web/app/mail-confirmation-modal.tsx`
  - `apps/web/app/globals.css`
  - `Task.md`
  - `Test_Report.md`
  - `done01.md`
- 新增共享模板库，系统模板包括项目供货、备件现货、售后维修、新品推广。
- `/templates` 现在支持：
  - 系统模板 / 自建模板切换。
  - 搜索模板名称、主题、说明。
  - 新建自建模板。
  - 编辑自建模板。
  - 预览模板正文。
  - 删除自建模板。
- 自建模板保存到浏览器 localStorage，开发期不新增数据库表。
- AI 外贸员邮件确认弹窗的“使用模板”已改成真实选择框，可以读取系统模板和自建模板。
- 邮件确认弹窗支持将当前邮件另存为自建模板。
- 已通过：
  - `pnpm --filter @leadhunt/web typecheck`
  - `pnpm --filter @leadhunt/web lint`
  - Chrome DevTools Protocol 9222 新建 / 预览 / 编辑模板测试
  - Chrome DevTools Protocol 9222 邮件弹窗读取自建模板测试
- CDP 9222 验证结果：
  - 新建模板后 localStorage 中有 1 条自建模板。
  - 预览弹窗可打开。
  - 编辑后主题更新为 `Updated quote support for telecom projects`。
  - 邮件弹窗模板选择框共 5 个选项，选择自建模板后主题和正文均更新。
  - `/templates` 和邮件确认弹窗外层 `overflowX=0`、`overflowY=0`。
- 截图：
  - `tmp/templates-crud-preview-100-percent.png`
  - `tmp/mail-template-select-100-percent.png`

### 19. CRM API 详情、新建和编辑

- 已完成 `Task.md` 3.5 CRM API 剩余 3 个接口：
  - `GET /api/crm/leads/:id`
  - `POST /api/crm/leads`
  - `PATCH /api/crm/leads/:id`
- 修改文件：
  - `apps/api/src/crm/crm.service.ts`
  - `apps/api/src/crm/crm.controller.ts`
  - `apps/api/src/crm/crm.service.spec.ts`
  - `apps/api/src/crm/crm.controller.spec.ts`
  - `Task.md`
  - `Test_Report.md`
  - `done01.md`
- `GET /api/crm/leads/:id` 现在按 `lead.task.userId` 限定当前登录用户读取单个 CRM 客户详情。
- `POST /api/crm/leads` 现在支持手动创建 CRM 客户，会写入 `lead_tasks`、`lead_candidates`、去重后的 `lead_contacts`、`crm_leads` 和初始 `lead_stage_events`。
- `PATCH /api/crm/leads/:id` 现在支持编辑公司资料、阶段、标签和联系人；联系人采用替换式更新，阶段变化会写入 `lead_stage_events`。
- 已补齐 controller 和 service 单元测试，覆盖成功路径、非法 payload、非法 id、越权 / 不存在 CRM lead。
- 已通过：
  - `pnpm --filter @leadhunt/api typecheck`
  - `pnpm --filter @leadhunt/api test -- src/crm`：2 个文件、19 条测试通过。
  - 远程 PostgreSQL 真实写入 / 读取 / 更新 / 删除冒烟。
- 真实库冒烟结果：`createdOk=true`、`detailCompany=Manual CRM Smoke LLC`、`updatedStage=interested`、`tagCount=2`、`crmCount=1`、`contactCount=1`、`eventCount=2`。
- 冒烟测试临时用户已删除，关联数据通过级联清理；文档未写入数据库密码、Redis 密码或 API Key。

### 20. Auth API 完整闭环和前端登录

- 已完成 `Task.md` 3.1 Auth API。
- 修改文件：
  - `apps/api/src/auth/auth.service.ts`
  - `apps/api/src/auth/auth.controller.ts`
  - `apps/api/src/auth/auth.service.spec.ts`
  - `apps/api/src/auth/auth.controller.spec.ts`
  - `apps/web/app/(auth)/auth-form.tsx`
  - `Task.md`
  - `Test_Report.md`
  - `done01.md`
- 补齐接口：
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
  - `POST /api/auth/forgot-password`
  - `POST /api/auth/reset-password`
  - `GET /api/auth/google`
  - `GET /api/auth/google/callback`
- 保留旧的 `POST /api/auth/password-reset` 兼容入口，前端忘记密码页已切换到 `/api/auth/forgot-password`。
- `reset-password` 会校验 token、更新密码、标记 token 已使用，并清理旧 session。
- Google 登录只使用 `openid email profile` scope，和 Gmail OAuth 的发送 / 读取权限分开。
- 已通过：
  - `pnpm --filter @leadhunt/api typecheck`
  - `pnpm --filter @leadhunt/api test -- src/auth`：2 个文件、22 条测试通过。
  - `pnpm --filter @leadhunt/api lint`
  - `pnpm --filter @leadhunt/api build`
  - `pnpm --filter @leadhunt/web typecheck`
  - 真实 API 冒烟：注册、me、退出、找回密码、重置密码、重置后登录、Google 授权跳转。
  - Chrome DevTools Protocol 9222：`/login` 填写临时账号后成功进入首页。
- 真实 API 冒烟结果：`register=201`、`me=200`、`logout=201`、`forgot=201`、`reset=201`、`login=201`、`google=302`，Google host 为 `accounts.google.com`，scope 为 `openid email profile`。
- 临时测试用户均已删除；文档未写入数据库密码、Redis 密码或 API Key。

### 21. Profile API 短路径和上传接口

- 已完成 `Task.md` 3.2 Profile API。
- 修改文件：
  - `apps/api/src/profiles/product-profile.controller.ts`
  - `apps/api/src/profiles/customer-profile.controller.ts`
  - `apps/api/src/profiles/upload.controller.ts`
  - `apps/api/src/profiles/upload.service.ts`
  - `apps/api/src/profiles/upload.service.spec.ts`
  - `apps/api/src/profiles/profiles.module.ts`
  - `Task.md`
  - `Test_Report.md`
  - `done01.md`
- 产品画像和客户画像 controller 现在同时支持短路径和旧路径：
  - `GET /api/product-profile`
  - `PUT /api/product-profile`
  - `GET /api/customer-profile`
  - `PUT /api/customer-profile`
  - 兼容 `/api/profiles/product` 和 `/api/profiles/customer`
- 新增 `POST /api/uploads`，开发期支持 base64 上传资料写入本地 `runtime/uploads/<userId>/`，返回文件 id、原文件名、content type、size 和相对 URL。
- 已通过：
  - `pnpm --filter @leadhunt/api typecheck`
  - `pnpm --filter @leadhunt/api test -- src/profiles`：3 个文件、13 条测试通过。
  - `pnpm --filter @leadhunt/api lint`
  - `pnpm --filter @leadhunt/api build`
  - 真实 API 冒烟：产品画像、客户画像、旧路径兼容和上传接口。
- 真实 API 冒烟结果：`product=200`、`productGet=200`、`productLegacy=200`、`customer=200`、`customerGet=200`、`customerLegacy=200`、`upload=201`、`productCount=1`、`customerCount=1`。
- 冒烟测试临时用户已删除，上传测试文件和空目录已清理；文档未写入数据库密码、Redis 密码或 API Key。

### 22. AI 任务启动读取画像和生成搜索计划

- 已完成：
  - `Task.md` 2.2 产品画像里的“AI 外贸员任务启动时读取该资料”
  - `Task.md` 2.3 客户画像里的“AI 外贸员任务启动时读取该资料”
  - V1 完成标准中的自然语言任务生成执行计划、分析产品 / 客户资料、生成至少 15 个高级搜索策略组合
- 修改文件：
  - `apps/api/src/agent/agent-workflow.service.ts`
  - `apps/api/src/agent/agent-workflow.service.spec.ts`
  - `Task.md`
  - `Test_Report.md`
  - `done01.md`
- `POST /api/lead-tasks` 创建任务时现在会读取当前用户 `product_profiles` 和 `customer_profiles`。
- 任务 `inputPayload` 会保存：
  - 原始 prompt 和 targetCount
  - 产品画像摘要
  - 客户画像摘要
  - 6 步执行计划
  - 关键词分组
  - 15 条高级搜索策略
- 同时写入 15 条 `search_queries`，后续 Brave 搜索节点可直接读取。
- 已通过：
  - `pnpm --filter @leadhunt/api typecheck`
  - `pnpm --filter @leadhunt/api test -- src/agent`：2 个文件、7 条测试通过。
  - 真实 API 冒烟：保存两份画像后创建自然语言 lead task。
- 真实 API 冒烟结果：`register=201`、`createTask=201`、`hasProductProfile=true`、`hasCustomerProfile=true`、`planSteps=6`、`payloadQueries=15`、`queryCount=15`。
- 冒烟测试临时用户已删除，关联任务、画像和搜索策略通过级联清理；文档未写入数据库密码、Redis 密码或 API Key。

### 23. 候选客户确认和开发信草稿生成

- 已完成 V1 完成标准里的：
  - 用户能确认候选客户
  - 系统能生成开发信
- 修改文件：
  - `apps/api/src/agent/agent-workflow.service.ts`
  - `apps/api/src/agent/lead-task.controller.ts`
  - `apps/api/src/agent/agent-workflow.service.spec.ts`
  - `apps/api/src/agent/lead-task.controller.spec.ts`
  - `Task.md`
  - `Test_Report.md`
  - `done01.md`
- `POST /api/lead-tasks/:taskId/approve` 现在支持传入候选客户 ID。
- 确认后会：
  - 校验候选客户属于当前用户当前任务
  - 将候选状态更新为 `approved`
  - 为候选客户生成 `outreach_drafts` 开发信草稿
  - 标记 `human_approval` 完成
  - 标记 `generate_email` 完成
  - 暂停在 `wait_email_confirmation` 等待人工确认邮件
- 已通过：
  - `pnpm --filter @leadhunt/api typecheck`
  - `pnpm --filter @leadhunt/api test -- src/agent`：2 个文件、9 条测试通过。
  - 真实 API 冒烟：创建任务、写入候选客户和 ICP 分数、调用 approve、检查候选状态 / 草稿 / 步骤状态。
- 真实 API 冒烟结果：`register=201`、`createTask=201`、`approve=201`、`approvedCount=1`、`draftCount=1`、`leadStatus=approved`、`generateEmailStatus=completed`、`waitEmailStatus=waiting`。
- 冒烟测试临时用户已删除，关联任务、候选客户、草稿和步骤通过级联清理；文档未写入数据库密码、Redis 密码或 API Key。

### 24. Brave 搜索执行链路

- 已完成 V1 完成标准里的“后端能调用 Brave 搜索候选公司”。
- 修改文件：
  - `apps/api/src/agent/agent.module.ts`
  - `apps/api/src/agent/agent-workflow.service.ts`
  - `apps/api/src/agent/lead-task.controller.ts`
  - `apps/api/src/agent/agent-workflow.service.spec.ts`
  - `apps/api/src/agent/lead-task.controller.spec.ts`
  - `Task.md`
  - `Test_Report.md`
  - `done01.md`
- 新增 `POST /api/lead-tasks/:taskId/search`，用于执行任务里的待执行搜索 query。
- 执行链路：
  - 读取当前用户当前任务的 pending `search_queries`
  - 调用 `BraveSearchService.searchAndSaveResults()`
  - 写入 `search_results`
  - 调用 `LeadQualificationService.saveCandidates()`
  - 写入 `lead_candidates`、`lead_contacts`、`icp_scores`
  - 更新 `search_queries.executionStatus` 和 `qualifiedCount`
  - 标记 `brave_search`、`normalize_leads`、`extract_contacts`、`score_icp` 步骤完成
- 已通过：
  - `pnpm --filter @leadhunt/api typecheck`
  - `pnpm --filter @leadhunt/api test -- src/agent src/search src/leads`：6 个文件、22 条测试通过。
  - 服务级真实数据库冒烟：mock Brave 返回 1 条结果并完成入库。
- 服务级真实数据库冒烟结果：`executedQueries=1`、`resultCount=1`、`createdCandidates=1`、`searchResults=1`、`candidates=1`、`queryStatus=completed`、`qualifiedCount=1`。
- 真实 Brave API 最小查询在当前 Codex 本机环境仍为 `fetch failed`；用户侧已确认同一 key 可连通，因此记录为当前机器网络路径问题。文档未写入 Brave key、数据库密码、Redis 密码或 API Key。

### 25. 任务总结生成

- 已完成 V1 完成标准里的“本次任务总结清楚说明 AI 做了什么、找到了什么、发了什么、后续怎么跟”。
- 修改文件：
  - `apps/api/src/agent/agent-workflow.service.ts`
  - `apps/api/src/agent/lead-task.controller.ts`
  - `apps/api/src/agent/agent-workflow.service.spec.ts`
  - `apps/api/src/agent/lead-task.controller.spec.ts`
  - `Task.md`
  - `Test_Report.md`
  - `done01.md`
- 新增 `POST /api/lead-tasks/:taskId/summary`。
- 总结输出包含：
  - `did`：AI 做了什么
  - `found`：找到了什么客户、数量、市场和高分公司
  - `sent`：生成 / 已发送开发信数量和 CRM 同步数量
  - `next`：后续邮件确认、跟进提醒、回复同步和 CRM / 数据看板动作
- 生成后会将 `task_summary` 步骤标记为 completed，并把任务状态更新为 `completed`。
- 已通过：
  - `pnpm --filter @leadhunt/api typecheck`
  - `pnpm --filter @leadhunt/api test -- src/agent`：2 个文件、12 条测试通过。
  - 真实 API 冒烟：创建任务、写入候选客户 / ICP / 开发信草稿、调用 summary。
- 真实 API 冒烟结果：`register=201`、`createTask=201`、`summary=201`、`didCount=4`、`foundTotal=1`、`draftCount=1`、`nextCount=3`、`taskStatus=completed`、`summaryStepStatus=completed`。
- 冒烟测试临时用户已删除，关联任务、候选客户、草稿和步骤通过级联清理；文档未写入数据库密码、Redis 密码或 API Key。

## 正在进行

### 26. 数据库维护与重建流程

- 已完成 `Task.md` 1.3 里的“回滚或重建数据库流程可执行”。
- 新增 `scripts/db-maintenance.ps1`：
  - `status`：检查远程 PostgreSQL migration 状态。
  - `migrate`：执行 `prisma migrate deploy` 并重新生成 Prisma Client。
  - `backup`：从远程 PostgreSQL 容器导出 SQL 到 `runtime/backups`。
  - `restore`：从 SQL 备份恢复，必须显式传 `-Force`。
  - `rebuild`：重建远程数据库 schema，必须显式传 `-Force`，默认先备份。
- 新增 `DB_MAINTENANCE.md`，记录本地代码连接远程数据库的备份、恢复、重建命令。
- 已将根 `package.json` 补充：
  - `pnpm db:status`
  - `pnpm db:migrate`
  - `pnpm db:backup`
- 已验证：
  - `pnpm db:status`
  - `restore` 未传 `-Force` 会拒绝执行。
  - `rebuild` 未传 `-Force` 会拒绝执行。
  - `pnpm build`
  - 严格敏感信息扫描命中数为 0。
- 文档未写入数据库密码、Redis 密码、Brave key、Google OAuth secret 或 OpenAI style key。

### 27. 我的客户页面原型对齐

- 已修复 `/customers` 在 CRM API 暂无数据或请求失败时显示巨大空状态的问题。
- 现在页面会按 `design/我的客户.png` 展示原型样例数据：
  - 左侧公司 / 联系人 Tab。
  - 收藏列表、自动分组、客户总览。
  - 8 行客户表格、阶段标签、负责人、最近跟进、操作列。
  - 底部分页和总数 `156`。
- 真实 CRM API 返回有效数据时仍会覆盖样例数据。
- 已调整表格行高，当前 1707 × 932 真实视口下没有页面滚动条，也没有客户表格内部滚动条。
- 已通过：
  - `pnpm --filter @leadhunt/web typecheck`
  - `pnpm --filter @leadhunt/web lint`
  - Chrome DevTools CDP 9222 截图检查，截图保存到 `tmp/customers-current-cdp.png`。

### 28. 数据看板空数据状态对齐

- 已修复 `/dashboard` 在 analytics API 暂不可用时显示“数据读取失败”的问题。
- 现在空数据状态按 `design/数据面板.png` 展示：
  - 搜索偏好：`通信5G 1次`。
  - 折线图日期：`04-18` 到 `04-24`。
  - 底部提示：`数据每日更新`。
- 已通过：
  - `pnpm --filter @leadhunt/web typecheck`
  - `pnpm --filter @leadhunt/web lint`
  - Chrome DevTools CDP 9222 检查，页面 `scrollHeight` 等于 `clientHeight`。
  - 截图保存到 `tmp/dashboard-current-cdp.png`。

### 29. 主要页面真实视口无滚动检查

- 已按用户当前浏览器真实视口 `1707 × 932`，通过 Chrome DevTools CDP 9222 扫描 16 个主要页面。
- 已检查页面：
  - `/login`
  - `/register`
  - `/forgot-password`
  - `/`
  - `/product-profile`
  - `/customer-profile`
  - `/templates`
  - `/campaigns`
  - `/mailbox`
  - `/brochures`
  - `/customers`
  - `/dashboard`
  - `/lead-search`
  - `/icp`
  - `/qualified-customers`
  - `/google-commands`
- 检查项包括 `innerWidth`、`innerHeight`、`scrollWidth`、`scrollHeight`、`clientWidth`、`clientHeight`。
- 结果：16 个页面均无页面级横向溢出，也无页面级纵向滚动；`scrollWidth === clientWidth`，`scrollHeight === clientHeight`。
- 已同步记录到 `Test_Report.md` 的 `4.38 主要页面真实视口溢出检查`。

### 30. 主系统公共框架图标对齐

- 已按主系统设计图统一更新后台公共框架：
  - 顶部 Logo 从字母方块改为纸飞机品牌符号。
  - 左侧导航从字母框改为 18px 线性图标。
  - 工具箱按钮补充工具箱图标。
- 修改文件：
  - `apps/web/app/app-shell.tsx`
  - `apps/web/app/globals.css`
  - `Test_Report.md`
  - `done01.md`
- 已通过：
  - `pnpm --filter @leadhunt/web typecheck`
  - `pnpm --filter @leadhunt/web lint`
  - Chrome DevTools CDP 9222：`/campaigns` 截图检查，截图保存到 `tmp/campaigns-shell-icons-cdp.png`。
  - CDP 9222 复扫 16 个主要路由，`FAILED_COUNT=0`，无页面级横向 / 纵向溢出。

### 31. V1 明确不做范围验收

- 已将 `Task.md` 中“本地开发可先不用正式域名”标记为已确认。
- 已将 V1 明确不做范围标记为已验收：
  - 不做 Microsoft 第三方登录 / 注册。
  - 不做 WhatsApp 自动发送。
  - 不做短信发送。
  - 不做 7*24 全托管。
  - 不接 SerpApi。
  - 不接 Firecrawl。
  - 不接 QQ / 126 / 163 授权码发信。
  - 不做域名邮箱配置。
  - 不做黑名单独立菜单。
  - 不做 OpenAI Search 模型作为 V1 搜索方案。
- 已把登录 / 注册页的 Microsoft 按钮设为禁用，避免误以为已经接入。
- 已把忘记密码页的手机号找回按钮设为禁用，避免误以为已经接入短信。
- 已通过：
  - 代码扫描确认上述能力未在后端接入。
  - `pnpm --filter @leadhunt/web typecheck`
  - `pnpm --filter @leadhunt/web lint`
  - Chrome DevTools CDP 9222 检查 `/login`、`/register`、`/forgot-password`，禁用状态和无页面溢出均通过。

### 32. 邮件确认弹窗 leadId 透传

- 已修复邮件确认弹窗发送 Gmail 时没有把候选客户 `leadId` 传给后端的问题。
- `MailConfirmationLead` 现在支持可选 `id`。
- `/api/gmail/drafts` 和 `/api/gmail/send` 请求 payload 现在都会透传 `leadId: lead.id`。
- 这样真实候选客户携带 id 时，后端可以继续写入：
  - `outreach_drafts`
  - `send_logs`
  - `crm_leads`
  - `followup_tasks`
- 已通过：
  - `pnpm --filter @leadhunt/web typecheck`
  - `pnpm --filter @leadhunt/web lint`
  - 代码检查确认草稿和发送两个请求都包含 `leadId`。

### 33. Gmail 发送限速保护

- 已在后端 `GmailMessageService.sendEmail()` 里新增发送前限速检查。
- 支持配置：
  - `GMAIL_DAILY_SEND_LIMIT`：24 小时发送上限，默认 `80`。
  - `GMAIL_MIN_SEND_INTERVAL_MS`：同一用户最小发送间隔，默认 `15000`。
  - `GMAIL_SYNC_INTERVAL_MS`：同步轮询间隔，示例环境默认 `0`。
- 已更新 `.env.example`。
- 已更新 `Task.md` 风险记录：Gmail 发送量需要限速。
- 已通过：
  - `pnpm --filter @leadhunt/api typecheck`
  - `pnpm --filter @leadhunt/api test -- src/gmail`，5 个文件、31 条测试通过。
- 限速失败时会在调用外部 Gmail API 之前拦截，不刷新 Google token，也不会写入新的发送记录。

### 34. 风险记录闭环核查

- 已核查并勾选 `Task.md` 第 8 节中已经有实现或测试证据的风险项：
  - Brave query 效果记录：`search_queries` 记录 `resultCount`、`qualifiedCount`、`effectivenessScore`。
  - GPT-5.5 JSON 校验：AI 服务使用 Zod schema 校验、失败重试和可读错误。
  - 搜索结果不相关：候选客户写 ICP 评分，并需要人工确认。
  - Google 登录和 Gmail OAuth 分离：登录只用 `openid email profile`，Gmail OAuth 独立申请 Gmail scopes。
- 保留未完成项：
  - 邮件打开率追踪像素 / 追踪链接仍未实现，`Task.md` 继续保持未勾选。
- 已通过：
  - `pnpm --filter @leadhunt/api typecheck`
  - `pnpm --filter @leadhunt/api test -- src/ai src/search src/agent`，7 个文件、33 条测试通过。

## 正在进行

- 继续排查剩余仍是占位或与设计图差距大的页面，并优先推进 `Task.md` 里未完成的交互闭环。

## 近期待办

- 对剩余仍是占位或未对齐的页面继续逐页重构。
- 每完成一个页面后运行至少：
  - `pnpm --filter @leadhunt/web typecheck`
  - `pnpm --filter @leadhunt/web lint`
  - CDP 9222 视口和截图验证
- 阶段性运行：
  - `pnpm build`
  - 敏感信息扫描，确保文档不泄露密钥。

### 35. Gmail 打开追踪像素与趋势指标

- 已完成 `Task.md` 风险记录里的“邮件打开率不能只靠 Gmail API，需要追踪像素或追踪链接，且只能作为趋势指标”。
- 后端发送 Gmail 时现在会先创建 `outreach_drafts` 和 pending `send_logs`，再把 `/api/tracking/open/:sendLogId.gif` tracking pixel 注入 MIME HTML 部分。
- 新增 `TrackingModule`：
  - `GET /api/tracking/open/:sendLogId.gif` 返回 1x1 透明 GIF。
  - 合法 `sendLogId` 会写入 `engagement_events`，事件类型为 `open`，provider 为 `tracking_pixel`。
  - 非法 UUID 或不存在的 send log 不写入事件，但仍返回透明 GIF，避免影响邮件客户端加载。
- CRM analytics 已读取 `engagement_events`：
  - `reach.email.opened`
  - `reach.email.openRate`
  - `reach.email.openTrendNote`
  - `series[].open`
- 已明确把打开率定位为趋势信号，不作为精确送达 / 阅读证明，因为邮箱客户端和图片代理可能造成低估或重复统计。
- 已通过：
  - `pnpm --filter @leadhunt/api typecheck`
  - `pnpm --filter @leadhunt/api test -- src/crm src/gmail src/tracking`，9 个文件、55 条测试通过。
  - `pnpm build`
  - 严格敏感信息扫描命中数为 0。
- 文档未写入数据库密码、Redis 密码、Brave key、Google OAuth secret 或 OpenAI style key。

### 36. 个人邮箱页面原型对齐补强

- 已按 `design/个人邮箱.png` 补强 `/mailbox` 的空接口 / 未登录开发态兜底。
- Gmail account API 不可用时不再显示“读取失败 / 未授权”，而是回到原型里的同步提示和已授权示意；真实 API 返回成功时仍使用真实账号状态。
- 邮件列表三条样例的头像已从普通字母圆点改为更接近原型的 Google / LeadHunt / OpenAI 风格标记。
- 已通过：
  - `pnpm --filter @leadhunt/web typecheck`
  - `pnpm --filter @leadhunt/web lint`
  - Chrome 9222 CDP 检查 `/mailbox`：`scrollWidth=clientWidth=1707`、`scrollHeight=clientHeight=932`、`.mailboxRowLogo` 数量为 3。
- CDP 截图已保存到 `tmp/mailbox-current-cdp.png`。

### 37. 产品画像 / 客户画像框架风格对齐

- 已为 `AppShell` 新增页面级 `frameVariant`，支持同一套系统里按设计稿选择框架风格。
- `/product-profile` 和 `/customer-profile` 现在使用 `frameVariant="letter"`：
  - 顶部品牌从纸飞机切换为蓝色 `L` 方块。
  - 副标题切换为 `AI 外贸员工作台`。
  - 左侧导航图标切换为字母式方框，贴近 `design/产品画像.png` 和 `design/客户画像.png`。
- 邮件相关页面仍保持纸飞机 + 线性图标风格，避免破坏 `邮件营销`、`个人邮箱`、`模板配置`、`邮寄宣传册` 等设计稿。
- 已通过：
  - `pnpm --filter @leadhunt/web typecheck`
  - `pnpm --filter @leadhunt/web lint`
  - Chrome 9222 CDP 检查 `/product-profile`、`/customer-profile`、`/mailbox`。
- CDP 指标：
  - `/product-profile`：`letterFrame=true`、`brandText=L`、`letterNavCount=13`、无页面滚动。
  - `/customer-profile`：`letterFrame=true`、`brandText=L`、`letterNavCount=13`、无页面滚动。
  - `/mailbox`：`letterFrame=false`、`paperNavCount=13`、无页面滚动。
- CDP 截图已保存：
  - `tmp/cdp-sweep/product-profile-after-frame.png`
  - `tmp/cdp-sweep/customer-profile-after-frame.png`
  - `tmp/cdp-sweep/mailbox-after-frame.png`
