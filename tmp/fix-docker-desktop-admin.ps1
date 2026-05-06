$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Please run this script in an elevated Administrator PowerShell window."
  }
}

function Stop-DockerProcesses {
  $names = @(
    "Docker Desktop",
    "Docker Desktop Installer",
    "com.docker.backend",
    "com.docker.service",
    "com.docker.proxy",
    "vpnkit",
    "dockerd",
    "docker"
  )

  foreach ($name in $names) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
}

function Stop-DockerServices {
  $services = @("com.docker.service", "Docker Desktop Service")

  foreach ($name in $services) {
    $service = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($service) {
      Stop-Service -Name $name -Force -ErrorAction SilentlyContinue
    }
  }
}

function Uninstall-DockerDesktop {
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($winget) {
    winget uninstall --id Docker.DockerDesktop --exact --silent --accept-source-agreements | Out-Host
  }
}

function Backup-Path {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupPath = "$Path.bak-$timestamp"

  Write-Host "Taking ownership of $Path"
  & takeown.exe /F $Path /R /A /D Y | Out-Host
  & icacls.exe $Path /grant "*S-1-5-32-544:F" /T /C | Out-Host

  Write-Host "Moving $Path to $backupPath"
  Move-Item -LiteralPath $Path -Destination $backupPath -Force
}

function Remove-PathIfExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  Write-Host "Removing $Path"
  Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
}

function Install-DockerDesktop {
  $installer = Join-Path $env:LOCALAPPDATA "Temp\WinGet\Docker.DockerDesktop.4.71.0\Docker%20Desktop%20Installer.exe"

  if (Test-Path -LiteralPath $installer) {
    Write-Host "Installing Docker Desktop from cached installer..."
    & $installer install --quiet
    return
  }

  Write-Host "Cached installer not found. Installing Docker Desktop through winget..."
  winget install --id Docker.DockerDesktop --exact --accept-source-agreements --accept-package-agreements
}

Assert-Admin

Write-Host "Stopping Docker processes and services..."
Stop-DockerProcesses
Stop-DockerServices

Write-Host "Uninstalling existing Docker Desktop entry if present..."
Uninstall-DockerDesktop

Write-Host "Cleaning old Docker Desktop machine-level state..."
Backup-Path "C:\ProgramData\DockerDesktop"
Remove-PathIfExists "C:\ProgramData\Docker"

Write-Host "Cleaning old user-level Docker Desktop state..."
Remove-PathIfExists (Join-Path $env:APPDATA "Docker")
Remove-PathIfExists (Join-Path $env:LOCALAPPDATA "Docker")

Write-Host "Installing Docker Desktop..."
Install-DockerDesktop

Write-Host ""
Write-Host "Docker Desktop install command finished."
Write-Host "If Windows asks for reboot, reboot before testing docker."
Write-Host "After install, open Docker Desktop once and wait until it says it is running."
