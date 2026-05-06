# LeadHunt AI 已完成工作记录 03

更新时间：2026-05-02 11:55 +08:00

说明：本文件记录 `done02.md` 之后的新进度，继续用于新对话接手。本文只记录进度、文件和验证结果，不记录数据库密码、Redis 密码、API Key、OAuth secret 等敏感信息。

## 当前环境

- 本地项目目录：`E:\money\LeadHunt-Codex`
- Web：`http://localhost:3000`
- API：`http://localhost:4000`
- 浏览器验证方式：Chrome DevTools Protocol `127.0.0.1:9222`
- 测试账号：当前已登录的"LeadHunt 测试账号"，已通过 Google OAuth 授权 `wangyawei223@gmail.com`

## 本轮用户反馈（已逐项处理）

1. 导航 "我的产品画像" 改成 "产品画像"。
2. 客户画像页"保存并开始找客户"和"仅保存"按钮原本调同一个 handler，没有差异，需要真实差异化。
3. AI 外贸员落地页底部 `当前：半托管` pill 文字与下拉箭头垂直不对齐，且不能切换。
4. 邮件确认弹窗：
   - 收件人不能添加，且只显示 1 个，应默认填上所有候选客户邮箱。
   - "共 1 个" pill 与"添加"按钮没对齐，"手动输入"无法真的输入。
   - 删除"已读取模板库"。
   - AI 改写两个 select（语言 / 语气）没有对齐；要确认 AI 改写真的调用 GPT-5.5。
5. AI 外贸员历史任务侧栏一直是 "暂无历史任务"，新建任务后没回显。
6. 个人邮箱不应该只是静态示意，要展示真实绑定 Gmail 的全部收件 / 发件记录，能点开看正文（像 Gmail）。
7. 数据看板 "数据概况" 第 1、3 张卡片排版乱（"任务数/邮件数"挤压导致与第 2、4 张卡不齐）。

## 已完成

### 47. 导航重命名 "我的产品画像" → "产品画像"

- 修改文件：
  - `apps/web/app/app-shell.tsx`
- Chrome 9222 验证：`/` 路由下侧边导航顺序：`AI 外贸员 New / 产品画像 / 客户画像 / 模板配置 / 邮件营销 / 个人邮箱 / 邮寄宣传册 / 我的客户 / 数据看板`，原"我的"前缀已移除。

### 48. 产品画像 / 客户画像保存按钮真正差异化

- 修改文件：
  - `apps/web/app/product-profile/product-profile-form.tsx`
  - `apps/web/app/customer-profile/customer-profile-form.tsx`
- 原行为：两个按钮都绑同一个 `handleSave`，不区分。
- 现行为：
  - 主按钮 `保存并开始找客户`（产品画像页同步改名，原文案是"保存并生成产品画像"）→ `handleSaveAndStart`：调 `PUT /api/profiles/{product|customer}` 持久化，成功后 `router.push("/")` 跳转到 AI 外贸员落地页继续找客户。
  - 次按钮 `仅保存` → `handleSaveOnly`：只持久化，不跳转，提示"已保存"。
  - 失败时两边都给清晰错误提示，不会静默成功。

### 49. 半托管 pill 改为可切换 select 并修垂直对齐

- 修改文件：
  - `apps/web/app/ai-worker-client.tsx`
  - `apps/web/app/globals.css`
- AI 外贸员落地页底部从 `<button>当前：半托管 ⌄</button>` 重写为 `<label>当前：<select>半托管/全托管</select></label>`，由父组件 state `hostingMode` 控制。
- CSS：`.aiLandingHostingPill .hostingSelect` 用 SVG 自定义下拉箭头，padding 与 line-height 都按 32px pill 高度居中，原本的"文字和下拉图标错位"消失。
- Chrome 9222 验证：
  - `select.options` = `["semi:半托管", "full:全托管"]`，初始 `selectValue=semi`。
  - 切到 `full`，pill 文字立刻更新为 `当前：全托管`。

### 50. 邮件确认弹窗：多收件人 / 删除 "已读取模板库" / 添加按钮可用 / select 对齐

- 修改文件：
  - `apps/web/app/mail-confirmation-modal.tsx`
  - `apps/web/app/ai-worker-client.tsx`
  - `apps/web/app/globals.css`
- 弹窗 props 新增 `recipients?: MailConfirmationRecipient[]`；AI 外贸员把当前任务的所有 `displayLeads` 都映射成收件人传入，弹窗 mount 时默认填全部候选客户邮箱。
- 内部 `MailDraft.to: string` 重构为 `recipients: string[]`：
  - 输入框由 `to` 文本框改成"输入新收件人 → 回车 / 点添加 / 输入逗号"加进列表。
  - 邮箱格式校验失败、重复添加都会给提示。
  - "共 X 个" 由静态 span 改为 `<button class="pill count" aria-expanded>` 真按钮，点开显示完整收件人 chip 列表，每个 chip 有 `×` 可单独移除。
- 已删除模板行右侧"已读取模板库"文案。
- 真实发送：`sendEmail` 改为对每位收件人逐封调用 `POST /api/gmail/send`，发送时按 `recipients[].leadId` 把候选客户 id 透传给后端，保留 CRM / followup 写入；状态条显示"已成功发送 X/Y 位收件人"。
- AI 改写两个 select 对齐：
  - `.rewriteOptions` 加 `align-items: end`。
  - `.selectBox` 改为 `grid-template-rows: 18px 40px`，label/select 各占固定高度，长 label "输出邮件使用的语言"（8 字）和短 label "邮件语气"（4 字）即使前者换行也不会让 select 错位。
- AI 改写实测调用 GPT-5.5 / `POST /api/gmail/rewrite`：
  - 用浏览器登录会话 `fetch('/api/gmail/rewrite', ...)` 真实命中后端，返回 HTTP 201。
  - 输入 `instruction=改成更正式的语气，并强调可整套项目供货...`，后端返回的 `subject` 把全部首字母改为 Title Case，`body` 重写得更正式且明确强调"complete project-level supply requirements as well as individual cards and single equipment units"，`changes` 字段也填了说明。
  - 服务路径：`GmailController.rewrite` → `LeadHuntAiService.rewriteEmail` → `Gpt55Client.complete`，使用 `.env` 配置的 GPT-5.5 OpenAI 兼容端点和 key（不在文档中输出）。
- Chrome 9222 真实弹窗验证：
  - 默认 `共 7 个` pill（恢复任务有 7 家候选）；展开后 chip 列表读到 7 个候选邮箱。
  - 在输入框输入 `extra@example.com`，点添加：弹窗变成 `共 8 个`，最末 chip 是新添加邮箱，输入框被清空，状态条提示已添加。
  - 模板行右侧不再出现"已读取模板库"。
  - AI 改写两个 select 在视觉上左右上下都已对齐。

### 51. AI 外贸员历史任务侧栏

- 修改文件：
  - `apps/api/src/agent/agent-workflow.service.ts`（新增 `listTasksForUser`）
  - `apps/api/src/agent/lead-task.controller.ts`（新增 `GET /api/lead-tasks`）
  - `apps/web/app/ai-worker-client.tsx`
  - `apps/web/app/globals.css`
- 后端 `GET /api/lead-tasks?search=&limit=` 返回当前登录用户最新 30 条任务，每条带 `id / status / createdAt / updatedAt / prompt / title / leadCount / queryCount`。
- 前端 AI 外贸员加载落地页时调一次 `loadTaskHistory`；新建任务成功后再触发一次刷新。
- 落地页历史任务面板：
  - 没数据时显示原"暂无历史任务"占位。
  - 有数据时渲染 `aiLandingTaskList`，每行显示任务标题（按 prompt 截断）、`MM-DD HH:mm · 候选 N · 指令 N`、状态徽章（pending / running / completed / email_sent / failed 不同颜色）。
  - 搜索框 `taskSearch` 在前端做关键字过滤，不重新发请求。
  - 点击任意历史任务 → `openHistoryTask(taskId)`：调 `GET /api/lead-tasks/:taskId` 把整个任务（候选客户、指令、阶段）读出来恢复到对话视图。
- Chrome 9222 验证：当前账号侧栏列出 14 条历史任务；点第 1 条 → 任务恢复到对话页，状态条显示"已恢复任务，候选客户 7 家"，搜索面板、流程进度、候选表格、CRM 预览都按真实数据回填。

### 52. 个人邮箱接 Gmail 真实收发记录与正文查看

- 修改文件：
  - `apps/api/src/gmail/gmail-message.service.ts`（新增 `listMailboxMessages` / `getMailboxMessage` / `summarizeGmailMessage` / `extractPayloadHtml` / `parseDisplayName`）
  - `apps/api/src/gmail/gmail.controller.ts`（新增 `GET /api/gmail/messages` 和 `GET /api/gmail/messages/:messageId`）
  - `apps/web/app/mailbox/mailbox-client.tsx`（整页重写）
  - `apps/web/app/globals.css`
- 后端：
  - `GET /api/gmail/messages?folder=inbox|sent&limit=&pageToken=&q=`：先用现有 `refreshAccessToken` 拿 access token，再调 Gmail `users/me/messages?labelIds=INBOX/SENT` 拿 ID 列表，并发 `format=metadata` 拉每条邮件的 From/To/Subject/Date/snippet/labelIds。
  - `GET /api/gmail/messages/:id`：拉 `format=full`，`extractPayloadText` 取纯文本主体（截断 50KB），`extractPayloadHtml` 取 HTML 主体（截断 200KB）；body / bodyHtml / labelIds 一起返回。
  - 复用现有的代理感知 fetch 和 token 刷新逻辑，没有新建网络层。
- 前端：
  - 文件夹切换：`收件箱 → 全部收件 / 发件箱 → 全部发件` 真实联动后端 `folder` 参数；其余文件夹为占位禁用。
  - 邮件列表展示真实头像首字母、发件人、地址、主题 + snippet、时间（今天显示 HH:mm，否则 MM-DD HH:mm）；未读邮件加粗。
  - 点击邮件触发 `GET /api/gmail/messages/:id`，右侧详情面板显示主题、发件人、收件时间、收件人，正文优先用 `<iframe sandbox="" srcDoc>` 渲染 HTML（防止外站 JS 执行 / cookie 串流），无 HTML 时用 `<pre>` 显示纯文本。
  - 搜索框接 Gmail `q=` 语法（例如 `from:google has:attachment`）。
  - 撤销授权后立刻清空列表 / 详情面板，并提示"已撤销授权"。
- Chrome 9222 验证：
  - 当前会话拉到 20 封真实收件箱邮件，包含 LeadHunt 自己测试发的 `LeadHunt CRM follow-up workflow UI test`、OpenAI 验证码、Reddit、Apify、linux.do 私信等。
  - 默认选中第一条，右侧 iframe 渲染了 HTML 正文（"Dear Procurement Team, I noticed Telecommunication Products UAE..."）。
  - "已同步 20 封 收件箱邮件" 状态可见；点击"全部发件"会切到发件箱。
  - 顶部信息条显示 `wangyawei223@gmail.com / 已授权 / 2026年5月1日 23:42`，与真实 Google 授权一致。
- 安全性：
  - iframe 用 `sandbox=""`（无任何特权），HTML 中所有 `<script>` / `<style>` / cookie / 第三方加载都被 sandboxed。
  - 不在文档 / 日志中记录 access token、refresh token、邮件 provider id、收件人邮箱等敏感信息。

### 53. 数据看板 "数据概况" 4 卡片对齐

- 修改文件：
  - `apps/web/app/globals.css`
- `.overviewMetric`：
  - 加 `min-height: 90px`，三行 grid 改为 `30px 22px 18px` 固定高度；icon 占 `grid-row 1/4` 与文字三行垂直居中对齐。
  - `strong / p / small` 显式 `grid-column: 2`、`grid-row: 1/2/3`，并在 `small` 上加 `min-height: 18px`、`white-space: nowrap`，让"任务数/邮件数"和"—"一样高度。
- Chrome 9222 验证：4 张卡片高度全为 90px，strong/p/small 在每张卡内的 top 偏移完全相同（4 / 34 / 56），不再因为第 1、3 卡的多字 small 把布局推下去。截图：`tmp/dashboard-overview-aligned.png`。

### 54. 邮件确认弹窗收件人区域改成竞品同款紧凑行

- 修改文件：
  - `apps/web/app/mail-confirmation-modal.tsx`
  - `apps/web/app/globals.css`
  - `apps/web/app/mailbox/mailbox-client.tsx`（顺手补齐 done03 上轮遗留的 lint 未使用状态）
- 收件人区域改动：
  - 默认只在同一行展示前 2 个收件人 chip、`共 X 个` 下拉按钮、`手动输入` 输入框和带用户添加图标的 `添加` 按钮。
  - 完整收件人列表不再撑开一整块大区域，改为点击 `共 X 个` 后从当前行下方浮层展开。
  - chip 删除按钮改为 lucide `X` 图标；`共 X 个` 使用 `ChevronDown / ChevronUp`；`添加` 使用 `UserPlus`，整体更接近用户给的图 2。
  - 输入框支持回车添加、逗号批量添加和去重，保留原有邮箱格式校验。
- 顺手修复：
  - `mailbox-client.tsx` 中 `selectedMessageId` / `loadingDetail` 被 done03 改动留下未使用，已用于当前选中邮件高亮和加载正文提示。
  - `globals.css` 新增 `.mailboxRow.active` 高亮样式，避免 lint 阻塞。
- Chrome 9222 验证：
  - 恢复历史任务后打开邮件确认弹窗，Gmail 已授权为 `wangyawei223@gmail.com`。
  - 收件人行显示 `sales@yellowpages-uae.com`、`sales@xtream-me.com`、`共 7 个`、手动输入框和 `添加` 按钮，未展开时不再出现图 1 那种大块收件人列表。
  - 本次只验证弹窗 UI，没有点击确认发送，没有发送对外邮件。

## 修改文件汇总（本轮）

后端：
- `apps/api/src/agent/agent-workflow.service.ts`
- `apps/api/src/agent/lead-task.controller.ts`
- `apps/api/src/gmail/gmail-message.service.ts`
- `apps/api/src/gmail/gmail.controller.ts`

前端：
- `apps/web/app/app-shell.tsx`
- `apps/web/app/ai-worker-client.tsx`
- `apps/web/app/mail-confirmation-modal.tsx`
- `apps/web/app/product-profile/product-profile-form.tsx`
- `apps/web/app/customer-profile/customer-profile-form.tsx`
- `apps/web/app/mailbox/mailbox-client.tsx`
- `apps/web/app/globals.css`

文档：
- `done03.md`

## 已通过验证

- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/api test -- gmail crm agent-workflow lead-task`：23 个测试文件 / 133 条测试通过
- Chrome DevTools Protocol 9222 真实链路：导航重命名、保存并开始找客户跳转、半托管/全托管切换、历史任务恢复、邮件确认弹窗 7 候选默认 + 手动新增至 8、AI 改写真实命中 GPT-5.5 接口（HTTP 201 + 改写文本）、Gmail 收件箱列出 20 封真邮件 + 详情 iframe 渲染、数据概况 4 张卡片高度一致

## 备注

- 本轮没有记录 OAuth code/state、refresh token、access token、cookie、Google 验证码、账号密码或 Gmail provider message id。
- 没有发送任何对外邮件。所有 AI 改写、Gmail 列表 / 详情读取都只在本机 9222 真实会话内进行。
- AI 改写依然走 GPT-5.5 OpenAI 兼容接口，密钥由 `.env` 注入，未在文档输出。
- 本轮没有改 Prisma schema，没有写 migration。

## 下一步建议

- 邮件营销 `/campaigns` 页面 AI 改写按钮也可对接 `POST /api/gmail/rewrite`，沿用本轮的弹窗组件即可。
- 个人邮箱当前只有"全部收件 / 全部发件"切换，可继续接 `is:unread`、`is:starred`、`label:Drafts` 等 Gmail label 把"未读邮件 / 草稿箱 / 标签邮件"占位激活。
- 邮件正文 iframe 可再加"在 Gmail 网页打开"链接（`https://mail.google.com/mail/u/0/#inbox/{messageId}`），让用户跳转 Gmail 直接处理。
- 历史任务侧栏目前只支持点选恢复；后续可支持"删除任务 / 重命名任务"。
