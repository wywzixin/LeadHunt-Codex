# LeadHunt AI 需求文档

版本：V1.0  
日期：2026-05-14
项目定位：通信设备行业 AI 外贸获客与跟进系统

## 1. 项目背景

LeadHunt AI 是面向通信设备出口商的垂直 AI 外贸员产品，不做泛行业获客工具。系统需要围绕通信设备行业的真实外贸场景工作：先理解卖方产品与现有客户类型，再搜索海外相似客户，判断是否符合 ICP，生成可编辑开发信，通过当前登录用户授权的 Gmail 发出，并把客户沉淀到 CRM 与后续跟进流程中。

第一版以验证业务闭环为目标，不追求 7*24 全自动运行，也不接入付费搜索聚合服务。搜索能力采用 Brave AI 搜索，AI 分析与文案生成采用 GPT-5.5，工作流编排采用 LangGraph，生产和联调环境使用 PostgreSQL checkpoint 保存 Agent 状态。

## 2. 产品目标

1. 让通信设备出口商可以输入一句自然语言任务，例如“帮我找 UAE 通信设备经销商，并生成开发信”。
2. 系统自动分析卖方独立站 `telecorenet.com` 的产品能力，形成产品画像。
3. 系统自动分析现有客户 `spectrummea.com`、`highcloud.ae`，形成参考客户画像。
4. 系统基于产品画像和参考客户画像，从“高级搜索策略库”中选择合适的搜索策略，生成“搜索操作符 + 通信设备关键词 + 目标国家/客户类型”的组合查询，再由 Brave AI 搜索执行，找到相似海外公司。
5. 系统对候选公司做 ICP 判断，只保留高匹配客户。
6. 系统生成可编辑的英文开发信，并通过 Gmail OAuth 授权的个人邮箱发送。
7. 系统把合格客户、发送状态、标签、跟进任务同步到 CRM。
8. 系统输出本次任务总结，方便用户知道 AI 做了什么、找到了什么、后续该怎么跟进。

## 3. 目标用户

### 3.1 主要用户

通信设备出口商、外贸业务员、外贸团队负责人。

### 3.2 典型业务对象

目标客户不是普通消费品买家，而是海外 4G/5G 通信设备领域中的 B2B 公司，包括：

- 通信设备经销商
- 现货商 / stockist
- 系统集成商
- 通信工程承包商
- 铁塔、电源、回传、IBS 服务商
- 网络运维服务商
- 备件替换、设备翻新、生命周期延长服务商
- 采购 Huawei、ZTE、Ericsson、Nokia、Eltek 等多品牌设备的渠道商

## 4. 目标市场

第一阶段优先覆盖：

- 中东：UAE、Saudi Arabia、Iraq、Iran 等
- 非洲：Nigeria、Kenya、South Africa、Ghana、Tanzania 等
- 东南亚：Indonesia、Vietnam、Philippines、Thailand、Malaysia 等
- 南美：Brazil、Colombia、Peru、Chile 等
- 其他机会市场：Russia、Iraq、Iran 等

## 5. V1 范围

### 5.1 V1 必做功能

| 模块 | 需求 |
| --- | --- |
| 账号注册登录 | 支持邮箱密码登录、邮箱密码注册、忘记密码和 Google 登录入口；Microsoft 第三方登录 / 注册不进入 V1 |
| AI 外贸员任务输入 | 用户用自然语言输入获客任务，系统拆解执行路径 |
| 产品资料配置 | 用户只保存官网、产品资料和补充说明；配置页不做 AI 解析结果展示 |
| 参考客户资料配置 | 用户只保存目标市场、参考客户官网和补充说明；配置页不做 AI 解析结果展示 |
| 产品 / 客户画像分析节点 | 在 AI 外贸员任务执行时分析产品资料和参考客户资料，生成画像、关键词和搜索方向 |
| 高级搜索策略库 | 沉淀 Brave 官方 operator 白名单、Google 官方常用搜索逻辑、常见 SEO 操作符、外贸获客模板和通信设备关键词库 |
| Brave AI 搜索 | 由后端调用 Brave Search API / LLM Context API 执行兼容查询，获取候选客户 |
| 搜索策略生成 | GPT-5.5 生成高级搜索策略、行业关键词、客户词、排除词和国家组合，并标记 operator 来源与执行状态 |
| ICP 判断 | 根据产品画像、参考客户画像、候选公司信息打分 |
| 合格客户库 | 保存高匹配客户、联系方式、来源、评分、标签和状态 |
| 开发信生成 | 针对合格客户生成可编辑英文开发信 |
| AI 改写 | 支持选择输出语言、邮件语气，输入改写要求，一键改写并覆盖邮件正文 |
| Gmail OAuth | 只支持当前登录用户授权自己的 Gmail 发件 |
| 邮件确认弹窗 | 半托管模式下，发送前弹窗展示收件人、主题、正文，由用户确认发送 |
| CRM 同步 | 将合格客户、标签、触达记录、跟进任务写入 CRM |
| 回复和跟进闭环 | V1 实现 Gmail 回复同步、回复分类、跟进任务、客户阶段事件和基础活动分析 |
| 任务总结 | 展示本次任务的搜索、筛选、邮件、CRM 同步和后续建议 |

### 5.2 V1 不做或后置

| 功能 | 处理方式 |
| --- | --- |
| WhatsApp 自动发送 | V1 不发送，后续版本再接 WhatsApp Business Cloud API |
| 短信发送 | V1 不做 |
| 7*24 全托管自动运行 | V1 先做验证模式和半托管模式 |
| SerpApi | 不使用 |
| Firecrawl | 不使用 |
| OpenAI Search 模型 | 不作为 V1 搜索方案 |
| 域名邮箱配置 | 不做，删除“系统域名 / 个人域名 / 域名配置”概念 |
| QQ / 126 / 163 授权码发信 | 不做，V1 只支持 Gmail OAuth |
| Microsoft OAuth 登录 / 注册 | V1 不做，后续根据企业客户需求再评估 |
| 黑名单独立菜单 | 不做，必要时作为 CRM 客户状态或标签处理 |
| 邮件发送记录独立弹窗 Tab | 发送确认弹窗只保留发邮件表单 |
| 开发信草稿独立菜单 | 不做独立菜单，发送前正文只是临时可编辑草稿 |

## 6. 核心业务流程

### 6.0 账号注册登录流程

1. 未登录用户进入系统时，先进入登录 / 注册页。
2. 登录页支持邮箱 + 密码登录，支持“记住我”。
3. 注册页支持邮箱 + 密码 + 确认密码注册，用户需同意服务条款和隐私政策。
4. 忘记密码页支持输入注册邮箱，系统发送重置密码链接。
5. V1 可保留 Google 登录入口，用于账号登录；该入口与 Gmail 发件授权是两个不同动作。
6. 用户进入系统后，如果需要发邮件，还必须单独完成 Gmail OAuth 授权。
7. Microsoft 第三方登录 / 注册入口 V1 不开发，不作为可点击功能。

### 6.1 AI 获客主流程

1. 用户输入任务。
2. 系统创建或复用一个客户池，例如“5G通信设备买家客户池”。
3. LangGraph 创建任务并绑定客户池，生成执行计划。
4. GPT-5.5 在 AI 外贸员任务中读取产品资料配置并分析卖方产品画像。
5. GPT-5.5 在 AI 外贸员任务中读取参考客户资料配置并分析参考客户画像。
6. GPT-5.5 从高级搜索策略库中选择 Brave API 可执行的 operator 和业务搜索模板，生成通信设备关键词、客户词、国家词和排除词。
7. 后端将“搜索策略 + 关键词”组合成 Brave AI 可执行查询，调用 Brave AI 搜索候选公司。
8. 系统清洗、去重、提取官网、邮箱、电话、国家、来源。
9. GPT-5.5 做 ICP 判断和推荐指数评分。
10. 如果合格客户数量不足，LangGraph 优先执行客户池内未完成的搜索指令；指令耗尽后，再根据人工审核反馈生成下一轮搜索词并循环搜索。
11. 达到目标数量或预算上限后，展示首批候选客户。
12. 用户确认客户后进入邮件生成和 CRM 同步流程。

当前 V1 的首轮获客任务必须由后端自动跑完本轮全部 query：`POST /api/lead-tasks` 创建任务后立即返回 `task_id`，后端后台继续完成画像读取、GPT 搜索规划、query 校验、Brave 搜索、候选清洗和 ICP 评分。前端只轮询任务状态，不再承担“等待搜索指令生成后再触发搜索”的接力职责。

后台任务需要具备基础恢复能力：后端重启或开发环境热更新后，最近仍处于 `running` 的首轮获客任务应能被重新捡起；已生成 query 的任务不得重复 GPT 规划，应继续执行未完成 query。

### 6.1.1 当前已落地的 GPT 主导边界

AI 外贸员的搜索规划不再由后端模板独占。当前主链路按以下职责拆分：

- 后端读取产品画像、客户画像、CRM 样本和任务文本。
- 后端抓取画像中的官网、产品页、产品资料 URL 和参考客户官网，形成网页证据。
- GPT-5.5 分析卖方产品能力和参考客户类型。
- GPT-5.5 扩展产品词、买家词、行业场景词、目标市场词和排除词。
- GPT-5.5 根据后端提供的 operator 白名单和策略库生成搜索 query。
- 后端只做硬边界校验：operator 是否允许自动执行、国家是否落在目标市场池、query 是否重复、数量是否足够、是否有基本产品/客户/场景信号、是否需要补充安全排除词。
- 后端不在 query 校验阶段判断“客户质量好不好”，避免把 GPT 生成的高价值窄 query 误删。
- GPT 失败、输出不合法或 query 数量不足时，后端使用原有确定性策略补足。

产品画像 URL 的处理规则：

- 如果用户填写 `https://telecorenet.com/`，后端会读取该官网首页。
- 如果用户填写 `https://telecorenet.com/products`，后端会读取产品目录，并识别 WooCommerce 产品标题、分页和总产品数。
- 产品目录抓取上限为 50 页 / 1000 个产品名，足以覆盖当前 `telecorenet.com` 约 158 个产品的目录规模。
- 抓取只读取公开 HTML / plain text，使用后端 `fetch`、跟随重定向、6 秒超时，并记录读取成功 / 失败原因。

客户画像 URL 的处理规则：

- 如果用户填写参考客户官网，例如 `https://spectrummea.com/`、`https://highcloud.ae/`，后端会抓取网页标题、正文摘要、行业词、客户意图词和场景词。
- 这些证据会进入 GPT-5.5 的客户画像分析，让系统学习“我要找同类型客户”，而不是只把参考 URL 当普通备注。
- 客户画像里的目标国家 / 地区会参与 query 国家池；如果同时存在 `Global` 和具体市场，具体市场优先。

### 6.1.2 持续客户池与继续找更多客户

“继续找更多客户”不是简单重复执行同一个任务，而是在同一个客户池中持续拓展。

客户池要求：

- 每个获客主题有一个长期客户池，保存搜索指令、搜索轮次、候选客户、过滤结果、审核反馈和 CRM 同步状态。
- 用户点击“继续找更多客户”时，不要求重新输入原始需求。
- 系统优先执行当前客户池中未完成的搜索指令，避免浪费 Brave 请求。
- 未完成搜索指令耗尽后，系统根据已通过、已拒绝、已过滤客户的特征生成下一轮搜索指令。
- 新候选客户必须和当前客户池、历史搜索结果、CRM 已有客户去重。
- 去重维度至少包括官网域名、邮箱、公司名 + 国家。
- 页面只展示业务化状态，例如“本轮新增”“高分客户”“待审核”“已过滤”“还可继续搜索指令”，不展示 `human_approval`、`wait_email_confirmation`、`LangGraph checkpoint` 等内部技术名。
- 客户必须人工审核后才能进入开发信生成；邮件发送前必须再次人工确认。

竞品关键词质量经验：

- 避免把通信设备获客做成泛消费电子搜索，例如 `4G router`、`4G modem`、`4G mobile device`、`PCB board`、`Power amplifier`。
- 优先生成真实买家类型词，例如 `telecom equipment distributor`、`telecom spare parts stockist`、`telecom system integrator`、`network rollout contractor`、`base station maintenance company`、`tower power service company`、`RAN equipment reseller`。
- 对 `mobile phone`、零售、电商、招聘、新闻、报告、学校、政府站点等弱线索默认降权或过滤。

### 6.2 邮件半托管流程

1. 系统为选中客户生成邮件主题和正文。
2. 用户在弹窗中查看发件 Gmail、收件人、回复邮箱、邮件模板、主题、发送时间和正文。
3. 用户可直接编辑正文。
4. 用户可在右侧 AI 改写区选择语言、语气，并输入改写要求。
5. 点击“一键改写”后，改写结果覆盖当前正文。
6. 用户点击“确认发送”。
7. 后端通过 Gmail API 发送邮件。
8. 系统记录发送结果，并同步客户状态到 CRM。

### 6.3 CRM 同步流程

1. 合格客户进入 CRM。
2. 系统保存公司名称、官网、国家、邮箱、电话、来源 URL、ICP 评分、匹配理由。
3. 系统添加标签，例如“通信设备经销商”“现货商”“系统集成商”“UAE”“首次触达”。
4. 邮件发送成功后，客户阶段变为“已触达”。
5. 系统默认创建 3 天后跟进任务。
6. 任务完成后生成总结，展示新增客户数、已发送数、待跟进数和风险项。

## 7. ICP 判断需求

### 7.1 ICP 判断输入

- 卖方产品画像
- 参考客户画像
- Brave AI 搜索返回的网页标题、摘要、上下文、URL
- 公司官网内容摘要
- 国家 / 地区
- 联系方式完整度
- 产品和业务关键词

### 7.2 ICP 评分维度

| 维度 | 权重 | 说明 |
| --- | --- | --- |
| 行业匹配 | 25 | 是否属于通信设备、集成、工程、运维、备件相关业务 |
| 产品匹配 | 25 | 是否可能采购 RRU、BBU、AAU、微波、电源、板卡、备件等 |
| 客户类型匹配 | 20 | 是否类似现有客户类型 |
| 国家市场价值 | 10 | 是否在目标市场或高机会国家 |
| 联系方式完整度 | 10 | 是否有邮箱、电话、官网等 |
| 采购可能性 | 10 | 是否存在项目交付、补货、维护、翻新等需求信号 |

### 7.3 ICP 输出

每个客户需输出：

- 推荐指数
- ICP 分数
- 客户类型
- 匹配理由
- 可能采购产品
- 风险项
- 建议触达方式
- 来源链接

当前实现中，ICP 由两层合成：

- 后端规则分：负责证据质量、联系方式、目标国家、明显风险页、域名去重等确定性判断。
- GPT-5.5 买家匹配分：负责判断搜索结果到底像真实买家、可能买家、供应商/竞争对手、目录页、文章页、招聘页、市场报告还是无关页面。

最终分数建议口径：`最终 ICP = GPT 买家匹配分 60% + 后端规则证据分 40%`。目录页、内容文章、招聘、市场报告、无关页和供应商/竞争对手需要封顶降权；真实买家且 GPT 置信度足够高时允许进入高匹配。

## 8. 搜索需求

### 8.1 搜索提供方

V1 搜索分为两层：高级搜索策略库和搜索执行器。

高级搜索策略库不是“Google 指令全集”。`google search.md` 只能作为初始业务经验，不能作为完整规则库。V1 需要把以下内容统一沉淀为可维护策略：

- Brave 官方 operator 白名单。
- Google 官方常用搜索逻辑。
- 常见但需测试的 SEO 搜索操作符。
- 外贸获客业务模板。
- 通信设备行业关键词库。
- 排除词库。
- 每个搜索式的执行效果评分。

搜索执行器：使用 Brave AI 搜索能力执行兼容查询。

- Brave Web Search API：获取候选搜索结果、URL、标题、摘要。
- Brave LLM Context API：获取适合 AI 处理的网页上下文片段。

官方来源：

- Brave Search API Search Operators：https://api-dashboard.search.brave.com/documentation/resources/search-operators
- Google Search Help Refine Searches：https://support.google.com/websearch/answer/2466433

库文件：

- 人读版：`search/advanced-search-strategy-library.md`
- Agent 读取版：`search/advanced-search-strategy-library.json`

产品侧可以显示为“高级搜索策略 + Brave AI 搜索”。这表示系统仍然沿用高级搜索开发客户的思路，但第一版以 Brave Search API 的自动执行能力为准。后续如果接入 Google Custom Search、SerpApi 或其他搜索 API，可以复用同一套策略库，同时按不同执行器调整兼容性。

### 8.2 搜索策略

系统需要自动组合三类内容：

第一类是高级搜索操作符和模板。

系统需要区分两类兼容性：

- Google 手动搜索可用。
- Brave API 自动执行可用。

V1 优先使用的搜索执行白名单：

这些操作符由 Brave 官方文档列出，V1 可以优先支持，但仍需要记录执行效果并持续测试：

| 操作符 | operator_source | execution_status | 说明 |
| --- | --- | --- | --- |
| `"` 精确短语 | `brave_official` / `google_official` | `experimental` | 精确匹配产品词、品牌词或客户类型词 |
| `-` 排除词 | `brave_official` / `google_official` | `experimental` | 排除招聘、新闻、培训、论坛、消费者内容 |
| `OR` / `AND` / `NOT` | `brave_official` | `experimental` | 扩展或约束多组产品词和客户词 |
| `site:` | `brave_official` / `google_official` | `experimental` | 限定国家域名、行业站点或客户官网 |
| `filetype:` / `ext:` | `brave_official` | `experimental` | 查找 PDF、Excel、目录、展商名单等资料 |
| `intitle:` | `brave_official` | `experimental` | 要求标题命中行业或客户类型词 |
| `inbody:` / `inpage:` | `brave_official` | `experimental` | 要求页面正文命中产品词或客户词 |
| `loc:` / `lang:` | `brave_official` | `experimental` | 做地区和语言约束，需持续记录效果 |

常见但需测试或手动使用的 SEO / Google 操作符：

| 操作符 | operator_source | execution_status | 说明 |
| --- | --- | --- | --- |
| `inurl:` | `common_seo` | `manual_only` | Google / SEO 常见用法，Brave API 自动执行前需测试 |
| `intext:` | `common_seo` | `manual_only` | Google / SEO 常见用法，Brave API 自动执行前需测试 |
| `allintitle:` / `allinurl:` / `allintext:` | `common_seo` | `disabled` | 不进入 V1 自动执行白名单 |
| `before:` / `after:` / `AROUND()` / `related:` / `cache:` | `common_seo` | `disabled` | V1 不自动生成，后续按搜索执行器兼容性再评估 |

第二类是 AI 扩展词。

搜索前先基于用户输入、产品画像和参考客户画像生成扩展词，再把扩展词写入 `keyword_groups`。扩词维度包括：

| 扩词维度 | 说明 | 通信设备示例 |
| --- | --- | --- |
| 用户输入的主产品 | 识别用户真正想找的核心产品 | `telecom equipment`、`RRU`、`BBU` |
| 同类产品 / 细分品类 | 扩展相关产品、型号、模块、应用品类 | `AAU`、`remote radio unit`、`baseband unit`、`rectifier module` |
| 商品长尾词 | 更接近买家搜索、目录和库存页的具体产品名 | `Huawei RRU spare parts`、`ZTE BBU boards`、`telecom power rectifier module` |
| 上下游词 | 零部件、配套设备、供应链和服务环节 | `power module`、`antenna feeder`、`IBS solution`、`equipment refurbishment` |
| 客户采购意图词 | 采购、进口、批发、经销、现货、项目供货等意图 | `distributor`、`stockist`、`importer`、`purchasing`、`project supply` |
| 目标市场词 | 国家、地区、城市、国家域名、loc operator 和 country 参数 | `UAE`、`Dubai`、`Saudi Arabia`、`Riyadh` |
| 行业场景词 | 使用场景、应用行业和解决方案方向 | `telecom infrastructure`、`network rollout`、`site maintenance` |

第三类是通信设备行业基础关键词：

- 产品词：`RRU`、`BBU`、`AAU`、`microwave backhaul`、`telecom power`、`rectifier`、`Huawei ZTE spare parts`
- 客户词：`telecom equipment distributor`、`stockist`、`system integrator`、`telecom contractor`
- 场景词：`network maintenance`、`IBS service`、`tower power`、`refurbished telecom equipment`
- 国家词：`UAE`、`Saudi Arabia`、`Nigeria`、`Kenya`、`Brazil` 等
- 排除词：`consumer phone`、`job`、`training`、`news`、`course` 等

### 8.2.1 组合查询示例

系统不是只搜单个关键词，而是把指令和关键词组合成可执行 query，例如：

```text
("RRU" OR "BBU" OR "AAU") ("distributor" OR "stockist" OR "system integrator") UAE -job -training -news
intitle:"telecom equipment" ("Huawei" OR "ZTE") ("stockist" OR "distributor") site:.ae
inpage:telecom ("microwave backhaul" OR "telecom power") ("service" OR "solution") loc:sa
"Huawei ZTE spare parts" ("trading" OR "importer" OR "purchasing") UAE -Alibaba -Amazon -China -forum
filetype:pdf "telecom" "exhibitors" "UAE"
```

每个任务至少生成 15 个“高级搜索策略 + 通信设备关键词”组合查询，并记录：

- 原始策略模板
- `operator_source`：`google_official` / `brave_official` / `common_seo`
- `execution_status`：`supported` / `experimental` / `manual_only` / `disabled`
- 填入的产品词 / 客户词 / 国家词
- 排除词
- 实际提交给 Brave AI 搜索的 query
- query 对应的候选客户数量和合格客户数量

继续找更多客户时还需要记录：

- query 所属客户池和搜索轮次
- query 是否已执行、待执行、失败、禁用
- query 的去重命中数量
- query 产生的高分客户、低分客户和过滤客户数量
- 人工审核反馈对下一轮 query 生成的影响

### 8.3 搜索预算

V1 需要控制：

- 单任务最大搜索轮次
- 单轮最大结果数
- 单域名重复次数
- Brave API 请求次数
- 失败重试次数

## 9. 邮件需求

### 9.1 发件规则

1. V1 只允许当前登录用户授权自己的 Gmail。
2. 不保存 Gmail 密码。
3. 不要求用户填写邮箱授权码。
4. 不支持系统域名、个人域名、企业域名配置。
5. 发送前必须让用户在弹窗里确认。
6. 每封邮件必须有发送记录和对应客户记录。

### 9.2 邮件字段

发送确认弹窗需要包含：

- 发件邮箱
- Gmail OAuth 授权状态
- 收件人
- 回复邮箱
- 邮件模板
- 邮件主题
- 发送时间：立即发送 / 定时发送
- 邮件正文
- AI 改写区域
- 确认发送按钮

### 9.3 AI 改写字段

AI 改写区域需要包含：

- 输出邮件使用的语言
- 邮件语气
- 输入需要改写的内容
- 一键改写按钮

改写结果直接覆盖邮件正文，覆盖前可以显示加载状态。

## 10. 回复和跟进闭环

回复和跟进闭环在 V1 实现，不再后置。V1 不只完成发件和 CRM 同步，还要让系统知道客户后续有没有回复、该怎么跟进、哪些搜索词和模板带来了更好的客户质量：

- `inbox_sync`：同步 Gmail 收件箱、已发送邮件、线程和客户回复。
- `reply_classification`：判断回复意图，例如感兴趣、要报价、要目录、拒绝、退订、自动回复。
- `followup_tasks`：创建 3 天后跟进、报价提醒、人工处理任务。
- `lead_stage_events`：记录客户从新线索到已触达、已回复、感兴趣、报价中的变化。
- `campaign_analytics`：分析搜索词、国家、客户类型、模板带来的回复率和高意向客户数量。

### 10.1 V1 闭环执行规则

1. 邮件发送成功后，系统创建 `inbox_sync` 同步任务，定时拉取 Gmail 线程和客户回复。
2. 客户有新回复时，系统调用 GPT-5.5 做 `reply_classification`。
3. 若回复包含 price、quote、catalog、datasheet、spec 等意图，客户阶段更新为“感兴趣”或“报价中”，并创建人工处理任务。
4. 若 3 天未回复，系统创建二次跟进任务。
5. 若客户退订、拒绝或要求停止联系，客户阶段更新为“勿扰”，后续不再自动触达。
6. 每次发送、打开、点击、回复、退订、阶段变化都写入 `lead_stage_events`。
7. 每个任务结束后更新 `campaign_analytics`，统计搜索词、国家、客户类型、模板和邮件主题的效果。

## 11. 权限与安全

1. 用户密码必须使用强哈希保存，不允许明文保存。
2. 登录态使用安全 Cookie 或后端签发的短期访问令牌 + 刷新令牌。
3. 忘记密码链接必须有有效期，并且使用后立即失效。
4. Google 登录只用于账号认证；Gmail OAuth 只用于发件授权，两者权限范围分开。
5. Microsoft OAuth 登录 / 注册 V1 不启用。
6. GPT-5.5 不直接调用外部 API，不直接发送邮件。
7. Brave、Gmail、CRM 等外部能力由后端工具层封装。
8. LangGraph 只编排受控工具节点。
9. 半托管模式下，关键动作必须人工确认。
10. 低 ICP 分数客户不得自动进入发送流程。
11. 用户可以查看每个客户的来源和匹配理由。
12. 所有发送、同步、阶段变化都需要记录日志。
13. Gmail Token 加密保存，支持用户撤销授权。

## 12. 非功能需求

| 类型 | 要求 |
| --- | --- |
| 性能 | 单次搜索任务需要流式展示进度，不让用户长时间盯空白页 |
| 可恢复 | LangGraph 每个节点状态和 checkpoint 可保存，生产环境使用 PostgreSQL checkpoint，任务失败或服务重启后可继续 |
| 可追溯 | 每个客户要能追溯搜索词、来源 URL、ICP 理由 |
| 可控成本 | 缓存 Brave 搜索结果，控制搜索轮次和重试 |
| 可控 AI 成本 | 候选 GPT 判断必须先经过规则预筛和批次上限，不能对低质量搜索结果无脑逐条调用 |
| 可编辑 | 邮件内容必须可人工修改 |
| 可扩展 | 后续可以接 WhatsApp、短信、更多邮箱和全托管模式 |
| 易用性 | 页面避免复杂专业术语，突出“任务、结果、确认、跟进” |

## 13. 验收标准

### 13.0 账号链路验收

- 用户能通过邮箱和密码注册账号。
- 用户能通过邮箱和密码登录系统。
- 用户能发起忘记密码流程，并收到重置密码链接。
- 用户注册时必须同意服务条款和隐私政策。
- 登录注册页可以展示 Google 登录入口。
- Microsoft 第三方登录 / 注册在 V1 中不可用，不进入可点击主链路。

### 13.1 获客链路验收

- 输入一个通信设备获客任务后，系统能生成产品画像和参考客户画像。
- 系统能生成至少 15 个“高级搜索策略 + 通信设备关键词”的组合查询，并按策略模板、operator 来源、执行状态、产品词、客户词、地区词、排除词分类展示。
- 创建任务后，后端必须自动执行完本轮全部 pending query；前端刷新或轮询只展示进度，不负责触发首轮搜索。
- 系统能返回候选客户列表，并展示来源。
- 系统能对客户输出 ICP 分数和匹配理由。
- 系统能筛出合格客户并保存到客户库。
- 用户点击“继续找更多客户”后，系统沿用同一个客户池继续拓展，不要求用户重新输入同样的需求。
- 继续拓展时不能重复执行已完成搜索指令，除非用户明确要求重新跑。
- 新增候选客户不能和当前客户池、历史候选、CRM 已有客户重复。
- 页面不能向普通用户展示 `human_approval`、`wait_email_confirmation`、`checkpoint` 等内部技术词。

### 13.2 邮件链路验收

- 用户能完成 Gmail OAuth 授权。
- 系统能用授权 Gmail 展示发件邮箱。
- 系统能生成邮件主题和正文。
- 用户能编辑正文。
- 用户能使用 AI 改写覆盖正文。
- 用户点击确认发送后，后端能调用 Gmail API 发出邮件。
- 发送结果能写入客户记录和任务总结。

### 13.3 CRM 链路验收

- 合格客户能同步到 CRM。
- 客户能带有标签、阶段、来源、ICP 分数。
- 发送成功后客户阶段变为“已触达”。
- 系统能创建默认 3 天后跟进任务。
- AI 项目执行页能展示 CRM 同步缩略表格，并支持点击查看完整 CRM 数据弹窗。
- CRM 数据弹窗能展示公司名称、国家、行业、电话、邮箱、AI 标签、客户阶段和负责人。
- 任务结束后展示本次总结。

### 13.4 回复和跟进闭环验收

- 系统能同步 Gmail 收件箱、已发送邮件、线程和客户回复。
- 系统能识别客户回复意图，并给出分类结果和置信度。
- 系统能根据回复意图创建报价提醒、人工处理或二次跟进任务。
- 系统能记录客户阶段变化，例如新线索、已触达、已回复、感兴趣、报价中、勿扰。
- 系统能展示基础活动分析，包括搜索词、国家、客户类型、模板带来的回复数和高意向客户数。

## 14. 里程碑

### 阶段 1：基础框架

- 前端 SaaS 框架
- 后端 API
- 数据库模型
- Gmail OAuth
- Brave AI 搜索封装

### 阶段 2：AI 获客验证

- LangGraph 工作流
- 产品画像分析
- 参考客户画像分析
- 搜索策略生成
- ICP 判断
- 候选客户展示

### 阶段 3：邮件半托管

- 开发信生成
- 邮件确认弹窗
- AI 改写
- Gmail 发送
- 发送记录落库

### 阶段 4：CRM 与跟进

- 合格客户库
- CRM 同步
- 客户标签
- 跟进任务
- CRM 同步缩略表格
- CRM 数据查看弹窗
- 任务总结

### 阶段 5：回复和跟进闭环

- Gmail 回复同步
- 回复意图分类
- 客户阶段时间线
- 活动分析
- 全托管规则评估

## 15. 风险与约束

1. Brave AI 搜索结果质量会受关键词和目标市场影响，需要缓存与人工反馈优化。
2. 部分公司官网没有邮箱或联系方式，需要后续补充更多数据源。
3. Gmail 发送量受 Google 风控限制，需要限速和发送安全规则。
4. 邮件打开率无法仅靠 Gmail API 获得，若要统计打开，需要增加追踪像素或追踪链接。
5. 全托管模式涉及误发和合规风险，V1 不直接上线。
6. WhatsApp 主动触达需要企业号、模板消息和合规审核，放到后续版本。
