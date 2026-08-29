# Implementation Plan: Upload Dewek — Solo Control Plane (Lean from Scratch)

## Overview

Build the lean DAM you defined: `create project → folder/tag → presigned POST direct to R2 (zero-compute) → confirm HEAD+UPDATE → get links (?width=&format=&quality=) → use` — centralized one-plane for all your projects, single `x-api-key`, dashboard in `portfolio-cloudflare`. YAGNI: `aws4fetch` 11kB, D1 conditional `UPDATE ... WHERE pending` not DO, flat `folder` string + `tags: string[]` JSON (no hierarchy/join), $0/128MB/10ms/0 users hard constraints. Source of truth: `SPEC.md:1` + `docs/ideas/upload-dewek.md:1`. Demo-safe + dogfoods portfolio.

## Architecture Decisions

- **Presigned POST via `aws4fetch` over `@aws-sdk/signature-v4`** (`SPEC.md:32`): 11kB vs 300kB, stays <1MB bundle and <10ms CPU per `wrangler deploy --dry-run`.
- **R2 HEAD + conditional `UPDATE ... WHERE status='pending'` over Durable Object** (`SPEC.md:13`): `UNIQUE(r2Key)` + `WHERE pending` is atomic for 0-1000 concurrent confirms, no Paid DO needed → keeps $0.
- **Flat `folder?: string` + `tags?: string[]` JSON on `assets` over `tags` table** (`SPEC.md:84`): 1 column + 1 JSON field, `LIKE`/`json_each` filter covers 90% of "gaperlu bingung" organization. No join, no nested permissions until >200 assets.
- **Single-tenant Solo Control Plane** (`docs/ideas/upload-dewek.md:11`): one `x-api-key` (hash in `api_keys`) scoped to all `projects`; dashboard filters by `?projectId=` rather than per-project key self-serve. Keeps MVP 1 week, B deferred.
- **Dashboard in `portfolio-cloudflare` not new app**: Next.js/OpenNext route `/dashboard/assets` consumes Workers API. One deploy for dogfooding, one story for hiring, no extra worker for UI.
- **Vertical slicing over horizontal**: each task delivers `schema + validation + endpoint + test (+ dashboard piece)` end-to-end, leaves system working after each slice.

## Dependency Graph

```
D1 schema (projects/api_keys/assets+folder/tags, migrations)
  ├── auth middleware (x-api-key hash)
  │     │
  │     ├── POST /projects (create project) ──→ dashboard project switcher
  │     │        │
  │     │        └── POST /upload/init (presign + D1 pending) ──→ R2 HEAD helper
  │     │                     │
  │     │                     └── POST /upload/confirm (HEAD+UPDATE→validated)
  │     │                              │
  │     │                              ├── GET /assets?projectId&folder&tag&q (filter/pagination)
  │     │                              │        │
  │     │                              │        └── dashboard grid+filter+copy-links
  │     │                              │
  │     │                              └── GET /assets/:id/content?width=&format=&quality= (IMAGES)
  │     │                                       └── DELETE /assets/:id
  │     │
  │     └── kv/imagery bindings unchanged (CACHE/IMAGES passthrough)
  │
  └── test harness (vitest + vitest-pool-workers, drizzle local)
```

Build bottom-up; each vertical after auth can be tested via `curl` + `vitest` + `wrangler dev --local`.

## Task List

### Phase 1: Foundation — makes everything else possible

- [ ] Task 1: Test harness + lint/type gate (XS)
- [ ] Task 2: `assets` schema `folder` + `tags` + migration + seed (S)

### Checkpoint: Foundation
- [ ] `pnpm lint && pnpm exec tsc --noEmit && pnpm test` green on empty harness
- [ ] `pnpm db:generate && pnpm db:migrate:local` applies, `assets` has `folder`/`tags` + indices, seeded `project=portfolio`
- [ ] `wrangler deploy --dry-run` bundle <500kB, no `@aws-sdk/*`

### Phase 2: Core Centralized Workflow — `create project → upload → confirm`

- [ ] Task 3: `POST /projects` + `GET /projects` CRUD (S) — enables "gaperlu bingung naro assets dimana"
- [ ] Task 4: Auth middleware `x-api-key` + `POST /upload/init` with `folder/tags` presigned POST (M)
- [ ] Task 5: `POST /upload/confirm` R2 HEAD + conditional UPDATE → validated + links (M)

### Checkpoint: Core Upload
- [ ] `curl` happy path: `POST /projects → POST /upload/init → POST FormData direct to R2 → POST /upload/confirm → 200 validated variants` works against `wrangler dev --local` with real R2 HEAD, no Worker body read, <10ms per init
- [ ] Race: double confirm second → 409 `ERR_CONFLICT`, `HEAD` miss → 404, invalid key → 401/403, bad body → 422 with `issues[]`
- [ ] Bundle + CPU still lean, `wrangler tail` proves zero-compute (no `request.arrayBuffer()`)

### Phase 3: Organization & Delivery — `folder/tag` + optimized serve

- [ ] Task 6: `GET /assets?projectId&folder&tag&q&cursor&limit` filtered pagination (M)
- [ ] Task 7: `GET /assets/:id/content?width=&format=&quality=` Images transform serve (M)
- [ ] Task 8: `DELETE /assets/:id` soft `rejected` + `R2.delete` (S)

### Checkpoint: Organization & Delivery
- [ ] Filter: `?folder=blog/hero&tag=dark&q=cover` returns correct slice, cursor pagination stable
- [ ] Serve: `?width=800&format=webp&quality=80` returns image with `IMAGES` applied, cache hit on second, 404 for `rejected`
- [ ] All Phase 2-3 routes covered by unit + integration (`init→confirm→list→serve→delete`) against local D1/R2

### Phase 4: Dashboard — makes it demo-safe & dogfoodable (in `portfolio-cloudflare`)

- [ ] Task 9: Dashboard shell + project switcher + list consumption (M)
- [ ] Task 10: Dropzone `init → R2 POST → confirm` wiring + folder/tag inputs + copy optimized link + quota bar + dogfood migration (M)

### Checkpoint: Complete
- [ ] Dashboard at `/dashboard/assets` does full workflow without opening R2 console: create project → pick folder/tags → drop → confirm → grid filtered → copy `...?width=800&format=webp` → paste in portfolio code
- [ ] `portfolio-cloudflare/public` hero migrated to `projectId=portfolio` via this flow, `GET /assets?projectId=portfolio` returns it
- [ ] `pnpm lint && tsc --noEmit && pnpm test` green in both repos, `SPEC.md:172` success criteria all checked, `portfolio-cloudflare/src/projects/upload-dewek/index.mdx:122` screenshot updated, deployable via `pnpm deploy --minify` on $0

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `aws4fetch` presign wrong / R2 rejects POST | High — blocks entire upload path | Add Task 4 unit test vector against real R2 local, keep `@aws-sdk/*` out of bundle; verify with `wrangler dev --local` + raw `fetch` FormData before dashboard |
| `tags` JSON filter perf / `LIKE` brittle at >200 assets | Med — organization search degrades | Keep `tags` as JSON array + simple `LIKE '%"dark"%'` v1; add `idx_assets_project_status_created_at` + `folder` index; defer `tags` table/join until measured pain (explicit Not Doing) |
| Cloudflare Images free limit hit ($0 breaks) | Med — `?width=&format=` starts 402 | Fallback: serve raw R2 without `IMAGES` (still cache), measure via `dash.cloudflare.com` after 100 transforms; document limit in README |
| R2 `r2Key` collision across projects | Low — data loss/confusion | Enforce `r2Key=projects/<projectId>/<folder?>/<uuid>-<filename>` + `UNIQUE(r2Key)` + `folder` not part of key uniqueness; tested in Task 4 |
| Dashboard built before API stable (theatre demo) | High — fake demo | Strict vertical order: Tasks 3-8 must pass `curl` integration before Task 9 starts (checkpoint gate) |
| `wrangler dev --local` vs remote R2 drift (HEAD semantics) | Low — confirm passes local but fails remote | Integration tests run both `--local` and single real R2 head check in `confirm` handler mocked via `head` stub; manual `wrangler tail` on remote once per phase |

## Open Questions

- Dashboard route final: `/dashboard/assets` vs `/assets-control-plane`? — defer to Task 9 start.
- `folder` validation: free-form `string` up to 80 chars `a-z0-9/_-` or any? Propose strict `^[a-z0-9/_-]{0,80}$` to keep `r2Key` safe.
- `tags` limit: max 5 tags, each 20 chars alphanum? Propose limit at `zValidator` to keep JSON small.
- Public serve: private `x-api-key` required for `GET /assets/:id/content` or public via signed `?token=`? Phase 3 Task 7 will propose private first, signed later if portfolio `<img>` needs it.
- Quota UX: hard reject 413 at `init` vs warning — hard reject v1 (clear demo), revisit if portfolio hits 1GB.
