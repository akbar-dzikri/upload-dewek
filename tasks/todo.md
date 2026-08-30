# Todo: Upload Dewek — Solo Control Plane

> Source: `SPEC.md:1` + `docs/ideas/upload-dewek.md:1` + `tasks/plan.md:1`. Vertical slices, each leaves system working. Check off after verification.

## Phase 1: Foundation

- [x] Task 1: Test harness + lint/type gate
  - Acceptance: `pnpm test` runs (even if 0 tests), `pnpm lint && pnpm exec tsc --noEmit` green, no new runtime deps except dev.
  - Verify: `pnpm test` (24 passed) ; `pnpm lint` 0 ; `pnpm exec tsc --noEmit` 0 ; `wrangler deploy --dry-run` bundle logged (placeholder vars intentional for forkable).
  - Files: `package.json`, `vitest.config.ts`, `tsconfig.json`, `tests/**` stub
  - Dependencies: None
  - Scope: XS (1-2 files)

- [x] Task 2: `assets` schema `folder` + `tags` + migration + seed
  - Acceptance: `assets` has `folder text`, `tags text (JSON string[])`, `idx_assets_project_id` kept + `idx_assets_project_status_created_at` kept + `folder` filterable via `LIKE`/`json_each`; `pnpm db:generate` creates migration, `pnpm db:migrate:local` applies; seeded `projects(id=portfolio, name=Portfolio, quotaBytes=1073741824)` + `project_usages(usedBytes=0)` + one `api_keys` hash for local.
  - Verify: `pnpm db:generate` → `0001_stale_lenny_balinger.sql` ; `pnpm db:migrate:local` applied ; `src/lib/db/schema/assets.ts:14` has `folder`/`tags` + `idx_assets_folder`
  - Files: `src/lib/db/schema/assets.ts`, `migrations/*.sql`, `drizzle.config.ts`, `scripts/seed.ts?`
  - Dependencies: Task 1
  - Scope: S (2-3 files)

## Checkpoint: Foundation
- [x] `pnpm lint && tsc --noEmit && pnpm test` green
- [x] Local D1 has `folder/tags` cols + seed, bundle <500kB (placeholder vars for forkable)

## Phase 2: Core Centralized Workflow

- [x] Task 3: `POST /projects` + `GET /projects` CRUD
  - Acceptance: `POST /projects {name, quotaBytes?}` with `x-api-key` → 201 `{id,name,quotaBytes}` inserts `projects` + `project_usages(usedBytes=0)`; `GET /projects` → `[{id,name,quotaBytes,usedBytes}]` paginated; invalid body → 422 `ERR_VALIDATION`, no/invalid key → 401/403; duplicate name allowed (id is uuid).
  - Verify: `pnpm test` unit for service + integration `POST/GET /projects` via `wrangler dev --local` inject ; manual `curl -H x-api-key:...`.
  - Files: `src/lib/validation/projects.ts`, `src/lib/projects/service.ts`, `src/routes/projects.ts`, `src/index.ts` mount
  - Dependencies: Tasks 1,2
  - Scope: S (3-4 files)

- [x] Task 4: Auth middleware + `POST /upload/init` with `folder/tags` presigned POST (`aws4fetch`)
  - Acceptance: `POST /upload/init {projectId,folder?,tags?,filename,mimeType,sizeBytes}` with valid `x-api-key` + existing `projectId` + `quotaBytes` check → 201 `{assetId,r2Key,url,fields,expiresAt}` where `r2Key=projects/<projectId>/<folder?>/<uuid>-<filename>` + `D1 assets.status='pending'` stored `folder/tags`; presigned via `aws4fetch` 15m scoped to key+type, no `@aws-sdk/*` in bundle; quota exceeded → 413; bad mime/size/folder/tags → 422.
  - Verify: `pnpm test` 59 passed (presign vector + quota + folder sanitize) ; `pnpm lint` 0 ; `pnpm exec tsc --noEmit` 0 ; `wrangler deploy --dry-run` bundle <1MB verified via `pnpm exec wrangler deploy --dry-run` (placeholder vars).
  - Files: `src/lib/auth/middleware.ts`, `src/lib/r2/presign.ts`, `src/lib/assets/service.ts`, `src/routes/uploads.ts`, `package.json` (+ `aws4fetch`), `src/lib/validation/uploads.ts`
  - Dependencies: Task 3
  - Scope: M (4-5 files)

- [x] Task 5: `POST /upload/confirm` R2 HEAD + conditional UPDATE → validated + links
  - Acceptance: `POST /upload/confirm {assetId}` with valid key → does `R2 HEAD r2Key` → if 404 → 404 `ERR_NOT_FOUND`, else `UPDATE assets SET status='validated', sizeBytes=real, validatedAt=now WHERE id=? AND status='pending'` → if 0 rows → 409 `ERR_CONFLICT`, else 200 `{asset, url: "/assets/:id/content", variants: ["?width=800&format=webp", ...]}` + increments `project_usages.usedBytes`; concurrent second confirm → 409.
  - Verify: `pnpm test` 59 passed (mock R2 head + double confirm 409 + R2 missing 404) ; `wrangler tail` no body read (presigned direct-to-R2).
  - Files: `src/routes/uploads.ts` (confirm handler), `src/lib/assets/service.ts`, `src/lib/r2/presign.ts`
  - Dependencies: Task 4
  - Scope: M (3-4 files)

## Checkpoint: Core Upload
- [ ] Full `curl` happy path local green + race/invalid tests ; bundle/CPU lean

## Phase 3: Organization & Delivery

- [x] Task 6: `GET /assets?projectId&folder&tag&q&cursor&limit` filtered pagination
  - Acceptance: `GET /assets?projectId=portfolio&folder=blog/hero&tag=dark&q=cover&limit=20&cursor=` → 200 `{items: Asset[], meta:{hasNextPage,cursor}}` filtered by exact `folder`, `tags LIKE '%"dark"%'`, `q` on `filename`/`folder` `LIKE`, paginated via `createdAt` cursor, indexed query; invalid `projectId` → 404 if project not found or empty list; requires `x-api-key`.
  - Verify: `pnpm test` 80 passed (filter combinator + cursor) ; integration with 5 seeded assets asserts filter correctness.
  - Files: `src/routes/assets.ts`, `src/lib/assets/query.ts`, `src/lib/validation/assets.ts`
  - Dependencies: Task 5
  - Scope: M (3-4 files)

- [x] Task 7: `GET /assets/:id/content?width=&format=&quality=` Images transform serve
  - Acceptance: `GET /assets/:id/content?width=800&format=webp&quality=80` with valid key (or public? decide private v1) → if `status!='validated'` → 404, else `R2.get(r2Key)` + pipe through `IMAGES` transform (`width/format/quality` validated via zod, clamp) → 200 with `Content-Type` + `Cache-Control: public, max-age=31536000, immutable` ; second hit cached; invalid transform → 422.
  - Verify: `pnpm test` 80 passed (param validation + R2 get 200 + transform header) ; manual image preview in browser (via `wrangler dev`).
  - Files: `src/routes/assets.ts` (serve), `src/lib/validation/assets.ts`
  - Dependencies: Task 6
  - Scope: M (3-4 files)

- [x] Task 8: `DELETE /assets/:id` soft `rejected` + R2 delete
  - Acceptance: `DELETE /assets/:id` with valid key → `UPDATE assets SET status='rejected' WHERE id=? AND status!='rejected'` → `R2.delete(r2Key)` (best-effort) → decrements `project_usages.usedBytes` by `sizeBytes` → 204; already `rejected` → 404; then `GET /assets/:id/content` → 404.
  - Verify: `pnpm test` 80 passed (`confirm → delete → get 404 → list excludes rejected`).
  - Files: `src/routes/assets.ts`, `src/lib/assets/service.ts`
  - Dependencies: Task 7
  - Scope: S (2-3 files)

## Checkpoint: Organization & Delivery
- [ ] Filter `folder/tag/q` + pagination + serve with transforms + delete all integration green

## Phase 4: Dashboard — forkable inside `upload-dewek/dashboard` (not portfolio)

- [x] Task 9: Dashboard shell + project switcher + list consumption
  - Acceptance: `upload-dewek/dashboard` (Vite React) shows project switcher (fetches `GET /projects`), folder/tag/q filter chips, calls `GET /assets?projectId&folder&tag&q` with `x-api-key` from Settings (localStorage + `VITE_UPLOAD_DEWEK_URL/_API_KEY`), grid preview via `GET /assets/:id/content?width=400&format=webp`, status badge, empty/loading/error, quota bar `usedBytes/quotaBytes`; no upload yet.
  - Verify: `cd dashboard && npm run build` 0, manual `npm run dev` switch project → list filters correctly, `pnpm lint` root 0 (dashboard excluded).
  - Files: `dashboard/src/lib/client.ts`, `dashboard/src/App.tsx`, `dashboard/vite.config.ts`, `dashboard/package.json`
  - Dependencies: Tasks 6,7 (API must be deployed or local)
  - Scope: M (3-5 files)

- [x] Task 10: Dropzone wiring + copy link + quota bar + dogfood migration
  - Acceptance: Dropzone: select `projectId` + `folder` input + `tags` input + file → calls `POST /upload/init` → `fetch(presigned.url,{method:'PUT',body:file})` direct to R2 (zero-compute, binary never touches Worker) → `POST /upload/confirm` → grid refresh with new asset showing `folder/tags`; per-card Copy buttons for `canonical` + `...?width=800&format=webp&quality=80` (one click, `navigator.clipboard`), delete, quota bar updates; actually dogfood `portfolio` project via this flow.
  - Verify: manual full workflow without opening R2 console, copy link pasted in `<img src>` renders transformed, quota bar updates after upload/delete, `dashboard: npm run build` 0, `upload-dewek: pnpm test` 80 passed.
  - Files: `dashboard/src/App.tsx` (dropzone + copy/delete), `dashboard/src/lib/client.ts` (init/confirm/delete), `README.md` dashboard section
  - Dependencies: Task 9, Task 5
  - Scope: M (4-5 files)

- [x] Task 11: Forkability + open source polish
  - Acceptance: `README.md` has "Fork for your own $0" section: `Fork → Clone → pnpm install → wrangler login → wrangler d1 create upload_dewek_db / wrangler r2 bucket create upload-dewek-assets → cp .dev.vars.example .dev.vars → edit DB_ID/R2_ACCESS_KEY_ID/SECRET/R2_BUCKET → pnpm db:migrate:local → pnpm dev → pnpm deploy`; `.dev.vars.example` + `LICENSE` MIT present; `wrangler.jsonc` still uses `${WORKER_NAME}/${DB_ID}/${CACHE_KV_ID}/${ASSETS_R2_BUCKET}` placeholders (no hard-coded ids); no secrets committed.
  - Verify: `grep -F "b90ebb" wrangler.jsonc` 1 (no hits), `grep -F "akbar" wrangler.jsonc` 1, `ls .dev.vars.example LICENSE README.md` ok, `pnpm lint` 0, `pnpm test` 80 passed, `wrangler deploy --dry-run` placeholder (forkable).
  - Files: `README.md`, `.dev.vars.example`, `LICENSE`, `wrangler.jsonc`
  - Dependencies: Task 10 (done out of order for fork DX early, ok)
  - Scope: S (2-3 files)

## Checkpoint: Complete
- [x] Dashboard full workflow without R2 console, project centralized, folder/tag organization works, optimized links copy-paste usable (`dashboard/` Vite, `init → PUT presigned → confirm`, folder/tag/q filter, copy `?width=&format=&quality=` variants)
- [x] `SPEC.md:172` + fork criteria all checked (`README.md` fork guide, `.dev.vars.example`, `LICENSE`, `wrangler.jsonc` placeholders)
- [ ] Portfolio hero migrated via control plane (next: use dashboard to upload `portfolio` hero and replace `public/` with `.../assets/:id/content?width=...` — tracked as follow-up, not blocking)
- [x] Fresh fork on second account succeeds per Task 11 guide without code edit (verified placeholders, `grep` 1)
- [x] `upload-dewek: pnpm lint 0 && tsc --noEmit 0 && pnpm test 80 passed (12 files)` green, `dashboard: npm run build` 0, `wrangler deploy --dry-run` placeholder (forkable), no DO/Queue/Wasm, $0 deploy `pnpm deploy --minify`

## Parallelization

- Safe to parallelize after Phase 1: Task 6 and Task 7 specs can be drafted while Task 4-5 implement (no code overlap), docs/portfolio screenshot after Task 8.
- Must be sequential: Task 4 → 5 (presign before confirm), Task 6 → 7 (list before serve uses same query), Task 9 → 10 (shell before wiring).

## Definition of Done (per task)

- `pnpm lint` 0 errors, `pnpm exec tsc --noEmit` 0 errors, `pnpm test` green (new tests added)
- `curl` or integration for every new endpoint against `wrangler dev --local`
- Bundle check `wrangler deploy --dry-run` logged, no `@aws-sdk/*`
- README/SPEC not lying: if task changes flow, update `docs/ideas/upload-dewek.md`/`SPEC.md` same PR
