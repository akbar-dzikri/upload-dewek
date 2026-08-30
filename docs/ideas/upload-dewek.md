# Upload Dewek — Solo Control Plane

## Problem Statement

**How might we give a solo dev a $0, zero-OOM centralized asset control plane on Cloudflare edge that dogfoods across his own projects, impresses a hiring manager in 2 minutes, AND is forkable so anyone with the same "gaperlu bingung naro assets dimana" case can `fork → wrangler deploy` on their own Cloudflare account — without rebuilding Cloudinary/UploadThing or re-adding V1 queues/DO/Wasm?**

Solo dev juggles images across N projects (portfolio, agency sites, n8n automation). Options today: R2 raw (no DB/search/quota/dashboard), Cloudinary (paid transforms, kills $0), proxy-through-Worker (OOM on 128MB/10ms). No single place to `create project → pick folder/tag → upload → get link → use`. Every new project = "gaperlu bingung naro assets dimana". Need personal Cloudinary × UploadThing but *simpler*, centralized, dashboard-visible, demo-safe, $0, **and open — bring your own Cloudflare account** (like UploadThing self-host, not SaaS).

## Recommended Direction

**Solo Control Plane — Direction A, Forkable Open Source.** One tenant per fork (you fork → your account), N projects, minimal dashboard. MIT.

API stays in `upload-dewek` Workers (`Hono` + `aws4fetch` presigned POST + D1 `assets` + R2 `ASSETS` + `IMAGES`), single `x-api-key` (hashed in `api_keys`, seeded for your `projects`). No per-project key self-serve, no DO/Queue. Fork DX is first-class: `fork → pnpm install → wrangler d1 create → wrangler r2 bucket create → .dev.vars → pnpm db:migrate:local → pnpm dev` on forker's own $0 Cloudflare account — no hardcoded `akbar-dzikri` ids.

**Workflow you want (the job to be done):** whenever you start a new project — `create project di upload dewek` → optional `folder/tag` for organization (e.g. `portfolio/blog/hero`, tags `["hero","dark"]`) → `upload media` via dropzone (presigned POST direct-to-R2) → `get links` (canonical + `?width=&format=&quality=` variants, one-click copy) → `use` in that project's code. No more scattering assets across repo `public/` or ad-hoc R2 buckets.

Dashboard lives in `portfolio-cloudflare` (Next.js/OpenNext, already on Cloudflare) as a new route `/*/assets*` that consumes the Workers API. This splits concerns: Workers = zero-compute ingestion + serve, Portfolio = the demo recruiters *see* (grid, preview, copy-optimized-URL, folder/tag filter). Dogfooding is the proof: migrate `portfolio-cloudflare/public` + 1 agency project to `projectId=portfolio` on day 1 and use it via `.../assets/:id?width=800&format=webp`.

Why this over Lite Multi-Tenant (B) and Showcase Thin (C): B proves multi-tenant SaaS with 0 tenants — premature scale that delays job-in-30d and kills forkability (who pays for your R2?). C is just an image route, not a product story. A is forkable: each fork is its own Solo Control Plane on its own $0 account (your fork dogfoods your projects, their fork dogfoods theirs). Keeps LinkedIn YAGNI: less code, `aws4fetch` 11kB, `UPDATE ... WHERE status='pending'` not DO, $0 Paid-free, **BYO-Cloudflare**.

## Key Assumptions to Validate

- [ ] **You will actually migrate one real project in week 1.** _Test:_ move `portfolio-cloudflare` hero images to `projectId=portfolio`; if you don't, it's portfolioware. Kill criterion: still on `/public` after 7 days → pause dashboard, fix migration DX.
- [ ] **Dashboard is the demo, not API docs.** _Test:_ show dashboard screenshot to a non-technical hiring manager for 30s — can they say "I get it"? If they need `curl`, dashboard failed.
- [ ] **Cloudflare Images free tier covers your 5 projects.** _Test:_ check `dash.cloudflare.com` Images usage after 100 transforms; if approaching limit, $0 breaks → fallback to R2-only serve without transforms.
- [ ] **Single key per fork is enough; per-project keys are YAGNI until forkers ask.** _Test:_ you manage `portfolio`, `client-x`, `n8n-assets` with one key + `?projectId=` filter; forker does same on their account. If a forker needs isolated client key, they open an issue — not v1.
- [ ] **Forkability is real, not README theatre.** _Test:_ fresh clone on a second Cloudflare account `fork → pnpm install → wrangler d1 create/r2 create → .dev.vars → pnpm db:migrate → pnpm dev` succeeds without touching `src/`; if it needs code edit, fail.
- [ ] **API before dashboard ordering matters.** _Test:_ ship `POST /upload/init → R2 POST → POST /upload/confirm → GET /assets/:id?width=` and prove it with `curl` + `wrangler tail` (no Worker body read, <10ms) before writing any dashboard component.
- [ ] **`aws4fetch` presigned POST is sufficient (no SDK).** _Test:_ bundle <1MB (`wrangler deploy --dry-run`), CPU <10ms per init. If SDK needed, kill.

## MVP Scope

**In — API (`upload-dewek` Workers):**
- `POST /projects` / `GET /projects` — create/list your centralized projects `{name, quotaBytes?}` → `projects` + `project_usages`; needed so "gaperlu bingung naro assets dimana" → you create `project=portfolio`, `project=client-x` once, then scope uploads.
- `POST /upload/init` — `zValidator` `{filename,mimeType,sizeBytes,projectId, folder?:string, tags?:string[]}` + `x-api-key` check + `quotaBytes` guard (`project_usages.usedBytes + sizeBytes > quotaBytes → 409/413`) + `D1 INSERT assets(status='pending', r2Key=projects/<projectId>/<folder?>/<uuid>-<filename>, folder, tags JSON)` + `aws4fetch` presigned POST (`url`, `fields`, `expiresAt` 15m, scoped key+type) → 201
- `POST /upload/confirm` — `{assetId}` → `R2 HEAD r2Key` (404 → 404) → `UPDATE assets SET status='validated', sizeBytes, validatedAt WHERE id=? AND status='pending'` (0 rows → 409 already confirmed) → 200 + return canonical `url` + optimized variants
- `GET /assets?projectId=&folder=&tag=&status=&q=&cursor=&limit=` — D1 paginated + filtered (`idx_assets_project_status_created_at` + `folder`/`tags` JSON filter, simple `LIKE` for v1) → JSend + `meta{hasNextPage, cursors}`. Supports your workflow: filter by project/folder/tag to find link quickly.
- `GET /assets/:id` / `GET /assets/:id/content?width=&format=&quality=` — 200 stream from `R2` via `IMAGES` transform (or 302 to `...?width=400&format=webp`), `Cache-Control`, 404 if `rejected`/missing. `tags`/`folder` returned for UI.
- `DELETE /assets/:id` — soft `rejected` + `R2 delete` (or pending GC), 204
- `GET /` health

**In — Dashboard (`portfolio-cloudflare` for your demo + forkable minimal dashboard in `upload-dewek`):**
- `portfolio-cloudflare/src/app/dashboard/assets` — your showcase: project switcher + create project modal (`POST /projects`), folder/tag filter chips + search `q`, upload dropzone with folder/tag inputs (calls `init` → `fetch(url, {method:'POST', body: FormData with fields+file})` direct to R2 → `confirm`), grid with preview, status badge `pending/validated`, `folder` + `tags` display, one-click copy `.../assets/:id?width=800&format=webp&quality=80` (and canonical), delete, quota bar `usedBytes/quotaBytes`
- `upload-dewek/` forkable dashboard (minimal, same logic) OR forkers reuse portfolio route as template — seeded `projects` (`id=portfolio`, `name=Portfolio`, `quotaBytes=1GB`) + one `api_keys` for local, docs show how to point dashboard `NEXT_PUBLIC_UPLOAD_DEWEK_URL` to their worker.
- Seeded `projects` + one `api_keys` for you

**In — Forkability (open source):**
- `README.md` fork guide: `Fork → Clone → pnpm install → wrangler login → wrangler d1 create upload_dewek_db / wrangler r2 bucket create upload-dewek-assets → cp .dev.vars.example .dev.vars (R2_ACCESS_KEY_ID/SECRET, DB_ID) → pnpm db:generate → pnpm db:migrate:local → pnpm dev → pnpm deploy`
- `.dev.vars.example`, `wrangler.jsonc` with `${VAR}` placeholders (already `WORKER_NAME/DB_ID/CACHE_KV_ID/ASSETS_R2_BUCKET`), `LICENSE` MIT, `CONTRIBUTING.md` 10 lines.

**Out — Not in MVP:**
- Per-project `api_keys` self-serve SaaS, RBAC/row-level security, billing
- Webhooks, background jobs, AI auto-tagging/vectorize
- Nested folder permissions, drag-drop move/rename (flat `folder` string only)
- Video transcoding beyond `video/mp4` passthrough
- `GET /assets/:id` public CDN without key (keep private; signed `?token=` later if needed)
- Queue/DO/Wasm/custom image pipeline
- Hosted SaaS for forkers (you don't pay for their R2 — they bring account)

**Ship slice:** `projects` CRUD + `POST /upload/init→confirm` with `folder/tags` → `GET /assets?projectId&folder&tag` filtering → `GET /assets/:id/content?width=` optimization → dashboard consumes it → publish fork guide → migrate 1 real project (`portfolio`) → showcase with "Fork for your own $0 account" CTA.

## Not Doing (and Why)

- **Per-project API keys self-serve** — you = only user. One key + `?projectId=` + `projects` table you control is YAGNI; B adds self-serve auth/rate-limit complexity before 1 paying client.
- **Durable Objects / Queues / Workers Workflows** — require Paid plan → kills $0. `UNIQUE(r2Key)` + conditional `UPDATE WHERE pending` is atomic enough for 0-1000 confirms. No mutex until proven contention.
- **`@aws-sdk/signature-v4` in Worker** — 300kB+, blows 10ms/1MB bundle. `aws4fetch` 11kB is the lean story.
- **Proxying binary through Worker** — anti-pattern you market against. Presigned POST direct-to-R2 is the whole point; Worker never `await request.arrayBuffer()`.
- **Building dashboard before API** — demo on fake data is theatre. API is the truth, dashboard is the lens.
- **Merging Workers into `portfolio-cloudflare`** (Direction C) — couples DAM to portfolio deploy, loses forkable `github.com/akbar-dzikri/upload-dewek` standalone repo that people can fork for their own account.
- **AI auto-tagging/vector search, nested folder hierarchy** — vitamin for 0 assets; `folder` as flat string + `tags: string[]` covers 90% with 1 column + 1 JSON field.
- **Building a SaaS for forkers (you host their assets)** — anti-fork: you pay $0 for yours, they pay $0 for theirs on their account. Don't centralize; document BYO-Cloudflare.

## Open Questions

- **Dashboard location for forkers:** ship minimal dashboard inside `upload-dewek/` (e.g. `frontend/` SPA) vs tell forkers to clone `portfolio-cloudflare/src/app/dashboard/assets` as template? Propose: portfolio dashboard is your showcase, forkable minimal `frontend/` later if forkers ask (YAGNI now, README points to portfolio route as reference).
- **ID generation:** `crypto.randomUUID()` (native, 0 deps) vs `nanoid`? Propose native.
- **Size caps:** 10MB image / 100MB video? Or 5MB for free-tier demo? Propose 10/100, enforce at `init`.
- **Public vs signed serve:** should `GET /assets/:id/content` be public for `<img src>` or require `x-api-key`? Propose private by default, signed `?token=` later for forkers' public sites.
- **Quota UX:** hard reject at `init` (413) vs soft allow with warning? Propose hard reject (clear demo).
- **Folder/tags v1 shape:** `folder?: string` + `tags?: string[]` flat JSON with `LIKE` filter enough? Propose JSON `tags` + `folder` column for v1.
- **Fork license/docs:** MIT + `README` fork guide + `.dev.vars.example` enough? Propose yes for v1, add `CONTRIBUTING.md` if stars >10.

## Workflow (Happy Path)

```
[New project] → Dashboard: POST /projects {name:"Toko Kue"} → id=proj_abc
     → pick/create folder ("products/cake") + tags (["hero","promo"])
     → drop files → for each: POST /upload/init {projectId,folder,tags,filename,mimeType,sizeBytes}
     → get {url,fields,assetId} → FormData POST direct to R2 (bypasses Worker)
     → POST /upload/confirm {assetId} → 200 {url: ".../assets/:id/content", variants: ["?width=800&format=webp", "..."]}
     → grid shows asset with folder/tag badges → click Copy Link → paste `https://assets.dewek.id/assets/:id?width=800&format=webp` into project's code
     → later: GET /assets?projectId=proj_abc&folder=products/cake&tag=hero&q=cake → instant find
```
Centralized: all projects' assets in one control plane, filterable by `projectId/folder/tag`, solvable via dashboard without opening R2 console.
