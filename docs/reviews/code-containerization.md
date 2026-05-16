# Containerization Review

Scope: end-to-end review of the container build, image runtime, and deployment surface for the Support Agent monorepo. Read inputs: `Dockerfile`, `Dockerfile.admin`, `.dockerignore`, `nginx/admin.conf`, `.github/workflows/deploy.yml`, `turbo.json`, `pnpm-workspace.yaml`, root `package.json`, all `apps/*/package.json`, `apps/api/tsconfig.json`, `apps/api/src/index.ts`, `apps/api/src/app.ts`, `apps/admin/vite.config.ts`, `packages/skills-runtime/src/seed-loop.ts`, `packages/config/src/env.ts`.

## 1. Executive Summary — Top 5 Risks

1. **Admin container will not boot on Cloud Run.** `Dockerfile.admin:40` says `EXPOSE 80`, but `nginx/admin.conf:2` binds `listen 8080;`. Cloud Run injects `PORT=8080` and routes to whatever the container actually listens on — here that happens to be 8080, so the container *runs*, but `EXPOSE 80` is misleading and a healthcheck or any external orchestrator (Compose, k8s, ALB) that trusts `EXPOSE` will hit the wrong port. There is also no `$PORT` substitution in `admin.conf`, so a Cloud Run revision configured with `containerPort != 8080` will silently break.
2. **`prisma migrate deploy` runs on every API container start with no advisory lock.** `Dockerfile:74` chains `prisma migrate deploy && node …` in the CMD. With more than one Cloud Run instance (min-instances ≥ 2 or any cold-start fan-out) you get N concurrent migrate runs racing against the `_prisma_migrations` table. Prisma serializes via PG advisory locks internally for *applying* a migration, but failures (timeout, network hiccup) mid-startup take a replica out and there is no separate "wait for schema" mode. There is no Cloud Run Jobs / pre-deploy migrate step in `.github/workflows/deploy.yml`.
3. **Workers and the gateway have no Dockerfile.** Only `Dockerfile` (API) and `Dockerfile.admin` exist. `apps/worker/src/index.ts` and `apps/gateway/src/index.ts` are real runtime surfaces (`docs/techstack.md:39-45`, `docs/worker-deployment.md`). They cannot be built or deployed today — the deploy workflow only deploys API and admin (`.github/workflows/deploy.yml`).
4. **No SIGTERM / graceful shutdown anywhere.** `apps/api/src/index.ts`, `apps/worker/src/index.ts`, `apps/gateway/src/index.ts` install no `process.on('SIGTERM'|'SIGINT')` handlers and never call `app.close()`. Cloud Run sends SIGTERM with a 10s grace; in-flight Fastify requests and BullMQ jobs will be cut. `apps/api/src/plugins/prisma.ts:17` registers `onClose` for Prisma, but `onClose` only fires if `app.close()` is called.
5. **Production image ships full devDependencies and source.** `Dockerfile:39-46` copies build-stage `node_modules/` wholesale into runtime — TypeScript, vitest, tsx, prisma CLI deps, eslint, etc. No `pnpm install --prod` or `pnpm deploy`. Combined with the `node:22-slim` base, the image is unnecessarily large and ships test/dev tooling into prod.

## 2. Blockers (will break prod boot or build)

### B1. `Dockerfile.admin` exposes the wrong port
File: `Dockerfile.admin:40`, `nginx/admin.conf:2`.
- `EXPOSE 80` does not match `listen 8080;`. The image runs on 8080 by coincidence (nginx config). Any tooling that infers the port from the image (`docker run -P`, Compose, AWS ALB) will misroute. Cloud Run currently works only because it ignores `EXPOSE` and probes `PORT=8080`.

Fix: change to `EXPOSE 8080` and (better) make nginx honour `$PORT` via an envsubst step or `listen ${PORT};`.

### B2. Workers and gateway are undeployable
Files: `apps/worker/src/index.ts`, `apps/gateway/src/index.ts`, `.github/workflows/deploy.yml`.
- No `Dockerfile.worker`, no `Dockerfile.gateway`, no CI step that produces those images. `docs/worker-deployment.md` calls for a `worker-core` image family that does not exist in this repo.

### B3. `prisma migrate deploy` in the CMD is not multi-replica safe
File: `Dockerfile:74`.
- Two simultaneous boots both invoke `migrate deploy`. Prisma's advisory lock makes the *second* one wait, but it adds startup latency, can exceed Cloud Run's startup probe budget (default 240s but commonly 10s for HTTP probes), and any migration failure prevents the container from ever listening — Cloud Run sees a crash loop, not "schema not ready".
- Recommended: run migrations once via a Cloud Run Job (or `gcloud run jobs execute`) before `deploy-cloudrun`, and have the runtime image's CMD be just `node apps/api/dist/src/index.js`. Or guard with `[ "${RUN_MIGRATIONS:-1}" = "1" ] && prisma migrate deploy`.

### B4. Admin image build will fail if Tailwind v4 picks up a missing config

`Dockerfile.admin:25-31` copies only `index.html`, `public/`, `src/`, `vite.config.ts`, and three `tsconfig*.json`. Tailwind v4 (`@tailwindcss/vite`, `apps/admin/package.json:32`) is config-via-CSS so this happens to work today, but any future `tailwind.config.{ts,js}` or `postcss.config.*` at `apps/admin/` will silently be ignored. Add a `COPY apps/admin/postcss.config.* apps/admin/tailwind.config.* … || true` or just `COPY apps/admin/ apps/admin/` after exclusions.

### B5. `pnpm install --frozen-lockfile` runs without copying every workspace `package.json`

`Dockerfile.admin:10-13` copies `apps/admin/package.json`, `packages/contracts/package.json`, `packages/executors-runtime/package.json` and then runs `pnpm install --frozen-lockfile`. The repo's `pnpm-workspace.yaml` declares `apps/*` and `packages/*`; pnpm v9 with a workspace lockfile expects to resolve *every* workspace package referenced in the lockfile. Missing manifests cause `ERR_PNPM_OUTDATED_LOCKFILE` or partial graph install. The API `Dockerfile:9-15` has the same shape: it omits `apps/admin/`, `apps/worker/`, `apps/gateway/`, `packages/jira-client/`, `packages/linear-client/`, `packages/respondio-client/`, `packages/skills/`, `packages/executors/`, `packages/skills-executor-runtime/`. Whether this still installs cleanly depends on pnpm tolerating missing optional workspace links — it is brittle and a single dependency change in the lockfile will start failing builds.

## 3. High-Priority Improvements

### H1. Strip devDependencies from runtime image
File: `Dockerfile:38-46`.
- The runtime stage copies the build-stage `node_modules/` directly. Use `pnpm deploy --filter @support-agent/api --prod /prod/api` (or `pnpm install --prod --frozen-lockfile`) into the runtime stage. Expect a multi-hundred-MB reduction and removal of all build-only packages (tsx, typescript, vitest, prisma CLI, eslint, …).

### H2. No HEALTHCHECK directive
Files: `Dockerfile`, `Dockerfile.admin`.
- `apps/api/src/routes/health.ts` exposes `GET /health`. Add `HEALTHCHECK CMD curl -fsS http://localhost:${PORT:-8080}/health || exit 1`. Cloud Run uses its own probes (configure `startupProbe`/`livenessProbe` in the service spec), but a `HEALTHCHECK` is required for any Compose / k8s / Compute Engine deployment of workers and is not configured.

### H3. nginx is missing gzip/brotli and HTML cache rules
File: `nginx/admin.conf`.
- No `gzip on;`, no `brotli` module hook, no `Cache-Control: no-cache` on `index.html` (only on hashed assets via the regex). Without that, SPA users will be served a stale `index.html` after deploys.
- Also missing: `add_header X-Content-Type-Options nosniff`, `Referrer-Policy`, `Strict-Transport-Security` (set at the load-balancer if used), `add_header X-Frame-Options DENY`.

Suggested rules below in §6.

### H4. SPA fallback collides with API paths
File: `nginx/admin.conf:6-8`.
- `try_files $uri $uri/ /index.html;` will happily serve `index.html` for `/v1/foo`. Today the admin is on its own host (`app.appbuildbox.com`, `.github/workflows/deploy.yml:40`) so this is fine, but if the two are ever fronted by a shared LB, requests to `/v1/*` would 200 with the SPA HTML. Add an explicit `location /v1/ { return 404; }` or document the assumption.

### H5. No signal handling → dropped in-flight work
Files: `apps/api/src/index.ts`, `apps/worker/src/index.ts`, `apps/gateway/src/index.ts`.
- Add `for (const sig of ['SIGTERM','SIGINT']) process.on(sig, async () => { await app.close(); process.exit(0); });` to each entrypoint. For the worker, drain BullMQ via `transport.stop()` first (the transport already supports `start` — add a corresponding `stop`).

### H6. `findPackagesDir` walks to the filesystem root and could match unexpected `packages/` dirs
File: `apps/api/src/index.ts:12-23`.
- Inside the container, `/app/apps/api/dist/src/index.js` resolves cleanly. But the walk uses `existsSync`, not "contains a `pnpm-workspace.yaml`" — if a future image places the API binary at a path that happens to have an unrelated `packages/` ancestor (e.g. a bind-mounted dev host), it will be silently wrong. Cheap fix: only accept the directory if its parent also contains `pnpm-workspace.yaml` (the actual workspace marker).

### H7. Lockfile copy is sufficient but workspace manifest copy is incomplete
See B5. Cleanest fix is one explicit `COPY` per workspace `package.json`, generated by a small `scripts/generate-dockerfile-deps.mjs`, or use `pnpm fetch` followed by `pnpm install --offline` after copying all manifests.

### H8. `UOA_CLIENT_SECRET` is read with `!` even though it is optional
File: `apps/api/src/routes/auth.ts:313` (`computeClientHash(env.SSO_DOMAIN, env.UOA_CLIENT_SECRET)`) called from a path reached during onboarding when secret may be unset. `packages/config/src/env.ts:36` types it as optional. Not container-specific but it will crash a fresh deployment that has not finished UOA claim-link.

## 4. Medium

### M1. `.dockerignore` is thin
File: `.dockerignore`.
- Missing entries: `**/coverage`, `**/.turbo`, `**/.vite`, `**/.next` (defensive), `**/*.test.ts` is too narrow — also exclude `**/__tests__`, `e2e/`, `playwright-report/`, `test-results/`, `apps/admin/playwright.config.ts`. Currently `apps/admin/e2e/` will be copied into the admin build context.

### M2. Layer caching is suboptimal
- `Dockerfile:8-16` mixes lockfile + manifests with a single `pnpm install`. If any *non-manifest* file in step 8's COPY changes (turbo.json, root package.json), the install layer is invalidated. That is correct for *real* dependency changes but `turbo.json` should not invalidate it. Split: copy `pnpm-lock.yaml` + every workspace `package.json` first, then `pnpm install`, then copy everything else.
- The same issue exists in `Dockerfile.admin:10-15`.

### M3. node base image not pinned by digest
Files: `Dockerfile:2,32`, `Dockerfile.admin:1,35`.
- `node:22-slim` and `nginx:alpine` are tags that float. Pin by digest (`node:22-slim@sha256:…`) for reproducible builds, or at minimum to a patch version (`node:22.11.0-slim`).

### M4. `corepack prepare pnpm@9.15.4 --activate` runs twice in API Dockerfile
File: `Dockerfile:4,34`.
- Once in build stage, once in runtime. The runtime stage never invokes pnpm (the CMD shells out to `pnpm --filter … exec prisma migrate deploy`). If you switch CMD to call `node_modules/.bin/prisma` directly you can drop corepack from the runtime stage entirely and shrink the image further.

### M5. Build stage missing OpenSSL for prisma binary targets
File: `Dockerfile:2-29`, `apps/api/prisma/schema.prisma:7` (`binaryTargets = ["native", "debian-openssl-3.0.x"]`).
- The build stage runs `prisma generate` and uses the `native` target, but `node:22-slim` does not include `openssl` by default (it is installed in the runtime stage at line 35 but not the build stage). Prisma client engine downloads need openssl available at generate time on some image variants. Add `apt-get install -y openssl ca-certificates` in the build stage too.

### M6. `executors-runtime` browser entry not protected
File: `apps/admin/vite.config.ts:11`.
- Vite aliases `@support-agent/executors-runtime` to `packages/executors-runtime/src/browser.ts`. Good for dev. For container build the alias still resolves under `/app/apps/admin/`; `packages/executors-runtime/src/` must be copied first — it is at `Dockerfile.admin:19`. Confirmed OK, but worth noting: the alias does not point at `dist/`, so the admin image *does not need* a built `executors-runtime` at all — yet `Dockerfile.admin:22-23` builds it. Either remove that build or switch the alias to use the package entry point.

### M7. Missing `NODE_OPTIONS` / GC tuning hints
- For Cloud Run, set `NODE_OPTIONS=--enable-source-maps` (sourcemaps already enabled in `tsconfig.base.json:9`) and a `--max-old-space-size` aligned with the Cloud Run memory limit. Not a blocker; a hygiene item.

## 5. Low / Hygiene

- `Dockerfile:71` `ENV PORT=8080` is overridden by Cloud Run anyway. Fine, but document.
- `Dockerfile:35` `apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*` — also install `ca-certificates` and `tini` (PID 1, signal forwarding).
- Run as a non-root user. Neither image creates a dedicated user. Append `USER node` in both runtime stages after `chown`-ing the relevant directories.
- `Dockerfile.admin` builds with `node:22-alpine`, while API builds with `node:22-slim`. Mixed bases are fine but pick one for the build stage to share apt cache and reduce surface.
- `apps/admin/vite.config.ts` does not set `build.sourcemap`. Decide per security posture; default is off, which is correct for prod.
- `nginx/admin.conf` listens on a single hardcoded port. Templating via `envsubst < admin.conf.template > admin.conf` at container start lets Cloud Run override `$PORT` cleanly.
- `.dockerignore` does not ignore `**/*.tsbuildinfo`, which is generated by composite TS builds and copied unnecessarily.
- The admin Dockerfile builds `@support-agent/contracts` and `@support-agent/executors-runtime` (`Dockerfile.admin:22-23`) before `pnpm -F @support-agent/admin build`. Since Vite bundles from source via the alias, these two builds may be redundant — verify by removing and retesting.
- `findPackagesDir` uses `__dirname`, which only works under CJS output. If `apps/api` ever moves to ESM (`"type": "module"`), this silently breaks; gate on `import.meta.url` then.

## 6. Concrete Proposed Diffs

### 6.1 Fix admin port + add SPA cache + security headers

`nginx/admin.conf`:

```nginx
server {
    listen 8080;
    server_tokens off;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/javascript application/xml application/wasm image/svg+xml;
    gzip_min_length 1024;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer always;

    location = /index.html {
        add_header Cache-Control "no-cache" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable" always;
    }
}
```

`Dockerfile.admin:40`: `EXPOSE 8080`.

### 6.2 Move migrations out of CMD

`Dockerfile`:

```dockerfile
# Default: run migrate then start; opt out via RUN_MIGRATIONS=0 for replicas.
CMD ["sh", "-c", "[ \"${RUN_MIGRATIONS:-1}\" = \"1\" ] && pnpm --filter @support-agent/api exec prisma migrate deploy; exec node apps/api/dist/src/index.js"]
```

Better: add a `migrate` step to `.github/workflows/deploy.yml` that runs `gcloud run jobs execute supportagent-api-migrate` before `deploy-cloudrun` and set `RUN_MIGRATIONS=0` in the service.

### 6.3 SIGTERM in API entrypoint

`apps/api/src/index.ts` (append in `main` after `app.listen`):

```ts
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    app.log.info({ sig }, 'shutdown requested');
    try { await app.close(); } finally { process.exit(0); }
  });
}
```

Mirror in `apps/worker/src/index.ts` (call `transport.stop?.()` before exit) and `apps/gateway/src/index.ts` (`await app.close()` then `processor.stop?.()`).

### 6.4 Trim runtime image

Replace the `Dockerfile` runtime stage `COPY --from=build /app/.../node_modules/` lines with:

```dockerfile
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/*/package.json packages/
# ... or use a script to enumerate manifests
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate \
 && pnpm install --frozen-lockfile --prod --filter @support-agent/api...
COPY --from=build /app/apps/api/dist/ apps/api/dist/
COPY --from=build /app/packages/*/dist/ packages/
COPY --from=build /app/apps/api/prisma/ apps/api/prisma/
COPY --from=build /app/node_modules/.prisma /app/node_modules/.prisma
```

(The wildcard `COPY packages/*/package.json packages/` does not work with Docker's COPY; use one line per package or a script. Sketched here for direction.)

### 6.5 Add HEALTHCHECK

`Dockerfile`:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

`Dockerfile.admin`:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
```

### 6.6 Tighten `.dockerignore`

```
node_modules
dist
.git
.github
**/*.test.ts
**/__tests__
**/coverage
**/.turbo
**/.vite
**/*.tsbuildinfo
apps/admin/e2e
apps/admin/playwright-report
apps/admin/test-results
.env*
.claude
.worktrees
docs
CLAUDE.md
AGENTS.md
README.md
scripts/e2e-integration-test.mjs
```

(Keep `docs/` excluded only if no runtime artifact references it; current code does not.)

### 6.7 Add minimal worker/gateway Dockerfiles

Both follow the API pattern: build stage copies the relevant package set, runs `pnpm turbo build --filter=@support-agent/worker...` (resp. gateway), runtime stage runs `node apps/worker/dist/src/index.js`. They do not need Prisma migrate. The worker image needs Playwright/Chromium only for `worker-web` profile (see `docs/worker-deployment.md:101-115`); start with `worker-core` only.

---

## Verification Notes

- `Dockerfile:74` `CMD ["sh","-c","pnpm --filter @support-agent/api exec prisma migrate deploy && node apps/api/dist/src/index.js"]` — confirmed.
- `apps/api/src/index.ts:12-23` `findPackagesDir` — confirmed walks upward looking for any `packages/` directory.
- `apps/api/src/lib/uoa.ts:37-39` — `importPKCS8(...{ extractable: true })` — confirmed.
- `apps/api/src/routes/auth.ts:349` — `decodeJwt(token.access_token)` — confirmed.
- `nginx/admin.conf:2` `listen 8080;` vs `Dockerfile.admin:40` `EXPOSE 80` — confirmed.
- `.github/workflows/deploy.yml` deploys only `supportagent-api` and `supportagent-admin` — confirmed; no worker/gateway job.
- `apps/api/src/plugins/prisma.ts:17` `onClose` is the only Prisma teardown hook — confirmed; never invoked because no entrypoint calls `app.close()`.
