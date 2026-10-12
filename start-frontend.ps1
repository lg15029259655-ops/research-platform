$ErrorActionPreference = 'Stop'
$frontend = Join-Path $PSScriptRoot 'frontend'
$pnpm = (Get-Command pnpm -ErrorAction SilentlyContinue).Source
if (-not $pnpm) { $pnpm = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' }
if (-not (Test-Path -LiteralPath $pnpm)) { throw '未找到 pnpm，请先运行 .\setup.ps1' }
Push-Location $frontend
try { & $pnpm dev } finally { Pop-Location }
