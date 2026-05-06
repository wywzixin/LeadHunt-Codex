# GPT-5.5 API 调用说明

本项目分成两类 AI 能力：

- GPT-5.5：负责产品画像、客户画像、高级搜索策略生成、搜索结果清洗、ICP 判断、开发信生成。
- Brave AI 搜索：负责联网搜索、获取候选 URL、网页片段和可验证来源。
- LangGraph：负责 AI 外贸员工作流编排，把 GPT-5.5、Brave、Gmail、WhatsApp、CRM 等工具按步骤串起来。
- 回复和跟进闭环：负责同步邮箱/WhatsApp 回复、分类客户意图、生成跟进任务、记录客户阶段事件和分析活动质量。

V1 搜索已确定使用 Brave Search API / Brave LLM Context，不使用 SerpApi、Firecrawl 或 OpenAI Search。搜索策略层使用“高级搜索策略库”，不是“Google 指令全集”。

V1 Agent 架构已确定直接采用 LangGraph。LangGraph 负责流程编排、分支、循环、暂停确认和状态恢复；BullMQ / Redis 负责后台队列、限速、重试和 Worker 调度。

## 接口信息

| 项目 | 值 |
|------|-----|
| 模型名称 | `gpt-5.5` |
| API Key | `REDACTED_OPENAI_API_KEY` |
| 协议 | 兼容 OpenAI Chat Completions API |

## 两种访问方式

### 方式一：直连 HTTP（本地 / Node.js 服务端）

- **Base URL**: `http://43.167.204.62:8080/v1`
- **适用场景**：本地开发、服务器端 Node.js 调用
- **注意**：仅支持 HTTP，不支持 HTTPS，浏览器直调需要代理

```js
const res = await fetch('http://43.167.204.62:8080/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer REDACTED_OPENAI_API_KEY'
  },
  body: JSON.stringify({
    model: 'gpt-5.5',
    messages: [
      { role: 'system', content: '你是一个有用的助手' },
      { role: 'user', content: '你好' }
    ],
    stream: false,
    max_tokens: 2048
  })
})
const data = await res.json()
const reply = data.choices[0].message.content
```

### 方式二：Cloudflare Tunnel HTTPS（Cloudflare Workers / 线上环境）

- **Base URL**: `https://field-safely-translator-charges.trycloudflare.com/v1`
- **适用场景**：Cloudflare Workers、任何要求 HTTPS 的环境
- **注意**：Tunnel 地址在服务器重启后会变，变了需重新配置 `OPENAI_BASE_URL`

```js
const res = await fetch('https://field-safely-translator-charges.trycloudflare.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer REDACTED_OPENAI_API_KEY'
  },
  body: JSON.stringify({
    model: 'gpt-5.5',
    messages: [
      { role: 'system', content: '你是一个有用的助手' },
      { role: 'user', content: '你好' }
    ],
    stream: false,
    max_tokens: 2048
  })
})
const data = await res.json()
const reply = data.choices[0].message.content
```

## 使用 openai 库调用

```bash
npm install openai
```

```js
const OpenAI = require('openai')

// 本地直连
const client = new OpenAI({
  apiKey: 'REDACTED_OPENAI_API_KEY',
  baseURL: 'http://43.167.204.62:8080/v1'
})

// Cloudflare Workers / HTTPS 环境
// const client = new OpenAI({
//   apiKey: 'REDACTED_OPENAI_API_KEY',
//   baseURL: 'https://field-safely-translator-charges.trycloudflare.com/v1'
// })

const completion = await client.chat.completions.create({
  model: 'gpt-5.5',
  messages: [{ role: 'user', content: '你好' }],
  max_tokens: 2048
})

console.log(completion.choices[0].message.content)
```

## Cloudflare Workers 环境变量配置

Worker 通过 `wrangler secret` 读取配置，当前线上配置：

```bash
# 查看当前配置
CLOUDFLARE_API_TOKEN=xxx npx wrangler secret list

# 更新 Tunnel 地址（服务器重启后 Tunnel URL 变化时执行）
echo "https://新地址/v1/chat/completions" | CLOUDFLARE_API_TOKEN=xxx npx wrangler secret put OPENAI_BASE_URL

# 重新部署 Worker
CLOUDFLARE_API_TOKEN=xxx npx wrangler deploy
```

## 支持的模型

| 模型 | 说明 |
|------|------|
| `gpt-5.5` | 主力模型，推荐使用 |
| `gpt-5.3-codex` | 代码能力强 |
| `gpt-5.2` | 稳定版本 |
| `gpt-5.1` | 轻量版本 |
| `gpt-5` | 基础版本 |

## 注意事项

- 速率限制：建议并发不超过 3-5，稳定速率约 3 req/s
- Tunnel 地址在 `cloudflared` 服务重启后会变，需更新 Worker 的 `OPENAI_BASE_URL`
- 如需固定地址，绑定域名到服务器并开启 Cloudflare 橙云代理

## LangGraph Agent 架构说明

### 为什么 V1 直接使用 LangGraph

LeadHunt AI 不是单轮问答，而是长流程 Agent：

1. 分析产品画像
2. 分析参考客户画像
3. 生成高级搜索策略和 Brave 可执行 query
4. 多轮搜索候选客户
5. 去重和清洗候选公司
6. ICP 打分
7. 判断是否达到目标数量
8. 生成开发信 / WhatsApp 文案
9. 验证模式停止、半托管等待确认、全托管继续发送
10. 写入 CRM 和发送记录
11. 同步客户回复并做意图分类
12. 生成跟进任务和客户阶段事件
13. 分析搜索词、模板和渠道效果

这些流程存在循环、分支、人工确认、失败重试和状态恢复，所以 V1 直接使用 LangGraph 编排，避免后期从普通顺序流程重构。

### 推荐安装

```bash
npm install @langchain/langgraph @langchain/core zod
```

后台全托管任务建议同时安装：

```bash
npm install bullmq ioredis
```

### LangGraph 和 BullMQ 的分工

| 模块 | 负责什么 |
|------|----------|
| LangGraph | 单个 Agent 任务内部流程：节点、分支、循环、暂停、人机确认、状态恢复 |
| BullMQ / Redis | 后台任务队列：排队、限速、重试、延迟执行、Worker 调度 |
| GPT-5.5 | 节点内的 AI 分析：画像、高级搜索策略、ICP、开发信 |
| Brave Search API | 联网搜索和网页上下文 |
| Gmail / WhatsApp / CRM | 触达和客户管理工具 |

### V1 工作流节点

```text
start
  -> load_task
  -> build_product_profile
  -> build_reference_customer_profile
  -> plan_search_queries
  -> brave_search
  -> normalize_candidates
  -> score_icp
  -> enough_qualified?
      -> no: plan_next_queries -> brave_search
      -> yes: generate_outreach
  -> mode_router
      -> validate: finish
      -> semi_auto: wait_human_approval
      -> full_auto: send_outreach
  -> save_to_crm
  -> inbox_sync
  -> reply_classification
  -> followup_tasks
  -> campaign_analytics
  -> finish
```

### 工具注册建议

所有外部能力都通过后端工具注册，不让 GPT-5.5 直接调用外网。

```ts
export const tools = {
  'brave.search': braveSearch,
  'web.extract': extractWebPage,
  'lead.normalize': normalizeLead,
  'lead.score': scoreLeadWithGPT55,
  'outreach.generate': generateOutreachWithGPT55,
  'gmail.createDraft': createGmailDraft,
  'gmail.send': sendGmail,
  'gmail.syncInbox': syncGmailInbox,
  'whatsapp.createTask': createWhatsAppTask,
  'whatsapp.sendTemplate': sendWhatsAppTemplate,
  'whatsapp.syncReplies': syncWhatsAppReplies,
  'engagement.track': trackEngagementEvent,
  'crm.save': saveLeadToCrm,
  'reply.classify': classifyReplyWithGPT55,
  'followup.schedule': scheduleFollowupTask,
  'lead.stageEvent': createLeadStageEvent,
  'campaign.analytics': updateCampaignAnalytics
}
```

### 任务模式

| 模式 | 行为 |
|------|------|
| 验证模式 | 搜索、ICP 判断、生成开发信草稿，不自动发送 |
| 半托管 | 关键步骤暂停，用户确认后继续搜索、生成或发送 |
| 全托管 | 在满足 ICP、发送频率、黑名单、重复发送等规则后自动继续 |

### 全自动安全规则

- ICP 分数低于阈值不发送。
- 无官网、无来源 URL、联系方式来源不明确的不发送。
- 同一公司、同一邮箱、同一域名要去重。
- 同一客户 30 天内不重复触达。
- 每日邮件和 WhatsApp 发送量必须限速。
- 所有搜索词、来源 URL、ICP 理由、发送内容和发送结果都要写入日志。
- Gmail / WhatsApp 发送失败时只有限次数重试，不能无限循环。

## Brave AI 搜索调用说明

### 使用定位

产品界面里可以叫“Brave AI 搜索”，技术实现使用 Brave Search API：

- `LLM Context API`：优先使用，返回适合大模型直接处理的网页上下文、片段、标题和 URL。
- `Web Search API`：辅助使用，返回标准搜索结果、标题、URL、摘要和来源信息。
- `Answers API`：暂不作为 V1 主流程。它适合直接生成带引用的答案，但本项目需要把候选公司交给 GPT-5.5 做行业 ICP 判断，所以优先用 LLM Context / Web Search。

### 高级搜索策略库

`google search.md` 只能作为初始业务经验，不能当成完整规则库。V1 使用“高级搜索策略库”，并区分两类兼容性：

- Google 手动搜索可用。
- Brave API 自动执行可用。

V1 自动执行优先使用 Brave 官方文档列出的 operator，但这些 search operators 仍需要记录效果并持续测试。

官方来源：

- Brave Search API Search Operators：https://api-dashboard.search.brave.com/documentation/resources/search-operators
- Google Search Help Refine Searches：https://support.google.com/websearch/answer/2466433

库文件：

- 人读版：`search/advanced-search-strategy-library.md`
- Agent 读取版：`search/advanced-search-strategy-library.json`

每个 operator 至少保存两个字段：

```ts
type OperatorSource = 'google_official' | 'brave_official' | 'common_seo'
type ExecutionStatus = 'supported' | 'experimental' | 'manual_only' | 'disabled'
```

V1 搜索执行白名单：

| 操作符 | operator_source | execution_status | 说明 |
| --- | --- | --- | --- |
| `"`、`-`、`OR`、`AND`、`NOT` | `brave_official` | `experimental` | 精确匹配、排除词和布尔组合 |
| `site:`、`filetype:`、`ext:`、`intitle:` | `brave_official` | `experimental` | 限定站点、文件类型和标题命中 |
| `inbody:`、`inpage:`、`loc:`、`lang:` | `brave_official` | `experimental` | 页面内容、地区和语言约束 |
| `inurl:`、`intext:` | `common_seo` | `manual_only` | 偏 Google / SEO 常见用法，不进入 V1 自动执行白名单 |
| `allintitle:`、`allinurl:`、`before:`、`after:` | `common_seo` | `disabled` | V1 不自动生成 |

### 环境变量

```bash
BRAVE_SEARCH_API_KEY=你的_brave_search_api_key
BRAVE_SEARCH_BASE_URL=https://api.search.brave.com/res/v1
```

### 推荐接口一：LLM Context

用途：根据通信设备行业搜索词，直接拿到网页片段和来源，减少自己抓网页的需求。

```js
const params = new URLSearchParams({
  q: '("RRU" OR "BBU" OR "AAU") ("distributor" OR "stockist" OR "system integrator") loc:ae -job -training -news',
  country: 'ae',
  search_lang: 'en',
  count: '20',
  maximum_number_of_urls: '10',
  maximum_number_of_tokens: '8192',
  context_threshold_mode: 'balanced'
})

const res = await fetch(`https://api.search.brave.com/res/v1/llm/context?${params}`, {
  headers: {
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip',
    'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY
  }
})

const data = await res.json()
```

关键字段：

- `grounding.generic[].url`：候选页面 URL
- `grounding.generic[].title`：页面标题
- `grounding.generic[].snippets`：Brave 提取的相关网页片段
- `sources`：来源域名、标题、页面时间等元数据

### 推荐接口二：Web Search

用途：拿更传统的搜索结果列表，适合做候选公司发现、翻页和搜索语法验证。

```js
const params = new URLSearchParams({
  q: 'intitle:"telecom equipment" ("Huawei" OR "ZTE") ("stockist" OR "distributor") site:.ae',
  country: 'ae',
  search_lang: 'en',
  count: '20',
  extra_snippets: 'true'
})

const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
  headers: {
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip',
    'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY
  }
})

const data = await res.json()
```

关键字段：

- `web.results[].title`
- `web.results[].url`
- `web.results[].description`
- `web.results[].extra_snippets`

### LeadHunt V1 搜索链路

1. LangGraph 启动任务并进入产品画像节点。
2. GPT-5.5 分析 `telecorenet.com`，生成产品画像和供应能力。
3. GPT-5.5 分析 `spectrummea.com`、`highcloud.ae`，生成参考客户画像。
4. `expand_keywords` 节点按 7 类维度扩词：主产品、同类产品 / 细分品类、商品长尾词、上下游词、客户采购意图词、目标市场词、行业场景词。
5. GPT-5.5 从高级搜索策略库生成至少 15 组“operator + 扩展词 + 国家/客户类型 + 排除词”组合 query。
6. LangGraph 调用 Brave LLM Context / Web Search 获取候选公司。
7. GPT-5.5 读取 Brave 返回的 URL、标题、摘要和网页片段，做 ICP 评分。
8. LangGraph 判断是否继续搜索、等待人工确认、生成开发信或进入发送节点。
9. 合格客户进入客户库，再生成可编辑开发信。

### V1 控制策略

- 第一版任务由人工触发，不做 7*24 自动搜索，但内部流程按 LangGraph 节点执行。
- 每个任务先生成至少 15 组组合 query，每组最多取 10-20 条结果。
- `manual_only` 和 `disabled` 的 operator 不进入 V1 自动搜索执行节点。
- 对同一个 query 和 URL 做缓存，避免重复请求。
- Brave 搜索失败时，任务状态标记为“搜索失败 / 可重试”，不要自动无限重试。
- 只有 ICP 分数达到阈值或人工确认的客户，才进入合格客户库。
