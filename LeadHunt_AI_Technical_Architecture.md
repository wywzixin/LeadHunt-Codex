# LeadHunt AI 技术架构文档

版本：V1 架构草案  
日期：2026-05-14
定位：通信设备行业垂直 AI 外贸获客系统

## 1. 产品目标

LeadHunt AI 面向通信设备出口商，目标不是泛外贸工具，而是垂直开发海外 4G/5G 通信设备客户。

核心用户场景：

1. 用户输入开发任务，例如“帮我找 50 个 UAE 通信设备经销商”。
2. 系统分析用户独立站 `telecorenet.com` 的产品和供应能力。
3. 系统分析现有客户 `spectrummea.com`、`highcloud.ae` 的客户类型和关键词。
4. 系统创建或复用长期客户池，例如“5G通信设备买家客户池”。
5. LangGraph Agent 基于高级搜索策略库和通信设备关键词生成组合查询，并调用 Brave AI 搜索候选公司。
6. GPT-5.5 根据产品画像、参考客户画像和搜索结果做 ICP 判断。
7. 合格客户进入客户库，并生成可编辑开发信。
8. 验证模式只展示结果；半托管等待用户确认后发送邮件；WhatsApp 不进入 V1 发送链路，后续版本再接入。
9. 系统同步客户回复、识别意向、创建跟进任务，并分析哪些搜索词、模板和渠道带来高质量客户。

## 2. 总体技术选型

| 层级 | 技术选择 | 说明 |
|------|----------|------|
| 前端 | Next.js + React + TypeScript | 登录注册、SaaS 管理后台、AI 外贸员会话页、客户库、邮件营销、个人邮箱授权 |
| UI | Tailwind CSS / CSS Modules + Lucide Icons | 沿用当前原型风格，图标按钮优先 |
| 后端 API | Node.js + NestJS + TypeScript | 负责业务 API、认证、OAuth、任务创建、Webhook、权限控制 |
| Agent 编排 | LangGraph JS + @langchain/core + Postgres checkpoint | 编排 AI 外贸员长流程、分支、循环、暂停、恢复和跨请求状态保存 |
| 后台队列 | BullMQ + Redis | 负责任务排队、限速、重试、延迟发送、Worker 调度 |
| 数据库 | PostgreSQL + Prisma | 保存任务、客户、搜索结果、ICP 评分、开发信、发送记录 |
| 搜索 | 高级搜索策略库 + Brave Search API / LLM Context API | 先生成带 operator 来源和执行状态的 query，再获取候选 URL、标题、摘要、网页片段和来源 |
| 大模型 | GPT-5.5 Chat Completions 兼容接口 | 画像分析、搜索词生成、ICP 判断、开发信生成 |
| 邮件 | Gmail API + Google OAuth | V1 先支持登录用户个人 Gmail，创建草稿或发送 |
| WhatsApp | V1 不发送；V2 WhatsApp Business Cloud API | V1 只保留后续扩展位置，V2 接企业模板消息 |
| 回复同步 | Gmail 同步 / Webhook；V2 WhatsApp Webhook | 同步客户回复、打开状态、送达状态和跟进信号 |
| 分析 | Campaign Analytics | 统计搜索词、国家、模板、渠道、打开率、回复率、意向率 |
| 文件存储 | Cloudflare R2 / S3 兼容存储 | 保存导出文件、附件、日志快照、用户上传资料 |
| 监控 | Sentry + OpenTelemetry + 结构化日志 | 追踪 Agent 节点、工具调用、失败原因和成本 |

## 3. 总体架构图

```mermaid
flowchart TB
  User[用户浏览器] --> FE[Next.js 前端]
  FE --> API[NestJS 后端 API]

  API --> Auth[认证与权限模块]
  API --> TaskAPI[任务 API]
  API --> CRMAPI[客户 / CRM API]
  API --> MailAPI[邮件 API]

  TaskAPI --> PG[(PostgreSQL)]
  CRMAPI --> PG
  MailAPI --> PG

  TaskAPI --> Queue[BullMQ 队列]
  Queue --> Redis[(Redis)]
  Queue --> Worker[Agent Worker]

  Worker --> Graph[LangGraph 工作流]
  Graph --> GPT[GPT-5.5]
  Graph --> Brave[Brave Search API]
  Graph --> WebExtract[网页上下文提取]
  Graph --> Gmail[Gmail API]
  Graph --> WhatsAppV2[WhatsApp V2 工具]
  Graph --> CRMTool[CRM 保存工具]
  Graph --> Followup[回复分类 / 跟进任务]
  Graph --> Analytics[活动质量分析]

  GPT --> APIProxy[OpenAI-compatible API Proxy]
  Brave --> Internet[互联网搜索结果]
  Gmail --> Google[Google OAuth / Gmail]
  WhatsAppV2 --> Meta[WhatsApp Cloud API]

  Graph --> PG
  Graph --> Redis
  Graph --> ObjectStore[(R2 / S3 文件存储)]
```

## 4. 前端架构

### 4.1 页面模块

| 页面 | 说明 |
|------|------|
| 登录 / 注册 / 忘记密码 | 邮箱密码登录注册、重置密码、Google 登录入口；Microsoft OAuth V1 不启用 |
| AI 外贸员 | 主工作台，输入任务、展示 Agent 步骤、半托管确认 |
| 工作台 | 任务概览、今日新增客户、待确认任务、发送状态 |
| 我的产品画像 | 保存官网、产品页、产品资料和补充说明；不在配置页做 AI 解析 |
| 参考客户画像 | 保存目标市场、参考客户官网和补充说明；不在配置页做 AI 解析 |
| AI 搜索客户 | 高级搜索策略 + Brave 搜索任务、候选客户、组合 query 和来源 URL |
| ICP 判断 | 客户评分、匹配理由、可售卖产品、风险项 |
| 合格客户库 | 已通过 ICP 的客户、联系方式、标签、跟进状态 |
| 高级搜索策略 | 沉淀 Brave 官方 operator 白名单、Google 官方常用搜索逻辑、常见 SEO 操作符、行业模板和执行效果评分 |
| 模板配置 | 开发信模板、变量、语言、邮件语气 |
| 邮件营销 | 发送记录、发邮件、邮件模板 |
| 个人邮箱 | Gmail OAuth 授权、当前发件邮箱、撤销授权 |
| 回复和跟进 | 同步客户回复、AI 分类、待跟进任务、报价提醒 |
| 活动分析 | 搜索词质量、开发信模板效果、国家/渠道转化漏斗 |
| 邮寄宣传册 | 邮寄任务、素材、收件地址、状态 |
| 我的客户 | CRM 客户管理 |
| 导出记录 | 导出客户、发送记录、任务结果 |

### 4.2 前端状态与通信

V1 推荐：

- 普通业务数据：React Query。
- 页面局部状态：Zustand 或 React state。
- Agent 实时进度：先用轮询，后续升级 SSE。
- 任务详情页：根据 `task_id` 拉取步骤、候选客户、确认点和发送状态。

接口模式：

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
POST /api/auth/forgot-password
POST /api/auth/reset-password
GET  /api/auth/google
GET  /api/auth/google/callback
POST /api/lead-tasks
GET  /api/lead-tasks/:taskId
GET  /api/lead-tasks/:taskId/events
GET  /api/lead-tasks/:taskId/leads
POST /api/lead-tasks/:taskId/approve
POST /api/lead-tasks/:taskId/pause
POST /api/lead-tasks/:taskId/resume
POST /api/lead-tasks/:taskId/cancel
```

## 5. 后端架构

### 5.1 后端模块

```text
src/
  modules/
    auth/
    users/
    password-reset/
    gmail-oauth/
    lead-tasks/
    agent-runs/
    brave-search/
    leads/
    icp/
    outreach/
    crm/
    whatsapp/
    inbox-sync/
    engagement-events/
    reply-classification/
    followup-tasks/
    campaign-analytics/
    exports/
    billing/
  workers/
    agent.worker.ts
    outreach.worker.ts
  graph/
    leadhunt.graph.ts
    nodes/
    tools/
  shared/
    config/
    logger/
    errors/
```

### 5.2 后端职责边界

| 模块 | 职责 |
|------|------|
| API Server | 接收前端请求、处理登录注册、创建任务、返回状态、处理 OAuth 和 Webhook |
| Auth Layer | 邮箱密码注册登录、Google 登录、忘记密码、登录态、权限校验；Microsoft OAuth V1 不启用 |
| Agent Worker | 执行 LangGraph 工作流，不阻塞 API 请求 |
| Tool Layer | 封装 Brave、GPT-5.5、Gmail、CRM 等 V1 工具；WhatsApp 作为 V2 扩展 |
| Persistence Layer | 写入 PostgreSQL、Redis、对象存储 |
| Guardrail Layer | 限速、去重、黑名单、发送阈值、安全规则 |
| Follow-up Layer | 同步回复、分类意图、创建跟进任务、记录客户阶段变化 |
| Analytics Layer | 统计搜索词、模板、国家、渠道和客户质量 |

## 6. LangGraph Agent 架构

### 6.1 为什么用 LangGraph

LeadHunt AI 的任务不是一次性问答，而是长流程：

- 有多轮搜索。
- 有条件分支。
- 有人工确认。
- 有失败重试。
- 有后台恢复。
- 有半托管和全托管两种模式。

LangGraph 用来把这些步骤编排成可控工作流。GPT-5.5 不直接调用外部 API，而是由 LangGraph 节点在后端调用受控工具。

### 6.1.1 当前做实的 LangGraph 职责

LangGraph 在项目中不是只做展示时间线，而是作为 AI 外贸员主流程编排层：

- 维护任务状态、搜索轮次、候选客户、人工确认和错误信息。
- 负责编排搜索、清洗、ICP 打分、人工审核、开发信生成、邮件确认、Gmail 发送、CRM 同步和跟进计划。
- 在 `human_approval` 节点强制暂停，客户必须人工审核后才能进入邮件生成。
- 在 `wait_email_confirmation` 节点强制暂停，邮件必须人工确认后才能发送。
- 使用 LangGraph checkpoint 保存图状态，生产环境使用 PostgreSQL checkpoint，测试或一次性本地调试才使用 MemorySaver。

用户界面不要直接暴露这些节点名。普通用户只看到“待审核客户”“等待确认发送”“继续找更多客户”等业务状态。

### 6.2 Agent 工作流图

```mermaid
flowchart TD
  Start([开始任务]) --> LoadTask[加载任务与用户配置]
  LoadTask --> ProductProfile[分析产品画像]
  ProductProfile --> CustomerProfile[分析参考客户画像]
  CustomerProfile --> PlanQueries[生成高级搜索策略 + Brave 搜索 query]
  PlanQueries --> BraveSearch[调用 Brave 搜索]
  BraveSearch --> Normalize[候选公司清洗与去重]
  Normalize --> Extract[提取官网/邮箱/电话/WhatsApp]
  Extract --> ScoreICP[GPT-5.5 ICP 打分]
  ScoreICP --> Enough{合格客户够了吗?}

  Enough -- 不够 --> Budget{搜索预算还有吗?}
  Budget -- 有 --> PlanNext[生成下一组搜索词]
  PlanNext --> BraveSearch
  Budget -- 没有 --> GenerateOutreach[生成开发信草稿]

  Enough -- 够了 --> GenerateOutreach
  GenerateOutreach --> Mode{任务模式}

  Mode -- 验证模式 --> FinishValidate[保存结果并结束]
  Mode -- 半托管 --> HumanApproval[暂停等待人工确认]
  HumanApproval --> Approved{用户确认?}
  Approved -- 否 --> FinishValidate
  Approved -- 是 --> SendOutreach[调用发送工具]
  Mode -- 全托管 --> Guardrails[发送安全规则检查]
  Guardrails --> CanSend{允许发送?}
  CanSend -- 否 --> FinishValidate
  CanSend -- 是 --> SendOutreach

  SendOutreach --> SaveCRM[保存 CRM 和发送记录]
  SaveCRM --> ScheduleFollowup[创建默认跟进计划]
  ScheduleFollowup --> Finish([完成])
  FinishValidate --> Finish
```

### 6.2.1 持续客户池与继续拓展图

```mermaid
flowchart TD
  Start(["用户发起获客需求"]) --> Pool{"是否已有同主题客户池?"}
  Pool -- 否 --> CreatePool["创建客户池"]
  Pool -- 是 --> LoadPool["加载客户池状态"]
  CreatePool --> PlanRound["生成首轮搜索指令"]
  LoadPool --> Pending{"还有未执行搜索指令?"}
  Pending -- 有 --> RunPending["优先执行未完成指令"]
  Pending -- 没有 --> Learn["读取审核通过 / 拒绝 / 过滤反馈"]
  Learn --> PlanNext["生成下一轮搜索指令"]
  PlanRound --> RunSearch["调用 Brave 搜索"]
  RunPending --> RunSearch
  PlanNext --> RunSearch
  RunSearch --> Normalize["清洗与结构化候选"]
  Normalize --> Dedupe["按域名 / 邮箱 / 公司名 + 国家 / CRM 去重"]
  Dedupe --> Score["ICP 评分"]
  Score --> SavePool["写入客户池、搜索轮次和候选状态"]
  SavePool --> HumanReview["展示待审核客户"]
  HumanReview --> Continue{"用户继续找更多客户?"}
  Continue -- 是 --> Pending
  Continue -- 否 --> Finish(["保留客户池，等待下次继续"])
```

### 6.2.2 回复和跟进闭环图

```mermaid
flowchart TD
  Sent[邮件已发送 / V2 WhatsApp 已发送] --> InboxSync[同步收件箱和渠道回执]
  InboxSync --> HasReply{有新回复?}
  HasReply -- 否 --> FollowupDue{到跟进时间?}
  FollowupDue -- 否 --> Wait[等待下一次同步]
  FollowupDue -- 是 --> FollowupTask[生成二次触达任务]

  HasReply -- 是 --> Classify[GPT-5.5 回复分类]
  Classify --> Intent{客户意图}
  Intent -- 感兴趣 / 要报价 --> QuoteTask[创建报价或人工跟进任务]
  Intent -- 要目录 / 要规格 --> ContentTask[创建资料发送任务]
  Intent -- 拒绝 / 退订 --> DoNotContact[标记勿扰]
  Intent -- 无效 / 自动回复 --> LowPriority[低优先级处理]

  QuoteTask --> StageEvent[记录客户阶段事件]
  ContentTask --> StageEvent
  DoNotContact --> StageEvent
  LowPriority --> StageEvent
  FollowupTask --> StageEvent
  StageEvent --> AnalyticsUpdate[更新活动分析]
  AnalyticsUpdate --> CRMUpdate[更新 CRM 客户状态]
```

### 6.3 LangGraph 状态对象

```ts
type LeadHuntGraphState = {
  taskId: string
  userId: string
  leadPoolId: string
  searchRoundId?: string
  mode: 'validate' | 'semi_auto' | 'full_auto'
  targetCount: number
  targetRegions: string[]
  productProfile?: ProductProfile
  referenceProfiles: ReferenceCustomerProfile[]
  searchQueries: SearchQuery[]
  pendingSearchQueries: SearchQuery[]
  executedSearchQueryIds: string[]
  rejectedLeadSignals: LeadFeedbackSignal[]
  approvedLeadSignals: LeadFeedbackSignal[]
  searchResults: SearchResult[]
  candidates: LeadCandidate[]
  qualifiedLeads: QualifiedLead[]
  outreachDrafts: OutreachDraft[]
  inboxThreads: InboxThread[]
  inboundMessages: InboundMessage[]
  replyClassifications: ReplyClassification[]
  followupTasks: FollowupTask[]
  leadStageEvents: LeadStageEvent[]
  campaignMetrics: CampaignMetric[]
  approvals: HumanApproval[]
  budgets: {
    maxQueries: number
    maxCandidates: number
    maxGptCalls: number
    maxEmailsPerDay: number
  }
  currentStep: string
  errors: AgentError[]
}
```

### 6.4 LangGraph checkpoint 持久化

当前代码已从开发期 `MemorySaver` 切换为可配置 checkpoint：

- `LANGGRAPH_CHECKPOINT_STORE=postgres`：生产和联调推荐值，使用 `@langchain/langgraph-checkpoint-postgres`。
- `LANGGRAPH_CHECKPOINT_STORE=memory`：只用于单元测试、一次性本地调试或无状态 demo。
- `LANGGRAPH_CHECKPOINT_DATABASE_URL`：可单独指定 checkpoint 数据库；不配置时复用 `DATABASE_URL`。
- `LANGGRAPH_CHECKPOINT_SCHEMA`：checkpoint 表所在 schema，默认 `public`。

选择 PostgreSQL checkpoint 的原因：

- AI 外贸员任务会跨多个 API 请求、人工审核和邮件确认，服务重启后必须能恢复。
- checkpoint 状态和业务数据都在 PostgreSQL，方便按 `thread_id` / `task_id` 联合排查。
- 当前项目已经有 PostgreSQL 依赖，先用 PostgresSaver 比额外引入 Redis checkpoint 更简单。

Redis 仍用于队列、短期缓存和限速。除非后续需要极高频的短生命周期图状态，否则不建议把 LangGraph checkpoint 主存储放到 Redis。

### 6.5 工具注册

```ts
export const tools = {
  'gpt.productProfile': buildProductProfile,
  'gpt.referenceProfile': buildReferenceCustomerProfile,
  'gpt.planQueries': planSearchQueries,
  'brave.search': braveSearch,
  'web.extract': extractWebContext,
  'lead.normalize': normalizeLeadCandidate,
  'gpt.scoreICP': scoreICP,
  'gpt.generateOutreach': generateOutreach,
  'gmail.createDraft': createGmailDraft,
  'gmail.send': sendGmail,
  'gmail.syncInbox': syncGmailInbox,
  // V2: WhatsApp Business Cloud API
  'whatsapp.sendTemplate': sendWhatsAppTemplate,
  'whatsapp.syncReplies': syncWhatsAppReplies,
  'engagement.trackOpen': trackEmailOpen,
  'engagement.trackClick': trackEmailClick,
  'crm.saveLead': saveLeadToCrm,
  'reply.classify': classifyReplyWithGPT55,
  'followup.schedule': scheduleFollowupTask,
  'lead.stageEvent': createLeadStageEvent,
  'campaign.analytics': updateCampaignAnalytics
}
```

## 7. 搜索与 ICP 链路

### 7.1 搜索提供方

V1 使用 Brave Search API：

- `LLM Context API`：优先使用，拿适合 GPT-5.5 分析的网页片段和来源。
- `Web Search API`：辅助使用，拿标准搜索结果列表。

不使用：

- SerpApi
- Firecrawl
- OpenAI Search

### 7.2 搜索策略

V1 回到最初用高级搜索方法开发客户的思路，但不把 `google search.md` 当成完整规则库。`google search.md` 只能作为初始业务经验，真正的搜索策略需要沉淀为“高级搜索策略库”。

高级搜索策略库包含：

1. Brave 官方 operator 白名单。
2. Google 官方常用搜索逻辑。
3. 常见但需测试的 SEO 搜索操作符。
4. 外贸获客业务模板。
5. AI 扩展词模型。
6. 通信设备行业关键词库。
7. 排除词库。
8. 每个搜索式的执行效果评分。

官方来源：

- Brave Search API Search Operators：https://api-dashboard.search.brave.com/documentation/resources/search-operators
- Google Search Help Refine Searches：https://support.google.com/websearch/answer/2466433

库文件：

- 人读版：`search/advanced-search-strategy-library.md`
- Agent 读取版：`search/advanced-search-strategy-library.json`

Brave AI 在这里是搜索执行器，不是替代高级搜索方法论。系统需要同时保存“原始策略模板”和“实际提交给 Brave 的 query”，方便后续切换到 Google Custom Search、SerpApi 或其他搜索 API。

### 7.2.1 GPT-led 搜索规划实现

当前代码中，`AgentWorkflowService.buildTaskContext()` 是获客任务搜索规划的核心入口：

1. 读取 `ProductProfileService` 和 `CustomerProfileService` 保存的画像。
2. 用 `WebsiteContentService.readProfileSites()` 抓取产品官网、产品目录、产品资料 URL 和参考客户官网。
3. 用确定性 `createKeywordGroups()` / `generateSearchQueries()` 先生成兜底关键词和 query。
4. 调用 `LeadHuntAiService.analyzeProductProfile()` 分析产品画像。
5. 调用 `LeadHuntAiService.analyzeCustomerProfile()` 分析客户画像。
6. 调用 `LeadHuntAiService.expandKeywords()` 扩展产品词、买家词、场景词、目标市场词和排除词。
7. 调用 `LeadHuntAiService.generateSearchStrategy()` 生成 GPT-led 搜索策略。
8. 用 `normalizeAiSearchPlan()` 校验和规范化 GPT query。
9. GPT query 不足 15 条时，用确定性 query 补足。

创建获客任务后的执行方式已改为后端自动接力：

- `POST /api/lead-tasks` 只负责创建 `lead_task`、初始化 `agent_steps`，然后立即返回 `task_id`。
- 后端在后台继续执行 `读取画像 -> GPT 规划 query -> 校验 query -> Brave 搜索全部 pending query -> 清洗候选 -> GPT/规则融合评分 -> 写入候选`。
- 前端不再等待 45 秒后调用 `/api/lead-tasks/:taskId/search` 接力；前端只轮询 `GET /api/lead-tasks/:taskId` 展示进度。
- 搜索执行时，单条 query 开始处理即写为 `running`，拿到 Brave 原始结果后先回写 `resultCount`，避免页面看起来“搜索指令待生成 / 不动了”。
- 后端启动时会恢复最近 24 小时仍处于 `running` 的获客任务；如果任务已经有 query，则跳过 GPT 规划，重置卡在 `running` 的 query 并继续执行 pending query。
- 本轮所有 query 执行完后，任务停在人工审核客户阶段；邮件生成和发送仍必须等待用户确认。

后端校验器的职责边界：

- 可以丢弃：不在自动执行白名单里的 operator、无国家约束的 query、完全没有产品/客户/场景信号的 query、重复 query、过长 query。
- 可以补充：安全排除词，例如 `-job`、`-career`、`-hiring`、`-training`。
- 不负责：判断这个 query 搜出来的客户是否值钱。客户质量由 GPT 候选买家判断和 ICP 融合评分处理。

候选清洗和 GPT 评分的成本边界：

- Brave 每条 query 当前取 1 页，`count=20`；候选清洗最多处理前 20 条。
- 联系方式探测只对规则判断仍有买家可能性的官网执行，单候选最多探测 6 个常见页面，单页面 3.5 秒超时，二级 contact 链接最多 4 个。
- GPT 候选买家判断不是对所有搜索结果无脑调用；每批最多评估 5 个通过规则预筛的候选，低分文章页、目录页、消费电子页由规则层直接压低。
- 最终 ICP 仍按 GPT 买家匹配分和规则证据分融合；规则预筛只控制成本和速度，不替代最终人工审核。

`WebsiteContentService` 抓取规则：

- 使用后端 `fetch`，`LeadHuntAI/0.1 website profile reader` User-Agent，跟随重定向。
- 只读取 `text/html`、`text/plain`、`application/xhtml+xml`。
- 单 URL 读取超时为 6 秒。
- 对 WooCommerce 产品目录，识别 `woocommerce-loop-product__title`、`Showing x-y of n results` 和 `/page/{n}/` 分页。
- 产品目录上限为 50 页 / 1000 个产品名，防止无限抓取，同时覆盖 `telecorenet.com` 当前 158 个产品规模。

V1 自动执行以 Brave 官方文档列出的 operator 为优先白名单。由于 Brave 官方也说明 search operators 仍处于实验阶段，V1 需要记录每个 operator 的执行效果并持续测试，不把任何 operator 写成永久稳定能力。

系统需要区分两类兼容性：

- Google 手动搜索可用。
- Brave API 自动执行可用。

每个 operator 需要记录：

- `operator_source`：`google_official` / `brave_official` / `common_seo`
- `execution_status`：`supported` / `experimental` / `manual_only` / `disabled`

V1 每个任务至少生成 15 个“高级搜索策略 + 通信设备关键词”的组合查询，并按策略模板、operator 来源、执行状态、核心词、产品词、客户词、地区词、排除词分组展示。组合查询不足 15 个时，不进入搜索执行节点，需要回到搜索策略节点补足。

在生成 query 之前，Agent 需要先执行 `expand_keywords` 节点，按以下维度扩词：

| 维度 | 说明 | 示例 |
| --- | --- | --- |
| 主产品 | 用户输入或产品画像中的核心产品 | `telecom equipment`、`RRU`、`BBU` |
| 同类产品 / 细分品类 | 产品型号、模块和相关品类 | `AAU`、`remote radio unit`、`rectifier module` |
| 商品长尾词 | 买家搜索和库存页里更具体的产品名 | `Huawei RRU spare parts`、`ZTE BBU boards` |
| 上下游词 | 零部件、配套设备、服务和供应链词 | `power module`、`IBS solution`、`equipment refurbishment` |
| 客户采购意图词 | 采购、进口、批发、现货和项目供货意图 | `distributor`、`stockist`、`importer`、`purchasing` |
| 目标市场词 | 国家、地区、城市、域名和 API 地区参数 | `UAE`、`Dubai`、`Saudi Arabia`、`Riyadh` |
| 行业场景词 | 使用场景和解决方案方向 | `telecom infrastructure`、`network rollout`、`site maintenance` |

V1 搜索操作符兼容矩阵：

| 操作符 | operator_source | execution_status | 用途 |
| --- | --- | --- | --- |
| `"` 精确短语 | `brave_official` / `google_official` | `experimental` | 精确匹配品牌、产品和客户类型 |
| `-` 排除词 | `brave_official` / `google_official` | `experimental` | 排除招聘、新闻、培训、消费者和论坛结果 |
| `OR` / `AND` / `NOT` | `brave_official` | `experimental` | 组合产品词和客户词 |
| `site:` | `brave_official` / `google_official` | `experimental` | 限定国家域名或目标站点 |
| `filetype:` / `ext:` | `brave_official` | `experimental` | 查找 PDF、目录、展商名单和资料表 |
| `intitle:` | `brave_official` | `experimental` | 强化标题命中 |
| `inbody:` / `inpage:` | `brave_official` | `experimental` | 强化页面内容命中 |
| `loc:` / `lang:` | `brave_official` | `experimental` | 地区和语言约束 |
| `inurl:` / `intext:` | `common_seo` | `manual_only` | 偏 Google / SEO 常见用法，不进入 V1 自动执行白名单 |
| `allintitle:` / `allinurl:` / `before:` / `after:` | `common_seo` | `disabled` | V1 不自动生成，后续按执行器兼容性评估 |

Agent 生成多组 query，例如：

```text
("RRU" OR "BBU" OR "AAU") ("distributor" OR "stockist" OR "system integrator") UAE -job -training -news
intitle:"telecom equipment" ("Huawei" OR "ZTE") ("stockist" OR "distributor") site:.ae
inpage:telecom ("microwave backhaul" OR "telecom power") ("service" OR "solution") loc:sa
"Huawei ZTE spare parts" ("trading" OR "importer" OR "purchasing") UAE -Alibaba -Amazon -China -forum
filetype:pdf "telecom" "exhibitors" "UAE"
```

### 7.3 ICP 评分维度

| 维度 | 分值建议 | 说明 |
|------|----------|------|
| 行业相关性 | 25 | 是否通信设备、网络、系统集成、工程服务 |
| 产品匹配 | 25 | 是否涉及 Huawei/ZTE/Ericsson/Nokia/Eltek、RRU、BBU、微波、电源等 |
| 客户类型 | 20 | 经销商、现货商、集成商、工程商、运维商 |
| 采购可能性 | 15 | 是否有项目交付、备件补货、维护翻新需求 |
| 联系方式完整度 | 10 | 邮箱、电话、WhatsApp、官网是否齐全 |
| 区域优先级 | 5 | UAE、Saudi、Nigeria、Kenya、Brazil 等重点市场 |

建议阈值：

```text
80-100：高优先级，进入合格客户库
65-79：待人工确认
0-64：不建议触达
```

当前实现采用“规则证据分 + GPT 买家语义分”融合：

- `LeadQualificationService.scoreCandidate()` 输出规则证据分，处理行业词、产品词、买家场景、目标国家、联系方式、风险域名、目录 / 内容页等确定性信号。
- `LeadHuntAiService.evaluateCandidateBuyer()` 输出 GPT 买家判断，分类为 `target_buyer`、`possible_buyer`、`supplier_or_competitor`、`directory`、`content_article`、`job_page`、`market_report`、`irrelevant`、`unknown`。
- `mergeAiEvaluationWithRuleScore()` 计算最终分：GPT `fitScore` 占 60%，规则分占 40%。
- `directory`、`content_article`、`job_page`、`market_report`、`irrelevant` 最高封顶到低分；`supplier_or_competitor` 最高封顶到复核区间；真实买家且高置信时可进入高匹配。

## 8. 邮件触达与后续 WhatsApp 扩展

### 8.1 Gmail 邮件

V1 只支持当前登录用户授权自己的 Gmail：

1. 用户点击“使用 Google 授权 Gmail”。
2. 后端完成 OAuth，保存 refresh token。
3. Agent 生成开发信。
4. 验证模式：只保存开发信。
5. 半托管：创建 Gmail 草稿，用户确认后发送。
6. 全托管：通过安全规则后调用 Gmail API 发送。

不做：

- 不做系统发件域名。
- 不做域名配置。
- 不做 QQ / 163 / SMTP 授权码版本。

### 8.2 WhatsApp

V1 不做 WhatsApp 发送，也不在主流程里创建 WhatsApp 待发送任务。第一版先把搜索、ICP、Gmail 发信、CRM 同步和跟进任务跑通。

V2 再接 WhatsApp Business Cloud API：

- 使用企业 WhatsApp 号码。
- 使用已审核模板消息主动触达。
- 客户回复后再进入自由文本跟进窗口。

### 8.3 回复和跟进闭环

外贸获客产品不能只停留在“找到客户并发送”，必须持续判断客户反应并推动下一步。

V1 闭环能力：

1. `inbox_sync`：同步 Gmail 收件箱、已发送邮件、线程、客户回复和基础回执。
2. `engagement_events`：V1 记录邮件打开、链接点击、送达、退信等互动事件；V2 再扩展 WhatsApp 回执。
3. `reply_classification`：用 GPT-5.5 判断回复意图，例如感兴趣、要报价、要目录、拒绝、退订、自动回复、无效。
4. `followup_tasks`：根据客户意图和时间规则创建跟进任务，例如 3 天后二次触达、需要人工报价；V2 再增加 WhatsApp 跟进。
5. `lead_stage_events`：记录客户阶段变化，例如已触达、已打开、已回复、感兴趣、报价中、勿扰。
6. `campaign_analytics`：统计哪些搜索词、国家、客户类型、开发信模板和渠道带来的打开率、回复率和高意向客户最多。

注意：Gmail API 本身不会直接告诉系统“对方是否打开邮件”。如果 V1 要做打开统计，需要在邮件中加入追踪像素或追踪链接，由后端记录 `open` / `click` 事件；部分邮箱会屏蔽图片或预加载图片，所以打开率只能作为趋势指标，不能作为 100% 准确事实。

推荐默认规则：

- 发送后 3 天未回复：创建一次二次跟进任务。
- 客户回复包含 price、quote、catalog、spec、datasheet：标记为高意向并提醒人工处理。
- 客户回复 unsubscribe、not interested、stop：标记勿扰，不再自动触达。
- 自动回复或退信：降低优先级，并记录联系方式质量问题。
- 每次阶段变化都写入 `lead_stage_events`，便于 CRM 时间线展示。

## 9. 数据库设计

### 9.1 ER 图

```mermaid
erDiagram
  users ||--o{ auth_accounts : signs_in_with
  users ||--o{ user_sessions : has
  users ||--o{ password_reset_tokens : requests
  users ||--o{ gmail_accounts : owns
  users ||--o{ lead_tasks : creates
  lead_tasks ||--o{ agent_steps : has
  lead_tasks ||--o{ search_queries : has
  search_queries ||--o{ search_results : returns
  lead_tasks ||--o{ lead_candidates : discovers
  lead_candidates ||--o{ lead_contacts : has
  lead_candidates ||--o{ icp_scores : scored_by
  lead_candidates ||--o{ outreach_drafts : gets
  outreach_drafts ||--o{ send_logs : sends
  send_logs ||--o{ engagement_events : produces
  outreach_drafts ||--o{ inbox_threads : tracked_by
  inbox_threads ||--o{ inbound_messages : contains
  inbound_messages ||--o{ reply_classifications : classified_as
  lead_candidates ||--o{ followup_tasks : needs
  lead_candidates ||--o{ lead_stage_events : changes
  lead_tasks ||--o{ campaign_analytics : measures
  lead_candidates ||--o{ crm_leads : saved_as

  users {
    uuid id PK
    string email
    string name
    string password_hash
    string role
    string status
    datetime email_verified_at
    datetime last_login_at
    datetime created_at
  }

  auth_accounts {
    uuid id PK
    uuid user_id FK
    string provider
    string provider_user_id
    string email
    datetime created_at
  }

  user_sessions {
    uuid id PK
    uuid user_id FK
    string refresh_token_hash
    string user_agent
    string ip_address
    datetime expires_at
    datetime created_at
  }

  password_reset_tokens {
    uuid id PK
    uuid user_id FK
    string token_hash
    datetime expires_at
    datetime used_at
    datetime created_at
  }

  gmail_accounts {
    uuid id PK
    uuid user_id FK
    string email
    string refresh_token_encrypted
    datetime connected_at
  }

  lead_tasks {
    uuid id PK
    uuid user_id FK
    uuid lead_pool_id FK
    string mode
    string status
    int target_count
    json input_payload
    datetime created_at
  }

  lead_pools {
    uuid id PK
    uuid user_id FK
    string name
    string status
    json target_regions
    json product_keywords
    json buyer_type_keywords
    datetime created_at
    datetime updated_at
  }

  lead_search_rounds {
    uuid id PK
    uuid pool_id FK
    uuid task_id FK
    int round_index
    string status
    json feedback_summary
    datetime started_at
    datetime finished_at
  }

  agent_steps {
    uuid id PK
    uuid task_id FK
    string node_name
    string status
    json input
    json output
    text error
    datetime created_at
  }

  search_queries {
    uuid id PK
    uuid task_id FK
    uuid pool_id FK
    uuid round_id FK
    string provider
    string operator_source
    string execution_status
    string operator_name
    text strategy_template
    text query
    json keyword_groups
    string country
    int result_count
    int qualified_count
    float effectiveness_score
  }

  search_results {
    uuid id PK
    uuid query_id FK
    string title
    string url
    text snippet
    string domain
  }

  lead_candidates {
    uuid id PK
    uuid task_id FK
    uuid pool_id FK
    uuid round_id FK
    string company_name
    string website
    string country
    string source_url
    string status
  }

  lead_candidate_events {
    uuid id PK
    uuid lead_id FK
    uuid pool_id FK
    string event_type
    text note
    json metadata
    datetime created_at
  }

  lead_dedupe_keys {
    uuid id PK
    uuid pool_id FK
    uuid lead_id FK
    string key_type
    string key_value
    datetime created_at
  }

  lead_contacts {
    uuid id PK
    uuid lead_id FK
    string type
    string value
    string source_url
  }

  icp_scores {
    uuid id PK
    uuid lead_id FK
    int score
    string grade
    json reasons
  }

  outreach_drafts {
    uuid id PK
    uuid lead_id FK
    string channel
    string subject
    text body
    string status
  }

  send_logs {
    uuid id PK
    uuid draft_id FK
    string channel
    string status
    string provider_message_id
    datetime sent_at
  }

  engagement_events {
    uuid id PK
    uuid send_log_id FK
    string event_type
    string provider
    json metadata
    datetime occurred_at
  }

  inbox_threads {
    uuid id PK
    uuid draft_id FK
    string provider
    string thread_id
    string status
    datetime last_synced_at
  }

  inbound_messages {
    uuid id PK
    uuid thread_id FK
    string from_email
    string subject
    text body_preview
    datetime received_at
  }

  reply_classifications {
    uuid id PK
    uuid message_id FK
    string intent
    int confidence
    json extracted_needs
    text summary
  }

  followup_tasks {
    uuid id PK
    uuid lead_id FK
    string type
    string status
    datetime due_at
    text note
  }

  lead_stage_events {
    uuid id PK
    uuid lead_id FK
    string from_stage
    string to_stage
    string reason
    datetime created_at
  }

  campaign_analytics {
    uuid id PK
    uuid task_id FK
    string dimension
    string dimension_value
    int sent_count
    int reply_count
    int qualified_count
  }

  crm_leads {
    uuid id PK
    uuid lead_id FK
    string stage
    json tags
    datetime created_at
  }
```

### 9.2 关键表说明

| 表 | 作用 |
|----|------|
| `users` | 系统用户账号，保存邮箱、昵称、密码哈希、状态和最近登录时间 |
| `auth_accounts` | 第三方登录绑定关系；V1 只启用 Google，Microsoft 不启用 |
| `user_sessions` | 登录会话、刷新令牌哈希、过期时间和设备信息 |
| `password_reset_tokens` | 忘记密码重置令牌哈希、有效期和使用状态 |
| `lead_tasks` | 用户创建的获客任务 |
| `lead_pools` | 长期客户池，例如“5G通信设备买家客户池”，承载连续拓展和跨轮次去重 |
| `lead_search_rounds` | 客户池下的搜索轮次，记录本轮来源、反馈摘要和执行状态 |
| `agent_steps` | LangGraph 每个节点的输入、输出、状态、错误 |
| `search_queries` | GPT-5.5 生成的高级搜索策略模板、operator 来源、执行状态、关键词组合、实际执行 query、所属客户池 / 轮次和效果评分 |
| `search_results` | Brave 返回的 URL、标题、摘要、片段 |
| `lead_candidates` | 候选公司，绑定任务、客户池和搜索轮次 |
| `lead_candidate_events` | 客户审核、过滤、加入 CRM、发送、退订等事件 |
| `lead_dedupe_keys` | 域名、邮箱、公司名 + 国家等去重键，避免继续拓展时重复返回同一客户 |
| `lead_contacts` | 邮箱、电话、WhatsApp、LinkedIn 等联系方式 |
| `icp_scores` | ICP 分数、匹配理由、风险点 |
| `outreach_drafts` | 邮件开发信草稿；V2 可扩展 WhatsApp 文案 |
| `send_logs` | 发送日志和状态 |
| `engagement_events` | V1 邮件打开、点击、送达、退信；V2 扩展 WhatsApp 回执 |
| `inbox_threads` | V1 邮件线程；V2 扩展 WhatsApp 会话线程 |
| `inbound_messages` | 客户回复、自动回复、退信等入站消息 |
| `reply_classifications` | AI 对回复的意图分类和摘要 |
| `followup_tasks` | 后续跟进任务，例如二次触达、报价；V2 可增加 WhatsApp 跟进 |
| `lead_stage_events` | 客户阶段变化时间线 |
| `campaign_analytics` | 搜索词、模板、国家、渠道等维度的效果统计 |
| `gmail_accounts` | 用户授权的 Gmail 账号 |

## 10. 开发 50 个客户的时序图

```mermaid
sequenceDiagram
  participant U as 用户
  participant FE as 前端
  participant API as 后端 API
  participant BG as 后端后台任务
  participant G as LangGraph
  participant LLM as GPT-5.5
  participant B as Brave Search
  participant DB as PostgreSQL

  U->>FE: 输入“开发 50 个 UAE 客户”
  FE->>API: POST /api/lead-tasks
  API->>DB: 创建 lead_task + agent_steps
  API-->>FE: 立即返回 task_id
  API->>BG: 启动后台自动获客流水线

  loop 前端轮询
    FE->>API: GET /api/lead-tasks/:id
    API-->>FE: 返回步骤、query、原始命中、候选客户
  end

  BG->>G: load_task / analyze_product_profile / analyze_customer_profile
  G->>LLM: 分析产品画像、参考客户和关键词
  LLM-->>G: 返回画像、关键词和搜索策略
  G->>DB: 写入 search_queries
  BG->>B: 一次性执行本轮全部 pending query
  B-->>BG: 返回搜索结果
  BG->>DB: 保存 search_results，query 标记 running/completed/failed
  BG->>LLM: 候选买家判断
  BG->>DB: 保存候选客户、联系人、ICP 分数
  BG->>DB: human_approval 置为 waiting，任务暂停等待人工审核
```

## 10.1 回复同步和跟进时序图

```mermaid
sequenceDiagram
  participant Gmail as Gmail API
  participant Q as BullMQ
  participant W as Inbox Worker
  participant G as LangGraph
  participant LLM as GPT-5.5
  participant DB as PostgreSQL
  participant FE as 前端

  Gmail-->>Q: 新邮件同步任务 / 定时轮询
  Q->>W: 执行 inbox_sync
  W->>G: 启动回复处理子图
  G->>Gmail: 拉取 thread 和 message
  G->>DB: 保存 inbound_messages
  G->>LLM: 分类客户回复意图
  LLM-->>G: 返回 intent / confidence / summary
  G->>DB: 保存 reply_classifications
  G->>DB: 写入 lead_stage_events
  G->>DB: 创建 followup_tasks
  G->>DB: 汇总 engagement_events
  G->>DB: 更新 campaign_analytics
  FE->>DB: 查询待跟进任务和客户时间线
```

## 11. 安全与合规规则

### 11.0 账号认证安全

- 邮箱密码注册时，密码必须使用强哈希算法保存，例如 Argon2 或 bcrypt。
- 登录态建议使用 HttpOnly Secure Cookie 保存刷新令牌，访问令牌短期有效。
- 忘记密码重置链接必须有有效期，令牌只保存哈希，使用后立即失效。
- Google 登录只用于账号认证，授权范围尽量最小化。
- Gmail OAuth 是发件授权，和 Google 登录分开处理、分开保存 scope 和 token。
- Microsoft OAuth 登录 / 注册 V1 不启用，不接入回调接口。
- 注册、登录、忘记密码接口需要限速，防止撞库和邮件轰炸。

### 11.1 Agent 安全边界

- GPT-5.5 不直接联网。
- GPT-5.5 不直接发送邮件或 WhatsApp。
- 所有工具调用必须由后端 Tool Registry 控制。
- 发送类工具必须经过 Guardrail 检查。
- 所有 Agent 决策和工具结果必须写入 `agent_steps`。
- 所有回复分类、客户阶段变化和跟进任务必须可追溯。

### 11.2 触达安全规则

- ICP 分数低于阈值不发送。
- 缺少来源 URL 不发送。
- 联系方式来源不明确不发送。
- 同一公司、邮箱、域名去重。
- 同一客户 30 天内不重复触达。
- 每日邮件发送量限速。
- WhatsApp 主动触达不进入 V1；V2 接入时必须优先使用已审核模板消息。
- 发送失败只允许有限重试。
- 客户退订、拒绝或明确要求停止联系后，必须停止自动触达。

## 12. 环境变量

不要把真实密钥提交到代码仓库。

```bash
# App
APP_URL=http://localhost:3000
API_URL=http://localhost:4000
NODE_ENV=development
JWT_SECRET=change_me
AUTH_COOKIE_SECRET=change_me

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/leadhunt
REDIS_URL=redis://localhost:6379

# LangGraph checkpoint
# production / shared dev: postgres
# unit tests / disposable local demo: memory
LANGGRAPH_CHECKPOINT_STORE=postgres
LANGGRAPH_CHECKPOINT_SCHEMA=public
LANGGRAPH_CHECKPOINT_DATABASE_URL=postgresql://user:password@localhost:5432/leadhunt

# GPT-5.5
OPENAI_BASE_URL=http://43.167.204.62:8080/v1
OPENAI_API_KEY=你的_gpt55_key
OPENAI_MODEL=gpt-5.5

# Brave
BRAVE_SEARCH_API_KEY=你的_brave_search_key
BRAVE_SEARCH_BASE_URL=https://api.search.brave.com/res/v1

# Google OAuth / Gmail
GOOGLE_AUTH_CLIENT_ID=xxx
GOOGLE_AUTH_CLIENT_SECRET=xxx
GOOGLE_AUTH_REDIRECT_URI=http://localhost:4000/api/auth/google/callback
GOOGLE_GMAIL_CLIENT_ID=xxx
GOOGLE_GMAIL_CLIENT_SECRET=xxx
GOOGLE_GMAIL_REDIRECT_URI=http://localhost:4000/api/oauth/google/callback

# WhatsApp V2
WHATSAPP_ACCESS_TOKEN=xxx
WHATSAPP_PHONE_NUMBER_ID=xxx
WHATSAPP_BUSINESS_ACCOUNT_ID=xxx

# Object Storage
S3_ENDPOINT=xxx
S3_ACCESS_KEY_ID=xxx
S3_SECRET_ACCESS_KEY=xxx
S3_BUCKET=leadhunt
```

## 13. 部署架构

```mermaid
flowchart LR
  Browser[Browser] --> CDN[CDN / Edge]
  CDN --> FE[Next.js Frontend]
  FE --> API[NestJS API Server]
  API --> PG[(Managed PostgreSQL)]
  API --> Redis[(Managed Redis)]
  API --> S3[(R2 / S3)]
  Redis --> Worker1[Agent Worker 1]
  Redis --> Worker2[Outreach Worker]
  Worker1 --> External[GPT-5.5 / Brave / Gmail / V2 WhatsApp]
  Worker2 --> External
```

V1 可以先部署为：

- 前端：Vercel / Cloudflare Pages / 自有服务器。
- 后端 API：VPS / Docker。
- Worker：同一台 VPS 的独立进程。
- PostgreSQL：本机 Docker 或云数据库。
- Redis：本机 Docker 或云 Redis。

后续正式全托管：

- API Server 水平扩容。
- Agent Worker 独立扩容。
- Outreach Worker 独立限速。
- PostgreSQL 开启备份。
- Redis 开启持久化和监控。

## 14. V1 开发里程碑

### 阶段 1：基础骨架

- Next.js 前端框架。
- NestJS API 框架。
- PostgreSQL + Prisma。
- Redis + BullMQ。
- 用户登录。
- Gmail OAuth 授权页面。

### 阶段 2：Agent 验证流程

- LangGraph 工作流骨架。
- GPT-5.5 调用封装。
- Brave Search API 调用封装。
- 产品画像节点。
- 参考客户画像节点。
- 搜索词生成节点。
- ICP 评分节点。

### 阶段 3：客户库和开发信

- 候选客户保存。
- 合格客户库。
- ICP 评分展示。
- 开发信模板配置。
- 开发信生成。
- Gmail 草稿创建。

### 阶段 4：半托管流程

- 人工确认节点。
- 任务暂停 / 继续。
- Agent 步骤日志。
- 发送前确认。
- 发送记录。

### 阶段 5：回复和跟进闭环

- Gmail 收件箱同步。
- 邮件打开和链接点击事件记录。
- 客户回复线程匹配。
- GPT-5.5 回复分类。
- 跟进任务生成。
- 客户阶段事件时间线。
- 搜索词、模板、国家、渠道效果分析。

### 阶段 6：全托管准备

- 发送限速。
- 去重和黑名单。
- WhatsApp Cloud API 评估。
- 成本统计。
- 失败恢复和报警。

## 15. 外部文档参考

- LangGraph JS 文档：https://docs.langchain.com/oss/javascript/langgraph/overview
- LangGraph GitHub：https://github.com/langchain-ai/langgraph
- Brave Web Search API：https://api-dashboard.search.brave.com/documentation/services/web-search
- Brave LLM Context API：https://api-dashboard.search.brave.com/documentation/services/llm-context
- Gmail API Sending：https://developers.google.com/workspace/gmail/api/guides/sending
- Gmail API Scopes：https://developers.google.com/workspace/gmail/api/auth/scopes
- WhatsApp Cloud API：https://developers.facebook.com/docs/whatsapp/cloud-api/
- BullMQ 文档：https://docs.bullmq.io/
