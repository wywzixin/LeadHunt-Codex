# LeadHunt AI 开发任务清单

版本：V1 开发任务  
日期：2026-05-14
目标：明天正式进入开发，把当前原型、需求文档、产品设计文档和技术架构文档落成可运行项目。

关联文档：

- `LeadHunt_AI_Requirements_Document.md`
- `LeadHunt_AI_Product_Design_Document.md`
- `LeadHunt_AI_Technical_Architecture.md`
- `API调用说明.md`
- `design/leadhunt-full-system-home.html`
- `design/leadhunt-ai-project-email-modal.html`
- `design/leadhunt-auth-pages.html`

## 0. 当前确认口径

- [x] Docker Desktop 已安装。
- [x] 开发期基础服务改为远程服务器 Docker Compose 启动 PostgreSQL 和 Redis，本地代码直接连接远程数据库。
- [x] 搜索方案：V1 使用 Brave Search API / LLM Context API。
- [x] Brave Search key：已收到可用 key，真实 key 只允许写入本地 `.env`，禁止写入文档和代码仓库。
- [x] AI 模型：使用用户提供的 GPT-5.5 OpenAI-compatible API。
- [x] GPT-5.5 连通性：用户已实测可以连通。
- [x] 工作流：V1 直接采用 LangGraph。
- [x] LangGraph checkpoint：开发联调和生产默认使用 PostgreSQL checkpoint；单元测试 / 一次性本地 demo 可切换为 MemorySaver。
- [x] 产品口径：“再次搜索”改为“继续找更多客户”，后续拓展应围绕同一个客户池持续执行、去重、学习和再拓展。
- [x] 发件：V1 只支持当前登录用户授权自己的 Gmail。
- [x] 登录注册：V1 支持邮箱密码登录、注册、忘记密码、Google 登录入口。
- [x] Microsoft 第三方登录 / 注册：V1 不做。
- [x] WhatsApp 自动发送：V1 不做，后续版本再接。
- [x] SerpApi / Firecrawl：V1 不使用。
- [x] 产品画像 / 客户画像页面只保存资料，AI 分析放到 AI 外贸员任务执行页。
- [x] 数据看板、我的客户、AI 外贸员、产品画像、客户画像、登录注册原型已进入设计口径。

## 1. 明天第一天必做任务

执行原则：

- [x] 每开发完一个功能，必须先完成该功能测试，再进入下一个功能。
- [ ] 测试不通过，不允许继续叠新功能。
- [ ] 每个功能至少包含：接口自测、页面自测、数据库写入检查、错误状态检查。
- [ ] 所有测试结果记录在本文件对应任务下方，或后续拆分到 `Test_Report.md`。

### 1.1 基础服务启动

- [ ] 检查 Docker Desktop 是否正常启动。（2026-04-29：本机固件虚拟化未开启，本地 Docker engine 暂缓）
- [x] 远程服务器执行 Docker Compose 启动 PostgreSQL 和 Redis。
- [x] 确认 PostgreSQL 可连接：远程 `5432`。
- [x] 确认 Redis 可连接：远程 `6379`。
- [x] 本地 `.env` 已配置远程 `DATABASE_URL` 和 `REDIS_URL`，不在文档中记录真实密钥。
- [x] 检查 `.env.example`，整理正式 `.env` 字段。
- [x] 不把任何真实密钥提交到代码仓库。

验收：

- [x] 远程 `docker compose ps` 显示 PostgreSQL / Redis 正常运行。
- [x] 后端能读取数据库连接字符串和 Redis 地址。

测试：

- [x] 执行远程 `docker compose ps`。
- [x] 执行 PostgreSQL 连接测试。
- [x] 执行 Redis ping 测试。
- [ ] 故意关闭一个服务，确认错误提示清楚。

### 1.2 项目骨架

- [x] 创建前端项目：Next.js + React + TypeScript。
- [x] 创建后端项目：NestJS + TypeScript。
- [x] 创建 Prisma 配置。
- [x] 创建基础目录结构：
  - `apps/web`
  - `apps/api`
  - `packages/shared`
  - `packages/agent`
- [x] 配置统一 lint / format / TypeScript。
- [x] 配置开发启动命令。

验收：

- [x] 前端能启动到本地端口。
- [x] 后端能启动到本地端口。
- [x] 前后端健康检查接口可访问。

测试：

- [x] 前端启动无报错。
- [x] 后端启动无报错。
- [x] `GET /health` 返回正常。
- [x] TypeScript 编译通过。
- [x] Lint 通过。

### 1.3 数据库第一版 Schema

- [x] 建立 Prisma schema。
- [x] 创建认证相关表：
  - `users`
  - `auth_accounts`
  - `user_sessions`
  - `password_reset_tokens`
- [x] 创建 Gmail 授权表：
  - `gmail_accounts`
- [x] 创建 AI 任务相关表：
  - `lead_tasks`
  - `agent_steps`
  - `search_queries`
  - `search_results`
- [x] 创建客户相关表：
  - `lead_candidates`
  - `lead_contacts`
  - `icp_scores`
  - `crm_leads`
- [x] 创建邮件与跟进相关表：
  - `outreach_drafts`
  - `send_logs`
  - `engagement_events`
  - `inbox_threads`
  - `inbound_messages`
  - `reply_classifications`
  - `followup_tasks`
  - `lead_stage_events`
  - `campaign_analytics`

验收：

- [x] Prisma migrate 能成功执行。（已对远程 PostgreSQL 执行 `prisma migrate deploy`）
- [x] 数据库里能看到核心表。

测试：

- [x] 执行 Prisma migration。
- [x] 执行 Prisma generate。
- [x] 用脚本写入并读取一条测试用户。
- [x] 用脚本写入并读取一条测试任务。
- [x] 回滚或重建数据库流程可执行。（已新增 `scripts/db-maintenance.ps1` 和 `DB_MAINTENANCE.md`；默认安全检查，恢复 / 重建需显式 `-Force`）

### 1.4 登录注册最小闭环

- [x] 接入 `design/leadhunt-auth-pages.html` 的页面结构和视觉风格。
- [x] 实现邮箱密码注册。（代码、单元测试、真实 HTTP + DB 集成已通过）
- [x] 实现邮箱密码登录。（代码、单元测试、真实 HTTP + DB 集成已通过）
- [x] 实现退出登录。
- [x] 实现当前用户接口 `GET /api/auth/me`。
- [x] 实现忘记密码请求接口。
- [x] 忘记密码邮件可以先写入日志或开发邮箱，正式邮件后接。
- [x] Google 登录入口先保留前端入口和后端接口占位。
- [x] 不做 Microsoft 第三方登录 / 注册。

验收：

- [x] 新用户可注册。
- [x] 用户可登录进入系统。
- [x] 未登录访问后台会跳转登录页。
- [x] 登录态刷新后仍可识别当前用户。（服务层和真实 HTTP session 已测）

测试：

- [x] 注册成功测试。（服务层单元测试）
- [x] 重复邮箱注册失败测试。（服务层单元测试）
- [x] 密码太短失败测试。（HTTP 400 + 服务层单元测试）
- [x] 登录成功测试。（服务层单元测试）
- [x] 密码错误失败测试。（服务层单元测试）
- [x] 退出登录测试。（服务层单元测试）
- [x] 未登录访问后台拦截测试。（前端路由保护 307）
- [x] 忘记密码请求测试。（服务层单元测试）
- [x] Microsoft 登录 / 注册入口不可用测试。
- [x] `design/登录页面.png` 100% 视口原型对齐截图检查。
- [x] `design/注册页面.png` 100% 视口原型对齐截图检查。
- [x] `design/忘记密码.png` 100% 视口原型对齐截图检查。

## 2. V1 完整开发任务

### 2.1 前端基础框架

- [x] 搭建 SaaS 主布局。
- [x] 接入顶部栏：
  - Logo
  - 消息
  - 当前用户头像
  - 用户昵称
  - 公司 / 身份描述
- [x] 接入左侧导航：
  - AI 外贸员
  - 我的产品画像
  - 客户画像
  - AI 搜索客户
  - ICP 判断
  - 合格客户库
  - Google 指令
  - 模板配置
  - 邮件营销
  - 个人邮箱
  - 邮寄宣传册
  - 我的客户
  - 数据看板
- [x] 左侧菜单点击后高亮当前页面。
- [x] 删除旧菜单：
  - 工作台
  - AI 搜索客户
  - ICP 判断
  - 合格客户库
  - Google 指令
  - 导出记录
- [x] 顶部去掉工具箱。
- [x] 当前账号显示王亚伟。

验收：

- [x] 页面宽度占满屏幕。
- [x] 右上角账号区域不留异常空白。
- [x] 当前页面导航高亮正确。

测试：

- [x] 导航点击高亮测试。
- [x] 刷新页面后当前路由保持测试。
- [x] 主要页面在 1440px、1920px 宽度下无遮挡测试。
- [x] 顶部账号区域显示王亚伟测试。
- [x] 当前 16 个实际页面完成 100% 视口外层滚动扫描，均无浏览器级横向 / 纵向滚动。

### 2.2 产品画像页面

- [x] 按新版原型实现产品画像页。
- [x] 页面只负责保存资料，不展示 AI 分析结果。
- [x] 字段：
  - 官网 / 产品页链接
  - 上传产品资料，可选
  - 补充说明，可选
- [x] 右侧只做当前保存资料预览。
- [x] 保存后通过 API upsert 写入 `product_profiles`。（真实远程数据库写入已验证）
- [x] AI 外贸员任务启动时读取该资料。

验收：

- [x] 用户能保存 `https://telecorenet.com/`。
- [x] 用户能补充产品说明。
- [x] 页面不出现“AI 解析产品画像”按钮。
- [x] 页面不要求用户手工确认品牌、关键词、供应能力等 AI 推理字段。

测试：

- [x] 保存官网链接成功测试。（服务层）
- [x] 保存补充说明成功测试。（服务层）
- [x] 空官网提示测试。（服务层）
- [x] 多行产品页链接保存测试。（服务层资料链接数组）
- [x] 上传资料入口状态测试。（浏览器渲染）
- [x] 保存后右侧预览刷新测试。（浏览器渲染）
- [x] 数据库写入检查。
- [x] `design/客户画像.png` 原型对齐截图检查。
- [x] `design/产品画像.png` 原型对齐截图检查。

### 2.3 客户画像页面

- [x] 按新版原型实现客户画像页。
- [x] 页面只负责保存资料，不展示 AI 分析结果。
- [x] 字段：
  - 目标国家 / 区域
  - 参考客户官网
  - 补充说明，可选
  - 从 CRM 选择样本，可选
- [x] 默认参考客户示例：
  - `https://spectrummea.com/`
  - `http://highcloud.ae/`
- [x] 保存后通过 API upsert 写入 `customer_profiles`。（真实远程数据库写入已验证）
- [x] AI 外贸员任务启动时读取该资料。

验收：

- [x] 用户能保存目标市场和参考客户官网。
- [x] 页面不出现“AI 解析客户画像”按钮。
- [x] 页面不展示客户类型、采购可能性等 AI 推理字段。

测试：

- [x] 保存目标国家成功测试。（服务层）
- [x] 保存参考客户官网成功测试。（服务层）
- [x] 多行参考客户官网保存测试。（服务层 + 浏览器渲染）
- [x] 从 CRM 选择样本入口状态测试。（浏览器渲染）
- [x] 保存后右侧预览刷新测试。（浏览器渲染）
- [x] 数据库写入检查。

### 2.4 高级搜索策略库

- [x] 建立搜索策略库数据结构。
- [x] 记录字段：
  - `operator_source`
  - `execution_status`
  - `operator_name`
  - `strategy_template`
  - `keyword_groups`
  - `effectiveness_score`
- [x] 内置 Brave 官方 operator 白名单。
- [x] 内置 Google 官方常用搜索逻辑。
- [x] 内置 common SEO 操作符，但默认不进入自动执行。
- [x] 结合 `google search.md` 作为业务经验，不作为完整规则库。
- [x] 每次任务至少生成 15 个组合查询。

验收：

- [x] 系统能生成至少 15 个“高级搜索策略 + 通信设备关键词”的 query。
- [x] 每个 query 能说明 operator 来源和执行状态。
- [x] `manual_only` / `disabled` 不进入 Brave 自动搜索。

测试：

- [x] 生成 15 个以上 query 测试。
- [x] operator 来源字段完整测试。
- [x] execution_status 字段完整测试。
- [x] manual_only 不执行测试。
- [x] disabled 不执行测试。
- [x] 搜索策略写入数据库测试。（服务层写入参数和真实远程数据库写入均已验证）

### 2.5 关键词扩展

- [x] 实现关键词扩展节点。
- [x] 扩词维度：
  - 用户输入的主产品
  - 同类产品 / 细分品类
  - 商品长尾词
  - 上下游词
  - 客户采购意图词
  - 目标市场词
  - 行业场景词
  - 排除词
- [x] 通信设备默认词库：
  - `telecom equipment`
  - `RRU`
  - `BBU`
  - `AAU`
  - `microwave backhaul`
  - `telecom power`
  - `Huawei ZTE spare parts`
  - `telecom equipment distributor`
  - `system integrator`
  - `telecom contractor`
  - `tower power IBS service`
- [x] 排除词：
  - `job`
  - `news`
  - `training`
  - `consumer phone`
  - `course`
  - `forum`

验收：

- [x] 输入“找 UAE 通信设备经销商”后，能生成产品词、客户词、地区词和排除词。
- [x] 关键词可用于 Brave query 拼接。

测试：

- [x] 主产品词提取测试。
- [x] 同类产品词扩展测试。
- [x] 采购意图词扩展测试。
- [x] 目标市场词扩展测试。
- [x] 排除词生成测试。
- [x] JSON 输出结构校验。

### 2.6 Brave 搜索服务

- [x] 封装 Brave Search API 客户端。
- [x] 封装 Brave LLM Context API 客户端。
- [x] 支持 query、country、language、count 等参数。
- [x] 增加请求限速。
- [x] 增加缓存。
- [x] 增加错误重试。
- [x] 记录搜索请求和返回结果。（服务层写入参数和真实远程数据库写入均已验证）

验收：

- [x] 后端能用 Brave key 搜索并返回标题、URL、摘要。（用户已用同一 key 实测通过；Codex 本机网络路径仍无法连通 `api.search.brave.com:443`）
- [x] 搜索结果写入 `search_results`。（服务层 mock 和真实远程数据库写入均已验证）
- [x] 搜索异常时有可读错误信息。

测试：

- [x] Brave 搜索成功测试。（mock）
- [x] Brave key 缺失测试。
- [x] Brave 请求失败重试测试。
- [x] 搜索结果缓存测试。
- [x] 搜索结果入库测试。（服务层 mock）
- [x] 同一 query 去重测试。

### 2.7 LangGraph Agent 工作流

- [x] 建立 LangGraph 项目结构。
- [x] 创建 V1 工作流节点：
  - `load_task`
  - `analyze_product_profile`
  - `analyze_customer_profile`
  - `expand_keywords`
  - `plan_search_queries`
  - `brave_search`
  - `normalize_leads`
  - `extract_contacts`
  - `score_icp`
  - `human_approval`
  - `generate_email`
  - `wait_email_confirmation`
  - `send_gmail`
  - `sync_crm`
  - `schedule_followup`
  - `task_summary`
- [x] 所有节点写入 `agent_steps`。（服务层 mock 和真实远程数据库写入均已验证）
- [x] 支持暂停、继续、失败重试。
- [x] 用户确认点可以暂停工作流。
- [x] 支持 `LANGGRAPH_CHECKPOINT_STORE=memory|postgres` 配置。
- [x] 非测试环境默认使用 PostgreSQL checkpoint，测试环境默认使用 MemorySaver。
- [x] `PostgresSaver.setup()` 已接入初始化 / 懒加载，服务销毁时关闭连接。
- [x] 创建获客任务后，后端后台自动执行首轮完整链路：生成 query、校验 query、执行全部 pending Brave 搜索、清洗候选、评分入库，并停在人工审核客户节点。
- [x] 后端启动时恢复最近仍处于 `running` 的首轮获客任务；已有 query 的任务跳过 GPT 规划，继续执行未完成 query。

验收：

- [x] 创建任务后能生成步骤时间线。
- [x] 每个节点状态可保存。（服务层 mock 和真实远程数据库写入均已验证）
- [x] 前端不再负责等待 45 秒后触发 `/api/lead-tasks/:taskId/search`；页面只轮询任务详情展示进度。
- [x] query 开始执行即标记 `running`，拿到 Brave 原始结果后先回写 `resultCount`，页面能看到原始命中和候选数增长。
- [x] 邮件发送前能暂停等待用户确认。
- [x] LangGraph checkpoint 表已在 PostgreSQL 中创建并能写入状态；服务重启恢复需继续做专项 E2E 复测。

测试：

- [x] 创建任务启动工作流测试。
- [x] 每个节点写入 `agent_steps` 测试。
- [x] 节点失败状态测试。
- [x] 暂停 / 继续测试。
- [x] 人工确认节点等待测试。
- [x] 任务恢复测试。

### 2.8 GPT-5.5 服务

- [x] 封装 OpenAI-compatible Chat Completions 客户端。
- [x] 使用 `API调用说明.md` 中的 GPT-5.5 API。
- [x] 统一 Prompt 模板：
  - 产品画像分析
  - 参考客户画像分析
  - 关键词扩展
  - 搜索策略生成
  - ICP 判断
  - 开发信生成
  - AI 改写
  - 回复分类
  - 任务总结
- [x] 增加 JSON 输出校验。
- [x] 增加失败降级和重试。
- [x] GPT-5.5 已接入 AI 外贸员主链路，不再只用于邮件改写：任务创建时会分析产品画像、分析客户画像、扩展关键词并生成搜索策略。
- [x] 搜索指令生成改为 GPT-5.5 主导，后端策略库保留为兜底；后端只校验 operator、国家、数量、重复、基本信号和安全排除词。
- [x] 新增候选买家判断 Prompt，用于区分真实买家、可能买家、供应商/竞争对手、目录页、文章页、招聘页、市场报告和无关结果。

验收：

- [x] GPT-5.5 能返回结构化产品画像。
- [x] GPT-5.5 能返回结构化搜索词。
- [x] 输出解析失败时能重试或给出错误提示。

测试：

- [x] GPT-5.5 客户端连通测试。
- [x] 产品画像 Prompt 测试。
- [x] 客户画像 Prompt 测试。
- [x] 关键词扩展 Prompt 测试。
- [x] ICP 判断 Prompt 测试。
- [x] 候选买家判断 Prompt 测试。
- [x] JSON schema 校验失败重试测试。

### 2.9 候选客户和 ICP 判断

- [x] 清洗 Brave 搜索结果。
- [x] 提取公司名称、官网、国家、摘要、来源 URL。
- [x] 提取邮箱、电话、社媒字段，V1 不发送 WhatsApp。
- [x] 去重公司、域名、邮箱。
- [x] ICP 评分维度：
  - 行业相关度
  - 客户类型
  - 产品匹配度
  - 国家 / 地区
  - 联系方式完整度
  - 风险项
- [x] 写入 `lead_candidates`、`lead_contacts`、`icp_scores`。
- [x] 候选客户入库前可调用 GPT-5.5 做买家语义判断。
- [x] 最终 ICP 分数采用 GPT 买家匹配分 60% + 后端证据质量分 40% 的融合方式。
- [x] 目录页、内容文章、招聘页、市场报告、无关页和供应商/竞争对手会被封顶降权，避免直接进入高分候选。
- [x] GPT 候选判断增加规则预筛和批次上限：每批最多 5 个候选进入 GPT，明显低质页面由规则层处理，避免长任务卡住。

验收：

- [x] 候选客户数据能保存评分和匹配理由。（页面展示待 2.10）
- [x] 低分客户不会进入发送流程。
- [x] 用户可以查看来源 URL。

测试：

- [x] 搜索结果清洗测试。
- [x] 公司去重测试。
- [x] 域名去重测试。
- [x] 联系方式提取测试。
- [x] ICP 高分客户测试。
- [x] ICP 低分客户拦截测试。
- [x] 来源 URL 保存测试。

### 2.10 AI 外贸员页面

- [x] 实现 AI 外贸员首页。
- [x] 实现 AI 项目执行区。
- [x] 展示用户原始任务。
- [x] 展示执行流程时间线。
- [x] 展示 AI 扩展词卡片。
- [x] 展示高级搜索策略 + Brave 搜索卡片。
- [x] 展示候选客户表格。
- [x] 支持用户确认客户进入邮件阶段。
- [x] 展示 CRM 同步卡片。
- [x] 展示本次任务总结。
- [x] 底部输入框可继续补充指令。
- [x] 首轮搜索相关入口不再展示“再次搜索 / 继续找更多客户”按钮，创建任务后自动执行本轮全部 query。
- [x] 主搜索按钮和空状态文案已改为后端自动执行本轮全部搜索指令。
- [ ] AI 外贸员页面展示客户池状态：本轮新增、高分客户、待审核、已过滤、还可继续搜索指令。
- [ ] 普通用户界面隐藏 `human_approval`、`wait_email_confirmation`、`checkpoint` 等内部技术词。

验收：

- [x] 页面不显示介绍视频。
- [x] 页面不显示观看回放。
- [x] 执行过程能看到 AI 做了什么。
- [x] 关键动作需要用户确认。

测试：

- [x] 输入任务创建测试。
- [x] 任务步骤渲染测试。
- [x] AI 扩展词卡片展示测试。
- [x] 搜索策略卡片展示测试。
- [x] 候选客户表格展示测试。
- [x] 用户确认客户测试。
- [x] 页面滚动到底部测试。

### 2.10.1 持续客户池 / 继续找更多客户

- [ ] 建 `lead_pools` 数据模型，保存获客主题、目标市场、产品关键词、客户类型词和当前状态。
- [ ] 建 `lead_search_rounds` 数据模型，记录每一次继续拓展的搜索轮次。
- [ ] `search_queries` 增加 `pool_id`、`round_id`、执行状态和去重统计。
- [ ] `lead_candidates` 增加 `pool_id`、`round_id`，支持跨轮次查询。
- [ ] 建 `lead_dedupe_keys`，按官网域名、邮箱、公司名 + 国家、CRM 已有客户去重。
- [ ] 建 `lead_candidate_events`，记录通过、拒绝、过滤、加入 CRM、发送、退订等反馈。
- [ ] “继续找更多客户”优先执行客户池未完成搜索指令，耗尽后再根据反馈生成下一轮指令。
- [ ] 竞品关键词经验纳入 query 生成：避免消费电子、零售、电商、招聘、新闻、报告等弱线索，优先真实通信设备买家类型词。

### 2.11 Gmail OAuth 和个人邮箱

- [x] 实现 Google OAuth for Gmail。
- [x] 授权 scope 只申请 Gmail 所需权限。
- [x] Refresh Token 加密保存。
- [x] 支持撤销授权。
- [x] 个人邮箱页展示当前 Gmail 授权状态。
- [x] 不支持 QQ / 126 / 163 授权码。
- [x] 不做系统域名 / 个人域名 / 域名配置。

验收：

- [x] 用户能授权 Gmail。（代码、mock callback、DB 冒烟已通过；真实 Google consent 需浏览器手动确认）
- [x] 系统能展示授权邮箱。
- [x] 用户能撤销授权。
- [x] 邮件发送前能判断 Gmail 是否已授权。

测试：

- [x] Gmail OAuth 跳转测试。
- [x] Gmail OAuth callback 测试。
- [x] Token 加密保存测试。
- [x] 授权状态展示测试。
- [x] 撤销授权测试。
- [x] 授权失效提示测试。
- [x] `design/个人邮箱.png` 原型对齐截图检查。

### 2.12 邮件确认弹窗和 AI 改写

- [x] 实现半托管邮件确认弹窗。
- [x] 左侧展示：
  - 发件 Gmail
  - Google OAuth 已授权
  - 仅使用当前登录用户邮箱发送
  - 收件人
  - 回复邮箱
  - 邮件模板
  - 邮件主题
  - 发送时间
  - 邮件正文编辑器
- [x] 右侧只保留一个 AI 改写输入框。
- [x] AI 改写字段：
  - 输出语言
  - 邮件语气
  - 需要改写的内容
  - 一键改写按钮
- [x] 改写结果覆盖正文。
- [x] 底部按钮：
  - 重置
  - 预览
  - 保存到 Gmail 草稿箱
  - 另存为模板
  - 确认发送
- [x] 发送前必须用户确认。

验收：

- [x] 弹窗不显示域名配置。
- [x] 弹窗不显示发送记录和邮件模板 Tab。
- [x] 用户能编辑正文。
- [x] 用户能 AI 改写并覆盖正文。
- [x] 用户确认后通过 Gmail API 发送。（单元测试和 mock Google API 冒烟通过，未触发真实外发）

测试：

- [x] 弹窗打开测试。
- [x] 发件 Gmail 展示测试。
- [x] 收件人展示测试。
- [x] 正文编辑测试。
- [x] AI 改写语言 / 语气测试。
- [x] AI 改写覆盖正文测试。
- [x] 保存 Gmail 草稿测试。
- [x] 确认发送测试。
- [x] Gmail 未授权拦截测试。
- [x] 发送失败提示测试。

### 2.13 CRM 同步和我的客户

- [x] 实现 CRM 客户列表。
- [x] 支持公司列表 / 联系人列表。
- [x] 支持收藏列表。
- [x] 支持自动分组：
  - 潜在客户
  - 7 天内联系客户
  - 未联系客户
- [x] 支持客户表格：
  - 公司名称
  - 国家 / 地区
  - 行业
  - 客户阶段
  - 负责人
  - 最近跟进
  - 操作
- [x] AI 任务完成后同步客户到 CRM。
- [x] 写入客户标签和阶段。

验收：

- [x] 邮件发送成功后客户阶段变为“已触达”。
- [x] 系统默认创建 3 天后跟进任务。
- [x] 我的客户页面能看到同步结果。

测试：

- [x] CRM 客户写入测试。
- [x] 客户标签写入测试。
- [x] 客户阶段更新测试。
- [x] 3 天后跟进任务创建测试。
- [x] 我的客户列表展示测试。
- [x] 公司列表 / 联系人列表切换测试。

### 2.14 CRM 数据查看弹窗

- [x] AI 项目执行页展示 CRM 同步缩略表格。
- [x] 点击缩略图后打开 CRM 数据弹窗。
- [x] 弹窗字段：
  - 公司名称
  - 国家
  - 行业
  - 电话
  - 邮箱
  - 数据来源
  - AI 标签
  - 客户阶段
  - 负责人
  - 评分
- [x] 支持分页。

验收：

- [x] 用户不用跳转 CRM，也能查看本次同步客户。
- [x] 弹窗背景遮罩当前 AI 项目页面。

测试：

- [x] 缩略表格展示测试。
- [x] 点击打开弹窗测试。
- [x] 表格字段完整测试。
- [x] 分页测试。
- [x] 关闭弹窗测试。

### 2.15 回复和跟进闭环

- [x] 邮件发送后创建 Gmail 线程跟踪。
- [x] 定时同步 Gmail 收件箱、已发送邮件、线程和客户回复。
- [x] 识别回复类型：
  - 感兴趣
  - 要报价
  - 要目录
  - 拒绝
  - 退订
  - 自动回复
- [x] 根据回复分类更新客户阶段。
- [x] 根据规则创建跟进任务。
- [x] 3 天未回复创建二次跟进任务。
- [x] 写入 `lead_stage_events`。
- [x] 写入 `campaign_analytics`。

验收：

- [x] 系统能同步 Gmail 回复。
- [x] 回复能被 AI 分类。
- [x] 高意向回复能创建人工处理任务。
- [x] 拒绝 / 退订客户不会再触达。

测试：

- [x] Gmail 线程同步测试。
- [x] 新回复入库测试。
- [x] 自动回复分类测试。
- [x] 感兴趣分类测试。
- [x] 要报价分类测试。
- [x] 拒绝 / 退订分类测试。
- [x] 3 天未回复任务创建测试。
- [x] 客户阶段事件写入测试。

### 2.16 数据看板

- [x] 实现新版数据看板。
- [x] 展示：
  - 数据概况
  - 搜索偏好
  - 到达率
  - 搜索次数
  - 我的数据
- [x] 支持全部 / 本月 / 本周 / 本日筛选。
- [x] 支持企业数据 / 个人数据切换占位。
- [x] 数据来源：
  - 搜索次数
  - 触达次数
  - 回复次数
  - 收藏次数
  - 收藏企业
  - 收藏个人
  - 邮件达到率

验收：

- [x] 左右卡片对齐。
- [x] 数据看板在左侧 CRM 客户管理分组下。
- [x] 页面滚动正常。

测试：

- [x] 数据概况渲染测试。
- [x] 搜索偏好渲染测试。
- [x] 搜索次数渲染测试。
- [x] 到达率渲染测试。
- [x] 我的数据图表渲染测试。
- [x] 时间筛选测试。
- [x] 左右卡片对齐截图检查。

### 2.17 模板配置

- [x] 实现开发信模板列表。
- [x] 支持系统模板和自建模板展示入口。
- [x] 内置模板：
  - 项目供货模板
  - 备件现货模板
  - 售后维修模板
  - 新品推广模板
- [x] 支持新增模板。
- [x] 支持编辑模板。
- [x] 支持预览模板。

验收：

- [x] 邮件生成时能选择模板。
- [x] 模板可编辑。

测试：

- [x] 模板列表展示测试。
- [x] `design/模板配置.png` 原型对齐截图检查。
- [x] 新建模板测试。
- [x] 编辑模板测试。
- [x] 预览模板测试。
- [x] 邮件生成读取模板测试。

### 2.18 邮件营销

- [x] V1 弱化邮件营销后台。
- [x] 保留发邮件入口。
- [x] 发送记录可以作为数据展示，不作为邮件确认弹窗的 Tab。
- [x] 不做复杂群发营销。

验收：

- [x] 主要发件动作在 AI 项目执行页邮件确认弹窗完成。

测试：

- [x] 邮件营销页面弱化展示测试。
- [x] 不出现复杂群发入口测试。
- [x] `design/邮件营销.png` 原型对齐截图检查。

### 2.19 邮寄宣传册

- [x] V1 可保留入口。
- [x] 不作为主链路。
- [x] 可只实现静态页面或低优先级功能。
- [x] 按 `design/邮寄宣传册.png` 原型对齐任务概览、二级导航、统计卡和创建任务表单。

验收：

- [x] 不影响 AI 外贸员主流程。

测试：

- [x] 页面入口可访问测试。
- [x] 主流程不依赖邮寄宣传册测试。
- [x] `design/邮寄宣传册.png` 原型对齐截图检查。

## 3. 后端 API 任务

### 3.1 Auth API

- [x] `POST /api/auth/register`
- [x] `POST /api/auth/login`
- [x] `POST /api/auth/logout`
- [x] `GET /api/auth/me`
- [x] `POST /api/auth/forgot-password`
- [x] `POST /api/auth/reset-password`
- [x] `GET /api/auth/google`
- [x] `GET /api/auth/google/callback`

### 3.2 Profile API

- [x] `GET /api/product-profile`
- [x] `PUT /api/product-profile`
- [x] `GET /api/customer-profile`
- [x] `PUT /api/customer-profile`
- [x] `POST /api/uploads`

### 3.3 Lead Task API

- [x] `POST /api/lead-tasks`
- [x] `GET /api/lead-tasks/:taskId`
- [x] `GET /api/lead-tasks/:taskId/events`
- [x] `GET /api/lead-tasks/:taskId/leads`
- [x] `POST /api/lead-tasks/:taskId/search`
- [x] `POST /api/lead-tasks/:taskId/approve`
- [x] `POST /api/lead-tasks/:taskId/summary`
- [x] `POST /api/lead-tasks/:taskId/pause`
- [x] `POST /api/lead-tasks/:taskId/resume`
- [x] `POST /api/lead-tasks/:taskId/cancel`

### 3.4 Gmail API

- [x] `GET /api/gmail/oauth/start`
- [x] `GET /api/gmail/oauth/callback`
- [x] `GET /api/gmail/account`
- [x] `DELETE /api/gmail/account`
- [x] `POST /api/gmail/drafts`
- [x] `POST /api/gmail/send`
- [x] `POST /api/gmail/sync`

### 3.5 CRM API

- [x] `GET /api/crm/leads`
- [x] `GET /api/crm/leads/:id`
- [x] `POST /api/crm/leads`
- [x] `PATCH /api/crm/leads/:id`
- [x] `GET /api/crm/analytics`

## 4. 需要你明天准备的东西

- [x] Brave Search API Key。
- [x] GPT-5.5 API Key / Base URL / Model 名称。
- [x] Google Cloud OAuth Client：
  - 登录用 Google Auth Client
  - Gmail 发件用 Google Gmail Client
- [x] 本地 `.env` 文件，不提交 Git。
- [x] 一个用于测试的 Gmail 账号。
- [x] 是否需要正式域名：本地开发可先不用。（当前本地开发 + 远程数据库，不阻塞 V1 开发）

## 5. 明确不做

- [x] 不做 Microsoft 第三方登录 / 注册。（前端入口已显式禁用，后端未接 Microsoft OAuth）
- [x] 不做 WhatsApp 自动发送。（代码扫描未接 WhatsApp / 自动发送）
- [x] 不做短信发送。（手机号找回入口已显式禁用，后端未接短信发送）
- [x] 不做 7*24 全托管。（当前为半托管人工确认链路）
- [x] 不接 SerpApi。（代码扫描未接 SerpApi）
- [x] 不接 Firecrawl。（代码扫描未接 Firecrawl）
- [x] 不接 QQ / 126 / 163 授权码发信。（当前仅 Gmail OAuth）
- [x] 不做域名邮箱配置。（代码和页面不引导配置 DNS / SPF / DKIM / DMARC）
- [x] 不做黑名单独立菜单。（代码扫描未新增独立黑名单菜单）
- [x] 不做 OpenAI Search 模型作为 V1 搜索方案。（当前 V1 搜索方案为 Brave Search）

## 6. 第一阶段完成标准

第一阶段完成后，需要达到：

- [x] 远程 PostgreSQL / Redis 正常，本地代码可连接。
- [x] 前端可以登录进入系统。
- [x] 后端 API 可以鉴权。
- [x] 产品画像和客户画像可以保存。
- [x] 可以创建一个 AI 外贸员任务。
- [x] LangGraph 能跑通一个空流程并写入 `agent_steps`。
- [x] Brave 搜索能返回候选 URL。（用户已实测 key 可返回结果；Codex 本机网络路径仍记录为环境问题）
- [x] GPT-5.5 能生成关键词和搜索策略。
- [x] 页面能展示任务步骤。

## 7. V1 最终完成标准

V1 完成后，需要达到：

- [x] 用户能注册、登录、找回密码。
- [x] 用户能保存产品画像和客户画像资料。
- [x] 用户输入自然语言任务后，AI 能生成执行计划。
- [x] AI 能分析产品资料和参考客户资料。
- [x] AI 能生成至少 15 个高级搜索策略组合。
- [x] 后端能调用 Brave 搜索候选公司。（代码链路、mock Brave 和真实数据库入库通过；当前 Codex 本机到 `api.search.brave.com` 仍为 `fetch failed`，用户侧 key 已实测可用）
- [x] 系统能清洗客户并做 ICP 评分。
- [x] 用户能确认候选客户。
- [x] 系统能生成开发信。
- [x] 用户能在邮件确认弹窗里编辑和 AI 改写开发信。
- [x] 用户确认后，系统通过 Gmail API 发送邮件。（代码路径和 mock Google API 冒烟通过，未真实外发）
- [x] 客户和触达记录能同步到 CRM。
- [x] 系统能创建 3 天后跟进任务。
- [x] 系统能同步 Gmail 回复并做回复分类。
- [x] 数据看板能展示搜索、触达、收藏、回复等基础数据。
- [x] 本次任务总结清楚说明 AI 做了什么、找到了什么、发了什么、后续怎么跟。

## 8. 风险记录

- [x] Brave operator 仍有实验性，需要记录每个 query 效果。（`search_queries` 已记录 `resultCount`、`qualifiedCount`、`effectivenessScore`，搜索执行会回写每条 query 效果）
- [x] Gmail 发送量受 Google 风控限制，需要限速。（已新增 `GMAIL_DAILY_SEND_LIMIT` 和 `GMAIL_MIN_SEND_INTERVAL_MS` 后端发送前检查）
- [x] 邮件打开率不能只靠 Gmail API，需要追踪像素或追踪链接，且只能作为趋势指标。（已在 Gmail 发送时注入 tracking pixel，`/api/tracking/open/:sendLogId.gif` 写入 `engagement_events`，CRM analytics 返回唯一打开数、打开率和 7 日打开趋势，并标注只能作为趋势信号）
- [x] GPT-5.5 输出需要 JSON 校验，避免结构化解析失败。（`LeadHuntAiService` 使用 Zod schema 校验并失败重试，测试覆盖失败后抛出可读错误）
- [x] 搜索结果可能混入不相关行业，需要 ICP 评分和人工确认。（候选客户入库会写 ICP 分数，确认接口会暂停在人工确认节点）
- [x] Gmail OAuth 和 Google 登录必须分开，不要混用 scope。（Google 登录 scope 仅 `openid email profile`，Gmail OAuth 独立申请 Gmail scopes）
- [ ] 继续找更多客户如果没有客户池和跨轮次去重，会重复返回已看过客户；需按 `lead_pools` / `lead_dedupe_keys` 方案补齐。
- [ ] UI 如果展示 `LangGraph`、`checkpoint`、`human_approval` 等技术词，会降低外贸用户理解效率；普通页面必须使用业务语言。

## 9. 明天开工顺序建议

1. 启动 Docker，确认 PostgreSQL / Redis。
2. 初始化 monorepo 和前后端项目。
3. 建 Prisma schema 和第一版 migration。
4. 实现 Auth API 和登录注册页面。
5. 实现主布局和路由。
6. 实现产品画像 / 客户画像保存。
7. 封装 GPT-5.5 客户端。
8. 封装 Brave Search 客户端。
9. 搭 LangGraph 空工作流。
10. 创建第一个 AI 外贸员任务并把步骤写进数据库。

## 10. 测试策略

### 10.1 测试原则

- [ ] 一个功能一个功能推进，不允许多个大功能同时半成品堆叠。
- [ ] 每个功能开发完成后，必须完成测试并记录结果。
- [ ] 测试通过后，才进入下一个功能。
- [ ] 测试失败时，先修复当前功能，不新开功能。
- [ ] 涉及外部 API 的功能必须同时测试成功、失败、限速、缺少 key 四种情况。

### 10.2 测试类型

- [ ] 单元测试：工具函数、Prompt 输出解析、ICP 评分、query 生成。
- [ ] 接口测试：Auth API、Profile API、Lead Task API、Gmail API、CRM API。
- [ ] 数据库测试：Prisma 写入、查询、关联、唯一约束、事务。
- [ ] Worker 测试：BullMQ 入队、执行、失败重试、延迟任务。
- [ ] LangGraph 测试：节点状态、暂停恢复、人工确认、失败续跑。
- [ ] LangGraph checkpoint E2E：PostgreSQL checkpoint 写入、API 重启、按同一 thread 恢复继续执行。
- [ ] 客户池 E2E：第一次找客户 -> 继续找更多客户 -> 不重复已执行 query 和已存在客户。
- [ ] 前端测试：页面渲染、表单校验、按钮状态、弹窗交互。
- [ ] 端到端测试：注册登录 -> 保存画像 -> 创建任务 -> 搜索 -> ICP -> 邮件确认 -> CRM 同步。

### 10.3 每个功能的完成定义

一个功能只有同时满足以下条件才算完成：

- [ ] 代码实现完成。
- [ ] 页面或接口能跑通。
- [ ] 数据库写入和读取正常。
- [ ] 成功路径测试通过。
- [ ] 失败路径测试通过。
- [ ] 空状态测试通过。
- [ ] 权限校验测试通过。
- [ ] 控制台和后端日志无明显错误。
- [ ] 相关任务清单勾选。

### 10.4 建议测试命令

后续项目初始化后补充实际命令，默认目标：

```bash
# 类型检查
npm run typecheck

# 单元测试
npm run test

# 接口 / 集成测试
npm run test:integration

# 前端端到端测试
npm run test:e2e

# Lint
npm run lint
```

### 10.5 测试记录模板

每完成一个功能，在该功能下补充，或同步记录到 `Test_Report.md`：

```text
测试时间：
测试功能：
测试命令：
测试账号：
通过项：
失败项：
修复记录：
是否允许进入下一个功能：是 / 否
```

### 10.6 测试闸门

明天开始开发时，默认执行顺序固定为：

1. 开发当前功能。
2. 本地运行当前功能。
3. 跑当前功能相关测试。
4. 修复失败项。
5. 在 `Test_Report.md` 记录测试结果。
6. 测试通过后，再进入下一个功能。

未完成测试记录的功能，不视为完成。
