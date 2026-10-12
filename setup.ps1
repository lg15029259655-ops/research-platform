$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$python = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path -LiteralPath $python)) { $python = (Get-Command python -ErrorAction SilentlyContinue).Source }
if (-not (Test-Path -LiteralPath $python)) { throw '未找到 Python。请安装 Python 3.12 或检查运行环境。' }
$pnpm = (Get-Command pnpm -ErrorAction SilentlyContinue).Source
if (-not $pnpm) { $pnpm = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' }
if (-not (Test-Path -LiteralPath $pnpm)) { throw '未找到 pnpm。请安装 Node.js 与 pnpm。' }
& $python -m venv (Join-Path $root 'backend\.venv')
& (Join-Path $root 'backend\.venv\Scripts\python.exe') -m pip install -r (Join-Path $root 'backend\requirements.txt')
Push-Location (Join-Path $root 'frontend')
try { & $pnpm install } finally { Pop-Location }
if (-not (Test-Path -LiteralPath (Join-Path $root 'backend\.env'))) {
    Copy-Item -LiteralPath (Join-Path $root '.env.example') -Destination (Join-Path $root 'backend\.env')
}
Write-Host '依赖安装完成。请分别运行 start-backend.ps1 与 start-frontend.ps1。'
