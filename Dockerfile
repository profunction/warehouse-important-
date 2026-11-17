FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate && apt-get update && apt-get install -y --no-install-recommends python3 make g++ curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/db/package.json packages/db/
COPY packages/server/package.json packages/server/
COPY packages/app/package.json packages/app/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY packages packages

FROM base AS server
RUN bash packages/server/scripts/fetch-fonts.sh || true
WORKDIR /app/packages/server
EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]

FROM base AS webbuild
RUN pnpm --filter @wh/app build

FROM nginx:1.27-alpine AS web
COPY --from=webbuild /app/packages/app/dist /usr/share/nginx/html
RUN printf 'server { listen 80; root /usr/share/nginx/html; location /api/ { proxy_pass http://server:3000; proxy_set_header Host $host; client_max_body_size 30m; } location / { try_files $uri /index.html; } }' > /etc/nginx/conf.d/default.conf
