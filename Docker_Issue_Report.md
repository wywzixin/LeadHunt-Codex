# Docker 问题交接记录

记录时间：2026-04-29 19:50 +08:00  
项目目录：`E:\money\LeadHunt-Codex`

## 1. 当前结论

Docker Desktop 已经安装，Docker CLI 和 Docker Compose 命令可用，但 Docker Desktop 的 Linux engine 没有启动成功。

当前最关键的线索是：

- Docker Desktop 状态为 `stopped`。
- `docker info` 连接 `dockerDesktopLinuxEngine` 失败。
- Docker Desktop 日志显示 `hasNoVirtualization=true`。
- Windows 查询 CPU 虚拟化状态显示 `VirtualizationFirmwareEnabled: False`。

因此当前更像是本机 BIOS / UEFI 固件虚拟化未开启，导致 WSL2 / Docker Desktop 后端无法启动；不是项目代码、`docker-compose.yml` 或 `.env` 的问题。

## 2. 已确认可用的部分

在普通 PowerShell 中执行：

```powershell
docker --version
docker compose version
```

输出：

```text
Docker version 29.4.1, build 055a478
Docker Compose version v5.1.3
```

项目根目录存在 `docker-compose.yml`，包含：

- PostgreSQL 16 Alpine，端口 `5432`
- Redis 7 Alpine，端口 `6379`
- 数据卷 `leadhunt_postgres_data`
- 数据卷 `leadhunt_redis_data`

## 3. 当前失败现象

### 3.1 Docker Desktop 状态

命令：

```powershell
docker desktop status
```

输出：

```text
Name                Value
Status              stopped
SessionID           53b6ab30-2855-4296-8c02-186b6ca5d137
```

### 3.2 Docker engine 无法连接

命令：

```powershell
docker info
```

输出：

```text
ERROR: request returned 500 Internal Server Error for API route and version http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.54/info, check if the server supports the requested API version
errors pretty printing info
```

之前也出现过：

```text
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
```

### 3.3 Docker Windows 服务状态

命令：

```powershell
Get-Service -Name com.docker.service
```

输出：

```text
Name                Status   StartType
----                ------   ---------
com.docker.service  Stopped  Manual
```

### 3.4 Docker Desktop 日志关键行

日志路径：

```text
C:\Users\wangyawei\AppData\Local\Docker\log\host\docker-desktop.exe.log
```

关键日志：

```json
{"docker":"stopped","dockerAPI":"stopped","hasNoVirtualization":true,"idle":"running","mode":"linux","sessionID":"...","state":"stopped"}
```

### 3.5 CPU / 固件虚拟化状态

命令：

```powershell
Get-CimInstance -ClassName Win32_Processor |
  Format-List Name,VirtualizationFirmwareEnabled,VMMonitorModeExtensions,SecondLevelAddressTranslationExtensions
```

输出：

```text
Name                                    : Intel(R) Core(TM) i7-14700HX
VirtualizationFirmwareEnabled           : False
VMMonitorModeExtensions                 : False
SecondLevelAddressTranslationExtensions : False
```

这通常表示 BIOS / UEFI 里的 Intel 虚拟化功能没有启用。

## 4. 之前已经处理过的问题

最开始 Docker Desktop 安装器报过：

```text
For security reasons C:\ProgramData\DockerDesktop must be owned by an elevated account
```

后来在管理员 PowerShell 中运行过清理 / 修复脚本，已完成：

- 停止旧 Docker 进程和服务
- 备份旧 `C:\ProgramData\DockerDesktop`
- 清理旧用户级 Docker 状态
- 重新安装 Docker Desktop

安装日志显示过 `Installation succeeded`。因此当前不优先判断为安装器没有安装成功。

## 5. 建议修复顺序

### 5.1 先进入 BIOS / UEFI 开启虚拟化

请重启电脑进入 BIOS / UEFI，打开类似下面名字的选项：

- Intel Virtualization Technology
- Intel VT-x
- VT-d
- Virtualization
- SVM Mode（AMD 机器才常见，本机是 Intel，通常不是这个）

保存后重启 Windows。

重启后先在任务管理器确认：

```text
任务管理器 -> 性能 -> CPU -> 虚拟化：已启用
```

再执行：

```powershell
Get-CimInstance -ClassName Win32_Processor |
  Format-List Name,VirtualizationFirmwareEnabled,VMMonitorModeExtensions,SecondLevelAddressTranslationExtensions
```

期望至少看到：

```text
VirtualizationFirmwareEnabled : True
```

### 5.2 用管理员 PowerShell 检查 / 启用 Windows 功能

右键 PowerShell，选择“以管理员身份运行”，执行：

```powershell
Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All
Get-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform
```

如果 WSL 或虚拟机平台未启用，执行：

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart
Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart
```

如果 Docker Desktop 仍提示需要 Hyper-V，可再启用：

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -NoRestart
Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -NoRestart
```

确保 hypervisor 自动启动：

```powershell
bcdedit /set hypervisorlaunchtype auto
```

然后重启 Windows。

### 5.3 修复 / 更新 WSL

管理员或普通 PowerShell 均可尝试：

```powershell
wsl --update
wsl --set-default-version 2
wsl --status
```

如果本机没有 WSL 基础组件，可执行：

```powershell
wsl --install --no-distribution
```

执行后按提示重启。

### 5.4 启动 Docker Desktop

重启后启动 Docker Desktop，等待界面显示 running。也可以执行：

```powershell
docker desktop start
docker desktop status
docker info
```

期望：

- `docker desktop status` 显示 running
- `docker info` 能正常打印 Server 信息
- 不再出现 `dockerDesktopLinuxEngine` 500 或 pipe 不存在

## 6. 项目验证步骤

Docker engine 正常后，在项目根目录执行：

```powershell
cd E:\money\LeadHunt-Codex
docker compose up -d
docker compose ps
```

期望看到：

- `leadhunt-postgres` running / healthy
- `leadhunt-redis` running / healthy

端口检查：

```powershell
Test-NetConnection localhost -Port 5432
Test-NetConnection localhost -Port 6379
```

容器内部检查：

```powershell
docker exec leadhunt-postgres pg_isready -U leadhunt -d leadhunt
docker exec leadhunt-redis redis-cli ping
```

期望：

```text
accepting connections
PONG
```

然后执行数据库迁移：

```powershell
pnpm --filter @leadhunt/api prisma migrate dev
```

最后跑项目校验：

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## 7. 注意事项

- 不要在公开聊天或日志里输出 `.env` 的真实密钥。
- 当前问题不需要先重装 Node.js、pnpm、Next.js 或 NestJS。
- 不建议先删除 Docker 数据卷；如果要删 `leadhunt_postgres_data` 或 `leadhunt_redis_data`，需要确认可以丢弃本地数据库数据。
- 如果开启 BIOS 虚拟化和 Windows 功能后仍失败，再考虑 Docker Desktop 的 Reset / Reinstall。

