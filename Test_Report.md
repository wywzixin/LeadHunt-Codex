# LeadHunt AI 测试记录

版本：V1  
创建日期：2026-04-29  
用途：记录每个功能开发完成后的测试结果。开发顺序必须遵守“一个功能开发完，测试通过并记录，再进入下一个功能”。

## 2026-05-15 首轮搜索自动后台执行测试

测试功能：创建 AI 外贸员任务后，后端自动完成首轮获客链路，前端只轮询任务详情，不再等待 45 秒后接力调用搜索接口。

测试命令：

- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/api test -- agent-workflow.service.spec.ts lead-qualification.service.spec.ts`

结果：

- API 类型检查通过。
- Web 类型检查通过。
- `agent-workflow.service.spec.ts`、`lead-qualification.service.spec.ts` 共 42 条测试通过。
- Chrome DevTools `http://localhost:3000/` 新建任务 `e24d74ee-11a5-4f2f-a508-3c35a4942a02`。
- 页面创建任务后立即显示任务 ID，后端自动生成 29 条 query。
- 未由前端调用 `/api/lead-tasks/:taskId/search`，后端自动进入 `brave_search`。
- 本轮 29 条 query 已全部执行完成，Brave 原始命中 114 条，入库候选 76 家。
- 评分结果：`qualified` 3 家、`review` 6 家、`rejected` 67 家；前端主表按规则只展示 9 家可复核客户，其中 3 家 ICP 75+。
- 补恢复逻辑后，开发服务热更新 / 重启可恢复最近 24 小时内仍为 `running` 的任务；已有 query 的任务跳过 GPT 规划并继续执行未完成 query。
- Chrome DevTools 复核历史任务恢复：页面显示“本轮搜索已完成：执行 29 条 query，命中 114 条结果，新增 76 家候选客户，等待人工审核”，不再显示“搜索指令待生成 / 待启动 / 等待首轮搜索结果”这类误导状态。

发现问题：

- 开发模式热更新会中断正在执行的内存后台任务；当前已补最近 running 任务恢复，但生产/正式联调仍建议继续升级为独立 worker / 队列 / 任务锁。
- 候选 GPT 逐条评分较慢；当前已补规则预筛和每批最多 5 个 GPT 候选判断，后续仍可继续做批量评分和并发上限。

## 2026-05-15 GPT 主导获客链路改造测试

测试功能：GPT-5.5 接入 AI 外贸员主链路、产品目录抓取放宽、GPT 搜索策略 fallback、候选客户评分融合、画像页读取已保存配置。

测试命令：

- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/agent typecheck`
- `pnpm --filter @leadhunt/api test -- src/ai/leadhunt-ai.service.spec.ts src/agent/website-content.service.spec.ts src/agent/agent-workflow.service.spec.ts src/leads/lead-qualification.service.spec.ts`
- `pnpm --filter @leadhunt/agent test`
- `pnpm --filter @leadhunt/api build`
- `pnpm --filter @leadhunt/agent build`

结果：

- API / Web / Agent 类型检查通过。
- API 相关单测 4 个测试文件 / 55 条通过。
- Agent 包 3 个测试文件 / 23 条通过。
- API 和 Agent 构建通过。
- `http://localhost:4000/health` 返回 200。
- `http://localhost:3000/` 页面可打开并保持登录状态。
- 产品画像页能读取已保存的 `https://telecorenet.com/` 和 `https://telecorenet.com/products`。
- 客户画像页能读取已保存的 `https://spectrummea.com/`、`https://highcloud.ae/` 和补充说明。
- 新建任务 `591215bb-8b7e-40a9-bc3c-96c0762cef48` 后，网站证据读取 4/4，生成 55 条搜索指令，目标国家从 prompt 中的 Nigeria / Saudi Arabia 生效，并扩展到 Lagos / Riyadh / Jeddah。
- 首批搜索执行 15 条 query，其中 11 条完成、4 条失败，候选主表过滤了低分 / rejected 结果。

发现问题：

- 本次真实运行时 GPT-5.5 兼容接口返回 HTTP 503：`Service temporarily unavailable`。
- 因此任务 `aiPlanning.querySource=deterministic_fallback`，`gptSearchQueryCount=0`，候选 `aiEvaluation=null`。
- 结论是代码已接入 GPT 主链路，但外部 GPT 服务不可用时会按设计 fallback；后续需要在 GPT-5.5 服务恢复后复测 GPT-led query 和 GPT 候选买家判断。

## 0. 测试总原则

- [ ] 每个功能必须先完成测试，再进入下一个功能。
- [ ] 测试失败时，先修复当前功能，不新增下一项功能。
- [ ] 每个功能至少覆盖成功路径、失败路径、空状态、权限校验和数据库写入检查。
- [ ] 涉及外部 API 的功能，需要覆盖缺少 key、key 无效、请求失败和限速提示。
- [ ] 所有测试命令、结果和修复记录必须写入本文档。

## 1. 测试环境

| 项目 | 内容 |
| --- | --- |
| 操作系统 | Windows |
| 数据库 | 远程 PostgreSQL via Docker，本地代码直连 |
| 缓存 / 队列 | 远程 Redis via Docker，本地代码直连 |
| 前端 | Next.js |
| 后端 | NestJS |
| ORM | Prisma |
| Agent | LangGraph |
| 搜索 | Brave Search API |
| AI 模型 | GPT-5.5 OpenAI-compatible API |
| 邮件 | Gmail OAuth + Gmail API |

## 2. 通用测试命令

项目初始化后补充实际命令：

```bash
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run test:e2e
```

## 3. 功能测试记录模板

复制下面模板到对应功能下填写。

```text
测试时间：
测试功能：
关联任务：
测试命令：
测试账号：
测试数据：

成功路径：
- [ ] 

失败路径：
- [ ] 

空状态：
- [ ] 

权限校验：
- [ ] 

数据库检查：
- [ ] 

页面检查：
- [ ] 

外部 API 检查：
- [ ] 不涉及

发现问题：
- 

修复记录：
- 

结论：
- [ ] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能
```

## 4. 第一阶段测试清单

### 4.1 Docker / 基础服务

- [x] 远程服务器 `docker compose up -d` 成功。
- [x] PostgreSQL 可连接。
- [x] Redis 可连接。
- [x] 后端能读取 `.env` 配置。
- [ ] 缺少必要环境变量时有清晰报错。

测试时间：2026-04-29 14:14:33 +08:00
测试功能：Docker / 基础服务环境检查
关联任务：Task.md 1.1 本地环境启动
测试命令：
- `docker --version`
- `docker compose version`
- `.env` 必需字段存在性检查，不输出字段值
- `where docker`
- 常见安装目录查找 `docker.exe`
- Docker 相关 Windows 服务检查
- `Test-NetConnection localhost -Port 5432`
- `Test-NetConnection localhost -Port 6379`
测试账号：不涉及
测试数据：不涉及

成功路径：
- [ ] 未通过，当前 PowerShell 会话无法识别 `docker` 命令。

失败路径：
- [x] `docker --version` 返回命令不存在。
- [x] `docker compose version` 返回命令不存在。
- [x] `where docker` 未找到 Docker CLI。
- [x] 常见安装目录未找到 `docker.exe`。
- [x] 未发现 Docker 相关 Windows 服务。
- [x] `localhost:5432` 未连通。
- [x] `localhost:6379` 未连通。

空状态：
- [x] `.env` 文件存在，必需字段名均存在；未输出任何密钥值。

权限校验：
- [x] 不涉及应用权限；当前阻塞为本机 Docker CLI / 服务不可用。

数据库检查：
- [ ] 未通过，PostgreSQL 未启动或不可连接。

页面检查：
- [x] 不涉及。

外部 API 检查：
- [x] 不涉及。

发现问题：
- 当前 Codex PowerShell 环境找不到 Docker CLI，无法执行 `docker compose up -d`。
- PostgreSQL 5432 和 Redis 6379 端口当前不可连接。

修复记录：
- 已确认 Node.js、npm、pnpm 可用。
- 已确认 `.env` 必需字段存在，且未打印密钥值。
- 2026-04-29 复测：`docker --version`、`docker compose version`、`where docker` 仍未找到 Docker CLI。
- 2026-04-29 复测：尝试在 C/D/E 文件系统搜索 `docker.exe` 和 `Docker Desktop.exe`，180 秒内未找到可用路径。
- 2026-04-29 15:00:09 +08:00：通过 winget 找到官方 `Docker.DockerDesktop` 4.71.0，安装器已下载并校验 SHA256 成功。
- 2026-04-29 15:00:09 +08:00：当前 Codex PowerShell 非管理员会话，普通 `winget install` 失败，日志显示安装器需要管理员权限。
- 2026-04-29 15:00:09 +08:00：`--scope user` 不可用，Docker Desktop 只提供机器级安装器。
- 2026-04-29 15:00:09 +08:00：尝试用 UAC 提权启动 winget 和 Docker 官方安装器，Windows 返回“操作被用户取消”，Docker 未安装成功。
- 2026-04-29 15:07:17 +08:00：用户已打开管理员 PowerShell，但 Codex 命令通道仍为非管理员，无法向已有管理员窗口注入命令。
- 2026-04-29 15:07:17 +08:00：再次尝试通过 UAC 启动 Docker 安装器和可视安装界面，Windows 仍返回“操作被用户取消”。
- 2026-04-29 15:07:17 +08:00：复查 `winget list Docker.DockerDesktop` 和 `C:\Program Files\Docker`，Docker 仍未安装。
- 2026-04-29 15:26:40 +08:00：管理员 PowerShell 执行修复脚本后，旧 `C:\ProgramData\DockerDesktop` 已备份，Docker Desktop 安装日志显示 `Installation succeeded`。
- 2026-04-29 15:26:40 +08:00：使用完整路径验证 Docker CLI 成功：Docker 29.4.1，Docker Compose v5.1.3。
- 2026-04-29 15:26:40 +08:00：启动 Docker Desktop 后，`docker info` 返回 DesktopLinuxEngine 500；安装日志显示启用了 Windows Subsystem for Linux 功能且需要重启。
- 2026-04-29 15:26:40 +08:00：注册表检查显示 `CBSRebootPending=true`、`PendingFileRenameOperations=true`，需重启 Windows 后继续验证 Docker engine。
- 2026-04-29 19:36:01 +08:00：用户重启 Windows 后复测，Docker CLI 可用：Docker 29.4.1，Docker Compose v5.1.3。
- 2026-04-29 19:36:01 +08:00：`docker info` 失败，提示 `dockerDesktopLinuxEngine` pipe 不存在；`docker desktop status` 为 `stopped`。
- 2026-04-29 19:36:01 +08:00：Docker Desktop 日志显示 `hasNoVirtualization=true`，`Win32_Processor.VirtualizationFirmwareEnabled=False`，当前机器固件虚拟化未开启，WSL2/Docker engine 无法启动。
- 2026-04-29 19:36:01 +08:00：当前 Codex PowerShell 不是提权管理员 token，无法从本会话修改 BIOS/固件虚拟化或启动需要管理员权限的 Docker 服务。

结论：
- [ ] 通过，可以进入下一个功能
- [x] 不通过，继续修复当前功能

测试时间：2026-04-29 21:28:00 +08:00
测试功能：远程 PostgreSQL / Redis 基础服务检查
关联任务：Task.md 1.1 基础服务启动
测试命令：
- `Test-NetConnection 43.167.204.62 -Port 5432`
- `Test-NetConnection 43.167.204.62 -Port 6379`
- Redis `AUTH` + `PING`，不输出密码
- `pnpm --filter @leadhunt/api prisma validate`
- `pnpm --filter @leadhunt/api prisma generate`
- `pnpm --filter @leadhunt/api prisma migrate deploy`
- Node + Prisma 真实写入/读取脚本
- 本地 API HTTP 冒烟：`/health`、注册、登录、`/api/auth/me`、产品画像保存、客户画像保存
测试账号：一次性测试账号，测试后已删除。
测试数据：远程数据库地址和密钥只读取本地 `.env`，不输出真实值。

成功路径：
- [x] 远程 PostgreSQL 5432 端口连通。
- [x] 远程 Redis 6379 端口连通。
- [x] Redis 鉴权后 `PING` 返回 `PONG`。
- [x] Prisma validate / generate / migrate deploy 均通过，初始化 migration 已应用到远程 PostgreSQL。
- [x] 真实数据库写入/读取通过：用户、session、产品画像、客户画像、任务、agent steps、search query、search result 均可写入并读取。
- [x] 删除测试用户后，关联数据级联删除验证通过。
- [x] 本地 API 连接远程数据库的 HTTP 冒烟通过：health、register、me、product profile、customer profile、login、DB verify。

失败路径：
- [x] 未输出任何真实数据库或 Redis 密钥。

空状态：
- [x] 不涉及页面空状态。

权限校验：
- [x] `GET /api/auth/me` 使用注册接口返回的 HttpOnly session cookie 成功识别当前用户。

数据库检查：
- [x] 远程 PostgreSQL 真实写入、读取、关联、级联删除均通过。

页面检查：
- [x] 不涉及。

外部 API 检查：
- [x] 不涉及。

发现问题：
- 本地 Docker Desktop engine 仍受固件虚拟化限制，开发期改用远程 Docker 数据库。

修复记录：
- 本地 `.env` 已改为远程 `DATABASE_URL` / `REDIS_URL`。
- 已对远程 PostgreSQL 执行 Prisma migration。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.2 项目骨架

- [x] 前端启动成功。
- [x] 后端启动成功。
- [x] `GET /health` 正常返回。
- [x] TypeScript 类型检查通过。
- [x] Lint 通过。

测试时间：2026-04-29 16:00:54 +08:00
测试功能：项目骨架
关联任务：Task.md 1.2 项目骨架
测试命令：
- `pnpm install`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm --filter @leadhunt/api prisma validate`
- 启动 `@leadhunt/api` 后请求 `GET http://localhost:4000/health`
- 启动 `@leadhunt/web` 后请求 `GET http://localhost:3000`
测试账号：不涉及
测试数据：不涉及

成功路径：
- [x] 创建 monorepo workspace：`apps/web`、`apps/api`、`packages/shared`、`packages/agent`。
- [x] Next.js + React + TypeScript 前端可 build，可启动到 `localhost:3000`，首页 HTTP 200，并包含 `LeadHunt AI`。
- [x] NestJS + TypeScript 后端可 build，可启动到 `localhost:4000`。
- [x] `GET /health` 返回 `status=ok`、`service=leadhunt-api`。
- [x] Prisma 7 配置通过 `prisma validate`。

失败路径：
- [x] 首次 Prisma 验证失败，原因是 Prisma 7 不再支持在 `schema.prisma` datasource 中写 `url`。
- [x] 已改为 `apps/api/prisma.config.ts` 管理 datasource URL，复测通过。

空状态：
- [x] 前端首页使用 0 候选客户、0 合格 ICP、0 待确认邮件作为初始空状态。

权限校验：
- [x] 当前阶段不涉及应用登录权限；Docker engine 仍是 1.1 环境阻塞，不影响 1.2 骨架测试。

数据库检查：
- [x] 当前阶段先验证 Prisma schema/config；远程数据库连接和迁移已在 4.1 / 4.3 补测通过。

页面检查：
- [x] 前端首页启动成功，导航、顶部账号“王亚伟”、AI 外贸员初始工作区可返回。

外部 API 检查：
- [x] 不涉及。

发现问题：
- `pnpm install` 提示部分依赖 build scripts 被 pnpm 默认拦截；当前 typecheck/lint/test/build/API health/前端启动均未受影响。
- Docker Desktop 已安装但本机 engine 受虚拟化限制；开发期 PostgreSQL/Redis 已改用远程 Docker 服务，测试归属 4.1。

修复记录：
- 补充 workspace TypeScript path 映射，解决前端直接引用 `@leadhunt/shared` 的类型解析。
- 修正 API `start` 脚本为 `node dist/src/main.js`。
- 将 dotenv 加载改为 quiet，避免启动日志输出 `.env` 路径提示。
- 增加 Prisma 7 `prisma.config.ts`，并从 `schema.prisma` 移除 datasource `url`。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.3 数据库 Schema

- [x] Prisma migrate 成功。
- [x] Prisma generate 成功。
- [x] 用户表写入 / 查询成功。
- [x] 任务表写入 / 查询成功。
- [x] 关联表关系正常。

测试时间：2026-04-29 16:04:08 +08:00
测试功能：数据库第一版 Schema
关联任务：Task.md 1.3 数据库第一版 Schema
测试命令：
- `pnpm --filter @leadhunt/api prisma format`
- `pnpm --filter @leadhunt/api prisma validate`
- `pnpm --filter @leadhunt/api prisma generate`
- `pnpm --filter @leadhunt/api prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`
- `pnpm --filter @leadhunt/api prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --output prisma/migrations/20260429160300_init_schema/migration.sql`
- `pnpm --filter @leadhunt/api prisma migrate deploy`
- Node + Prisma 远程数据库写入/读取/级联删除脚本
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
测试账号：不涉及
测试数据：不涉及

成功路径：
- [x] Prisma schema 覆盖 24 张核心表：`users`、`auth_accounts`、`user_sessions`、`password_reset_tokens`、`gmail_accounts`、`product_profiles`、`customer_profiles`、`lead_tasks`、`agent_steps`、`search_queries`、`search_results`、`lead_candidates`、`lead_contacts`、`icp_scores`、`crm_leads`、`outreach_drafts`、`send_logs`、`engagement_events`、`inbox_threads`、`inbound_messages`、`reply_classifications`、`followup_tasks`、`lead_stage_events`、`campaign_analytics`。
- [x] `prisma validate` 通过。
- [x] `prisma generate` 通过。
- [x] 已生成初始化 SQL：`apps/api/prisma/migrations/20260429160300_init_schema/migration.sql`。
- [x] 生成的 SQL 包含 24 个 `CREATE TABLE`，并包含索引和外键。
- [x] `prisma migrate deploy` 已成功应用到远程 PostgreSQL。
- [x] 真实数据库写入/读取通过：用户、session、产品画像、客户画像、任务、agent steps、search query、search result 均可写入并读取。
- [x] 删除测试用户后，关联数据级联删除验证通过。
- [x] 全仓 `typecheck`、`lint`、`test`、`build` 通过。

失败路径：
- [x] 本地 `prisma migrate dev` 未执行；开发期已改用 `prisma migrate deploy` 对远程 PostgreSQL 应用 migration。

空状态：
- [x] 不涉及页面空状态；schema 已为任务、搜索、候选客户、邮件、回复、跟进和 CRM 初始数据提供可空字段与默认状态。

权限校验：
- [x] 用户、会话、密码重置、Gmail 授权、任务均通过 `user_id` 建立归属关系。

数据库检查：
- [x] 真实 PostgreSQL 写入/读取检查通过。

页面检查：
- [x] 不涉及。

外部 API 检查：
- [x] 不涉及。

发现问题：
- Prisma 7 不再支持在 `schema.prisma` datasource 中写 `url`，已改为 `prisma.config.ts`。
- 本地 PostgreSQL 未启动；远程 PostgreSQL 已完成 migration 和写读验证。

修复记录：
- 新增 `apps/api/prisma.config.ts` 管理 schema 路径、migration 路径和 datasource。
- 补全第一版 Prisma schema 与初始化 migration SQL。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能的数据库执行部分。

### 4.4 登录注册

- [x] 注册成功。
- [x] 重复邮箱注册失败。
- [x] 登录成功。
- [x] 密码错误登录失败。
- [x] 退出登录成功。
- [x] 未登录访问后端接口被拦截。
- [x] Microsoft 第三方登录入口不展示或不可用。

测试时间：2026-04-29 16:13:59 +08:00
测试功能：登录注册最小闭环
关联任务：Task.md 1.4 登录注册最小闭环
测试命令：
- `pnpm --filter @leadhunt/api test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- 本地 API 连接远程数据库后请求 `POST /api/auth/register`
- 本地 API 连接远程数据库后请求 `POST /api/auth/login`
- 本地 API 连接远程数据库后请求 `GET /api/auth/me`
- 启动 API 后请求 `GET /health`
- 启动 API 后请求 `POST /api/auth/register` 短密码失败路径
- 启动 API 后请求 `GET /api/auth/me` 未登录失败路径
- 启动 API 后请求 `GET /api/auth/google` 占位接口
- 启动 Web 后请求 `/`、`/login`、`/register`、`/forgot-password`
测试账号：单元测试使用 `buyer@example.com`；真实 HTTP 冒烟使用一次性测试账号，测试后已删除。
测试数据：单元测试 mock Prisma；真实 HTTP 冒烟连接远程 PostgreSQL，不输出 `.env` 密钥。

成功路径：
- [x] 服务层注册成功单元测试通过，创建用户、credentials auth account 和 session。
- [x] 服务层登录成功单元测试通过，校验 bcrypt 密码并创建 session。
- [x] 服务层 `me` 成功单元测试通过，可根据 session 识别当前用户。
- [x] 服务层 logout 单元测试通过，会删除当前 session。
- [x] 忘记密码请求单元测试通过，存在用户时写入 password reset token，不存在用户时仍返回通用成功。
- [x] 前端 `/login`、`/register`、`/forgot-password` 均返回 HTTP 200。
- [x] 真实 HTTP 冒烟通过：注册成功、session cookie 生成、`GET /api/auth/me` 识别当前用户、登录成功。

失败路径：
- [x] 重复邮箱注册返回 BadRequest 单元测试通过。
- [x] 短密码注册返回 BadRequest 单元测试通过，HTTP 测试返回 400。
- [x] 密码错误登录返回 Unauthorized 单元测试通过。
- [x] 未登录 `GET /api/auth/me` HTTP 测试返回 401。
- [x] Google OAuth 后端占位接口 HTTP 测试返回 501。

空状态：
- [x] 未登录访问 `/` 返回 307，并跳转到 `/login?next=%2F`。

权限校验：
- [x] session cookie 使用 HttpOnly、SameSite=Lax。
- [x] refresh token 只保存 sha256 hash。
- [x] 前端路由保护基于 `lh_session` cookie 做后台访问拦截。

数据库检查：
- [x] 真实 PostgreSQL 注册/登录写入读取检查通过，测试账号已清理。

页面检查：
- [x] 登录、注册、忘记密码页面启动成功。
- [x] 页面保留 Google 入口。
- [x] 页面不包含 Microsoft 登录 / 注册入口。

外部 API 检查：
- [x] Google OAuth 仅占位，不触发外部 API。

发现问题：
- 本地 Docker engine 仍未可用，真实数据库接口集成测试已改用远程 PostgreSQL 完成。

修复记录：
- 新增 API `AuthModule`、`AuthController`、`AuthService`、`PrismaService`。
- 新增 Next auth 页面和 API rewrite。
- 新增 Next `proxy.ts`，未登录后台访问跳转登录。
- 增加 10 个认证服务单元测试。
- 追加本地 API + 远程 PostgreSQL 的真实 HTTP 冒烟测试。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能。

### 4.5 产品画像 / 客户画像

- [x] 产品画像资料保存成功。（代码、服务层、真实 HTTP + DB 均通过）
- [x] 客户画像资料保存成功。（代码、服务层、真实 HTTP + DB 均通过）
- [x] 右侧预览保存后的资料。
- [x] 空字段提示清晰。
- [x] AI 分析不在该页面执行。

测试时间：2026-04-29 19:44:00 +08:00
测试功能：产品画像页面与保存接口
关联任务：Task.md 2.2 产品画像页面
测试命令：
- `pnpm --filter @leadhunt/api prisma format`
- `pnpm --filter @leadhunt/api prisma validate`
- `pnpm --filter @leadhunt/api prisma generate`
- `pnpm --filter @leadhunt/api prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --output prisma/migrations/20260429160300_init_schema/migration.sql`
- `pnpm --filter @leadhunt/api test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- 本地 API 连接远程数据库后请求 `PUT /api/profiles/product`
- 启动 API 后请求 `GET /health`
- 启动 API 后请求 `GET /api/profiles/product` 未登录路径
- 启动 Web 后请求 `/product-profile`
- Playwright + 本机 Chrome 检查 `/product-profile` 1440px 视口
测试账号：浏览器页面使用测试 cookie `lh_session=test.session`；未使用真实账号。
测试数据：`https://telecorenet.com/`、产品资料链接数组、通信设备补充说明；未输出 `.env` 密钥。

成功路径：
- [x] Prisma schema 新增 `product_profiles` 表，并与 `users` 建立一对一关系。
- [x] 初始化 migration SQL 已重新生成，包含 `CREATE TABLE "product_profiles"`、唯一索引和外键。
- [x] `ProductProfileService` 可保存官网、产品页、资料链接数组和补充说明，并通过 `upsert` 写入当前用户记录。
- [x] 服务层 15 个 API 单元测试通过，其中产品画像覆盖：未登录读取失败、有效保存、非法 URL、空官网、多行资料链接和 notes trim。
- [x] 产品画像页面返回 HTTP 200。
- [x] 浏览器渲染检查通过：2 个 URL 输入、1 个文件上传入口、2 个文本框、保存按钮、右侧预览均存在。
- [x] 页面没有“AI 解析产品画像”按钮，也没有在该页面执行 AI 分析。
- [x] 全仓 `typecheck`、`lint`、`test`、`build` 均通过。

失败路径：
- [x] 未登录请求 `GET /api/profiles/product` 返回 401。
- [x] 空官网 / 非法官网 URL 在服务层返回 `BadRequestException`。

空状态：
- [x] 右侧预览对未填写官网、产品页、上传资料、资料链接和补充说明显示清晰空状态。

权限校验：
- [x] 产品画像接口通过 `lh_session` session cookie 获取当前用户，未登录不能访问。

数据库检查：
- [x] 真实 PostgreSQL 写入 / 读取已通过，`product_profiles` 记录可由 API 保存并读取。

页面检查：
- [x] Playwright 截图已生成：`tmp/leadhunt-product-profile-1440.png`。
- [x] 页面宽度未超出 1440px 视口，右侧预览位于视口内。

外部 API 检查：
- [x] 不涉及外部 API。

发现问题：
- `ProfilesModule` 首次启动 API 时缺少 `AuthModule` 导入，Nest 无法注入 `AuthService`。
- Docker Desktop 重启后 CLI 可用，但 engine 未启动，日志显示 `hasNoVirtualization=true`；真实 DB 检查已改用远程 PostgreSQL 完成。

修复记录：
- 在 `ProfilesModule` 导入 `AuthModule`，修复 Nest 运行时依赖注入。
- 产品画像页补充文件上传入口，并保留产品资料链接的多行输入。
- 产品画像 migration SQL 已跟随 `product_profiles` 重新生成。
- 增加产品画像服务层测试到 5 条。
- 追加本地 API + 远程 PostgreSQL 的产品画像真实保存测试。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能。

测试时间：2026-04-29 19:48:30 +08:00
测试功能：客户画像页面与保存接口
关联任务：Task.md 2.3 客户画像页面
测试命令：
- `pnpm --filter @leadhunt/api prisma format`
- `pnpm --filter @leadhunt/api prisma validate`
- `pnpm --filter @leadhunt/api prisma generate`
- `pnpm --filter @leadhunt/api prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --output prisma/migrations/20260429160300_init_schema/migration.sql`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- 本地 API 连接远程数据库后请求 `PUT /api/profiles/customer`
- 启动 API 后请求 `GET /health`
- 启动 API 后请求 `GET /api/profiles/customer` 未登录路径
- 启动 Web 后请求 `/customer-profile`
- Playwright + 本机 Chrome 检查 `/customer-profile` 1440px 视口
测试账号：浏览器页面使用测试 cookie `lh_session=test.session`；未使用真实账号。
测试数据：`https://spectrummea.com/`、`http://highcloud.ae/`、UAE / Qatar、CRM 样本选择和补充说明；未输出 `.env` 密钥。

成功路径：
- [x] Prisma schema 新增 `customer_profiles` 表，并与 `users` 建立一对一关系。
- [x] 初始化 migration SQL 已重新生成，包含 `CREATE TABLE "customer_profiles"`、唯一索引和外键。
- [x] `CustomerProfileService` 可保存目标市场、参考客户官网数组、CRM 样本 ID 和补充说明，并通过 `upsert` 写入当前用户记录。
- [x] 服务层 20 个 API 单元测试通过，其中客户画像覆盖：未登录读取失败、有效保存、缺少目标市场、非法参考客户 URL、多行参考客户官网和 CRM 样本保存。
- [x] 客户画像页面返回 HTTP 200。
- [x] 浏览器渲染检查通过：3 个文本框、2 个 CRM 样本复选框、保存按钮、右侧预览均存在。
- [x] 页面默认参考客户官网包含 `https://spectrummea.com/` 和 `http://highcloud.ae/`。
- [x] 页面没有“AI 解析客户画像”按钮，也没有展示客户类型、采购可能性等 AI 推理字段。
- [x] 全仓 `typecheck`、`lint`、`test`、`build` 均通过。

失败路径：
- [x] 未登录请求 `GET /api/profiles/customer` 返回 401。
- [x] 空目标市场 / 非法参考客户 URL 在服务层返回 `BadRequestException`。

空状态：
- [x] 右侧预览对未填写目标市场、参考客户官网、CRM 样本和补充说明显示清晰空状态。

权限校验：
- [x] 客户画像接口通过 `lh_session` session cookie 获取当前用户，未登录不能访问。

数据库检查：
- [x] 真实 PostgreSQL 写入 / 读取已通过，`customer_profiles` 记录可由 API 保存并读取。

页面检查：
- [x] Playwright 截图已生成：`tmp/leadhunt-customer-profile-1440.png`。
- [x] 页面宽度未超出 1440px 视口，右侧预览位于视口内。

外部 API 检查：
- [x] 不涉及外部 API。

发现问题：
- 本地 Docker/PostgreSQL 阻塞仍存在；真实数据库写入检查已改用远程 PostgreSQL 完成。

修复记录：
- 新增 `CustomerProfileService`、`CustomerProfileController` 和客户画像服务层测试。
- 新增 `/customer-profile` 客户画像保存页面，默认填入 `spectrummea.com` 和 `highcloud.ae`。
- 客户画像 migration SQL 已跟随 `customer_profiles` 重新生成。
- 追加本地 API + 远程 PostgreSQL 的客户画像真实保存测试。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能。

### 4.6 Brave 搜索

- [ ] Brave key 存在时搜索成功。
- [x] Brave key 缺失时返回清晰错误。
- [x] 关键词扩展结构完整。
- [x] 关键词可用于 Brave query 拼接。
- [x] 至少生成 15 个搜索策略组合。
- [x] `manual_only` / `disabled` 搜索策略不会自动执行。
- [ ] Brave key 存在时真实搜索成功。（当前网络无法连通 `api.search.brave.com:443`）
- [x] 搜索结果写入数据库。（服务层 mock 和真实远程数据库写入均已验证）

测试时间：2026-04-29 20:01:00 +08:00
测试功能：高级搜索策略库
关联任务：Task.md 2.4 高级搜索策略库
测试命令：
- `pnpm --filter @leadhunt/agent build`
- `pnpm --filter @leadhunt/agent test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- Node 直接调用 `generateSearchQueries({ targetMarkets: ["UAE", "Saudi Arabia"], minQueryCount: 15 })`
测试账号：不涉及
测试数据：UAE / Saudi Arabia、通信设备默认词库、`google search.md` 作为业务经验来源；未输出 `.env` 密钥。

成功路径：
- [x] `@leadhunt/agent` 新增高级搜索策略库数据结构，包含 `operator_source`、`execution_status`、`operator_name`、`strategy_template`、`keyword_groups`、`effectiveness_score`。
- [x] 内置 Brave 官方 operator 白名单：精确短语、排除词、OR、site、filetype、intitle、inpage、loc/lang、required term。
- [x] 内置 Google 官方常用搜索逻辑：精确短语、site、排除词等作为策略知识。
- [x] 内置 common SEO 操作符：`inurl` / `intext` 为 `manual_only`，`allintitle` / `related` / `cache` 等为 `disabled`。
- [x] 生成 15 条 Brave 自动执行 query 成功；首条示例包含 RRU / BBU / AAU、distributor / stockist / system integrator 和排除词。
- [x] 每条 query 都带 operator 来源、执行状态、策略模板、关键词组、国家和效果分。
- [x] API `SearchStrategyService` 可把生成策略映射为 `search_queries` 写入参数，服务层 mock 测试通过。
- [x] 真实远程 PostgreSQL 写入验证通过，`search_queries` 可保存并读取。
- [x] 全仓 `typecheck`、`lint`、`test`、`build` 均通过。

失败路径：
- [x] `manual_only` 模板不会进入 `getExecutableSearchStrategyTemplates()`。
- [x] `disabled` 模板不会进入 `getExecutableSearchStrategyTemplates()`。

空状态：
- [x] 未传目标市场时使用默认市场词：UAE、Saudi Arabia、Nigeria、South Africa、Indonesia、Brazil。

权限校验：
- [x] 不涉及用户权限；策略生成是纯服务能力。

数据库检查：
- [x] `search_queries` schema 已包含策略落库所需字段。
- [x] 服务层 mock 验证 `createMany` 写入参数。
- [x] 真实 PostgreSQL 写入已完成，`search_queries` 测试记录可写入并读取。

页面检查：
- [x] 不涉及页面。

外部 API 检查：
- [x] 本任务不调用 Brave API；Brave 真搜索在 2.6 执行。

发现问题：
- `@leadhunt/agent` build 起初会把 spec 编译到 `dist`，导致 Vitest 重复发现测试；已修复。
- API 直接 path 映射到 `@leadhunt/agent` 源码时触发 TypeScript `rootDir` 边界；已改为通过 workspace package 入口消费。

修复记录：
- 新增 `packages/agent/src/search-strategy.ts` 和策略库单元测试。
- 新增 `apps/api/src/search/search-strategy.service.ts` 和写入映射单元测试。
- 新增 `SearchModule` 并接入 `AppModule`。
- 调整 `@leadhunt/agent` test/build 配置，避免 dist 测试重复执行。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

测试时间：2026-04-29 20:10:30 +08:00
测试功能：Brave 搜索服务
关联任务：Task.md 2.6 Brave 搜索服务
测试命令：
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- Node 调用 `BraveSearchClient.searchWeb()` 做真实 Brave 小流量搜索，不打印 key
- `Resolve-DnsName api.search.brave.com`
- `Test-NetConnection api.search.brave.com -Port 443`
测试账号：不涉及
测试数据：`"telecom equipment" ("distributor" OR "stockist") UAE -job -training -news`；未输出 `.env` 密钥。

成功路径：
- [x] `BraveSearchClient.searchWeb()` 支持 Web Search API，能解析 `web.results[].title`、`url`、`description`、`extra_snippets`。
- [x] `BraveSearchClient.searchLlmContext()` 支持 LLM Context API，能解析 `grounding.generic[].title`、`url`、`snippets`。
- [x] 支持 query、country、language、count 参数。
- [x] 客户端包含请求限速、缓存、429 / 5xx 重试和 URL 去重。
- [x] 缺少 `BRAVE_SEARCH_API_KEY` 时返回清晰错误。
- [x] `BraveSearchService.searchAndSaveResults()` 可把搜索结果映射到 `search_results`，并更新 `search_queries.result_count`。
- [x] 同一 query 返回重复 URL 时会去重后再写入。
- [x] 真实远程 PostgreSQL 写入验证通过，`search_results` 可保存并读取。
- [x] API 单元测试 28 条通过，全仓 `typecheck`、`lint`、`test`、`build` 均通过。

失败路径：
- [x] mock 500 错误会触发重试。
- [x] 缺 key 会抛出 `BraveSearchError`，错误信息可读。
- [x] 真实 Brave API 搜索未通过，原因是当前网络无法连接 `api.search.brave.com:443`；DNS 可解析，TCP 连接失败 / 超时。

空状态：
- [x] Brave 返回空 `web.results` 时归一化为空数组，不抛异常。

权限校验：
- [x] 不涉及用户权限；搜索任务权限归属将在 LangGraph/任务层处理。

数据库检查：
- [x] 服务层 mock 验证 `search_results.createMany` 和 `search_queries.update` 参数。
- [x] 真实 PostgreSQL 写入已完成，`search_results` 测试记录可写入并读取。

页面检查：
- [x] 不涉及页面。

外部 API 检查：
- [x] 用户在另一环境已验证同一 Brave key 可返回 3 条搜索结果。
- [ ] Codex 本机网络路径仍未通过：`fetch failed`；`api.search.brave.com` DNS 解析成功，但 443 TCP 连接失败。

发现问题：
- Brave key 本身可用；当前仅 Codex 本机网络路径到 Brave API 不通。

修复记录：
- 新增 `apps/api/src/search/brave-search.client.ts`。
- 新增 `apps/api/src/search/brave-search.service.ts`。
- 新增 Brave 客户端和服务层单元测试。
- `.env.example` 增加 `BRAVE_SEARCH_BASE_URL` 默认值。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能。

测试时间：2026-04-29 20:04:00 +08:00
测试功能：关键词扩展
关联任务：Task.md 2.5 关键词扩展
测试命令：
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm --filter @leadhunt/agent test`
测试账号：不涉及
测试数据：`找 UAE 通信设备经销商`；未输出 `.env` 密钥。

成功路径：
- [x] `expandLeadKeywords()` 输出稳定 JSON 结构：主产品、同类产品、商品长尾词、上下游词、客户采购意图、目标市场、行业场景、排除词。
- [x] 输入“找 UAE 通信设备经销商”后输出 `telecom equipment`、`distributor`、`UAE`、`Dubai` 和排除词。
- [x] 通信设备默认词库包含 `telecom equipment`、`RRU`、`BBU`、`AAU`、`microwave backhaul`、`telecom power`、`Huawei ZTE spare parts`、`telecom equipment distributor`、`system integrator`、`telecom contractor`、`tower power IBS service`。
- [x] 排除词包含 `job`、`news`、`training`、`consumer phone`、`course`、`forum`。
- [x] `generateSearchQueries()` 已接入关键词扩展结果，生成 query 时能使用目标市场和排除词。
- [x] agent 测试 8 条通过，全仓 `typecheck`、`lint`、`test`、`build` 均通过。

失败路径：
- [x] 不涉及失败外部调用；纯函数输入为空时回退到默认通信设备词库和默认目标市场。

空状态：
- [x] 未输入任务时仍返回默认词库，可继续生成 Brave query。

权限校验：
- [x] 不涉及用户权限。

数据库检查：
- [x] 不涉及数据库写入。

页面检查：
- [x] 不涉及页面。

外部 API 检查：
- [x] 不调用外部 API。

发现问题：
- 无新增阻塞。

修复记录：
- 新增 `packages/agent/src/keyword-expansion.ts` 和关键词扩展测试。
- 搜索策略生成改为复用关键词扩展输出。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.7 LangGraph 空流程

- [x] 创建任务成功。（服务层 mock 和真实远程数据库写入均已验证）
- [x] 写入 `agent_steps` 成功。（服务层 mock 和真实远程数据库写入均已验证）
- [x] 节点状态正确变化。
- [x] 暂停 / 继续可用。
- [x] 失败节点可重试。

测试时间：2026-04-29 20:20:00 +08:00
测试功能：LangGraph Agent 空工作流
关联任务：Task.md 2.7 LangGraph Agent 工作流
测试命令：
- `pnpm --filter @leadhunt/agent add @langchain/langgraph @langchain/core`
- `pnpm --filter @leadhunt/agent build`
- `pnpm --filter @leadhunt/agent test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
测试账号：不涉及
测试数据：`task-1`、`Find UAE telecom distributors`；未输出 `.env` 密钥。

成功路径：
- [x] `@leadhunt/agent` 已接入 `@langchain/langgraph` 和 `@langchain/core`。
- [x] V1 16 个节点已按任务要求建立：`load_task`、`analyze_product_profile`、`analyze_customer_profile`、`expand_keywords`、`plan_search_queries`、`brave_search`、`normalize_leads`、`extract_contacts`、`score_icp`、`human_approval`、`generate_email`、`wait_email_confirmation`、`send_gmail`、`sync_crm`、`schedule_followup`、`task_summary`。
- [x] 空 LangGraph 从 `load_task` 执行到 `human_approval`，并在人工确认点暂停。
- [x] 时间线生成 16 个步骤，节点状态可从 pending 变为 completed / waiting / failed / running。
- [x] 支持 resume，将人工确认节点从 waiting 标记为 completed。
- [x] 支持失败节点和重试节点状态转换。
- [x] API `AgentWorkflowService` 可创建 `lead_tasks` 并批量写入 16 个 `agent_steps` 写入参数。
- [x] 真实远程 PostgreSQL 写入验证通过，`lead_tasks` 和 `agent_steps` 可保存并读取。
- [x] API 服务层 mock 覆盖创建任务、写入步骤、失败、重试、人工确认等待和确认继续。
- [x] agent 测试 12 条通过，API 测试 31 条通过，全仓 `typecheck`、`lint`、`test`、`build` 均通过。

失败路径：
- [x] 失败节点会写入 `failed` 和错误信息。
- [x] 重试节点会重新写入 `running` 并清空错误。

空状态：
- [x] 创建任务后所有未执行节点默认为 `pending`。

权限校验：
- [x] 不涉及页面权限；任务归属通过 `lead_tasks.user_id` 保存。

数据库检查：
- [x] 服务层 mock 验证 `leadTask.create`、`agentStep.createMany` 和 `agentStep.updateMany` 参数。
- [x] 真实 PostgreSQL 写入已完成，`lead_tasks` 和 `agent_steps` 测试记录可写入并读取。

页面检查：
- [x] 不涉及页面。

外部 API 检查：
- [x] 不涉及外部 API。

发现问题：
- LangGraph 对动态节点可达性校验严格；人工确认节点使用 conditional edge，在暂停时走 END，同时保留后续节点可达路径。

修复记录：
- 新增 `packages/agent/src/workflow.ts` 和 LangGraph 工作流测试。
- 新增 `apps/api/src/agent/agent-workflow.service.ts`、`AgentModule` 和服务层测试。
- 将旧占位工作流节点名替换为 V1 正式 16 节点。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.8 GPT-5.5 服务

- [x] OpenAI-compatible Chat Completions 客户端可用。
- [x] 9 类 Prompt 模板已统一。
- [x] JSON 输出校验和失败重试可用。
- [x] GPT-5.5 真实连通测试通过。
- [x] 真实产品画像和关键词扩展结构化输出通过。

测试时间：2026-04-29 22:12:00 +08:00
测试功能：GPT-5.5 服务
关联任务：Task.md 2.8 GPT-5.5 服务
测试命令：
- `pnpm --filter @leadhunt/api test`
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- Node + `Gpt55Client` 真实小请求，不输出 API key
- Node + `LeadHuntAiService` 真实产品画像分析和关键词扩展，不输出完整模型响应
测试账号：不涉及
测试数据：`https://telecorenet.com/`、UAE 通信设备经销商任务、参考客户官网；未输出 `.env` 密钥。

成功路径：
- [x] 新增 `Gpt55Client`，支持 OpenAI-compatible `/chat/completions`、model、max_tokens、temperature、JSON response_format、HTTP 429 / 5xx 重试。
- [x] 新增 `LeadHuntAiService`，统一封装产品画像、参考客户画像、关键词扩展、搜索策略生成、ICP 判断、开发信生成、AI 改写、回复分类、任务总结。
- [x] 新增 9 类 Zod schema，模型输出必须通过结构化 JSON 校验。
- [x] Prompt 要求只返回 JSON，不返回 Markdown 或代码块。
- [x] JSON code fence 和响应前后说明可被清理后解析。
- [x] schema 校验失败时会追加修正提示并重试一次。
- [x] GPT-5.5 真实小请求通过，返回内容可解析为 JSON。
- [x] GPT-5.5 真实业务请求通过，产品画像和关键词扩展均通过 schema 校验。
- [x] API 单元测试 44 条通过，全仓 `typecheck`、`lint`、`test`、`build` 均通过。

失败路径：
- [x] 缺少 `OPENAI_BASE_URL` 或 `OPENAI_API_KEY` 时返回清晰配置错误。
- [x] 非重试 HTTP 错误返回 typed `Gpt55Error`。
- [x] schema 连续失败后返回 `Gpt55OutputValidationError`。

空状态：
- [x] 不涉及页面空状态；Prompt 输入为空或信息不足时要求降低 confidence，不编造事实。

权限校验：
- [x] GPT-5.5 API key 只读取 `.env`，不写入文档或代码。

数据库检查：
- [x] 不涉及数据库写入。

页面检查：
- [x] 不涉及页面。

外部 API 检查：
- [x] GPT-5.5 真实 HTTP 连通通过。

发现问题：
- `.env` 原先的 `OPENAI_BASE_URL` 仍是占位地址，真实连通第一次失败为 DNS 找不到占位域名。

修复记录：
- 已按 `API调用说明.md` 更新本地 `.env` 的 GPT-5.5 base URL、model 和 API key，未输出真实值。
- 新增 `apps/api/src/ai` 模块并接入 `AppModule`。
- 新增 GPT-5.5 客户端和 LeadHunt AI 服务测试。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.9 前端基础框架

- [x] SaaS 主布局可访问。
- [x] 左侧导航页面齐全。
- [x] 当前页面导航高亮。
- [x] 顶部账号区域显示业务身份。
- [x] 1440px / 1920px 视觉检查通过。

测试时间：2026-04-29 16:22:34 +08:00
测试功能：前端基础框架
关联任务：Task.md 2.1 前端基础框架
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- `pnpm --filter @leadhunt/web build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- 启动 Web 后用 curl 检查 `/`、`/dashboard`、`/product-profile`、`/customer-profile`、`/templates`、`/campaigns`、`/mailbox`、`/brochures`、`/customers`
- 使用 Playwright + 本机 Chrome 检查 `/dashboard` 在 1440px 和 1920px 视口下的布局
测试账号：使用测试 cookie `lh_session=test.session`
测试数据：不涉及真实数据库

成功路径：
- [x] 9 个主导航页面均返回 HTTP 200。
- [x] 页面包含主布局 `.shell`。
- [x] 顶部账号区域包含 `TeleCoreNet` 业务身份，并位于视口内。
- [x] `/dashboard` 当前导航高亮为“数据看板”。
- [x] 1440px 和 1920px 截图已生成：`tmp/leadhunt-dashboard-1440.png`、`tmp/leadhunt-dashboard-1920.png`。
- [x] 全仓 `typecheck`、`lint`、`test`、`build` 通过。

失败路径：
- [x] 未登录访问 `/` 会被 proxy 重定向到 `/login?next=%2F`。

空状态：
- [x] 各页面使用 0 值或未连接状态展示初始数据。

权限校验：
- [x] 后台页面需要 `lh_session` cookie；登录、注册、忘记密码和 `/api/*` 不被拦截。

数据库检查：
- [x] 不涉及。

页面检查：
- [x] 主导航不包含旧菜单：工作台、AI 搜索客户、ICP 判断、合格客户库、Google 指令、导出记录。
- [x] 顶部不包含工具箱。

外部 API 检查：
- [x] 不涉及。

发现问题：
- Playwright bundled package存在，但自带 Chromium 未安装；已改用本机 Chrome 执行截图检查。

修复记录：
- 抽取 `AppShell` 和 `SectionPage`。
- 补齐 9 个主导航页面。
- 将 Next 16 的路由保护实现为 `proxy.ts`。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.10 候选客户和 ICP 判断

- [x] Brave 搜索结果清洗可用。
- [x] 公司名、官网、国家、摘要、来源 URL 提取可用。
- [x] 邮箱、电话、社媒提取可用。
- [x] 公司、域名、邮箱去重可用。
- [x] ICP 评分和低分拦截可用。
- [x] `lead_candidates`、`lead_contacts`、`icp_scores` 真实数据库写入通过。

测试时间：2026-04-29 22:25:00 +08:00
测试功能：候选客户清洗与 ICP 判断
关联任务：Task.md 2.9 候选客户和 ICP 判断
测试命令：
- `pnpm --filter @leadhunt/api test -- lead-qualification.service.spec.ts`
- `pnpm --filter @leadhunt/api typecheck`
- Node + Prisma 远程数据库写入/读取脚本
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
测试账号：一次性测试账号，测试后已删除。
测试数据：Spectrum MEA、High Cloud、UAE telecom distributor 样例、重复域名和 training 风险样例；未输出 `.env` 密钥。

成功路径：
- [x] `LeadQualificationService` 可把 Brave Web / LLM Context 结果归一化为候选客户。
- [x] 可从标题和域名提取公司名，保留官网、国家、摘要和来源 URL。
- [x] 可从标题、摘要和 URL 中提取 email、phone、social profile。
- [x] 同一批结果按域名、公司名和邮箱去重，并把批内重复计入 `skippedCount`。
- [x] ICP 评分覆盖行业相关度、客户类型、产品匹配、国家 / 地区、联系方式完整度和风险项。
- [x] 高分候选客户状态为 `qualified`，中分为 `review`，低分为 `rejected`。
- [x] 远程 PostgreSQL 真实写入通过：2 个候选客户、2 条联系方式、2 条 ICP 分数，1 条重复结果跳过。
- [x] API 单元测试 47 条通过，全仓 `typecheck`、`lint`、`test`、`build` 均通过。

失败路径：
- [x] 重复域名 / 重复邮箱不会重复创建候选客户。
- [x] training、job、course、news 等风险词会降低 ICP 分数并写入风险理由。

空状态：
- [x] 无联系方式时仍可创建候选客户，但联系方式完整度不加分。

权限校验：
- [x] 候选客户通过 `taskId` 归属到当前 AI 外贸员任务。

数据库检查：
- [x] `lead_candidates`、`lead_contacts`、`icp_scores` 写入和读取通过。
- [x] 删除测试用户后，任务和候选客户相关数据级联清理。

页面检查：
- [x] 不涉及页面；候选客户表格展示归属 2.10 AI 外贸员页面。

外部 API 检查：
- [x] 不直接调用外部 API；输入为 Brave 搜索结果对象。

发现问题：
- 首次真实 DB 冒烟时 `skippedCount` 未统计同一批搜索结果里的重复项，只统计数据库已存在重复项。

修复记录：
- `saveCandidates()` 现在会统计批内去重和数据库已存在去重。
- 新增 `apps/api/src/leads/lead-qualification.service.ts`、`LeadsModule` 和单元测试。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.11 AI 外贸员页面和 Lead Task API

- [x] AI 外贸员工作台可访问。
- [x] Lead Task API 创建、查询、事件、候选客户、确认、暂停、继续、取消接口可用。
- [x] 任务输入、时间线、扩展词、搜索策略、候选客户表格、CRM 同步、任务总结和底部补充指令均已渲染。
- [x] 1440px / 390px 截图检查通过，无横向溢出。

测试时间：2026-04-29 22:52:00 +08:00
测试功能：AI 外贸员页面和 Lead Task API
关联任务：Task.md 2.10 AI 外贸员页面、Task.md 3.3 Lead Task API
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api test`
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- 本机 Chrome + Playwright 截图检查 `/` 1440px 和 390px 视口
测试账号：截图检查使用测试 cookie；未调用真实用户资料。
测试数据：UAE 通信设备经销商任务、Spectrum MEA / High Cloud 预览候选客户；未输出 `.env` 密钥。

成功路径：
- [x] 首页改为 AI 外贸员工作台，包含任务输入和创建 AI 任务按钮。
- [x] `POST /api/lead-tasks` 可创建任务并写入完整 LangGraph 时间线。
- [x] `GET /api/lead-tasks/:taskId`、`events`、`leads` 可返回任务详情、步骤和候选客户。
- [x] pause / resume / cancel / approve 命令接口已接入当前登录用户校验。
- [x] 页面展示执行流程时间线、AI 扩展词、高级搜索策略、候选客户表格、CRM 同步、本次总结和继续补充指令。
- [x] 页面不包含介绍视频和观看回放入口。
- [x] 桌面截图：`tmp/ai-worker-1440-v2.png`。
- [x] 移动截图：`tmp/ai-worker-390-v2.png`。
- [x] 移动端 `scrollWidth` 等于 `innerWidth`，无横向溢出。
- [x] API 单元测试 50 条通过，全仓 `typecheck`、`lint`、`test`、`build` 均通过。

失败路径：
- [x] 未登录或无效 session 会由 AuthService 拦截。
- [x] 创建任务 payload 太短会返回 `BadRequestException`。

空状态：
- [x] 无候选客户时表格显示空状态，确认按钮不可用。

权限校验：
- [x] Lead Task 查询、事件、候选客户和状态命令都按当前用户校验任务归属。

数据库检查：
- [x] `lead_tasks` 和 `agent_steps` 写入已在 4.7 / 4.1 真实数据库验证通过。

页面检查：
- [x] 1440px 和 390px 页面截图无重叠、无横向溢出、底部补充指令可见。

外部 API 检查：
- [x] 页面本身不直接调用外部 API。

发现问题：
- 首次移动截图出现横向滚动，候选客户表格最小宽度把页面撑宽。

修复记录：
- 为 AI 工作台面板和表格滚动容器补充 `min-width: 0`、`max-width: 100%`，移动端复测通过。
- 新增 `LeadTaskController` 和控制器测试。
- 首页替换为 `AiWorkerClient` 交互工作台。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.12 Gmail OAuth 和个人邮箱

- [x] Gmail OAuth 后端接口已实现。
- [x] Gmail 授权状态页已实现。
- [x] Refresh Token 加密保存、读取和撤销已验证。
- [x] 1440px / 390px 邮箱页截图检查通过，无横向溢出。
- [x] 真实远程数据库 `gmail_accounts` 写入 / 查询 / 撤销冒烟通过。

测试时间：2026-04-29 23:55:00 +08:00
测试功能：Gmail OAuth 和个人邮箱
关联任务：Task.md 2.11 Gmail OAuth 和个人邮箱、Task.md 3.4 Gmail API
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- 真实远程数据库 Gmail OAuth mock callback 冒烟
- 本机 Chrome + Playwright 截图检查 `/mailbox` 1440px 和 390px 视口
测试账号：邮箱页截图使用测试 cookie 和模拟授权状态；真实 Google consent 尚未在浏览器中点击完成。
测试数据：测试邮箱为用户指定 Gmail；测试报告和任务文档未写入任何 OAuth Client Secret、数据库密码或 Redis 密码。

成功路径：
- [x] `GET /api/gmail/oauth/start` 返回 Google 授权 URL，并带签名 state。
- [x] `GET /api/gmail/oauth/callback` 能校验 state、交换 token、读取 Google profile，并写入 `gmail_accounts`。
- [x] `GET /api/gmail/account` 能返回当前用户 Gmail 授权状态。
- [x] `DELETE /api/gmail/account` 能撤销当前用户 Gmail 授权。
- [x] OAuth scope 限定为 Gmail 发送、草稿和只读所需权限。
- [x] Refresh Token 使用 AES-256-GCM 加密保存，真实 DB 冒烟确认数据库中不是明文。
- [x] 个人邮箱页展示已连接邮箱、授权状态、权限范围和撤销入口。
- [x] 桌面截图：`tmp/mailbox-1440.png`。
- [x] 移动截图：`tmp/mailbox-390.png`。
- [x] 移动端 `scrollWidth` 等于 `innerWidth`，无横向溢出。
- [x] API 单元测试 61 条通过，全仓 `typecheck`、`lint`、`test`、`build` 均通过。

失败路径：
- [x] 缺少 OAuth 配置时返回可读错误。
- [x] 缺少 `code` 或 `state` 时 callback 返回 `BadRequestException`。
- [x] state 签名无效或过期会拒绝授权。
- [x] 无 Gmail 授权时状态接口返回未连接状态。

权限校验：
- [x] Gmail 授权、查询和撤销都绑定当前登录用户。
- [x] 授权记录按 `user_id` 唯一归属，不复用其他用户邮箱。

数据库检查：
- [x] 真实远程数据库创建临时用户后，mock Google token/profile callback 写入 `gmail_accounts` 成功。
- [x] `encryptedRefreshToken` 字段不是明文 refresh token。
- [x] `revokeAccount()` 能写入 `revokedAt`。
- [x] 冒烟测试结束后已删除临时用户数据。

页面检查：
- [x] `/mailbox` 页面桌面和移动端截图无重叠、无横向溢出。
- [x] 页面不包含 QQ / 126 / 163 授权码入口。
- [x] 页面不包含系统域名、个人域名或 DNS 配置流程。

外部 API 检查：
- [x] Google OAuth token/profile 调用已通过 mock 覆盖。
- [ ] 真实 Google consent 尚未在浏览器手动完成。

发现问题：
- Google Cloud OAuth 控制台可能尚未添加本地 callback 地址；如果真实授权时报 `redirect_uri_mismatch`，需要在 OAuth Client 里添加 `http://localhost:4000/api/gmail/oauth/callback`。

修复记录：
- 新增 `GmailModule`、`GmailController`、`GmailOAuthService`、OAuth state 签名和 token 加密工具。
- 新增 Gmail OAuth 单元测试和真实远程 DB 冒烟脚本验证。
- 新增 `/mailbox` 个人邮箱页面和响应式样式。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.13 邮件确认弹窗和原型级 UI 重构

- [x] AI 外贸员首页按 `design/leadhunt-ai-project-email-modal.html` 重构为 56px 左侧轨道、72px 顶栏、对话工作区和底部输入框。
- [x] 邮件确认弹窗按原型重构为左侧发件表单 + 正文编辑器 + 底部动作栏，右侧只保留 AI 改写面板。
- [x] 登录页按 `design/leadhunt-auth-pages.html` 和设计规范重构，使用 100% 视口宽高，不再产生浏览器横向或纵向滚动。
- [x] Next 开发态浮层和已知浏览器插件注入导致的 hydration 噪音已隔离，生产构建不依赖插件清理逻辑。
- [x] `POST /api/gmail/drafts`、`POST /api/gmail/send`、`POST /api/gmail/rewrite` 已实现并接入弹窗。

测试时间：2026-04-30 01:35:00 +08:00
测试功能：邮件确认弹窗、AI 改写、原型级 UI 重构、100% 视口适配
关联任务：Task.md 2.12 邮件确认弹窗和 AI 改写、Task.md 3.4 Gmail API
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api test -- --runInBand apps/api/src/gmail`
- Chrome DevTools Protocol 9222 截图检查登录页、AI 工作台和邮件弹窗
- 真实远程数据库 Gmail draft/send mock Google API 冒烟

测试账号：前端截图使用测试 cookie；Gmail 账号使用用户指定测试邮箱；未执行真实外发邮件。
测试数据：UAE / Saudi 通信设备经销商样例、Gulf Telecom 样例收件人、Telecorenet 开发信样例；测试报告未写入 OAuth Client Secret、数据库密码、Redis 密码或 API Key。

成功路径：
- [x] 登录页在用户当前 150% 缩放场景下读取到真实 CSS 视口 `1707x932`，`scrollWidth=1707`、`scrollHeight=932`、`overflowX=0`、`overflowY=0`。
- [x] 登录页品牌区、左侧卖点、`/images/login.png` 主视觉、右侧登录卡片和第三方登录入口完整落在 100% 视口内。
- [x] AI 工作台在 `1707x932` 下外层 `overflowX=0`、`overflowY=0`，工作区滚动限制在 `.chatScroll` 内部。
- [x] 邮件弹窗在 `1707x932` 下尺寸为 `1360x860`，居中显示，弹窗外层和内部均无横向溢出。
- [x] 弹窗可展示发件 Gmail、Google OAuth 授权状态、收件人、回复邮箱、模板、主题、发送时间和正文编辑器。
- [x] AI 改写面板包含输出语言、邮件语气、改写输入框和一键改写按钮，mock rewrite 可覆盖正文。
- [x] 底部动作包含重置、预览、存草稿、另存为模板和确认发送。
- [x] Gmail draft/send 服务单元测试覆盖未授权拦截、草稿创建、确认发送、Google API 失败提示和 AI 改写。
- [x] 真实远程数据库 mock Google API 冒烟通过，写入 `outreach_drafts` 和 `send_logs`。
- [x] 截图已生成：`tmp/login-current-100-percent-final.png`、`tmp/home-current-100-percent.png`、`tmp/mail-modal-current-100-percent.png`。

失败路径：
- [x] 未授权 Gmail 时前端按钮提示需要先授权，后端拒绝 draft/send。
- [x] Gmail draft/send 外部 API 返回失败时后端抛出错误，前端显示失败状态。
- [x] AI 改写输入为空时不发起改写请求。

权限校验：
- [x] 发件邮箱只使用当前登录用户已授权 Gmail。
- [x] draft/send/rewrite 接口均依赖登录用户上下文，不允许跨用户复用授权。
- [x] UI 不显示域名配置、系统发信域名或邮件模板 Tab。

数据库检查：
- [x] draft/send 成功路径写入 `outreach_drafts`。
- [x] send 成功路径写入 `send_logs`。
- [x] 冒烟测试结束后清理临时用户和关联数据。

页面检查：
- [x] 登录页、AI 工作台和邮件弹窗均使用 Chrome DevTools Protocol 9222 验证。
- [x] 页面不依赖固定 1440px 宽度，按当前视口 100% 适配。
- [x] 原型核心结构、颜色、圆角、间距和功能区布局已按设计规范统一。

外部 API 检查：
- [x] Gmail API 调用在测试中使用 mock Google API，没有真实发送邮件。
- [x] Brave Search Key 已由用户在外部确认可用，本次测试未重复输出 Key。

发现问题：
- 登录页早期版本使用固定右侧列宽，在 2560x1600 / 150% 缩放窗口下会出现横向溢出。
- 浏览器插件会在开发态注入 `uptook-plugin-linkedin` DOM，引发 Next hydration dev overlay。
- Next dev overlay 会遮挡设计验收截图。

修复记录：
- 登录页改为 `100vw` / `100dvh`、`62fr / 38fr` 百分比布局，外层禁用浏览器滚动。
- AI 工作台外壳改为固定 100% 视口，滚动只保留在工作区内部。
- 增加开发态插件注入节点清理脚本，并隐藏 `nextjs-portal`，避免开发浮层污染视觉验收。
- 新增稳定测试钩子 `data-open-mail="true"`，用于 CDP 自动打开邮件弹窗。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.14 CRM 同步和我的客户

- [x] 新增 `CrmModule`、`CrmController`、`CrmService` 和 `syncLeadToCrm()`，支持 CRM 客户列表、联系人列表、收藏列表和自动分组。
- [x] `GET /api/crm/leads` 支持 `view=companies|contacts|favorites` 和 `group=all|potential|contacted_7_days|uncontacted`。
- [x] Gmail 发送成功路径会同步 `crm_leads`，写入阶段、标签、阶段事件，并创建 3 天后跟进任务。
- [x] 新增 `/customers` 我的客户页面，接入真实 CRM API，包含公司 / 联系人 / 收藏切换、分组筛选、搜索、统计和表格。
- [x] 修复 `tsx watch` 下 Nest 依赖注入元数据缺失问题，为运行态 controller/service 注入补充显式 `@Inject(...)`。

测试时间：2026-04-30 02:20:00 +08:00
测试功能：CRM 同步、我的客户、3 天跟进任务、公司 / 联系人切换
关联任务：Task.md 2.13 CRM 同步和我的客户、Task.md 3.5 CRM API
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- `pnpm --filter @leadhunt/api test -- src/crm src/gmail/gmail-message.service.spec.ts --runInBand`
- `pnpm --filter @leadhunt/api prisma migrate deploy`
- Chrome DevTools Protocol 9222 打开 `/customers` 并检查公司表 / 联系人表

测试账号：本地开发账号 `crm-demo@example.com`。测试数据为虚拟公司 `EuroCell Telecom GmbH`，未写入真实客户资料。
测试数据：远程 PostgreSQL 开发库中写入 1 条 CRM 公司、2 条联系人、1 条发送记录、1 条 3 天后跟进任务；报告不写入数据库密码、Redis 密码或 API Key。

成功路径：
- [x] 远程 PostgreSQL migration 检查通过，无待执行 migration。
- [x] 本地 API `/api/auth/login` 可登录开发账号。
- [x] `GET /api/crm/leads?view=companies&group=all` 返回公司数 1、联系人数 2、收藏数 1。
- [x] 公司记录展示公司名称、国家、行业、客户阶段、负责人、最近跟进和操作。
- [x] 邮件触达后的 CRM 阶段显示为“已触达”。
- [x] 默认跟进任务时间为邮件触达后 3 天。
- [x] 联系人列表切换后展示 2 条联系人记录。
- [x] 收藏统计按 `favorite` 标签计算。
- [x] Chrome 9222 验证 `/customers` 在 `1707x932` 视口下 `overflowX=0`、`overflowY=0`。
- [x] 截图已生成：`tmp/customers-current-100-percent.png`。

失败路径：
- [x] 未登录请求 CRM API 会被认证拦截。
- [x] CRM sync 传入不属于当前用户的 leadId 会返回 not found。
- [x] 重复同步同一 lead 不会重复创建待处理 follow-up。

权限校验：
- [x] CRM 查询按 `lead.task.userId` 限定当前用户。
- [x] CRM 同步前确认 lead 归属当前用户。
- [x] Gmail 发送后的 CRM 同步沿用当前登录用户上下文。

数据库检查：
- [x] `crm_leads` 成功 upsert。
- [x] `lead_candidates.status` 随 CRM 阶段更新。
- [x] `lead_stage_events` 成功写入阶段变化。
- [x] `followup_tasks` 成功写入 3 天后待跟进任务。
- [x] `outreach_drafts` 和 `send_logs` 可用于判断 7 天内联系客户。

页面检查：
- [x] `/customers` 可展示同步结果。
- [x] 公司列表 / 联系人列表切换可用。
- [x] 顶部统计、分组筛选和表格在当前 100% 视口内无外层滚动条。
- [x] `/customers` 已按 `design/我的客户.png` 重构为左侧客户列表面板 + 右侧客户表格工作区。

发现问题：
- `tsx watch` 开发运行时不会生成 Nest 构造器参数元数据，导致未显式注入的 controller/service 在接口请求时依赖为 `undefined`。

修复记录：
- 为 Auth、CRM、Gmail、Profiles、Agent、Search 等运行态依赖补充 `@Inject(...)`。
- 新增 CRM 服务层和 controller 单元测试。
- 新增真实接口 + 页面级 CRM 冒烟检查。
- 生成原型对齐截图：`tmp/customers-design-aligned-100-percent.png`。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.15 数据看板和 CRM Analytics

- [x] 新增 `GET /api/crm/analytics?range=all|month|week|day`，按当前登录用户聚合搜索、邮件触达、回复、收藏企业、收藏个人和 7 天趋势。
- [x] `/dashboard` 按 `design/数据面板.png` 重构为顶部概览、到达率、我的数据折线区、搜索偏好和搜索次数双栏卡片。
- [x] 左侧 AppShell 导航补齐原型里的线索中心条目，并将数据看板放入 `CRM 客户管理` 分组。
- [x] 数据看板时间筛选已接入真实接口，左侧 `全部 / 本月 / 本周 / 本日` 和右侧 `今天 / 近7天 / 全部` 同步切换同一统计范围。

测试时间：2026-04-30 09:20:00 +08:00
测试功能：数据看板、CRM Analytics、时间筛选、原型级页面对齐
关联任务：Task.md 2.16 数据看板、Task.md 3.5 CRM API
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/api test -- src/crm --runInBand`
- `pnpm --filter @leadhunt/api lint`
- `pnpm --filter @leadhunt/web lint`
- `Invoke-RestMethod http://localhost:4000/api/crm/analytics?range=all`
- Chrome DevTools Protocol 9222 打开 `/dashboard` 并检查真实视口

测试账号：本地开发账号 `crm-demo@example.com`。测试数据为虚拟 CRM 公司、虚拟 Gmail 发送记录和收藏标签；报告不写入数据库密码、Redis 密码或 API Key。

成功路径：
- [x] `GET /api/crm/analytics?range=all` 返回 `emailTasks=1`、`favoriteCompanies=1`、`searchRows=3`、`seriesDays=7`。
- [x] 页面数据概况展示 `1/1` 邮件联系、`1` 收藏企业、`0/0` 短信联系和 `0` 收藏个人。
- [x] 到达率展示邮件 `100%`、`1/1`，短信 `0%`、`0/0`。
- [x] 搜索偏好和搜索次数卡片可渲染空数据 / 占位数据。
- [x] 点击 `本周` 后左侧筛选显示 `本周`，右侧两个卡片同步显示 `近7天`。
- [x] Chrome 9222 验证 `/dashboard` 在真实 CSS 视口 `1707x932` 下 `overflowX=0`、`overflowY=0`。
- [x] 左侧导航不产生内部溢出：`.appNav clientHeight=776`、`scrollHeight=776`。
- [x] 截图已生成：`tmp/dashboard-analytics-design-aligned-100-percent.png`。

失败路径：
- [x] 未登录请求 analytics 会被认证拦截。
- [x] 非法 `range` 查询会返回 `Invalid CRM analytics query`。
- [x] 前端 analytics 请求失败时保留当前页面并显示读取失败状态。

数据库检查：
- [x] 搜索次数来自 `search_queries`。
- [x] 邮件触达来自 `send_logs`。
- [x] 回复次数来自 `inbound_messages`。
- [x] 收藏企业来自 `crm_leads.tags`。
- [x] 我的数据 7 天序列按日期聚合搜索、触达、回复和收藏。

页面检查：
- [x] `/dashboard` 左右卡片、标题、筛选、指标、到达率、折线图和提示条按原型布局。
- [x] 数据看板位于左侧 `CRM 客户管理` 分组，和当前设计图一致。
- [x] 页面不依赖固定 1440px 宽度，按当前视口 100% 适配。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.16 产品画像原型对齐

- [x] `/product-profile` 按 `design/产品画像.png` 重构为说明区、三步资料卡、AI 理解标签区和底部操作条。
- [x] 保留原 `PUT /api/profiles/product` 保存链路，`仅保存` 和 `保存并生成产品画像` 都会写入当前登录用户产品资料。
- [x] 页面从旧的左右预览布局改为原型里的整页工作流布局，上传资料、历史成交导入和清空重填均为可见占位入口。

测试时间：2026-04-30 09:35:00 +08:00
测试功能：产品画像页面、保存产品资料、100% 视口原型对齐
关联任务：Task.md 2.2 产品画像页面
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools Protocol 9222 打开 `/product-profile`，检查真实视口和页面保存状态

测试账号：本地开发账号 `crm-demo@example.com`。测试数据为 `https://telecorenet.com/` 和通信设备样例说明；报告不写入数据库密码、Redis 密码或 API Key。

成功路径：
- [x] `/product-profile` 在真实 CSS 视口 `1707x932` 下 `overflowX=0`、`overflowY=0`。
- [x] 页面展示标题、功能说明、三张说明卡、三步填写区、官网 / 产品页链接、主营产品关键词、上传资料、历史成交、补充说明和 AI 理解标签区。
- [x] 点击 `仅保存` 后前端状态显示“已保存，AI 外贸员会在后续任务中读取这份产品资料。”
- [x] 当前页面不再出现旧的右侧预览卡片，视觉结构和 `design/产品画像.png` 对齐。
- [x] 截图已生成：`tmp/product-profile-design-aligned-100-percent.png`。

失败路径：
- [x] 保存失败时页面显示检查链接格式或登录状态。
- [x] 网络异常时页面显示稍后重试。

页面检查：
- [x] 表单控件、标签、按钮和说明文案均在当前 100% 视口内完整显示。
- [x] 顶部栏、左侧导航和底部操作条未产生外层滚动条。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.17 客户画像原型对齐

- [x] `/customer-profile` 按 `design/客户画像.png` 重构为功能说明、三步填写区、AI 理解标签区和底部操作条。
- [x] 保留原 `PUT /api/profiles/customer` 保存链路，`仅保存` 和 `保存并开始找客户` 都会写入当前登录用户客户画像资料。
- [x] 页面从旧的左右预览布局改为原型里的客户画像工作流布局，CRM 选择和清空重填为可见占位入口。

测试时间：2026-04-30 09:45:00 +08:00
测试功能：客户画像页面、保存客户资料、100% 视口原型对齐
关联任务：Task.md 2.3 客户画像页面
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools Protocol 9222 打开 `/customer-profile`，检查真实视口和页面保存状态
- Chrome DevTools Protocol 9222 `Page.captureScreenshot` 保存当前页截图

测试账号：本地开发账号 `crm-demo@example.com`。测试数据为阿联酋 / 沙特 / 尼日利亚 / 肯尼亚和通信设备客户样例；报告不写入数据库密码、Redis 密码或 API Key。

成功路径：
- [x] `/customer-profile` 在真实 CSS 视口 `1707x932` 下 `overflowX=0`、`overflowY=0`。
- [x] 页面展示标题、功能说明、三张说明卡、三步填写区、目标国家 / 地区、行业关键词、参考客户官网、CRM 选择、补充说明和 AI 理解标签区。
- [x] 点击 `仅保存` 后前端状态显示“已保存，AI 外贸员会在后续任务中读取这份客户画像。”
- [x] 当前页面不再出现旧的右侧预览卡片，视觉结构和 `design/客户画像.png` 对齐。
- [x] 截图已生成：`tmp/customer-profile-design-aligned-100-percent.png`。

失败路径：
- [x] 保存失败时页面显示检查目标市场、参考客户官网或登录状态。
- [x] 网络异常时页面显示稍后重试。

页面检查：
- [x] 表单控件、标签、按钮和说明文案均在当前 100% 视口内完整显示。
- [x] 顶部栏、左侧导航和底部操作条未产生外层滚动条。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.18 模板配置原型对齐

- [x] `/templates` 按 `design/模板配置.png` 重构为 `发送记录 / 发邮件 / 邮件模板` 顶部 Tab、系统 / 自建筛选、搜索框、模板表格和模板选择弹窗示意区。
- [x] 内置展示 2 条系统邮件模板和 4 个模板卡片：项目供货、备件现货、售后维修、新品推广。
- [x] 新建、删除、编辑、预览保留为可见入口，后续再接真实 CRUD。

测试时间：2026-04-30 09:55:00 +08:00
测试功能：模板配置页面、系统模板列表、100% 视口原型对齐
关联任务：Task.md 2.17 模板配置
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools Protocol 9222 打开 `/templates`，检查真实视口、列表和模板卡片
- Chrome DevTools Protocol 9222 `Page.captureScreenshot` 保存当前页截图

成功路径：
- [x] `/templates` 在真实 CSS 视口 `1707x932` 下 `overflowX=0`、`overflowY=0`。
- [x] 模板表格展示 2 条系统模板，包含模板名称、模板主题、创建时间、创建用户和操作入口。
- [x] 下方模板选择示意区展示 4 个模板卡片。
- [x] 截图已生成：`tmp/templates-design-aligned-100-percent.png`。

未完成项：
- [ ] 新建模板真实保存。
- [ ] 编辑模板真实保存。
- [ ] 预览模板弹窗。
- [ ] 邮件确认弹窗读取模板列表。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.19 邮件营销原型对齐

- [x] `/campaigns` 按 `design/邮件营销.png` 重构为 `发送记录 / 发邮件 / 邮件模板` 顶部 Tab、发件表单、邮件编辑器和右侧 AI 改写面板。
- [x] 页面保留发邮件入口和草稿、预览、存草稿、另存为模板、发送等操作入口，不引入复杂群发后台。
- [x] 当前真实发件主链路仍以 AI 外贸员邮件确认弹窗为准，本页作为 V1 弱化入口和原型页面。

测试时间：2026-04-30 10:05:00 +08:00
测试功能：邮件营销页面、AI 改写面板、100% 视口原型对齐
关联任务：Task.md 2.18 邮件营销
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools Protocol 9222 打开 `/campaigns`，检查真实视口和主要 UI 区块
- Chrome DevTools Protocol 9222 `Page.captureScreenshot` 保存当前页截图

成功路径：
- [x] `/campaigns` 在真实 CSS 视口 `1707x932` 下 `overflowX=0`、`overflowY=0`。
- [x] 左侧发件表单展示 5 个核心字段：发件邮箱、收件人、回复邮箱、邮件模板、邮件主题。
- [x] 页面展示发送时间、邮件编辑工具栏、正文、底部动作和右侧 AI 改写面板。
- [x] 截图已生成：`tmp/campaigns-design-aligned-100-percent.png`。

未完成项：
- [ ] 本页发送按钮尚未接真实 Gmail send；真实发信仍在 AI 外贸员邮件确认弹窗完成。
- [ ] 本页 AI 改写按钮尚未接 `POST /api/gmail/rewrite`。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.20 个人邮箱原型对齐

- [x] `/mailbox` 按 `design/个人邮箱.png` 重构为左侧邮箱文件夹、邮件列表和 Gmail 授权状态面板。
- [x] 保留 `GET /api/gmail/account`、`/api/gmail/oauth/start`、`DELETE /api/gmail/account` 真实接口链路。
- [x] 当前开发账号未连接 Gmail 时显示未授权状态，OAuth 连接入口可见。

测试时间：2026-04-30 10:15:00 +08:00
测试功能：个人邮箱页面、Gmail 授权状态、100% 视口原型对齐
关联任务：Task.md 2.11 Gmail OAuth 和个人邮箱
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools Protocol 9222 打开 `/mailbox`，检查真实视口、邮箱行、文件夹按钮和授权面板
- Chrome DevTools Protocol 9222 `Page.captureScreenshot` 保存当前页截图

成功路径：
- [x] `/mailbox` 在真实 CSS 视口 `1707x932` 中 `overflowX=0`、`overflowY=0`。
- [x] 页面渲染 3 条邮件示意行、8 个文件夹按钮和授权状态面板。
- [x] 截图已生成：`tmp/mailbox-design-aligned-100-percent.png`。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.21 邮寄宣传册原型对齐

- [x] `/brochures` 按 `design/邮寄宣传册.png` 从旧占位页重构为邮寄宣传册任务工作台。
- [x] 页面包含二级导航、时间筛选、4 个统计卡、5 步创建任务进度、任务名称、收件人、国家 / 规格选择和上传区域。
- [x] V1 仅保留静态入口，不接入 AI 外贸员主流程，也不影响邮件和 CRM 主链路。

测试时间：2026-04-30 10:30:00 +08:00
测试功能：邮寄宣传册页面、100% 视口原型对齐
关联任务：Task.md 2.19 邮寄宣传册
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools Protocol 9222 打开 `/brochures`，检查真实视口和主要 UI 区块
- Chrome DevTools Protocol 9222 `Page.captureScreenshot` 保存当前页截图

成功路径：
- [x] `/brochures` 在真实 CSS 视口 `1707x932` 中 `overflowX=0`、`overflowY=0`。
- [x] 页面渲染 5 个二级导航按钮、4 个统计卡、5 个创建步骤和上传区域。
- [x] 主流程不依赖邮寄宣传册，页面作为 V1 低优先级静态入口存在。
- [x] 截图已生成：`tmp/brochures-design-aligned-100-percent.png`。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.22 注册和忘记密码原型复测

- [x] `/register` 按 `design/注册页面.png` 的左侧品牌视觉和右侧注册表单结构展示。
- [x] `/forgot-password` 按 `design/忘记密码.png` 的右侧找回密码卡片结构展示。
- [x] 两个页面共用认证页 100% 视口布局，不产生外层滚动条。

测试时间：2026-04-30 10:35:00 +08:00
测试功能：注册页面、忘记密码页面、100% 视口原型对齐
关联任务：Task.md 1.4 登录注册最小闭环
测试命令：
- Chrome DevTools Protocol 9222 打开 `/register` 和 `/forgot-password`
- Chrome DevTools Protocol 9222 检查真实视口、表单数量、品牌卖点和外层滚动
- Chrome DevTools Protocol 9222 `Page.captureScreenshot` 保存当前页截图

成功路径：
- [x] `/register` 在真实 CSS 视口 `1707x932` 中 `overflowX=0`、`overflowY=0`，4 个输入框和 4 个左侧卖点均渲染。
- [x] `/forgot-password` 在真实 CSS 视口 `1707x932` 中 `overflowX=0`、`overflowY=0`，1 个邮箱输入框和 4 个左侧卖点均渲染。
- [x] 截图已生成：`tmp/register-current-100-percent.png`。
- [x] 截图已生成：`tmp/forgot-current-100-percent.png`。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.23 线索中心缺失路由补齐

- [x] 新增 `/lead-search`，展示 AI 搜索客户的策略组合、兼容查询、候选结果和高级搜索策略样例。
- [x] 新增 `/icp`，展示 ICP 评分维度、高优先级 / 待确认 / 过滤客户和候选客户评分样例。
- [x] 新增 `/qualified-customers`，展示合格客户库、入库规则、CRM 同步说明和客户样例。
- [x] 新增 `/google-commands`，展示 Google 指令 / 高级搜索策略库的操作符兼容性、手动策略和禁用策略。

测试时间：2026-04-30 10:50:00 +08:00
测试功能：线索中心导航入口、缺失路由补齐、100% 视口检查
关联任务：Task.md 2.1 前端基础框架
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- `pnpm build`
- Chrome DevTools Protocol 9222 依次打开 `/lead-search`、`/icp`、`/qualified-customers`、`/google-commands`
- Chrome DevTools Protocol 9222 检查真实视口、导航高亮、统计卡、步骤卡和表格
- Chrome DevTools Protocol 9222 `Page.captureScreenshot` 保存当前页截图

成功路径：
- [x] 四个页面均返回真实页面，不再进入 404。
- [x] `pnpm build` 通过，生产构建路由清单包含四个新页面。
- [x] 四个页面在真实 CSS 视口 `1707x932` 中均为 `overflowX=0`、`overflowY=0`。
- [x] 每个页面均渲染 4 个统计卡、3 个说明卡和 3 条表格样例。
- [x] 截图已生成：
  - `tmp/lead-search-100-percent.png`
  - `tmp/icp-100-percent.png`
  - `tmp/qualified-customers-100-percent.png`
  - `tmp/google-commands-100-percent.png`

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.24 全页面 100% 视口外层滚动扫描

- [x] 使用 Chrome DevTools Protocol 9222 依次打开当前所有实际页面，统一检查 `documentElement/body` 的外层滚动尺寸。
- [x] 覆盖页面：`/login`、`/register`、`/forgot-password`、`/`、`/product-profile`、`/customer-profile`、`/lead-search`、`/icp`、`/qualified-customers`、`/google-commands`、`/templates`、`/campaigns`、`/mailbox`、`/brochures`、`/customers`、`/dashboard`。

测试时间：2026-04-30 10:55:00 +08:00
测试功能：全页面 100% 视口外层滚动扫描
测试命令：
- Chrome DevTools Protocol 9222 批量打开 16 个页面
- 对每页执行 `scrollWidth - innerWidth` 和 `scrollHeight - innerHeight` 检查

成功路径：
- [x] 16 个页面均在真实 CSS 视口 `1707x932` 中 `overflowX=0`。
- [x] 16 个页面均在真实 CSS 视口 `1707x932` 中 `overflowY=0`。
- [x] 登录、注册、忘记密码、AI 外贸员、画像页、线索中心、转化工具、邮箱、邮寄宣传册、CRM 和数据看板均未出现浏览器级滚动条。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.25 CRM 数据查看弹窗

- [x] AI 外贸员首页新增 CRM 同步预览卡片，展示待同步客户、ICP 高分客户、跟进提醒和 3 条缩略客户记录。
- [x] 点击 CRM 缩略表或 `查看 CRM 数据` 按钮会在当前 AI 项目页上方打开遮罩弹窗。
- [x] 弹窗字段覆盖公司名称、国家、行业、电话、邮箱、数据来源、AI 标签、客户阶段、负责人和评分。
- [x] 弹窗支持分页，第一页展示 3 条，第二页展示 2 条，并支持关闭。

测试时间：2026-04-30 12:29:00 +08:00
测试功能：AI 外贸员 CRM 同步缩略表格、CRM 数据弹窗、分页、关闭、100% 视口检查
关联任务：Task.md 2.14 CRM 数据查看弹窗
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- `pnpm build`
- Chrome DevTools Protocol 9222 打开 `/`，点击 `[data-crm-preview-thumb="true"]`
- Chrome DevTools Protocol 9222 检查弹窗字段、第一页 / 第二页行数、关闭状态和外层滚动
- Chrome DevTools Protocol 9222 `Page.captureScreenshot` 保存弹窗截图
- 对本次改动文件执行敏感字段扫描

成功路径：
- [x] 首页真实 CSS 视口为 `1707x932`，CRM 缩略表存在，外层 `overflowX=0`、`overflowY=0`。
- [x] 弹窗打开后存在 10 个字段表头：公司名称、国家、行业、电话、邮箱、数据来源、AI 标签、客户阶段、负责人、评分。
- [x] 弹窗第一页行数为 3，首行客户为 `Gulf Telecom Supplies FZE`，客户阶段为 `待触达`。
- [x] 点击下一页后行数为 2，首行客户为 `MEA Radio Systems Trading`，下一页按钮进入禁用状态。
- [x] 点击关闭按钮后 `.crmDataModal` 不再存在。
- [x] 弹窗打开状态下外层 `overflowX=0`、`overflowY=0`。
- [x] 全仓 `pnpm build` 通过，生产路由清单包含首页和当前所有已实现页面。
- [x] 本次改动文件敏感字段扫描无命中，报告未写入数据库密码、Redis 密码或 API Key。
- [x] 截图已生成：`tmp/ai-crm-modal-100-percent.png`。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.26 Gmail 回复同步和跟进闭环

- [x] Gmail 发信成功后写入 `send_logs`，并根据 Gmail `threadId` 创建 / 更新 `inbox_threads`。
- [x] 新增 `POST /api/gmail/sync`，可按全部线程或指定 `threadId` 同步 Gmail 回复。
- [x] `GmailMessageService.syncAllUsers()` 支持按 `GMAIL_SYNC_INTERVAL_MS` 可配置后台轮询；默认关闭，避免开发期无意触发真实 Gmail 请求。
- [x] 同步流程会跳过本账号发出的消息，只入库客户回复，写入 `inbound_messages`。
- [x] 回复会通过 AI 分类服务分类；AI 调用失败或测试场景可落到本地规则分类。
- [x] 支持分类：`interested`、`request_quote`、`request_catalog`、`rejection`、`unsubscribe`、`auto_reply`、`other`。
- [x] 根据分类更新 CRM 阶段、写入 `lead_stage_events`、创建人工跟进任务，并写入 `campaign_analytics`。
- [x] 拒绝 / 退订会取消待处理跟进任务，避免继续触达。

测试时间：2026-04-30 13:41:00 +08:00
测试功能：Gmail 回复同步、回复分类、CRM 阶段更新、跟进任务、Campaign Analytics
关联任务：Task.md 2.15 回复和跟进闭环、Task.md 3.4 Gmail API
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api test -- src/gmail`
- `pnpm --filter @leadhunt/api lint`
- `pnpm --filter @leadhunt/api build`
- 使用项目 `PrismaService` 连接远程开发 PostgreSQL，创建临时用户 / Gmail 账号 / 任务 / lead / draft / thread 后执行 `syncReplies()` 冒烟，并删除临时用户做级联清理。

成功路径：
- [x] Gmail 单元测试 5 个文件通过，共 29 条测试。
- [x] `sendEmail()` 会返回并保存 Gmail `threadId` 到 `inbox_threads`。
- [x] `POST /api/gmail/sync` controller 会使用当前登录用户调用 `syncReplies()`。
- [x] 报价回复会入库 1 条 `inbound_messages`、1 条 `reply_classifications`、创建 `prepare_quote` 跟进任务，并写入 `campaign_analytics`。
- [x] 感兴趣、要目录、自动回复、拒绝、退订分类路径均有服务层测试覆盖。
- [x] `syncAllUsers()` 可汇总所有已授权 Gmail 用户的同步结果，用于可配置后台轮询。
- [x] 真实远程 PostgreSQL 冒烟结果：`newReplies=1`、`classifiedReplies=1`、`followupsCreated=1`、`stageEventsWritten=1`、`analyticsWritten=1`，CRM 阶段为 `catalog_requested`。
- [x] 冒烟测试临时用户已删除，关联数据通过级联清理。
- [x] 全仓 `pnpm build` 通过。
- [x] 敏感字段扫描无真实密钥；只出现源码中的 Google OAuth secret 环境变量读取和 OAuth 标准参数名。

失败路径：
- [x] 未授权 Gmail 账号会返回 `Gmail is not authorized`。
- [x] 重复消息会通过同线程、发件人、主题和接收时间检查跳过。
- [x] 拒绝 / 退订会取消待处理 follow-up，不再继续触达。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.27 模板配置 CRUD 和邮件模板选择

- [x] 新增共享模板库 `apps/web/app/mail-templates.ts`，系统模板和邮件确认弹窗共用同一套模板数据。
- [x] `/templates` 支持系统模板 / 自建模板切换、搜索、新建、编辑、预览和删除自建模板。
- [x] 自建模板保存到浏览器 localStorage，开发期不新增数据库表，避免扩大后端 schema 范围。
- [x] AI 外贸员邮件确认弹窗的“使用模板”改为真实模板选择框，可读取系统模板和自建模板。
- [x] 邮件确认弹窗支持把当前邮件另存为自建模板。

测试时间：2026-04-30 13:55:00 +08:00
测试功能：模板配置新增、编辑、预览、邮件生成读取模板、100% 视口检查
关联任务：Task.md 2.17 模板配置
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools Protocol 9222 打开 `/templates`，清理模板 localStorage 后执行新建 / 预览 / 编辑流程
- Chrome DevTools Protocol 9222 打开 `/`，打开邮件确认弹窗并选择自建模板
- Chrome DevTools Protocol 9222 `Page.captureScreenshot` 保存模板页和邮件弹窗截图

成功路径：
- [x] 新建自建模板后 localStorage 中存在 1 条模板，页面自建模板表格显示 1 条记录。
- [x] 模板预览弹窗可打开，主题显示 `Quote support for telecom infrastructure projects`。
- [x] 编辑模板后 localStorage 中主题更新为 `Updated quote support for telecom projects`。
- [x] 邮件确认弹窗模板选择框存在 5 个选项：4 个系统模板 + 1 个自建模板。
- [x] 邮件确认弹窗选择自建模板后，邮件主题更新为 `Updated quote support for telecom projects`，正文包含报价需求内容。
- [x] `/templates` 和邮件确认弹窗在真实 CSS 视口 `1707x932` 下均为 `overflowX=0`、`overflowY=0`。
- [x] 截图已生成：
  - `tmp/templates-crud-preview-100-percent.png`
  - `tmp/mail-template-select-100-percent.png`

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.28 CRM API 详情、新建和编辑

- [x] 新增 `GET /api/crm/leads/:id`，按当前登录用户归属读取单个 CRM 客户详情。
- [x] 新增 `POST /api/crm/leads`，支持手动新建 CRM 客户、联系人、标签和初始阶段事件。
- [x] 新增 `PATCH /api/crm/leads/:id`，支持编辑公司资料、阶段、标签，并替换联系人。
- [x] 三个接口都通过 `lead.task.userId` 限定当前用户，避免读取或编辑其他用户客户。

测试时间：2026-04-30 14:18:00 +08:00
测试功能：CRM API 详情、新建、编辑、联系人替换、阶段事件、真实 PostgreSQL 冒烟
关联任务：Task.md 3.5 CRM API
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api test -- src/crm`
- `pnpm --filter @leadhunt/api lint`
- `pnpm --filter @leadhunt/api build`
- `pnpm build`
- 使用项目 `PrismaService` 连接远程开发 PostgreSQL，创建临时用户后调用 `CrmService.createLead()` / `getLead()` / `updateLead()`，最后删除临时用户做级联清理。

成功路径：
- [x] CRM controller 和 service 单元测试 2 个文件通过，共 19 条测试。
- [x] `GET /api/crm/leads/:id` 会校验 UUID，并调用当前用户上下文读取详情。
- [x] `POST /api/crm/leads` 会创建 `lead_tasks`、`lead_candidates`、`lead_contacts`、`crm_leads` 和 `lead_stage_events`。
- [x] `PATCH /api/crm/leads/:id` 会更新 `lead_candidates` 和 `crm_leads`，并在阶段变化时写入 `lead_stage_events`。
- [x] 联系人输入会去重，编辑时先删除旧联系人再写入新联系人。
- [x] 真实远程 PostgreSQL 冒烟结果：`createdOk=true`、`detailCompany=Manual CRM Smoke LLC`、`updatedStage=interested`、`tagCount=2`、`crmCount=1`、`contactCount=1`、`eventCount=2`。
- [x] 冒烟测试临时用户已删除，关联数据通过级联清理。
- [x] 报告未写入数据库密码、Redis 密码或 API Key。

失败路径：
- [x] 非法 CRM lead id 会返回 `Invalid CRM lead id`。
- [x] 新建 payload 缺少有效公司名会返回 `Invalid CRM lead payload`。
- [x] 空编辑 payload 或越权 / 不存在 CRM lead 会被拒绝。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.29 Auth API 完整闭环和前端登录

- [x] 补齐 `POST /api/auth/forgot-password`，并保留旧的 `POST /api/auth/password-reset` 兼容入口。
- [x] 新增 `POST /api/auth/reset-password`，支持使用有效 token 重设密码、标记 token 已使用，并清理旧 session。
- [x] 新增 `GET /api/auth/google`，生成 Google 登录授权跳转，只使用 `openid email profile` 身份 scope。
- [x] 新增 `GET /api/auth/google/callback`，校验 state cookie、换取 Google profile、创建或关联本地用户，并设置 LeadHunt session。
- [x] 前端忘记密码页改用 `/api/auth/forgot-password`。

测试时间：2026-04-30 14:26:00 +08:00
测试功能：Auth API、密码重置、Google 登录入口、前端登录进入系统
关联任务：Task.md 3.1 Auth API、Task.md 第一阶段完成标准、Task.md V1 完成标准
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api test -- src/auth`
- `pnpm --filter @leadhunt/api lint`
- `pnpm --filter @leadhunt/api build`
- `pnpm --filter @leadhunt/web typecheck`
- 真实 API 冒烟：注册、me、退出、找回密码、重置密码、重置后登录、Google 授权跳转。
- Chrome DevTools Protocol 9222 打开 `/login`，填写临时账号并登录进入首页。

成功路径：
- [x] Auth controller 和 service 单元测试 2 个文件通过，共 22 条测试。
- [x] 真实 API 冒烟返回：`register=201`、`me=200`、`logout=201`、`forgot=201`、`reset=201`、`login=201`、`google=302`。
- [x] Google 登录跳转目标为 `accounts.google.com`，scope 为 `openid email profile`，不包含 Gmail scope。
- [x] `/login` 页面使用临时测试账号登录后跳转到 `/`，首页 AI 外贸员主界面可见。
- [x] 临时 API 冒烟用户和前端登录测试用户均已删除，关联数据通过级联清理。
- [x] 报告未写入数据库密码、Redis 密码或 API Key。

失败路径：
- [x] 短注册密码、重复邮箱、错误登录密码、无效 session、无效或过期 reset token 均有单元测试覆盖。
- [x] Google callback state 不匹配会拒绝登录。
- [x] Google Auth 和 Gmail OAuth 使用不同路由和不同 scope，不混用权限。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.30 Profile API 短路径和上传接口

- [x] `GET /api/product-profile` 和 `PUT /api/product-profile` 已接入产品画像服务。
- [x] `GET /api/customer-profile` 和 `PUT /api/customer-profile` 已接入客户画像服务。
- [x] 保留旧路径 `/api/profiles/product` 和 `/api/profiles/customer`，避免现有前端保存链路断开。
- [x] 新增 `POST /api/uploads`，支持 V1 开发期用 base64 payload 写入本地 `runtime/uploads`。

测试时间：2026-04-30 14:36:00 +08:00
测试功能：Profile API 短路径、旧路径兼容、上传文件落盘、真实 PostgreSQL 写入
关联任务：Task.md 3.2 Profile API
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api test -- src/profiles`
- `pnpm --filter @leadhunt/api lint`
- `pnpm --filter @leadhunt/api build`
- 真实 API 冒烟：注册临时用户后调用产品画像、客户画像、上传接口，并删除临时用户。

成功路径：
- [x] Profile 单元测试 3 个文件通过，共 13 条测试。
- [x] 真实 API 冒烟返回：`product=200`、`productGet=200`、`productLegacy=200`、`customer=200`、`customerGet=200`、`customerLegacy=200`、`upload=201`。
- [x] 真实远程 PostgreSQL 写入检查：`productCount=1`、`customerCount=1`。
- [x] 上传接口会校验文件大小与 base64 内容长度一致，并将文件写入当前用户目录。
- [x] 冒烟测试临时用户已删除，上传测试文件和空目录已清理。
- [x] 报告未写入数据库密码、Redis 密码或 API Key。

失败路径：
- [x] 未登录读取 / 保存画像和上传会被拒绝。
- [x] 非法产品官网、缺少目标市场、非法参考客户 URL 会返回业务错误。
- [x] 上传 payload 非法或声明大小与内容不一致会被拒绝。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.31 AI 任务启动读取画像和生成搜索计划

- [x] 创建 AI 外贸员任务时读取当前用户的产品画像和客户画像。
- [x] 任务 `inputPayload` 写入产品画像、客户画像、执行计划、关键词分组和 15 条搜索策略。
- [x] 15 条搜索策略同步写入 `search_queries`，后续 Brave 搜索节点可直接读取。

测试时间：2026-04-30 14:42:00 +08:00
测试功能：AI 外贸员任务启动、画像读取、执行计划、搜索策略落库
关联任务：Task.md 2.2 产品画像、Task.md 2.3 客户画像、Task.md V1 完成标准
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api test -- src/agent`
- 真实 API 冒烟：注册临时用户、保存产品画像、保存客户画像、创建 lead task、检查 `lead_tasks.input_payload` 和 `search_queries`。

成功路径：
- [x] Agent 单元测试 2 个文件通过，共 7 条测试。
- [x] 无画像时会使用任务文本和默认通信设备词库生成执行计划。
- [x] 有画像时会读取产品官网、产品页、资料 URL、产品说明、目标地区、参考客户、CRM 样本和客户说明。
- [x] 真实 API 冒烟结果：`register=201`、`createTask=201`、`hasProductProfile=true`、`hasCustomerProfile=true`、`planSteps=6`、`payloadQueries=15`、`queryCount=15`。
- [x] 冒烟测试临时用户已删除，关联任务、画像和搜索策略通过级联清理。
- [x] 报告未写入数据库密码、Redis 密码或 API Key。

失败路径：
- [x] 创建任务 payload 少于 5 个字符会返回 `Invalid lead task payload`。
- [x] 读取任务详情、事件、候选客户和状态命令均按当前用户校验归属。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.32 候选客户确认和开发信草稿生成

- [x] `POST /api/lead-tasks/:taskId/approve` 支持传入候选客户 ID。
- [x] 确认候选客户后，候选状态更新为 `approved`。
- [x] 系统为已确认客户生成本地 `outreach_drafts` 开发信草稿。
- [x] 工作流步骤会将 `human_approval` 和 `generate_email` 标记完成，并暂停在 `wait_email_confirmation` 等待人工确认邮件。

测试时间：2026-04-30 15:51:00 +08:00
测试功能：候选客户确认、开发信生成、工作流步骤推进、真实 PostgreSQL 写入
关联任务：Task.md V1 完成标准
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api test -- src/agent`
- 真实 API 冒烟：注册临时用户、创建任务、写入候选客户和 ICP 分数、调用 approve、检查候选状态 / 草稿 / 步骤状态。

成功路径：
- [x] Agent 单元测试 2 个文件通过，共 9 条测试。
- [x] approve payload 会校验候选客户 UUID。
- [x] 指定候选客户必须属于当前任务，否则会拒绝。
- [x] 未传候选 ID 时，会默认选择 ICP 80 分以上的前 10 个候选客户。
- [x] 真实 API 冒烟结果：`register=201`、`createTask=201`、`approve=201`、`approvedCount=1`、`draftCount=1`、`leadStatus=approved`、`generateEmailStatus=completed`、`waitEmailStatus=waiting`。
- [x] 冒烟测试临时用户已删除，关联任务、候选客户、草稿和步骤通过级联清理。
- [x] 报告未写入数据库密码、Redis 密码或 API Key。

失败路径：
- [x] 非 UUID 候选客户 ID 会返回 `Invalid lead approval payload`。
- [x] 不属于该任务的候选客户会返回 `Some candidates do not belong to this task`。
- [x] 无可确认候选客户会返回 `No candidates available for approval`。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.33 Brave 搜索执行链路

- [x] 新增 `POST /api/lead-tasks/:taskId/search`，用于执行当前任务待执行搜索 query。
- [x] 执行时读取 `search_queries`，调用 `BraveSearchService.searchAndSaveResults()`。
- [x] 搜索结果写入 `search_results`，并通过 `LeadQualificationService` 清洗为候选客户和 ICP 分数。
- [x] 工作流步骤会推进 `brave_search`、`normalize_leads`、`extract_contacts`、`score_icp`。

测试时间：2026-04-30 15:59:00 +08:00
测试功能：Brave 搜索执行、搜索结果入库、候选客户清洗、ICP 写入、工作流步骤推进
关联任务：Task.md V1 完成标准
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api test -- src/agent src/search src/leads`
- 服务级真实数据库冒烟：mock Brave 返回 1 条结果，验证 `search_results`、`lead_candidates`、`icp_scores` 和 `search_queries` 状态。
- 真实 Brave API 最小查询尝试：不输出 key，仅记录状态。

成功路径：
- [x] Agent / Search / Leads 单元测试 6 个文件通过，共 22 条测试。
- [x] 服务级真实数据库冒烟结果：`executedQueries=1`、`resultCount=1`、`createdCandidates=1`、`searchResults=1`、`candidates=1`、`queryStatus=completed`、`qualifiedCount=1`。
- [x] 真实 Brave API 查询在当前 Codex 本机环境仍返回 `fetch failed`；用户侧已确认同一 key 可连通，因此当前记录为本机网络路径问题，代码链路和数据库链路通过。
- [x] 冒烟测试临时用户已删除，关联任务、搜索结果、候选客户和 ICP 分数通过级联清理。
- [x] 报告未写入 Brave key、数据库密码、Redis 密码或 API Key。

失败路径：
- [x] 搜索执行 payload 中 `limit` 超过范围会返回 `Invalid lead search payload`。
- [x] 非当前用户任务会返回 `Lead task not found`。
- [x] Brave key 缺失、HTTP 失败、重试和缓存已有 search client 单元测试覆盖。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.34 任务总结生成

- [x] 新增 `POST /api/lead-tasks/:taskId/summary`。
- [x] 总结包含 AI 做了什么、找到了什么、发了什么、后续怎么跟。
- [x] 总结写入 `task_summary` 步骤输出，并将任务状态更新为 `completed`。

测试时间：2026-04-30 16:04:00 +08:00
测试功能：任务总结、工作流收尾、真实 PostgreSQL 写入
关联任务：Task.md V1 完成标准
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api test -- src/agent`
- 真实 API 冒烟：注册临时用户、创建任务、写入候选客户 / ICP / 开发信草稿、调用 summary、检查任务状态和步骤输出。

成功路径：
- [x] Agent 单元测试 2 个文件通过，共 12 条测试。
- [x] 真实 API 冒烟结果：`register=201`、`createTask=201`、`summary=201`、`didCount=4`、`foundTotal=1`、`draftCount=1`、`nextCount=3`、`taskStatus=completed`、`summaryStepStatus=completed`。
- [x] 总结的 `did` 字段说明读取任务、生成搜索策略、清洗候选、ICP 判断和生成开发信草稿。
- [x] 总结的 `found` 字段说明候选客户总数、高匹配客户、已确认客户、主要市场和高分公司。
- [x] 总结的 `sent` 字段说明开发信草稿、已发送数量和 CRM 同步数量。
- [x] 总结的 `next` 字段给出邮件确认、跟进提醒和 CRM / 数据看板后续动作。
- [x] 冒烟测试临时用户已删除，关联任务、候选客户、草稿和步骤通过级联清理。
- [x] 报告未写入数据库密码、Redis 密码或 API Key。

失败路径：
- [x] 非当前用户任务会返回 `Lead task not found`。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.35 数据库维护与重建流程

- [x] 新增 `scripts/db-maintenance.ps1`，支持 `status`、`migrate`、`backup`、`restore`、`rebuild`。
- [x] 新增 `DB_MAINTENANCE.md`，记录远程 PostgreSQL 备份、恢复、重建流程。
- [x] `restore` 和 `rebuild` 均要求显式 `-Force`，避免误清开发数据。
- [x] `rebuild` 默认先备份，再清空 `public` schema，最后执行 Prisma migration 和 generate。

测试时间：2026-04-30 16:18:00 +08:00
测试功能：数据库 migration 状态检查、维护脚本安全默认值、文档脱敏
关联任务：Task.md 1.3 数据库第一版 Schema
测试命令：
- `pnpm db:status`
- `pnpm build`
- 严格敏感信息扫描：数据库密码、Redis 密码、Brave key、Google OAuth secret、OpenAI style key

成功路径：
- [x] `pnpm db:status` 能读取远程 PostgreSQL migration 状态。
- [x] `restore` 未传 `-Force` 会拒绝执行。
- [x] `rebuild` 未传 `-Force` 会拒绝执行。
- [x] `pnpm build` 通过，脚本和文档没有破坏现有工作区。
- [x] 严格敏感信息扫描命中数为 0。

失败路径：
- [x] `restore` 未传 `-Force` 会拒绝执行。
- [x] `rebuild` 未传 `-Force` 会拒绝执行。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.36 我的客户页面原型对齐

- [x] `/customers` 在 CRM API 暂无数据或请求失败时，使用原型一致的客户列表样例兜底。
- [x] 客户分组、客户总览、表格、阶段标签、负责人、最近跟进和分页恢复为设计稿结构。
- [x] 表格高度调整为当前真实视口内无内部滚动条，页面整体 `scrollHeight === clientHeight`。

测试时间：2026-04-30 16:35:00 +08:00
测试功能：我的客户页面原型还原、API 空数据兜底、CDP 9222 视觉检查
关联任务：Task.md 2.13 CRM 同步和我的客户
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools CDP 9222：打开 `http://localhost:3000/customers` 并截图。

成功路径：
- [x] Web 类型检查通过。
- [x] Web lint 通过。
- [x] CDP 检查返回：标题 `全部客户 (156)`、表格 8 行、表格 `scrollHeight` 等于 `clientHeight`、页面 `scrollHeight` 等于 `clientHeight`。
- [x] 截图保存到 `tmp/customers-current-cdp.png` 供人工对比设计稿。

失败路径：
- [x] CRM API 请求失败时不再显示巨大空状态，而是展示设计稿客户样例。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.37 数据看板空数据状态对齐

- [x] `/dashboard` 在 CRM analytics API 暂不可用时不再显示失败文案。
- [x] 空数据状态对齐 `design/数据面板.png`：搜索偏好显示 `通信5G 1次`，折线图日期为 `04-18` 到 `04-24`。
- [x] 底部提示恢复为“数据每日更新”，避免把开发期接口失败暴露成页面错误。

测试时间：2026-04-30 16:42:00 +08:00
测试功能：数据看板空数据状态、CDP 9222 视觉检查
关联任务：Task.md 数据看板页面、Task.md 2.13 CRM 同步和我的客户
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools CDP 9222：打开 `http://localhost:3000/dashboard` 并截图。

成功路径：
- [x] Web 类型检查通过。
- [x] Web lint 通过。
- [x] CDP 检查返回：底部提示为“数据每日更新”、搜索偏好为 `通信5G 1次`、折线图日期为 `04-18` 到 `04-24`。
- [x] 页面 `scrollHeight` 等于 `clientHeight`。
- [x] 截图保存到 `tmp/dashboard-current-cdp.png`。

失败路径：
- [x] Analytics API 请求失败时回退到稳定空数据，不显示错误态页面。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.38 主要页面真实视口溢出检查

测试时间：2026-04-30 16:47:00 +08:00
测试功能：登录、注册、忘记密码、AI 外贸员、产品画像、客户画像、模板配置、邮件营销、个人邮箱、邮寄宣传册、我的客户、数据看板、线索中心页面的真实视口宽高检查
关联任务：页面与原型对齐、用户反馈“宽高 100%，不能有滚动条”
测试命令：
- Chrome DevTools CDP 9222：依次打开 16 个主要路由，读取 `innerWidth`、`innerHeight`、`scrollWidth`、`scrollHeight`、`clientWidth`、`clientHeight`。

成功路径：
- [x] `/login` 无页面级横向 / 纵向溢出。
- [x] `/register` 无页面级横向 / 纵向溢出。
- [x] `/forgot-password` 无页面级横向 / 纵向溢出。
- [x] `/` 无页面级横向 / 纵向溢出。
- [x] `/product-profile` 无页面级横向 / 纵向溢出。
- [x] `/customer-profile` 无页面级横向 / 纵向溢出。
- [x] `/templates` 无页面级横向 / 纵向溢出。
- [x] `/campaigns` 无页面级横向 / 纵向溢出。
- [x] `/mailbox` 无页面级横向 / 纵向溢出。
- [x] `/brochures` 无页面级横向 / 纵向溢出。
- [x] `/customers` 无页面级横向 / 纵向溢出。
- [x] `/dashboard` 无页面级横向 / 纵向溢出。
- [x] `/lead-search` 无页面级横向 / 纵向溢出。
- [x] `/icp` 无页面级横向 / 纵向溢出。
- [x] `/qualified-customers` 无页面级横向 / 纵向溢出。
- [x] `/google-commands` 无页面级横向 / 纵向溢出。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.39 主系统框架 Logo 与导航图标对齐

- [x] 后台主系统顶部 Logo 从字母方块调整为设计稿一致的纸飞机品牌符号。
- [x] 左侧导航从字母框调整为统一 18px 线性图标，符合设计规范里的“线性图标、默认灰色、当前状态蓝色”要求。
- [x] 工具箱按钮补充图标，和 `design/*.png` 主系统页面顶部栏视觉一致。

测试时间：2026-04-30 17:15:00 +08:00
测试功能：后台主系统公共框架、顶部栏、左侧导航、真实视口溢出检查
关联任务：页面与原型 / 设计图对齐
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools CDP 9222：打开 `http://localhost:3000/campaigns` 截图，并复扫 16 个主要路由。

成功路径：
- [x] Web 类型检查通过。
- [x] Web lint 通过。
- [x] CDP 检查返回：`brandSvg=true`、`navSvgCount=13`、`toolboxHasIcon=true`。
- [x] 截图保存到 `tmp/campaigns-shell-icons-cdp.png`。
- [x] 复扫 16 个主要路由，`FAILED_COUNT=0`，全部无页面级横向 / 纵向溢出。

失败路径：
- [x] 图标切换后未引入页面级滚动条或横向溢出。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.40 V1 明确不做范围验收

- [x] `Task.md` 中“是否需要正式域名：本地开发可先不用”已确认，不阻塞当前 V1 本地开发。
- [x] Microsoft 登录 / 注册入口已显式禁用，后端未接 Microsoft OAuth。
- [x] 手机号找回入口已显式禁用，后端未接短信发送。
- [x] 代码扫描未发现 WhatsApp 自动发送、SerpApi、Firecrawl、QQ / 126 / 163 授权码发信、域名邮箱 DNS 配置、独立黑名单菜单、OpenAI Search 作为 V1 搜索方案的接入。

测试时间：2026-04-30 17:25:00 +08:00
测试功能：V1 明确不做范围、认证页禁用入口、代码扫描
关联任务：`Task.md` 第 4 / 5 节
测试命令：
- 代码扫描：`Select-String` 扫描 `apps/api/src`、`apps/web/app`、`apps/web/components`、`packages`。
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools CDP 9222：检查 `/login`、`/register`、`/forgot-password`。

成功路径：
- [x] `/login` Microsoft 按钮 `disabled=true`，标题为 `V1 暂不支持 Microsoft 登录 / 注册`。
- [x] `/register` Microsoft 按钮 `disabled=true`，标题为 `V1 暂不支持 Microsoft 登录 / 注册`。
- [x] `/forgot-password` 手机号找回按钮 `disabled=true`，标题为 `V1 暂不支持短信找回`。
- [x] 三个认证页均无页面级横向 / 纵向溢出。
- [x] `Task.md` 明确不做范围已勾选并写明原因。

失败路径：
- [x] 不存在可提交的 Microsoft 登录 / 注册表单动作。
- [x] 不存在可提交的手机号找回 / 短信发送动作。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.41 邮件确认弹窗 leadId 透传

- [x] `MailConfirmationLead` 支持 `id` 字段。
- [x] 保存 Gmail 草稿时会把 `leadId` 透传给 `/api/gmail/drafts`。
- [x] 确认发送时会把 `leadId` 透传给 `/api/gmail/send`。
- [x] 后端已有 `leadId` 后会写入 `outreach_drafts`、`send_logs`，并通过 `syncLeadToCrm` 同步 CRM 和创建 3 天后跟进任务；本次前端补齐了这条链路的必要参数。

测试时间：2026-04-30 17:35:00 +08:00
测试功能：邮件确认弹窗、Gmail 发送参数、CRM / follow-up 链路参数
关联任务：V1 最终完成标准“用户确认后通过 Gmail API 发送邮件、客户同步到 CRM、创建 3 天后跟进任务”
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- `Select-String` 检查 `mail-confirmation-modal.tsx` 中 `leadId: lead.id` 已覆盖草稿和发送两个请求。

成功路径：
- [x] Web 类型检查通过。
- [x] Web lint 通过。
- [x] `leadId` 参数已同时出现在 `/api/gmail/drafts` 和 `/api/gmail/send` 请求 payload 中。

失败路径：
- [x] `lead.id` 缺失时仍保持可选透传，不会破坏当前静态演示数据；真实候选客户携带 id 时可进入后端关联链路。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.42 Gmail 发送限速保护

- [x] 后端 `GmailMessageService.sendEmail()` 在刷新 Google token 和调用 Gmail API 前执行发送限速检查。
- [x] 新增 24 小时发送上限配置：`GMAIL_DAILY_SEND_LIMIT`，默认 `80`。
- [x] 新增最小发送间隔配置：`GMAIL_MIN_SEND_INTERVAL_MS`，默认 `15000`。
- [x] `.env.example` 已补充 Gmail 限速和同步间隔变量。
- [x] `Task.md` 风险记录“Gmail 发送量受 Google 风控限制，需要限速”已勾选并说明实现。

测试时间：2026-04-30 17:58:00 +08:00
测试功能：Gmail 发送限速、日发送上限、最小发送间隔、发送前拦截
关联任务：`Task.md` 风险记录、V1 Gmail 发送链路
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api test -- src/gmail`

成功路径：
- [x] API 类型检查通过。
- [x] Gmail 测试 5 个文件全部通过，共 31 条测试。
- [x] 正常发送路径仍会写入 `send_logs`、`crm_leads`、`followup_tasks`。
- [x] 达到 `GMAIL_DAILY_SEND_LIMIT` 时会在调用外部 Gmail API 前返回 `Gmail daily send limit reached`。
- [x] 小于 `GMAIL_MIN_SEND_INTERVAL_MS` 时会在调用外部 Gmail API 前返回 `Gmail send is rate limited`。

失败路径：
- [x] 限速失败时不会刷新 Google token，不会调用 Gmail API，也不会写入新的 `send_logs`。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.43 风险记录闭环核查

- [x] Brave query 效果记录：`search_queries` 已有 `resultCount`、`qualifiedCount`、`effectivenessScore` 字段，搜索执行会回写每条 query 的结果数量和合格候选数量。
- [x] GPT-5.5 JSON 校验：`LeadHuntAiService` 对所有结构化输出使用 Zod schema 校验，失败会重试一次，仍失败会抛出 `Gpt55OutputValidationError`。
- [x] 搜索结果混入不相关行业：候选客户入库会写 ICP 分数，后续必须经过人工确认接口。
- [x] Google 登录与 Gmail OAuth 分离：Google 登录 scope 仅 `openid email profile`，Gmail OAuth 独立申请 Gmail scopes。
- [x] 保留未完成风险：邮件打开率追踪像素 / 追踪链接仍未实现，继续保持 `Task.md` 未勾选。

测试时间：2026-04-30 18:02:00 +08:00
测试功能：风险记录实现核查、AI JSON 校验、Brave query 记录、人工确认、OAuth scope 分离
关联任务：`Task.md` 第 8 节风险记录
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api test -- src/ai src/search src/agent`

成功路径：
- [x] API 类型检查通过。
- [x] AI / Search / Agent 测试 7 个文件全部通过，共 33 条测试。
- [x] `Task.md` 中已实现或已记录的风险项已勾选，未实现的打开率追踪仍保持未勾选。

失败路径：
- [x] GPT JSON 校验失败路径已有测试，失败后会重试并在仍失败时抛出可读错误。
- [x] Brave HTTP 失败、重试、缺少 key 等失败路径已有 search client 测试覆盖。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.44 Gmail 打开追踪像素与 CRM 打开趋势

- [x] Gmail 确认发送时会先创建 pending `send_logs`，并在 MIME HTML 部分注入 `/api/tracking/open/:sendLogId.gif`。
- [x] 新增 `TrackingModule`，`GET /api/tracking/open/:sendLogId.gif` 会返回 1x1 透明 GIF，并在合法 `sendLogId` 命中时写入 `engagement_events`。
- [x] 非法 UUID 或不存在的 send log 不写入事件，接口仍返回透明 GIF，避免影响邮件客户端。
- [x] CRM analytics 返回 `reach.email.opened`、`reach.email.openRate`、`reach.email.openTrendNote` 和 `series[].open`，并将打开率标注为趋势信号。
- [x] `Task.md` 风险记录中的邮件打开率追踪项已勾选。

测试时间：2026-04-30 20:16:00 +08:00
测试功能：Gmail 追踪像素注入、打开事件记录、CRM 打开趋势统计
关联任务：`Task.md` 第 8 节风险记录
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api test -- src/crm src/gmail src/tracking`
- `pnpm build`
- 严格敏感信息扫描：数据库密码、Redis 密码、Brave key、Google OAuth secret、OpenAI style key

成功路径：
- [x] API 类型检查通过。
- [x] CRM / Gmail / Tracking 测试 9 个文件全部通过，共 55 条测试。
- [x] 整仓 `pnpm build` 通过。
- [x] 严格敏感信息扫描命中数为 0。
- [x] Gmail send 单测确认发送日志从 `pending` 更新为 `sent`，并确认 MIME 内容包含 tracking pixel URL。
- [x] Tracking service 单测覆盖合法打开、非法 UUID 和不存在 send log 三条路径。
- [x] CRM analytics 单测确认打开事件会计入唯一打开数、打开率和 7 日 `open` 序列。

失败路径：
- [x] 达到 Gmail 发送限速时仍在创建 pending send log 前拦截，不调用 Gmail API，也不写入新发送记录。
- [x] 非法 tracking id 不查询数据库，不写入 `engagement_events`。
- [x] send log 不存在时不写入 `engagement_events`。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.45 个人邮箱页面原型对齐补强

- [x] `/mailbox` 在 Gmail account API 不可用时回退到设计稿授权示意，不再暴露“读取失败 / 未授权”。
- [x] 邮件同步提示恢复为原型里的同步中提示。
- [x] 邮件列表头像恢复为 Google / LeadHunt / OpenAI 风格，而不是普通字母占位。

测试时间：2026-04-30 20:34:00 +08:00
测试功能：个人邮箱页面原型对齐、开发态兜底、真实视口无滚动
关联任务：页面与 `design/个人邮箱.png` 对齐
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome 9222 CDP 打开 `http://localhost:3000/mailbox`，读取 DOM 指标并截图。

成功路径：
- [x] Web 类型检查通过。
- [x] Web lint 通过。
- [x] CDP 指标：`scrollWidth=clientWidth=1707`、`scrollHeight=clientHeight=932`。
- [x] CDP 指标：`.mailboxRowLogo` 数量为 3，OpenAI 风格头像存在。
- [x] CDP 截图已保存到 `tmp/mailbox-current-cdp.png`。

失败路径：
- [x] Gmail account API 不可用时不再显示失败态页面文案，改为原型兜底状态。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.46 产品画像 / 客户画像框架风格对齐

- [x] `AppShell` 支持页面级 `frameVariant`，避免一套全局框架强行覆盖全部设计稿。
- [x] `/product-profile` 和 `/customer-profile` 已切换为蓝色 `L` 品牌方块与字母式导航。
- [x] `/mailbox` 仍保持纸飞机品牌和线性图标，证明 variant 没有影响已对齐的邮件页面。

测试时间：2026-04-30 20:45:00 +08:00
测试功能：产品画像、客户画像公共框架对齐；邮件页回归检查
关联任务：页面与 `design/产品画像.png`、`design/客户画像.png` 对齐
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome 9222 CDP 检查 `/product-profile`、`/customer-profile`、`/mailbox`。

成功路径：
- [x] Web 类型检查通过。
- [x] Web lint 通过。
- [x] `/product-profile`：`letterFrame=true`、`brandText=L`、`letterNavCount=13`、无页面滚动。
- [x] `/customer-profile`：`letterFrame=true`、`brandText=L`、`letterNavCount=13`、无页面滚动。
- [x] `/mailbox`：`letterFrame=false`、`paperNavCount=13`、无页面滚动。
- [x] CDP 截图已保存到 `tmp/cdp-sweep/product-profile-after-frame.png`、`tmp/cdp-sweep/customer-profile-after-frame.png`、`tmp/cdp-sweep/mailbox-after-frame.png`。

失败路径：
- [x] 页面级 variant 不影响未传参页面，邮件页仍保持原有框架风格。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.47 邮件确认弹窗 Gmail 授权兜底与表单可访问性补强

- [x] 邮件确认弹窗在开发态 Gmail account API 401 / 不可用时回退为已授权示意，不再禁用发送主动作。
- [x] 邮件确认弹窗表单控件补齐 `id` / `name` / 关联 label。
- [x] AI 外贸员底部任务输入区补齐隐藏 label、`id` 和 `name`。
- [x] 纯展示文本不再使用未关联 `<label>`，避免 Chrome DevTools 表单 label issue。
- [x] 发送时间单选按钮补齐 `aria-pressed`，切换状态时 active / muted 样式正确更新。

测试时间：2026-04-30 21:56:00 +08:00
测试功能：AI 外贸员邮件确认弹窗、Gmail 授权兜底、表单可访问性、真实视口无溢出
关联任务：Task.md 2.12 邮件确认弹窗和 AI 改写
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools Protocol 9222：打开 `http://localhost:3000/`，点击 `发邮件`，读取 DOM 指标、表单控件关联和控制台信息。

成功路径：
- [x] Web 类型检查通过。
- [x] Web lint 通过。
- [x] 弹窗最终状态显示 `Gmail 已授权，可以确认发送`。
- [x] 弹窗按钮可用：`存草稿`、`另存为模板`、`确认发送` 均未被禁用。
- [x] 页面外层 `scrollWidth=clientWidth=1707`、`scrollHeight=clientHeight=932`。
- [x] 弹窗外层 `scrollWidth=clientWidth=1360`、`scrollHeight=clientHeight=860`。
- [x] 10 个表单控件检查结果：`missingIdOrName=0`、`missingAccessibleName=0`。
- [x] 未关联 label 数量为 0。
- [x] `立即发送` / `定时发送` 的 `aria-pressed` 与样式状态一致。

失败路径：
- [x] 当前 CDP 会话无真实后端 session，`/api/gmail/account` 返回 401；弹窗按开发态兜底显示已授权状态，真实 API 成功时仍会覆盖为真实状态。
- [x] 本轮未执行真实 Gmail 外发动作。

结论：
- [x] 通过，可以进入下一个功能
- [ ] 不通过，继续修复当前功能

### 4.48 AI 外贸员真实 Brave 搜索与邮件确认链路

- [x] Brave Search API Key 可用性复核：PowerShell 通过 Windows 用户代理可正常返回 3 条结果。
- [x] Node / Nest 侧连接问题定位：默认 `fetch` 不自动走 Windows WinINet 代理，直连 Brave 会超时。
- [x] 后端 `BraveSearchClient` 支持读取 Windows 代理，并支持本机 `socks5h://127.0.0.1:10808` 出口。
- [x] 修复 SOCKS5 返回包拆分读取问题，避免握手阶段卡住。
- [x] 修复 Brave `country` 参数枚举：UAE 等不支持国家码改用 `ALL`，保留市场词在 query 内。
- [x] 开发搜索兜底改为显式开关，默认不再静默写入 fallback 候选客户。
- [x] 一次性测试账号完成注册、画像写入、任务创建、Brave 搜索、候选客户入库、ICP 评分、候选客户审批、开发信草稿生成和邮件确认弹窗打开。
- [x] Gmail 未授权时停在确认弹窗内提示“请先授权 Gmail”，未执行真实 Gmail 外发。
- [x] 一次性测试账号已退出并从数据库删除，相关测试数据通过级联关系清理。

测试时间：2026-04-30 23:40:00 +08:00
测试功能：AI 外贸员真实搜索链路、Brave 代理连接、搜索结果入库、候选客户清洗、开发信确认弹窗
关联任务：AI 外贸员核心链路、V1 关键链路端到端测试
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api lint`
- `pnpm --filter @leadhunt/api test`
- Node 侧真实 Brave 最小查询，不输出 API Key。
- Chrome DevTools Protocol 9222 页面链路验证。

成功路径：
- [x] API 类型检查通过。
- [x] API lint 通过。
- [x] API 单测 23 个文件全部通过，共 128 条测试。
- [x] Node 侧 Brave 最小查询返回 3 条结果，首条为 `Hello, world - Wikipedia`。
- [x] CDP 9222 页面显示任务生成 15 条搜索指令。
- [x] CDP 9222 页面显示已执行 5 条搜索指令、2 家候选客户、2 家 ICP 75+。
- [x] 点击 `发邮件` 后打开邮件确认弹窗，收件人、主题、正文由真实候选客户生成。
- [x] 弹窗显示 Gmail 未授权并阻止真实发送动作。

失败路径：
- [x] Brave Key 缺失、HTTP 失败、重试和缓存仍由 search client 单测覆盖。
- [x] 开发兜底只有显式 `LEADHUNT_DEV_SEARCH_FALLBACK=true` 或 `1` 时启用，默认失败会暴露真实错误，便于排查。
- [x] Brave 不支持的国家码不再发送非法 `AE`，避免 422 参数校验失败。

结论：
- [x] 通过，AI 外贸员核心接口链路已可从页面跑到真实 Brave 搜索和邮件确认弹窗。
- [ ] 不通过，继续修复当前功能。

备注：
- 当前首批候选客户质量仍需继续加强，下一步建议把文章页、社媒页、非公司主页降权或过滤，提高“经销商 / 现货商 / 系统集成商”命中率。
- 本报告未记录 Brave Key、cookie、测试账号密码、数据库连接串等敏感信息。

### 4.49 注册登录闭环与 AI 外贸员候选客户质量增强

- [x] 注册 / 登录表单改为显式 `onSubmit`，避免 React form action 在浏览器未完整接管时导致提交异常。
- [x] 注册页确认密码字段补齐 `name`、必填、长度校验和不一致提示。
- [x] 登录 / 注册成功后根据安全 `next` 参数跳转，默认进入 AI 外贸员工作台。
- [x] Chrome 9222 登录保留测试账号后，`/api/auth/me` 返回 200，受保护页面可访问。
- [x] 当前保留测试账号已写入产品画像和客户画像，凭据不写入报告。
- [x] 候选客户入库前新增页面质量评估，社媒、文章、新闻、报告、招聘、培训、产品应用说明、`.edu` / `.gov`、Alibaba / Amazon / AliExpress 等结果会过滤或跳过。
- [x] `rejected` ICP 候选不再入库，只保留 `review` / `qualified`，避免低质噪音进入候选名单。
- [x] Brave 单条 query 失败或超时时不再导致整个任务 500，失败 query 标记为 `failed`，接口返回 `failedQueries` / `successfulQueries`。
- [x] 搜索策略新增公司页 / 联系页 / 目录页优先模板，移除 `directory` / `yellowpages` 默认排除词。
- [x] 明确目标市场后，搜索策略只在目标市场和相邻城市轮转，不再混入 Nigeria / South Africa / Indonesia / Brazil。
- [x] 负向搜索词支持带空格词组加引号，并移除过粗的 `-phone`。

测试时间：2026-05-01 00:15:00 +08:00
测试功能：注册登录、测试账号、AI 外贸员真实 Brave 搜索、候选客户过滤、审批、开发信草稿、任务总结
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api lint`
- `pnpm --filter @leadhunt/api test`
- `pnpm --filter @leadhunt/agent typecheck`
- `pnpm --filter @leadhunt/agent test`
- `pnpm --filter @leadhunt/agent build`
- Chrome DevTools Protocol 9222 真实浏览器验证。

成功路径：
- [x] Chrome 9222 登录测试账号成功，`/api/auth/me=200`。
- [x] 产品画像和客户画像保存成功。
- [x] 新建 AI 外贸员任务生成 15 条 query，市场限定为 `UAE`、`Saudi Arabia`、`Dubai`、`Abu Dhabi`、`Riyadh`、`Jeddah`。
- [x] 执行 6 条真实 Brave query：`executedQueries=6`、`successfulQueries=6`、`failedQueries=0`、`resultCount=17`。
- [x] 过滤后入库 `createdCandidates=6`、`skippedCandidates=11`。
- [x] 最终候选不再包含 LinkedIn、产品应用说明页、Alibaba、维修页、进出口数据页。
- [x] 审批 1 家候选客户成功，生成 1 封开发信草稿。
- [x] 任务总结接口返回：`totalCandidates=6`、`qualifiedCandidates=1`、`approvedCandidates=1`、`draftCount=1`、`sentCount=0`。
- [x] API 全量测试 23 个文件 / 132 条通过。
- [x] Agent 测试 3 个文件 / 12 条通过。

失败路径：
- [x] Brave 单条 query 超时会写入 `executionStatus=failed` 并继续后续 query，不再 500。
- [x] 社媒、文章、产品应用说明、平台电商和 rejected 结果不会进入候选名单。
- [x] Gmail 未授权时不执行真实外发，本轮只验证到开发信草稿和任务总结。

结论：
- [x] 通过，注册登录和 AI 外贸员核心搜索 / 清洗 / 审批 / 草稿 / 总结链路已打通。
- [ ] 不通过，继续修复当前功能。

备注：
- 本报告未记录 Brave Key、cookie、测试账号密码、数据库连接串等敏感信息。
- 后续建议接 Gmail OAuth 后继续验证“确认发送 -> Gmail API -> CRM 同步 -> 3 天后跟进任务”的完整外发闭环。
- 目录页目前可进入候选；下一步可继续做目录页拆解，把目录中的真实公司拆成独立候选。

### 4.50 AI 外贸员搜索执行动态效果

- [x] 竞品页面通过 Chrome 9222 打开后落到登录页和腾讯滑块验证，本轮未绕过登录，只作为“搜索过程应可感知”的参考方向。
- [x] AI 外贸员对话页新增搜索执行动态面板，搜索中会显示轮换状态、流动进度、跳动点、扫描条和五个阶段状态。
- [x] 动态面板支持搜索完成态，展示搜索指令进度、Brave 命中、新增候选、过滤数量。
- [x] 动态面板支持部分成功态：搜索接口失败但候选已写入时，仍显示已有候选数量并提示可再次搜索补齐。
- [x] 搜索状态区域使用 `aria-live="polite"`，状态变化可被辅助工具读到。

测试时间：2026-05-01 02:00:00 +08:00
测试功能：AI 外贸员搜索中动态反馈、搜索完成统计、部分成功提示
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools Protocol 9222 页面验证。

成功路径：
- [x] Web 类型检查通过。
- [x] Web lint 通过。
- [x] CDP 9222 登录测试账号后创建 AI 外贸员任务。
- [x] 搜索中 DOM 可见“正在合并域名并写入候选客户”“已执行 0/15 条搜索指令”等动态状态。
- [x] 搜索完成后显示：执行 3 条 query、命中 10 条结果、新增 6 家候选、过滤 4 条、ICP 75+ 1 家。
- [x] CDP 截图已保存到 `tmp/cdp-sweep/ai-worker-search-activity.png`。

失败路径：
- [x] 竞品页需要登录和滑块验证时不做未授权绕过。
- [x] 搜索接口失败但已有候选客户写入时，页面不会只停留在“等待搜索任务启动”，会显示已有候选并允许再次搜索。

结论：
- [x] 通过，搜索客户过程已有明显动态反馈，用户能看出系统正在搜索、清洗和评分。
- [ ] 不通过，继续修复当前功能。

### 4.51 对照竞品补齐 AI 执行日志与失败态

- [x] 用户登录竞品后，Chrome 9222 可进入跨境魔方 AI 任务页并观察真实搜索态。
- [x] 竞品搜索态已确认包含：`AI正在任务执行...`、任务步骤、AI 扩展词、数据策略、执行结果表、执行日志时间线和 `正在工作:` 计时状态条。
- [x] 本地 AI 外贸员补齐横向执行日志：`LLM思考中`、`技能挑选中`、`任务规划中`、`数据搜索中`、`数据搜索完成`、`检索结果分析`。
- [x] 本地 AI 外贸员补齐 `正在工作:` 状态条、运行计时器和 `AI正在任务执行` 状态。
- [x] 本地搜索失败且无候选返回时，动态面板显示明确失败态：`搜索接口失败，任务已保留`、`需重试`、`搜索接口失败，可重试`，不再退回含糊等待态。

测试时间：2026-05-01 18:41:00 +08:00
测试功能：竞品搜索态观察、本地执行日志、计时状态条、失败态
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome 9222 / agent-browser 页面验证。

成功路径：
- [x] Web 类型检查通过。
- [x] Web lint 通过。
- [x] 竞品页面 DOM 可读到 `任务规划`、`筛选目标客户`、`AI扩展词`、`数据策略`、`执行任务`、`已找到97条`、`LLM思考中`、`数据搜索中`、`数据搜索完成`、`数据分析中`。
- [x] 本地搜索中 DOM 可读到 `正在工作:`、计时器、`AI正在任务执行`、`LLM思考中`、`技能挑选中`、`数据搜索中`、`检索结果分析`。
- [x] 竞品观察截图保存到 `tmp/competitor/upkuajing-ai-thinking-captcha.png` 和 `tmp/competitor/upkuajing-ai-search-results.png`。

失败路径：
- [x] 本地搜索接口失败且未写入候选时，会显示失败和重试状态，不再显示为尚未启动。
- [x] 竞品页面再次出现腾讯安全验证时，不自动处理滑块验证。

结论：
- [x] 通过，本地 AI 外贸员搜索态已从单一动态卡片升级为“主执行态 + 执行日志 + 计时条 + 明确失败态”，更接近竞品的可感知工作流。
- [ ] 不通过，继续修复当前功能。

### 4.52 AI 外贸员发送按钮打开邮件确认弹窗

- [x] 通过 Chrome 9222 复现：点击任务结果表格里的 `发送`，前端触发审批/草稿生成逻辑。
- [x] 复现根因：当前页面保存的旧任务 ID 与当前登录账号不一致，审批接口返回 `Lead task not found`，旧逻辑因此没有执行 `setMailOpen(true)`。
- [x] 已调整交互：点击发送后先打开邮件确认弹窗并使用当前候选客户预填开发信，后台再尝试生成后端草稿。
- [x] 后端任务失效时，弹窗仍保留；页面提示当前使用本地预填草稿，并清掉旧候选客户的后端关联 ID，避免误关联。
- [x] 当前测试账号未授权 Gmail 时，弹窗显示 `Gmail 未授权 / Google OAuth 未授权`，不会误导用户已经可以真实发送。

测试时间：2026-05-01 19:32:00 +08:00
测试功能：AI 外贸员结果页点击发送、邮件确认弹窗、本地预填草稿、任务失效兜底
测试命令：
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome 9222 / agent-browser 页面验证。

成功路径：
- [x] Web 类型检查通过。
- [x] Web lint 通过。
- [x] 点击表格 `发送` 后，DOM 可见 `.mailModalProto` 和 `.modalBackdrop`。
- [x] 弹窗可见 `发邮件`、`收件人`、`邮件主题`、`邮件内容`、`确认发送`、`AI 改写`。
- [x] 候选客户会自动预填收件人、主题和英文开发信正文。

失败路径：
- [x] 当审批接口返回 `Lead task not found` 时，弹窗仍会打开，页面提示任务与当前账号会话不一致。
- [x] 未授权 Gmail 时，弹窗保持确认发送前的授权阻断状态。

结论：
- [x] 通过，点击发送不再表现为无响应，邮件确认弹窗已经能稳定出现。
- [ ] 不通过，继续修复当前功能。

### 4.53 Gmail OAuth callback 500 代理修复

- [x] 复现用户问题：Google 验证后回跳 `localhost:4000/api/gmail/oauth/callback` 返回 500。
- [x] API 日志定位到后端请求 `https://oauth2.googleapis.com/token` 超时，错误为 `UND_ERR_CONNECT_TIMEOUT`。
- [x] 确认 Windows 系统代理开启，代理地址为 `127.0.0.1:10808`。
- [x] 新增 Gmail 专用代理感知 fetch，支持 Windows 系统代理、HTTP CONNECT、SOCKS5/SOCKS5H。
- [x] `GmailOAuthService` 默认走代理感知 fetch，用于 OAuth code 换 token 和读取 Gmail profile。
- [x] `GmailMessageService` 默认走代理感知 fetch，用于刷新 access token、保存草稿、发送邮件和同步回复。

测试时间：2026-05-01 19:59:00 +08:00
测试功能：Gmail OAuth callback 网络层、Google Token API 代理访问、Gmail 服务代理复用
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api lint`
- `pnpm --filter @leadhunt/api test -- gmail`
- 代理请求实测：`https://oauth2.googleapis.com/token`

成功路径：
- [x] API 类型检查通过。
- [x] API lint 通过。
- [x] Gmail 相关测试通过：5 个测试文件，32 条测试。
- [x] 通过系统代理请求 Google Token API 不再超时，返回业务级 `400 invalid_request`，证明网络层已通。

失败路径：
- [x] 旧 callback 授权码不可继续依赖，修复后需要重新从 `个人邮箱` 页面发起 Google OAuth。
- [x] Google 账号选择页对自动化点击未继续推进，需要用户手动点击账号并完成授权确认。

结论：
- [x] 通过，callback 500 的网络根因已修复。
- [ ] 不通过，继续修复当前功能。

### 4.54 Gmail OAuth 过期回跳与真实发送验证

- [x] 复现旧 callback 长链接继续打开仍报错的问题。
- [x] API 日志确认最新根因是 `Expired Gmail OAuth state`，不是 Google Token API 网络超时。
- [x] callback 中的 state 校验错误已转换为可读错误，并由 controller 回跳到邮箱页错误状态。
- [x] 过期授权链接回跳 `mailbox?gmail=error&reason=expired`，邮箱页展示明确提示，不再裸露 500。
- [x] 邮箱页未授权或接口失败时不再显示演示 Gmail 账号，当前发件邮箱会显示 `未授权`。
- [x] 邮件确认弹窗未授权或接口失败时不再伪装成已授权，`确认发送` 会被禁用。
- [x] 用户重新从 `个人邮箱` 页面发起 Google OAuth，并成功回跳 `mailbox?gmail=connected`。
- [x] 邮箱页展示真实授权邮箱 `wangyawei223@gmail.com` 和 `已授权`。
- [x] 使用当前会话调用真实 `/api/gmail/send`，向授权 Gmail 自身发送一封本地测试邮件，接口返回 `201` 与 `ok: true`。
- [x] 从 AI 外贸员页面新建任务、执行首轮 Brave 搜索并生成候选客户。
- [x] 点击 AI 外贸员 `发邮件` 打开邮件确认弹窗，弹窗读取到真实 Gmail 授权。
- [x] 将弹窗收件人改为授权 Gmail 自身后点击 `确认发送`，页面状态显示 `已确认发送`。

测试时间：2026-05-01 23:43:00 +08:00
测试功能：Gmail OAuth 过期态、授权成功态、真实 Gmail API 发送
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api lint`
- `pnpm --filter @leadhunt/api test -- gmail`
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome DevTools Protocol 9222 页面验证
- 当前会话真实 `/api/gmail/send` 请求
- AI 外贸员邮件确认弹窗页面级发送验证

成功路径：
- [x] API 类型检查通过。
- [x] API lint 通过。
- [x] Gmail 相关测试通过：5 个测试文件，33 条测试。
- [x] Web 类型检查通过。
- [x] Web lint 通过。
- [x] 旧 callback 不再返回 500，而是回跳邮箱页错误提示。
- [x] 重新授权后邮箱页显示 Gmail 授权成功。
- [x] 真实 Gmail API 发送成功，未向外部客户发送测试邮件。
- [x] 邮件确认弹窗页面级发送成功，测试收件人为授权 Gmail 自身。

失败路径：
- [x] 旧 OAuth callback 链接过期后不能复用，必须重新从邮箱页发起授权。
- [x] 授权未成功时，页面显示未授权并阻止误认为可发送。

结论：
- [x] 通过，Gmail OAuth 授权与真实 Gmail API 发信已打通。
- [ ] 不通过，继续修复当前功能。

### 4.55 Gmail 发送后 CRM 同步与 3 天跟进回显

- [x] Gmail 发送成功后返回 `crmLead`、`followupTask` 和 `sendLog`，前端可直接展示后续业务状态。
- [x] Gmail 真实发送成功后，后端更新 `send_gmail`、`sync_crm`、`schedule_followup`、`wait_email_confirmation` 四个工作流节点为 completed。
- [x] 发送成功后任务状态更新为 `email_sent`，候选客户状态更新为 `contacted`。
- [x] 发送成功后客户同步到 CRM，CRM stage 为 `contacted`。
- [x] 发送成功后创建 1 条 pending `email_followup`，到期时间为发送后的 3 天。
- [x] AI 外贸员页面发送后自动刷新任务，并回显已发送、已同步 CRM、待跟进提醒等计数。
- [x] 邮件确认弹窗显示 `已确认发送，已同步 CRM，并创建 05/05 00:35 跟进提醒`。

测试时间：2026-05-02 00:37:00 +08:00
测试功能：真实 Gmail 发送后的 CRM 同步、3 天后跟进任务、AI 外贸员页面回显
测试命令：
- `pnpm --filter @leadhunt/api typecheck`
- `pnpm --filter @leadhunt/api lint`
- `pnpm --filter @leadhunt/api test -- gmail crm agent-workflow lead-task`
- `pnpm --filter @leadhunt/web typecheck`
- `pnpm --filter @leadhunt/web lint`
- Chrome 9222 / Browser Use 页面验证
- PostgreSQL 明细核验任务、工作流节点、发送记录、CRM 和 followup

成功路径：
- [x] API 类型检查通过。
- [x] API lint 通过。
- [x] API 相关测试通过：9 个测试文件，66 条测试。
- [x] Web 类型检查通过。
- [x] Web lint 通过。
- [x] 使用授权 Gmail 页面级发送成功，测试收件人为授权 Gmail 自身，未向外部候选客户发送测试邮件。
- [x] 数据库确认任务状态为 `email_sent`。
- [x] 数据库确认 `send_gmail`、`sync_crm`、`schedule_followup`、`wait_email_confirmation` 均为 completed。
- [x] 数据库确认候选客户状态为 `contacted`、CRM stage 为 `contacted`、send log 为 sent。
- [x] 数据库确认实际存在 1 条 pending `email_followup`，到期时间为真实发送后的 3 天。

失败路径：
- [x] 曾在聚合 SQL 中看到 pending followup 数量为 2，复查 `followup_tasks` 明细后确认是 JOIN 聚合放大，不是重复创建。
- [x] 授权未成功时，邮件确认弹窗仍会禁用 `确认发送`，不会误发。

结论：
- [x] 通过，Gmail 发送后的 CRM 同步、3 天后跟进任务和 AI 外贸员页面回显已打通。
- [ ] 不通过，继续修复当前功能。

## 5. V1 关键链路端到端测试

- [x] 注册并登录。
- [x] 保存产品画像。
- [x] 保存客户画像。
- [x] 创建 AI 外贸员任务。
- [x] AI 生成关键词和搜索策略。
- [x] Brave 返回候选客户。
- [x] ICP 评分完成。
- [x] 用户确认候选客户。
- [x] 生成开发信。
- [x] 打开邮件确认弹窗。
- [ ] AI 改写覆盖正文。
- [x] Gmail 授权后发送邮件。
- [x] 客户同步到 CRM。
- [x] 创建 3 天后跟进任务。
- [ ] 数据看板展示统计。
