# ── Build stage ──────────────────────────────
FROM node:20-slim AS build

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# Install deps first (cache layer)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY tsconfig.base.json ./
COPY packages/config/ packages/config/
COPY packages/contracts/ packages/contracts/
COPY apps/api/ apps/api/

RUN pnpm --filter @support-agent/api exec prisma generate
RUN pnpm turbo build --filter=@support-agent/api...

# ── Production stage ─────────────────────────
FROM node:20-slim

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy full node_modules from build (includes Prisma client)
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/apps/api/node_modules/ apps/api/node_modules/
COPY --from=build /app/packages/config/node_modules/ packages/config/node_modules/
COPY --from=build /app/packages/contracts/node_modules/ packages/contracts/node_modules/

# Copy package manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/

# Copy built output and Prisma schema (for migrations)
COPY --from=build /app/packages/config/dist/ packages/config/dist/
COPY --from=build /app/packages/contracts/dist/ packages/contracts/dist/
COPY --from=build /app/apps/api/dist/ apps/api/dist/
COPY --from=build /app/apps/api/prisma/ apps/api/prisma/

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "apps/api/dist/index.js"]
