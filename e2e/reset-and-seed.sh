#!/usr/bin/env bash
# 重置开发库 → 重启服务器 → 建示范数据
set -e
cd "$(dirname "$0")/.."
(fuser -k 3000/tcp || true) 2>/dev/null; sleep 1
node packages/db/scripts/migrate.mjs --reset > /dev/null
node packages/db/scripts/bootstrap-admin.mjs admin@demo.local 123456 "系统管理员" > /dev/null
(pnpm --filter @wh/server start > /tmp/wh-server.log 2>&1 &)
for i in $(seq 1 30); do curl -sf localhost:3000/api/v1/health > /dev/null && break; sleep 0.5; done
node e2e/seed-demo.mjs && node e2e/seed-more.mjs
