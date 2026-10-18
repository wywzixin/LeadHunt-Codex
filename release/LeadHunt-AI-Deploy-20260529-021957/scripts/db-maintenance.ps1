[CmdletBinding()]
param(
  [ValidateSet("status", "migrate", "backup", "restore", "rebuild")]
  [string]$Mode = "status",

  [string]$RemoteHost = $env:LEADHUNT_DB_REMOTE,

  [string]$BackupPath = "",

  [switch]$Force,

  [switch]$SkipBackup
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

if ([string]::IsNullOrWhiteSpace($RemoteHost)) {
  $RemoteHost = "root@43.167.204.62"
}

function Invoke-Pnpm {
  param([string[]]$Arguments)

  & pnpm @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm command failed: pnpm $($Arguments -join ' ')"
  }
}

function Invoke-RemoteSql {
  param([string]$Sql)

  $Sql | & ssh $RemoteHost "docker exec -i leadhunt-postgres psql -U leadhunt -d leadhunt -v ON_ERROR_STOP=1"
  if ($LASTEXITCODE -ne 0) {
    throw "Remote SQL command failed."
  }
}

function Get-DefaultBackupPath {
  $backupDir = Join-Path $RepoRoot "runtime\backups"
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  return Join-Path $backupDir "leadhunt-$timestamp.sql"
}

function Invoke-Backup {
  param([string]$TargetPath)

  if ([string]::IsNullOrWhiteSpace($TargetPath)) {
    $TargetPath = Get-DefaultBackupPath
  }

  $targetDir = Split-Path -Parent $TargetPath
  if (-not [string]::IsNullOrWhiteSpace($targetDir)) {
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  }

  $remoteCommand = "docker exec leadhunt-postgres pg_dump -U leadhunt -d leadhunt --clean --if-exists --no-owner --no-privileges"
  $dump = & ssh $RemoteHost $remoteCommand
  if ($LASTEXITCODE -ne 0) {
    throw "Remote database backup failed."
  }

  $dump | Set-Content -Path $TargetPath -Encoding UTF8
  Write-Output "BACKUP_CREATED=$TargetPath"
}

switch ($Mode) {
  "status" {
    Invoke-Pnpm -Arguments @("--filter", "@leadhunt/api", "prisma", "migrate", "status")
    break
  }

  "migrate" {
    Invoke-Pnpm -Arguments @("--filter", "@leadhunt/api", "prisma", "migrate", "deploy")
    Invoke-Pnpm -Arguments @("--filter", "@leadhunt/api", "prisma", "generate")
    break
  }

  "backup" {
    Invoke-Backup -TargetPath $BackupPath
    break
  }

  "restore" {
    if (-not $Force) {
      throw "Restore is destructive. Re-run with -Force after choosing a known-good backup file."
    }

    if ([string]::IsNullOrWhiteSpace($BackupPath) -or -not (Test-Path $BackupPath -PathType Leaf)) {
      throw "BackupPath must point to an existing .sql backup file."
    }

    Get-Content -Path $BackupPath -Raw -Encoding UTF8 |
      & ssh $RemoteHost "docker exec -i leadhunt-postgres psql -U leadhunt -d leadhunt -v ON_ERROR_STOP=1"

    if ($LASTEXITCODE -ne 0) {
      throw "Remote database restore failed."
    }

    Invoke-Pnpm -Arguments @("--filter", "@leadhunt/api", "prisma", "migrate", "status")
    break
  }

  "rebuild" {
    if (-not $Force) {
      throw "Rebuild drops the public schema. Re-run with -Force only when the current development data can be discarded."
    }

    if (-not $SkipBackup) {
      Invoke-Backup -TargetPath $BackupPath
    }

    Invoke-RemoteSql -Sql "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO leadhunt; GRANT ALL ON SCHEMA public TO public;"
    Invoke-Pnpm -Arguments @("--filter", "@leadhunt/api", "prisma", "migrate", "deploy")
    Invoke-Pnpm -Arguments @("--filter", "@leadhunt/api", "prisma", "generate")
    Invoke-Pnpm -Arguments @("--filter", "@leadhunt/api", "prisma", "migrate", "status")
    break
  }
}
