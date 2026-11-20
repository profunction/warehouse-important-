# Windows 版：重置开发库 → 启动服务器 → 建示范数据。在项目根目录用 PowerShell 运行：  .\e2e\reset-and-seed.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not $env:DATABASE_ADMIN_URL) { $env:DATABASE_ADMIN_URL = "postgres://postgres:postgres@localhost:5432/postgres" }
# 关掉占用 3000 的旧服务器
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
node packages/db/scripts/migrate.mjs --reset
node packages/db/scripts/bootstrap-admin.mjs admin@demo.local 123456 "系统管理员"
Start-Process -FilePath "pnpm" -ArgumentList "--filter @wh/server start" -WindowStyle Minimized
for ($i = 0; $i -lt 40; $i++) { try { Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/v1/health | Out-Null; break } catch { Start-Sleep -Milliseconds 500 } }
node e2e/seed-demo.mjs
Write-Host "`n示范数据已建好。现在另开一个窗口运行:  pnpm dev:app   然后浏览器开 http://localhost:5173" -ForegroundColor Green
