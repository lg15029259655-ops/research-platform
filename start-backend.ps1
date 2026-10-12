$ErrorActionPreference = 'Stop'
$backend = Join-Path $PSScriptRoot 'backend'
$python = Join-Path $backend '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw '请先运行 .\setup.ps1' }
Push-Location $backend
try { & $python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload } finally { Pop-Location }
