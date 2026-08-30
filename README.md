# Upload Dewek — Solo Control Plane

> Personal Cloudinary × UploadThing lite, but simpler. Forkable open source (BYO $0 Cloudflare account).  
> Zero-compute ingestion: `S3 presigned POST` direct to **R2** → `D1` metadata → **Cloudflare Images** transforms. No proxy, no DO/Queue/Wasm, 128MB/10ms safe.

**Workflow you want:** `create project di upload dewek` → optional `folder/tag` → `upload media` via presigned POST → `get links` (`?width=&format=&quality=`) → `use` in your project. Centralized for all your projects, `gaperlu bingung naro assets dimana`.

Demo: `dashboard/` (Vite React, forkable) at `http://localhost:5173` + `portfolio-cloudflare` dogfoods `projectId=portfolio` via API. Fork for your own account → see Fork Guide below.

## Architecture (lean)

```
POST /projects {name} → D1 (projects + project_usages)
POST /upload/init {projectId,folder?,tags?,filename,mimeType,sizeBytes} → D1 pending + aws4fetch presigned POST (15m, scoped)
POST direct to R2 (bypasses Worker) → POST /upload/confirm {assetId} → R2 HEAD + UPDATE ... WHERE status='pending' → validated
GET /assets?projectId&folder&tag&q&cursor&limit → filtered list (LIKE on folder/tags)
GET /assets/:id/content?width=&format=&quality= → R2.get + Images transform + Cache-Control
DELETE /assets/:id → rejected + R2.delete + usage decrement
```

`wrangler.jsonc:2` bindings: `DB (D1)`, `ASSETS (R2)`, `CACHE (KV)`, `IMAGES`. `aws4fetch` 11kB, `Hono` + `drizzle-orm` + `zod`.

## Fork for your own $0 account (BYO Cloudflare)

> You don't deploy to my account — you fork and deploy to yours. $0 = your free tier.

```bash
# 1. Fork on GitHub, then:
git clone https://github.com/<you>/upload-dewek.git
cd upload-dewek
pnpm install

# 2. Login and create your own resources
npx wrangler login
npx wrangler d1 create upload-dewek-db
# -> copy database_id -> set DB_ID / DB_NAME in wrangler.jsonc vars or .dev.vars
npx wrangler r2 bucket create upload-dewek-assets
npx wrangler kv namespace create CACHE
# -> copy ids -> set CACHE_KV_ID / ASSETS_R2_BUCKET in wrangler.jsonc

# 3. Env
cp .dev.vars.example .dev.vars
# edit .dev.vars: R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (R2 → Manage R2 API Tokens) / R2_BUCKET

# 4. DB
pnpm db:generate   # already has 0000 + 0001 (folder/tags)
pnpm db:migrate:local
# for remote: pnpm db:migrate <DB_NAME>

# 5. Dev (local D1/R2, zero-compute verified via wrangler tail)
pnpm dev
# -> POST /projects, POST /upload/init, POST direct to R2, POST /upload/confirm

# 6. Deploy (your account, $0)
pnpm deploy --minify
# set secrets for remote if needed: npx wrangler secret put R2_ACCESS_KEY_ID etc
```

`wrangler.jsonc` uses `${WORKER_NAME}`, `${DB_ID}`, `${CACHE_KV_ID}`, `${ASSETS_R2_BUCKET}` placeholders — no hard-coded `akbar-dzikri` ids. `.dev.vars` is gitignored.

## Dashboard (forkable, inside `upload-dewek/dashboard`)

Full Solo Control Plane UI — not minimal placeholder: `create project → folder/tag/q filter → dropzone (init → PUT presigned → confirm) → grid preview → copy `?width=&format=&quality=` variants → delete → quota bar`.

```bash
cd dashboard
npm install   # or pnpm install
# set VITE_UPLOAD_DEWEK_URL + VITE_UPLOAD_DEWEK_API_KEY in dashboard/.env or use Settings UI (localStorage)
npm run dev   # http://localhost:5173
npm run build # production
```

The dashboard talks to your worker (`http://localhost:8787` by default, or `https://upload-dewek.<you>.workers.dev`). Set URL + `x-api-key` in the dashboard Settings (saved to `localStorage`) or via `VITE_UPLOAD_DEWEK_URL` / `VITE_UPLOAD_DEWEK_API_KEY` env. Zero-compute verified: `init → PUT presigned → confirm`, binary never touches Worker.

## Commands

```bash
pnpm dev                # wrangler dev (remote D1/R2)
pnpm dev:local          # wrangler dev --local
pnpm deploy             # wrangler deploy --minify
pnpm cf-typegen         # wrangler types → worker-configuration.d.ts
pnpm db:generate        # drizzle-kit generate
pnpm db:migrate:local   # wrangler d1 migrations apply --local
pnpm lint               # eslint .
pnpm lint:fix           # eslint . --fix
pnpm test               # vitest run (80 tests)
pnpm format             # prettier --write .
```

## Constraints

128MB RAM, 10ms CPU, $0 infra, 0 users → YAGNI: no Durable Objects/Queues/Wasm, `aws4fetch` not `@aws-sdk/*`, `UPDATE ... WHERE pending` not DO, flat `folder` string + `tags: string[]` JSON (no `tags` table until >200 assets).

See `SPEC.md:1` (source of truth) + `docs/ideas/upload-dewek.md:1` (one-pager) + `tasks/plan.md:1`.

## License

MIT — see `LICENSE`.

## Live

- **API (custom domain):** https://upload-dewek.dikicodes.com/health
- **API (workers.dev):** https://upload-dewek.akbardzkr05.workers.dev/health
- **Dashboard:** https://upload-dewek.dikicodes.com/ (or https://upload-dewek.akbardzkr05.workers.dev/ — same Worker via `assets` SPA fallback)
- **Health:** `GET /health` checks D1, `GET /healthz` liveness

Deployed via `wrangler deploy --config wrangler.deploy.jsonc` with `assets: dashboard/dist` (Vite) — single Worker free plan.

