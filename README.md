# 仓店通 WarehouseShop

零售店和超市的一体化系统：仓库、店面、库存账本、Excel 导入导出、角色权限、离线手机端。设计文档在 `docs/design/`，第一阶段详细规格在 `docs/design/phase1/`。

## 目录

| 目录 | 内容 |
|---|---|
| `packages/db` | PostgreSQL 迁移（29 张表、触发器、RLS、账号）、种子（权限、角色、A 模式模板、SOP）、数据库验收测试 |
| `packages/server` | Fastify API（认证、主数据、库存账本、同步、Excel、管理、超管），vitest 集成测试 |
| `packages/app` | React PWA：手机端（四个屏幕模板、三语、离线）和网页管理端、超管端 |
| `packages/shared` | 权限代码、三语错误信息、类型 |
| `e2e` | Playwright 端到端冒烟：手机端 20 项、网页端 18 项 |
| `docs/design` | 八部分设计和第一阶段规格、验收清单、验收记录 |

## 本地运行

需要 Node 22、pnpm 10、PostgreSQL 16（本机 5432，超级用户 postgres/postgres）。

```bash
pnpm install
```

```bash
node packages/db/scripts/migrate.mjs --reset
```

```bash
node packages/db/scripts/bootstrap-admin.mjs admin@demo.local 123456 "系统管理员"
```

```bash
pnpm dev:server
```

```bash
pnpm dev:app
```

浏览器开 http://localhost:5173 。超管用电邮登录后在"开店向导"建第一家店。标签 PDF 的中文字体按需下载：

```bash
bash packages/server/scripts/fetch-fonts.sh
```

## Windows 上运行

1. 安装 Git、Node 22 LTS、PostgreSQL 16（安装时把 postgres 用户密码设为 `postgres`，端口 5432）。
2. 打开 PowerShell：

```powershell
corepack enable; corepack prepare pnpm@10.28.0 --activate
```

```powershell
git clone -b claude/pensive-fermat-k3wys1 https://github.com/profunction/warehouse-important-.git
```

```powershell
cd warehouse-important-; pnpm install; pnpm approve-builds
```

`pnpm approve-builds` 时勾选 argon2 和 esbuild。然后一条命令建库、起服务器、建示范数据：

```powershell
.\e2e\reset-and-seed.ps1
```

再开一个 PowerShell 窗口：

```powershell
cd warehouse-important-; pnpm dev:app
```

浏览器开 http://localhost:5173 。PostgreSQL 密码不是 `postgres` 时先设 `$env:DATABASE_ADMIN_URL = "postgres://postgres:你的密码@localhost:5432/postgres"`。

## 示范数据

一条命令重置开发库、重启服务器、建示范小店（老板 0120000001 / 111111，库存员 0120000009 / 222222，收银员 0120000008 / 333333，公司代码 DEMO1）：

```bash
bash e2e/reset-and-seed.sh
```

## 测试

```bash
pnpm --filter @wh/db test
```

```bash
pnpm --filter @wh/server test
```

```bash
node e2e/mobile-smoke.mjs && node e2e/web-smoke.mjs
```

端到端测试需要开发服务器和 Vite 都在跑，且用示范数据。

## 环境变量（服务器）

| 变量 | 默认 | 说明 |
|---|---|---|
| PORT | 3000 | |
| DATABASE_HOST / DATABASE_PORT / DATABASE_NAME | localhost / 5432 / warehouse | |
| DB_RW_USER / DB_RW_PASS | app_rw / app_rw | 业务账号，受 RLS |
| DB_ADMIN_USER / DB_ADMIN_PASS | app_admin / app_admin | 超管跨公司账号 |
| JWT_SECRET | dev-secret-change-me | 生产必须改 |
| FILE_TOKEN_SECRET | dev-file-secret | 导出文件签名 |
| UPLOAD_DIR | packages/server/uploads | 导入导出文件 |
| LABEL_FONT | 自动查找 | 标签 PDF 中文字体路径 |

## Docker

```bash
docker compose up --build
```

`docker-compose.yml` 起 PostgreSQL、服务器（自动迁移）、前端静态站。首次启动后进容器建超管：

```bash
docker compose exec server node ../db/scripts/bootstrap-admin.mjs admin@example.com 123456
```

## 账号与数据库安全

- 业务代码只用 `app_rw`：对 `movement` 只能插入，对 `stock` 只读，无任何 DELETE 权限。
- 每张表开行级安全，会话变量 `app.company_id` 决定可见范围，超管也要先进入某家公司。
- 库存只能通过 `movement` 改变，触发器维护 `stock`，并做公司、启用原因、权限、后仓类别、负库存检查。
