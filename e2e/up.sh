#!/usr/bin/env bash
# 开发环境一键拉起：Postgres、API、Vite（已在跑的跳过）
cd "$(dirname "$0")/.."
pg_isready >/dev/null 2>&1 || service postgresql start >/dev/null 2>&1
for i in $(seq 1 20); do pg_isready >/dev/null 2>&1 && break; sleep 0.5; done
curl -sf localhost:3000/api/v1/health >/dev/null || (pnpm --filter @wh/server start > /tmp/wh-server.log 2>&1 &)
curl -sf localhost:5173/ >/dev/null || (pnpm --filter @wh/app dev > /tmp/wh-vite.log 2>&1 &)
for i in $(seq 1 60); do curl -sf localhost:3000/api/v1/health >/dev/null && curl -sf localhost:5173/ >/dev/null && break; sleep 0.5; done
echo "pg $(pg_isready >/dev/null && echo ok || echo down) · server $(curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/v1/health) · vite $(curl -s -o /dev/null -w '%{http_code}' localhost:5173/)"
