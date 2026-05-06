# LeadHunt AI Codex 接手文档

更新时间：2026-05-02 14:55 +08:00

用途：给下一个 Codex / AI 编程 Agent 快速接手本项目。本文是当前状态总览，详细逐项记录看 `done01.md`、`done02.md`、`done03.md`。

重要原则：不要在回复、文档、日志里输出 `.env`、API Key、OAuth secret、refresh token、access token、cookie、账号密码、Google 验证码、Gmail provider message id。

## 1. 当前项目环境

- 项目目录：`E:\money\LeadHunt-Codex`
- Web：`http://localhost:3000`
- API：`http://localhost:4000`
- 浏览器验证方式：Chrome DevTools Protocol `127.0.0.1:9222`
- 当前端口状态：`3000` 和 `4000` 已监听。
- 当前不是 git 仓库：`git status` 会返回 `not a git repository`。
- 数据库 / Redis：本地代码连接远程 PostgreSQL / Redis，真实连接信息在 `.env`，不要输出。
- 当前测试登录态：本机浏览器里已有 LeadHunt 测试账号会话。
- Gmail OAuth：当前测试账号已授权 `wangyawei223@gmail.com`，可用于本机验证 Gmail 发送 / 收件箱读取。不要记录或输出 token。

## 2. 新 Agent 开始前必须读

建议按这个顺序读：

1. `done01.md`
2. `done02.md`
3. `done03.md`
4. `Task.md`
5. `Test_Report.md`
6. `pro.md`
7. `LeadHunt_AI_Requirements_Document.md`
8. `LeadHunt_AI_Product_Design_Document.md`
9. `LeadHunt_AI_Technical_Architecture.md`
10. `design/LeadHunt_AI_Design_Guidelines.md`
11. `search/advanced-search-strategy-library.md`
12. `API调用说明.md`
13. `google search.md`

`done01/02/03` 是已完成工作，不要重复做。接手时以本文和三个 done 文档作为当前事实基线。

## 3. 当前最新验证结果

本次交接前刚跑过的命令：

- `pnpm --filter @leadhunt/web typecheck`：通过
- `pnpm --filter @leadhunt/web lint`：通过
- `pnpm --filter @leadhunt/api typecheck`：通过
- `pnpm --filter @leadhunt/api lint`：通过
- `pnpm --filter @leadhunt/api test -- gmail crm agent-workflow lead-task`：9 个测试文件 / 66 条测试通过
- `pnpm --filter @leadhunt/agent typecheck`：通过
- `pnpm --filter @leadhunt/agent test`：3 个测试文件 / 12 条测试通过

最近一次 Chrome 9222 页面验证：

- 恢复 AI 外贸员历史任务后可打开邮件确认弹窗。
- 邮件确认弹窗已读取真实 Gmail 授权。
- 收件人区域已改成紧凑行：前 2 个 chip + `共 7 个` + 手动输入框 + `添加`。
- 未点击确认发送，本次没有发送对外邮件。

历史已验证的大项详见：

- `done01.md`：页面重构、100% 视口检查、核心 API、CRM、Gmail 回复同步、模板 CRUD 等。
- `done02.md`：真实 Brave 搜索、注册登录、候选质量过滤、AI 搜索动态效果、Gmail OAuth、真实 Gmail 发送、CRM 同步和 3 天跟进。
- `done03.md`：导航和画像保存修正、历史任务、真实 Gmail 收发件箱、邮件弹窗多收件人 / AI 改写、数据看板卡片对齐、收件人紧凑行。

## 4. 已完成能力总览

### 基础和账号

- 远程 PostgreSQL / Redis 开发环境可用。
- Auth API 已完成：注册、登录、登出、当前用户、忘记密码、重置密码。
- 前端注册 / 登录闭环已修过，受保护页面不会登录后又跳回登录页。
- 顶部用户信息曾被用户反馈过“注册后仍显示旧用户”的问题，接手时建议重新复测当前登录用户显示。

### 页面和设计还原

已按设计稿或用户反馈重构 / 对齐：

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

历史 CDP 9222 扫描显示 16 个页面在 `1707x932` 真实 CSS 视口下无浏览器级横向 / 纵向滚动条。

### 产品画像和客户画像

- `PUT /api/profiles/product` 和 `PUT /api/profiles/customer` 可保存。
- 产品画像 / 客户画像页面的 `保存并开始找客户` 和 `仅保存` 已区分：
  - 保存并开始找客户：保存后跳回 AI 外贸员首页。
  - 仅保存：只保存，不跳转。
- 页面本身只负责资料保存，AI 分析放在 AI 外贸员任务里。

### AI 外贸员核心链路

已打通的主链路：

1. 登录 / 注册。
2. 保存产品画像。
3. 保存客户画像。
4. 创建 AI 外贸员任务。
5. 读取画像并生成搜索计划。
6. 生成 Brave 搜索 query。
7. 真实 Brave Search 返回结果。
8. 过滤社媒、文章页、电商、弱线索。
9. 生成候选客户和 ICP 评分。
10. 页面显示执行日志、搜索动态、候选列表、CRM 同步预览。
11. 点击发邮件打开邮件确认弹窗。
12. 邮件确认弹窗预填候选客户、主题、正文。
13. Gmail OAuth 授权后可真实发送。
14. 发送成功后同步 CRM、创建 3 天后跟进任务、刷新 AI 外贸员页面状态。

### Brave Search

- Brave Key 已确认可用，真实 key 只在 `.env`。
- Node/Nest 侧已补 Windows 系统代理读取、HTTP CONNECT、SOCKS5/SOCKS5H 支持。
- Brave `country` 参数做了兼容，不支持的市场降级为 `ALL`，市场词仍保留在 query。
- 开发兜底搜索已改为显式开关 `LEADHUNT_DEV_SEARCH_FALLBACK=true|1`，默认不静默 fallback。
- 候选质量已做第一轮增强：过滤 LinkedIn、Facebook、YouTube、Wikipedia、Medium、ResearchGate、Alibaba、Amazon、AliExpress、`.edu`、`.gov`、新闻、博客、报告、招聘等。

### 邮件确认弹窗 / Gmail

- Gmail OAuth callback 500 已修：Node 请求 Google Token API 现在走代理感知 fetch。
- 旧 OAuth state 过期不再裸 500，会回跳 `/mailbox?gmail=error&reason=...` 并显示明确提示。
- 未授权时不再伪装成已授权，`确认发送` 会禁用。
- 授权成功后能读取真实 Gmail account。
- 已用授权 Gmail 给自己发送过测试邮件，真实 Gmail API 返回成功。
- AI 外贸员真实发送后会同步 CRM 和 3 天跟进。
- 邮件确认弹窗支持：
  - 多收件人。
  - 默认填入当前任务全部候选邮箱。
  - 手动添加 / 回车添加 / 逗号批量添加。
  - 邮箱格式校验和去重。
  - 逐个收件人调用 `POST /api/gmail/send`。
  - AI 改写真调用 `POST /api/gmail/rewrite`，后端走 GPT-5.5。
  - 收件人区域已改成竞品同款紧凑行。

### 个人邮箱

- `/mailbox` 已接真实 Gmail 收件 / 发件记录。
- 后端接口：
  - `GET /api/gmail/messages?folder=inbox|sent&limit=&pageToken=&q=`
  - `GET /api/gmail/messages/:messageId`
- 前端可显示真实邮件列表，点击后在右侧详情渲染正文。
- HTML 正文用 `<iframe sandbox="">` 渲染，降低外部邮件 HTML 风险。
- 搜索框支持 Gmail `q=` 语法。
- 撤销授权会清空列表和详情。

### CRM / 跟进 / 数据看板

- CRM lead 查询、详情、新建、编辑已实现。
- Gmail 发送后能同步 CRM lead。
- 发送后能创建 3 天后的 `email_followup`。
- AI 外贸员页面能回显：
  - 邮件发送数。
  - 已同步 CRM 数。
  - 待跟进提醒数。
  - 候选状态 `已发送`。
- `/customers` 已接真实 CRM 列表。
- `/dashboard` 已接 CRM / 搜索 / 邮件统计聚合，并按设计修过卡片布局。

### 模板 / 邮件营销 / 邮寄宣传册

- `/templates` 已支持系统模板 / 自建模板切换、搜索、新建、编辑、预览、删除。
- 自建模板目前存浏览器 localStorage，不进数据库。
- 邮件确认弹窗可以读取系统模板和自建模板，也能另存为自建模板。
- `/campaigns` 已完成设计态页面和编辑器，但真实发送主链路仍以 AI 外贸员邮件确认弹窗为准。
- `/brochures` 是邮寄宣传册任务工作台静态入口，V1 低优先级，未接真实后端。

## 5. 当前未完成 / 建议继续做

优先级建议从高到低：

1. 继续提升候选客户质量
   - 现在已经过滤掉不少噪音，但 Yellow Pages / TradeWheel / Accio 这类目录页仍可能作为候选本体出现。
   - 下一步应做“目录页拆解成真实公司条目”，或至少目录页降权，把公司官网、联系页、关于页、供应商详情页排在前面。

2. 复测注册后顶部账号显示
   - 用户曾反馈用新用户名注册后顶部仍显示旧名字。
   - done 里有相关修复背景，但接手时建议重新注册一个临时账号验证：注册成功后顶部用户名、头像首字母、`/api/auth/me` 是否一致。

3. `/campaigns` 邮件营销页接真实能力
   - 当前 AI 外贸员弹窗的 `POST /api/gmail/rewrite` 已通。
   - 可把 `/campaigns` 的 AI 改写按钮接同一接口。
   - 发送能力也可复用邮件确认弹窗或 Gmail send service，但要避免绕过确认弹窗直接群发。

4. 个人邮箱剩余文件夹
   - 目前真实可用的是 `全部收件` / `全部发件`。
   - `待处理邮件`、`未读邮件`、`草稿箱`、`标签邮件`、`已删除邮件`、`垃圾邮件` 等仍偏占位。
   - 可继续接 Gmail label / q，例如 `is:unread`、`label:DRAFT`、`is:starred`。

5. 历史任务管理
   - 现在支持历史任务列表、搜索、点选恢复。
   - 未做删除任务、重命名任务、归档任务。

6. 数据看板真实发送后的统计复测
   - 数据看板页面和 API 已有，但真实 Gmail 发送后统计是否完全反映到 UI，建议再做一次端到端复测。
   - `Test_Report.md` 的 V1 端到端清单里仍留有 `数据看板展示统计` 未勾选。

7. 自动化 E2E
   - 当前大量验证依赖 Chrome 9222 手动/脚本化检查。
   - 可补 Playwright 端到端测试：注册登录 -> 保存画像 -> 创建任务 -> 搜索 -> 邮件确认 -> Gmail 授权拦截态 / mock 发送 -> CRM 同步。

8. 后台 Worker / 重试能力
   - V1 主链路已跑通，但长任务、BullMQ、LangGraph 失败续跑等仍需要按 `Task.md` 继续补强和测试。

9. 生产化 OAuth / 部署
   - 当前是本地开发和授权账号验证。
   - 生产环境的 Google OAuth 应用、回调域名、权限审核、速率限制、错误页和部署流程还未作为正式上线项完成。

10. 外部真实客户发信
   - 已验证 Gmail API 可发信，但测试时只发给授权 Gmail 自己。
   - 未经用户明确允许，不要向候选客户真实邮箱发送测试邮件。

## 6. 接手建议工作流

每次改动前：

1. 先确认当前页面和接口状态，不要直接重写。
2. 读取相关 done 小节和对应源码。
3. 如果涉及真实外部 API，先确认是否会产生费用或对外发送。
4. 不要输出 `.env` 或任何密钥。

每次改动后至少跑：

```powershell
pnpm --filter @leadhunt/web typecheck
pnpm --filter @leadhunt/web lint
pnpm --filter @leadhunt/api typecheck
pnpm --filter @leadhunt/api lint
```

涉及搜索 / Agent / Gmail / CRM 时再跑：

```powershell
pnpm --filter @leadhunt/api test -- gmail crm agent-workflow lead-task
pnpm --filter @leadhunt/agent typecheck
pnpm --filter @leadhunt/agent test
```

页面改动必须用 Chrome 9222 或可用浏览器工具验证真实 UI。尤其检查：

- 外层是否出现浏览器级横向 / 纵向滚动条。
- 文案和按钮是否被遮挡。
- 弹窗是否能打开 / 关闭。
- 授权、未授权、失败态是否清楚。
- 不要误发真实外部邮件。

## 7. 启动和排查命令

如果服务已停：

```powershell
pnpm --filter @leadhunt/api dev
pnpm --filter @leadhunt/web dev
```

也可以用：

```powershell
pnpm dev
```

检查端口：

```powershell
Get-NetTCPConnection -LocalPort 3000,4000 -State Listen
```

常用验证地址：

- `http://localhost:3000/`
- `http://localhost:3000/login?next=%2F`
- `http://localhost:3000/product-profile`
- `http://localhost:3000/customer-profile`
- `http://localhost:3000/mailbox`
- `http://localhost:3000/customers`
- `http://localhost:3000/dashboard`

## 8. 高风险注意事项

- 不要重复做 `done01/02/03` 已完成项，除非先复现到确实回归。
- 不要恢复或覆盖用户未说明的改动。
- 当前不是 git 仓库，无法依赖 git diff 做回滚。
- `.env` 里有真实连接和 key，不要打印。
- Brave / Google / GPT-5.5 都可能依赖本机代理；如果外部 API 超时，先查代理感知 fetch 和 Windows 系统代理，不要立刻判断 key 坏了。
- Gmail OAuth callback 的旧链接不能刷新复用，state 过期后必须从 `/mailbox` 重新点授权。
- 真实 Gmail 发送已打通，但外部候选客户发信要用户明确确认。
- 模板自建数据在 localStorage，不在远程数据库。
- `/campaigns` 和 `/brochures` 不应被误认为已经有完整后端业务闭环。

## 9. 最推荐的下一步

接手后建议先做一个轻量复测：

1. 打开 `http://localhost:3000/`。
2. 恢复一条 AI 外贸员历史任务。
3. 打开邮件确认弹窗，确认 Gmail 授权、收件人紧凑行、AI 改写按钮都可见。
4. 不要点击真实发送。
5. 打开 `/mailbox`，确认能读取真实 Gmail 收件箱。
6. 打开 `/dashboard`，确认数据概况卡片仍对齐。

然后优先继续做“候选客户质量提升”和“目录页拆真实公司条目”。这是目前最贴近用户业务价值的下一步。
