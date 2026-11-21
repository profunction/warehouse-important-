# 一键：在这台 Windows 电脑跑起系统，并用 Cloudflare 免费隧道给手机一个 https 网址。
# 用法：在项目文件夹打开 PowerShell，运行  .\phone.ps1
# 之后每次要给手机用，都只需再跑这一条。关掉这个窗口隧道就停，系统本身还在跑。
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not $env:DATABASE_ADMIN_URL) { $env:DATABASE_ADMIN_URL = "postgres://postgres:postgres@localhost:5432/postgres" }

function Say($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Up($url) { try { Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 3 | Out-Null; $true } catch { $false } }

Say "1/6 检查 Node、pnpm、PostgreSQL"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "没有安装 Node.js，请先装 Node 22 或 24：https://nodejs.org" }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { corepack enable; corepack prepare pnpm@10.28.0 --activate }
if (-not (Test-NetConnection localhost -Port 5432 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
  $svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($svc) { Write-Host "启动 PostgreSQL 服务 $($svc.Name)"; try { Start-Service $svc.Name } catch { Write-Host "启动失败，请用管理员 PowerShell 运行：  net start $($svc.Name)" -ForegroundColor Yellow; throw } ; Start-Sleep -Seconds 3 }
  else { Write-Host "没找到 PostgreSQL 服务。请安装 PostgreSQL 16（postgres 密码设为 postgres）后再跑。" -ForegroundColor Yellow; throw "PostgreSQL 未安装" }
}

Say "2/6 安装依赖（每次都跑，代码更新后新依赖才会装上；没变化时几秒就过）"
pnpm.cmd install

Say "3/6 数据库与 API 服务器"
if (-not (Up "http://localhost:3000/api/v1/health")) {
  $seeded = $false
  try { node packages/db/scripts/migrate.mjs | Out-Null; $seeded = $true } catch { }
  Start-Process -FilePath "pnpm.cmd" -ArgumentList "--filter @wh/server dev" -WindowStyle Minimized
  for ($i = 0; $i -lt 60; $i++) { if (Up "http://localhost:3000/api/v1/health") { break }; Start-Sleep -Milliseconds 500 }
}
# 还没有示范公司就建一个（超管 admin@demo.local / 123456，老板 0120000001 / 111111）
try {
  $r = Invoke-WebRequest -UseBasicParsing -Method POST -ContentType "application/json" -Body '{"company_code":"DEMO1","phone":"0120000001","pin":"111111"}' http://localhost:3000/api/v1/auth/login -ErrorAction Stop
} catch {
  Say "建示范数据"
  node packages/db/scripts/bootstrap-admin.mjs admin@demo.local 123456 "系统管理员"
  node e2e/seed-demo.mjs
}

Say "4/6 网页与手机端（Vite）：关掉旧的，重新启动，保证用最新配置并固定在 5173"
Get-NetTCPConnection -LocalPort 5173,5174 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
Start-Process -FilePath "pnpm.cmd" -ArgumentList "--filter @wh/app dev" -WindowStyle Minimized
for ($i = 0; $i -lt 60; $i++) { if (Up "http://localhost:5173/") { break }; Start-Sleep -Milliseconds 500 }
if (-not (Up "http://localhost:5173/")) { throw "网页没有在 5173 起来，看最小化的 Vite 窗口里的报错" }

Say "5/6 Cloudflare 隧道程序"
if (-not (Test-Path "cloudflared.exe")) {
  Write-Host "下载 cloudflared.exe（约 40MB，免费，不用注册）"
  Invoke-WebRequest -UseBasicParsing "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "cloudflared.exe"
}

Say "6/6 开隧道。下面出现 https://xxxx.trycloudflare.com 后，手机浏览器开：  那个网址/m"
Write-Host "   手机端 /m   收银 /pos   网页端 /w   示范账号：公司 DEMO1，库存员 0120000009 / 222222，老板 0120000001 / 111111" -ForegroundColor Green
Write-Host "   关掉这个窗口隧道就停（网址会变）。系统本身还在后台两个最小化窗口里跑。`n" -ForegroundColor Green
# --config 指向空文件：避免电脑上 ~/.cloudflared 里旧的命名隧道配置把临时隧道的路由全带成 404
$cfg = Join-Path $env:TEMP "wh-cloudflared-empty.yml"
Set-Content -Path $cfg -Value "" -Encoding ascii
.\cloudflared.exe tunnel --config $cfg --url http://localhost:5173
