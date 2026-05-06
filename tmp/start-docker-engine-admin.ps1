$ErrorActionPreference = "Continue"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Please run this script in an elevated Administrator PowerShell window."
}

$docker = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$desktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"

Write-Host "Starting Docker Desktop service..."
Start-Service -Name "com.docker.service" -ErrorAction Continue
Get-Service -Name "com.docker.service" | Format-Table Name, Status, StartType -AutoSize

Write-Host "Restarting Docker Desktop app..."
Get-Process | Where-Object { $_.ProcessName -like "*Docker*" -or $_.ProcessName -like "*com.docker*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Start-Process -FilePath $desktop

Write-Host "Waiting for Docker engine..."
$deadline = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $deadline) {
  & $docker info | Out-Host
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Docker engine is ready."
    exit 0
  }
  Start-Sleep -Seconds 8
}

Write-Host "Docker engine did not become ready within 5 minutes."
exit 1
