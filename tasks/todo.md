# Todo: Upload Dewek — Solo Control Plane

> Source: `SPEC.md:1` + `docs/ideas/upload-dewek.md:1` + `tasks/plan.md:1`. Vertical slices, each leaves system working. Check off after verification.

## Phase 1: Foundation

- [ ] Task 1: Test harness + lint/type gate
  - Acceptance: `pnpm test` runs (even if 0 tests), `pnpm lint && pnpm exec tsc --noEmit` green, no new runtime deps except dev.
  - Verify: `pnpm test` ; `pnpm lint` ; `pnpm exec tsc --noEmit` ; `wrangler deploy --dry-run` bundle size logged.
  - Files: `package.json`, `vitest.config.ts`, `tsconfig.json`, `tests/**` stub
  - Dependencies: None
  - Scope: XS (1-2 files)

- [ ] Task 2: `assets` schema `folder` + `tags` + migration + seed
  - Acceptance: `assets` has `folder text`, `tags text (JSON string[])`, `idx_assets_project_id` kept + `idx_assets_project_status_created_at` kept + `folder` filterable via `LIKE`/`json_each`; `pnpm db:generate` creates migration, `pnpm db:migrate:local` applies; seeded `projects(id=portfolio, name=Portfolio, quotaBytes=1073741824)` + `project_usages(usedBytes=0)` + one `api_keys` hash for local.
  - Verify: `pnpm db:generate` ; `pnpm db:migrate:local --local` ; `SELECT * FROM assets` shows new cols ; `git status` migration added.
  - Files: `src/lib/db/schema/assets.ts`, `migrations/*.sql`, `drizzle.config.ts`, `scripts/seed.ts?`
  - Dependencies: Task 1
  - Scope: S (2-3 files)

## Checkpoint: Foundation
- [ ] `pnpm lint && tsc --noEmit && pnpm test` green
- [ ] Local D1 has `folder/tags` cols + seed, bundle <500kB

## Phase 2: Core Centralized Workflow

- [ ] Task 3: `POST /projects` + `GET /projects` CRUD
  - Acceptance: `POST /projects {name, quotaBytes?}` with `x-api-key` → 201 `{id,name,quotaBytes}` inserts `projects` + `project_usages(usedBytes=0)`; `GET /projects` → `[{id,name,quotaBytes,usedBytes}]` paginated; invalid body → 422 `ERR_VALIDATION`, no/invalid key → 401/403; duplicate name allowed (id is uuid).
  - Verify: `pnpm test` unit for service + integration `POST/GET /projects` via `wrangler dev --local` inject ; manual `curl -H x-api-key:...`.
  - Files: `src/lib/validation/projects.ts`, `src/lib/projects/service.ts`, `src/routes/projects.ts`, `src/index.ts` mount
  - Dependencies: Tasks 1,2
  - Scope: S (3-4 files)

- [ ] Task 4: Auth middleware + `POST /upload/init` with `folder/tags` presigned POST (`aws4fetch`)
  - Acceptance: `POST /upload/init {projectId,folder?,tags?,filename,mimeType,sizeBytes}` with valid `x-api-key` + existing `projectId` + `quotaBytes` check → 201 `{assetId,r2Key,url,fields,expiresAt}` where `r2Key=projects/<projectId>/<folder?>/<uuid>-<filename>` + `D1 assets.status='pending'` stored `folder/tags`; presigned via `aws4fetch` 15m scoped to key+type, no `@aws-sdk/*` in bundle; quota exceeded → 413; bad mime/size/folder/tags → 422.
  - Verify: `pnpm test` (presign vector + quota + folder sanitize) ; `wrangler dev --local` + `fetch(url,{method:'POST',body:FormData})` to R2 succeeds ; `wrangler deploy --dry-run` bundle <1MB.
  - Files: `src/lib/auth/middleware.ts`, `src/lib/r2/presign.ts`, `src/lib/assets/service.ts`, `src/routes/uploads.ts`, `package.json` (+ `aws4fetch`)
  - Dependencies: Task 3
  - Scope: M (4-5 files)

- [ ] Task 5: `POST /upload/confirm` R2 HEAD + conditional UPDATE → validated + links
  - Acceptance: `POST /upload/confirm {assetId}` with valid key → does `R2 HEAD r2Key` (via `ASSETS.head` or fetch) → if 404 → 404 `ERR_NOT_FOUND`, else `UPDATE assets SET status='validated', sizeBytes=real, validatedAt=now WHERE id=? AND status='pending'` → if 0 rows → 409 `ERR_CONFLICT` (already confirmed), else 200 `{asset, url: "/assets/:id/content", variants: ["?width=800&format=webp", ...]}` + increments `project_usages.usedBytes`; concurrent second confirm → 409.
  - Verify: `pnpm test` (mock R2 head) + integration `init → R2 POST → confirm` with real local R2 ; double `confirm` integration asserts 409 ; `wrangler tail` shows no body read.
  - Files: `src/routes/uploads.ts` (confirm handler), `src/lib/assets/service.ts`, `src/lib/r2/verify.ts`
  - Dependencies: Task 4
  - Scope: M (3-4 files)

## Checkpoint: Core Upload
- [ ] Full `curl` happy path local green + race/invalid tests ; bundle/CPU lean

## Phase 3: Organization & Delivery

- [ ] Task 6: `GET /assets?projectId&folder&tag&q&cursor&limit` filtered pagination
  - Acceptance: `GET /assets?projectId=portfolio&folder=blog/hero&tag=dark&q=cover&limit=20&cursor=` → 200 `{items: Asset[], meta:{hasNextPage,cursor}}` filtered by exact `folder`, `tags LIKE '%"dark"%'`, `q` on `filename`/`folder` `LIKE`, paginated via `createdAt` cursor, indexed query; invalid `projectId` → 404 if project not found or empty list; requires `x-api-key`.
  - Verify: `pnpm test` (filter combinator + cursor) ; integration with 5 seeded assets asserts filter correctness.
  - Files: `src/routes/assets.ts`, `src/lib/assets/query.ts`
  - Dependencies: Task 5
  - Scope: M (3-4 files)

- [ ] Task 7: `GET /assets/:id/content?width=&format=&quality=` Images transform serve
  - Acceptance: `GET /assets/:id/content?width=800&format=webp&quality=80` with valid key (or public? decide private v1) → if `status!='validated'` → 404, else `R2.get(r2Key)` + pipe through `IMAGES` transform (`width/format/quality` validated via zod, clamp) → 200 with `Content-Type` + `Cache-Control: public, max-age=31536000, immutable` ; second hit cached; invalid transform → 422.
  - Verify: `pnpm test` (param validation) ; integration with local R2 object asserts 200 + transform header ; manual image preview in browser.
  - Files: `src/routes/assets.ts` (serve), `src/lib/validation/assets.ts`
  - Dependencies: Task 6
  - Scope: M (3-4 files)

- [ ] Task 8: `DELETE /assets/:id` soft `rejected` + R2 delete
  - Acceptance: `DELETE /assets/:id` with valid key → `UPDATE assets SET status='rejected' WHERE id=? AND status!='rejected'` → `R2.delete(r2Key)` (best-effort) → decrements `project_usages.usedBytes` by `sizeBytes` → 204; already `rejected` → 404; then `GET /assets/:id/content` → 404.
  - Verify: `pnpm test` + integration `confirm → delete → get 404 → list excludes rejected`.
  - Files: `src/routes/assets.ts`, `src/lib/assets/service.ts`
  - Dependencies: Task 7
  - Scope: S (2-3 files)

## Checkpoint: Organization & Delivery
- [ ] Filter `folder/tag/q` + pagination + serve with transforms + delete all integration green

## Phase 4: Dashboard (portfolio-cloudflare)

- [ ] Task 9: Dashboard shell + project switcher + list consumption
  - Acceptance: In `portfolio-cloudflare`, route `/dashboard/assets` shows project switcher (fetches `GET /projects`), folder/tag filter chips + search `q`, calls `GET /assets?projectId&folder&tag&q` with `x-api-key` from env, grid preview via `GET /assets/:id/content?width=400&format=webp`, status badge, empty/loading/error states; no upload yet.
  - Verify: `pnpm dev` in portfolio, manual: switch project → list filters correctly.
  - Files: `portfolio-cloudflare/src/app/dashboard/assets/page.tsx`, `lib/upload-dewek-client.ts`
  - Dependencies: Tasks 6,7 (API must be deployed or local)
  - Scope: M (3-5 files)

- [ ] Task 10: Dropzone wiring + copy link + quota bar + dogfood migration
  - Acceptance: Dropzone: select `projectId` + `folder` input + `tags` input + file → calls `POST /upload/init` → `fetch(url,{method:'POST',body:FormData(fields+file)})` direct to R2 (no Worker proxy) → `POST /upload/confirm` → toast + grid refresh with new asset showing `folder/tags`; per-card Copy buttons for `canonical` + `...?width=800&format=webp&quality=80` (one click); quota bar `usedBytes/quotaBytes` from `GET /projects`; actually migrate `portfolio-cloudflare/public/hero.jpg` via this flow and render via `.../assets/:id/content?width=1200&format=webp` in portfolio.
  - Verify: manual: full workflow without opening R2 console ; copy link pasted in `<img src>` renders transformed ; quota bar updates after upload/delete ; `pnpm test` for client helper.
  - Files: `portfolio-cloudflare/src/app/dashboard/assets/*`, `components/dropzone.tsx`, `portfolio-cloudflare/src/projects/upload-dewek/index.mdx` screenshot update
  - Dependencies: Task 9, Task 5
  - Scope: M (4-5 files)

## Checkpoint: Complete
- [ ] Dashboard full workflow without R2 console, project centralized, folder/tag organization works, optimized links copy-paste usable
- [ ] Portfolio hero migrated via control plane, `SPEC.md:172` success criteria all checked
- [ ] Both repos `pnpm lint && tsc --noEmit && pnpm test` green, `wrangler deploy --dry-run` <1MB, no DO/Queue/Wasm, $0 deploy `pnpm deploy --minify`

## Parallelization

- Safe to parallelize after Phase 1: Task 6 and Task 7 specs can be drafted while Task 4-5 implement (no code overlap), docs/portfolio screenshot after Task 8.
- Must be sequential: Task 4 → 5 (presign before confirm), Task 6 → 7 (list before serve uses same query), Task 9 → 10 (shell before wiring).

## Definition of Done (per task)

- `pnpm lint` 0 errors, `pnpm exec tsc --noEmit` 0 errors, `pnpm test` green (new tests added)
- `curl` or integration for every new endpoint against `wrangler dev --local`
- Bundle check `wrangler deploy --dry-run` logged, no `@aws-sdk/*`
- README/SPEC not lying: if task changes flow, update `docs/ideas/upload-dewek.md`/`SPEC.md` same PR
