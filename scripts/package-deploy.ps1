[CmdletBinding()]
param(
  [string]$PackageName = "",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

if (-not $SkipBuild) {
  & pnpm -r build
  if ($LASTEXITCODE -ne 0) {
    throw "Build failed before packaging."
  }
}

if ([string]::IsNullOrWhiteSpace($PackageName)) {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $PackageName = "LeadHunt-AI-Deploy-$timestamp"
}

$releaseRoot = Join-Path $RepoRoot "release"
$stage = Join-Path $releaseRoot $PackageName
$zip = Join-Path $releaseRoot "$PackageName.zip"

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
if (Test-Path $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage | Out-Null

$excludeDirs = @(
  ".git",
  "node_modules",
  "tmp",
  "runtime",
  "release",
  ".claude",
  ".codex",
  ".firecrawl",
  ".kiro",
  ".vscode"
)

$excludeFiles = @(
  ".env",
  "client_secret.json",
  "cookies.txt",
  "*.md",
  ".tmp-*",
  "tmp-task-*",
  "task_state*.json",
  "task_final*.json",
  "task_create.json",
  "leads_dump.txt",
  "*.network-response",
  "*.network-request"
)

$robocopyArgs = @(
  $RepoRoot.Path,
  $stage,
  "/E",
  "/XD"
) + $excludeDirs + @(
  "/XF"
) + $excludeFiles + @(
  "/NFL",
  "/NDL",
  "/NJH",
  "/NJS",
  "/NP"
)

& robocopy @robocopyArgs | Out-Null
$robocopyExitCode = $LASTEXITCODE
if ($robocopyExitCode -gt 7) {
  throw "robocopy failed with exit code $robocopyExitCode"
}

$nextBuildDir = Join-Path $stage "apps\web\.next"
$nextBuildArtifactsToRemove = @("cache", "dev", "diagnostics", "turbopack")
foreach ($artifact in $nextBuildArtifactsToRemove) {
  $path = Join-Path $nextBuildDir $artifact
  if (Test-Path $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}

$markdownFiles = Get-ChildItem -LiteralPath $stage -Recurse -File -Filter "*.md" -ErrorAction SilentlyContinue
if ($markdownFiles.Count -gt 0) {
  throw "Package still contains markdown files; first match: $($markdownFiles[0].FullName)"
}

if (Test-Path $zip) {
  Remove-Item -LiteralPath $zip -Force
}
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force

$sizeMb = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Output "PACKAGE_DIR=$stage"
Write-Output "PACKAGE_ZIP=$zip"
Write-Output "PACKAGE_SIZE_MB=$sizeMb"
