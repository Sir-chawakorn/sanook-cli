# Sanook CLI installer — Windows PowerShell
# Usage (GitHub raw — works today):
#   irm https://raw.githubusercontent.com/Sir-chawakorn/sanook-cli/main/scripts/install.ps1 | iex
# Optional short URL when hosted:
#   irm https://sanook.ai/install.ps1 | iex
# Honored env vars: $env:SANOOK_PKG, $env:SANOOK_VERSION
$ErrorActionPreference = 'Stop'

$pkg = if ($env:SANOOK_PKG) { $env:SANOOK_PKG } else { 'sanook-cli' }
$version = if ($env:SANOOK_VERSION) { $env:SANOOK_VERSION } else { 'latest' }
$minNodeMajor = 22

Write-Host "Installing Sanook CLI..." -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js not found. Install Node.js >= $minNodeMajor first: https://nodejs.org" -ForegroundColor Red
  Write-Host "Or:  winget install OpenJS.NodeJS.LTS" -ForegroundColor Red
  exit 1
}

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt $minNodeMajor) {
  Write-Host "Node.js $minNodeMajor+ required (found $(node -v)). Upgrade Node and retry." -ForegroundColor Red
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "npm not found (it ships with Node.js). Reinstall Node.js." -ForegroundColor Red
  exit 1
}

Write-Host "Using $(node -v) / npm $(npm -v)" -ForegroundColor Cyan
Write-Host "npm install -g ${pkg}@${version}" -ForegroundColor Cyan
npm install -g "${pkg}@${version}"
# $ErrorActionPreference='Stop' does NOT halt on a native command's non-zero exit in
# Windows PowerShell 5.1 — check $LASTEXITCODE explicitly so a failed install doesn't
# print the success banner.
if ($LASTEXITCODE -ne 0) {
  Write-Host "Global install failed (exit $LASTEXITCODE). Run PowerShell as Administrator, or fix your npm prefix permissions, then retry." -ForegroundColor Red
  exit 1
}

Write-Host "Sanook CLI installed." -ForegroundColor Green
Write-Host "Run:  sanook            (start the agent)"
Write-Host "      sanook setup      (first-time setup wizard)"
Write-Host "      sanook dashboard  (open the web dashboard)"
