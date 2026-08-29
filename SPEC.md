# Spec: Upload Dewek — Edge-Native DAM (Lean from Scratch)

> No V1 baggage. Fresh spec under real constraints. Idea unchanged: serverless headless DAM on Cloudflare edge, zero-compute ingestion.

## Objective

**What:** Headless Digital Asset Management API that runs entirely on Cloudflare edge — no servers, no proxying of bytes, no background workers.

**Workflow you want (centralized, no more "gaperlu bingung naro assets dimana"):**
Whenever you start a new project: `create project di upload dewek` → optional `folder/tag` for organization → `upload media` → `get links` → `use` in that project's code. Everything in one control plane.

**Core flow (Zero-Compute Ingestion):**
0. `POST /projects {name,quotaBytes?}` -> create `projects` + `project_usages` ( централизован place per your agency/portfolio/n8n projects)
1. `POST /upload/init {projectId,folder?,tags?,filename,mimeType,sizeBytes}` -> Worker validates, inserts `assets(status=pending, folder, tags JSON, r2Key=projects/<projectId>/<folder?>/<uuid>-<filename>)` in D1, returns **S3-compatible presigned POST** (URL + fields) scoped to `r2Key` + `content-type`, 15m expiry.
2. Client `POST`s binary **directly to R2** — payload never passes through Worker memory.
3. `POST /upload/confirm {assetId}` -> Worker does `R2 HEAD r2Key` (exists?) then `UPDATE assets SET status='validated' WHERE id=? AND status='pending'` (atomic, no DO) → returns canonical + optimized `?width=&format=&quality=` links.
4. `GET /assets?projectId=&folder=&tag=&q=` -> filtered list (centralized management) + `GET /assets/:id/content?width=&format=&quality=` -> serve from R2 (Cache) + **Cloudflare Images** transforms at CDN, zero Worker compute → copy link → use.

**Why:** Classic anti-pattern is proxying uploads through app server -> OOM on edge, egress cost, bandwidth limits.

**Constraints (hard):**
- 128MB RAM edge isolate, 10ms CPU time
- $0 infra — too poor for Workers Paid subscription (=> no Durable Objects, no Queues)
- 0 active users — YAGNI/KISS: ship less code, deliver business value, add complexity only after proven contention/scale

**Users:** Phase 0: you (portfolio demo). Phase 1: API consumers authenticated via `api_keys` per `projects` (multi-tenant ready, but not enforced beyond key check + quota until needed).

**V1 scrapped:** distributed Message Queues, isolated background workers, custom Wasm modules — whiteboard `v1` -> `simplified` per LinkedIn.

## Tech Stack

- **Runtime:** Cloudflare Workers (workerd), `compatibility_date: 2026-03-01`
- **Framework:** Hono `^4.12.3` + `@hono/zod-validator ^0.7.6`
- **Lang:** TypeScript `^5.9.3` strict, `module: ESNext`, `target: ESNext`
- **DB:** Cloudflare D1 (SQLite) + `drizzle-orm ^0.45.1` + `drizzle-kit ^0.31.9` + `drizzle-zod ^0.8.3`
- **Storage:** Cloudflare R2 (S3 API) via `ASSETS` binding; presign via `aws4fetch` (~11kB, not `@aws-sdk/*` ~300kB)
- **Cache:** KV `CACHE` (optional metadata cache, not required v1)
- **Images:** Workers `IMAGES` binding -> Cloudflare Images transforms
- **Validation:** `zod ^4.3.6`
- **Tooling:** `wrangler ^4.4.0`, `eslint ^9.37`, `prettier ^3.8.1`

## Commands

```bash
Build:      pnpm lint && pnpm exec tsc --noEmit
Dev:        pnpm dev                          # wrangler dev (remote D1/R2)
Dev local:  pnpm dev:local                    # wrangler dev --config wrangler.local.jsonc --local
Deploy:     pnpm deploy                       # wrangler deploy --minify
Types:      pnpm cf-typegen                   # wrangler types --env-interface CloudflareBindings -> worker-configuration.d.ts
DB gen:     pnpm db:generate                  # drizzle-kit generate
DB migrate: pnpm db:migrate:local --local    # wrangler d1 migrations apply --local
            pnpm db:migrate <DB_NAME>        # remote
Lint:       pnpm lint                         # eslint .
Lint fix:   pnpm lint:fix
Format:     pnpm format
Test:       pnpm test                         # vitest (to be added, see Testing Strategy)
```

Env: `WORKER_NAME, DB_ID/DB_NAME, CACHE_KV_ID, ASSETS_R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY` via `wrangler.jsonc` vars + `.dev.vars`.

## Project Structure

```
upload-dewek/
├── SPEC.md                     # this spec (source of truth)
├── tasks/
│   ├── plan.md                 # plan (Phase 2 output)
│   └── todo.md                 # task list
├── src/
│   ├── index.ts                # Hono app, route mounting (GET / health)
│   └── lib/
│       ├── core/
│       │   ├── errors.ts       # AppError + ERROR_REGISTRY (400/401/403/404/409/422/429/500)
│       │   └── types.ts        # ValidationIssue, shared types
│       ├── http/
│       │   ├── api-response.ts # successResponse/createdResponse/paginatedResponse (JSend)
│       │   └── error-mapper.ts # toApiError (AppError -> JSON)
│       ├── validation/
│       │   └── zod-validation.ts # zValidator wrapper (422 + issues)
│       ├── db/
│       │   ├── client.ts       # createDb(D1Database)
│       │   └── schema/
│       │       ├── projects.ts # projects(id,name,quotaBytes) + project_usages(projectId,usedBytes)
│       │       ├── api-keys.ts # api_keys(id,projectId,keyHash)
│       │       └── assets.ts   # assets(id,projectId,r2Key UNIQUE,filename,mimeType,sizeBytes,status[pending|validated|rejected],folder?,tags JSON,createdAt,validatedAt) + idx(projectId,status,createdAt)
│       ├── auth/               # (planned) api-key middleware: hash compare, load project
│       ├── r2/                 # (planned) presign helper (aws4fetch) + HEAD verify
│       └── assets/             # (planned) service: init/confirm/serve
├── migrations/                 # drizzle 0000_*.sql
├── wrangler.jsonc              # DB, CACHE(KV), ASSETS(R2), IMAGES bindings
├── drizzle.config.ts
├── tsconfig.json
└── package.json
Tests: `tests/` (unit) + `e2e/` (wrangler dev) colocated or `src/**/*.test.ts`
```

## Code Style

**Principles:** KISS, explicit errors, no magic. One snippet > paragraphs.

```typescript
// src/lib/core/errors.ts — registry + AppError
export const ERROR_REGISTRY = { 404:{message:'Not found',code:'ERR_NOT_FOUND'}, 422:{...} } as const;
export class AppError<TErrors=null> extends Error {
  constructor(opts:{message:string;code:ErrorCode;statusCode:ContentfulStatusCode;errors?:TErrors;expose?:boolean}){...}
}

// src/lib/http/api-response.ts — JSend
export const successResponse = <T>(c:Context,data:T,code=200)=> c.json({status:'success',data},code);

// Route: validation -> service -> response, never swallows errors
app.post('/upload/init',
  zValidator('json', initSchema), // throws AppError 422 with ValidationIssue[]
  async (c)=>{
    const {projectId} = c.get('auth'); // from api-key middleware
    const asset = await initAsset(c.env.DB, projectId, c.req.valid('json'));
    const presigned = await createPresignedPost(c.env, asset.r2Key, asset.mimeType);
    return successResponse(c, presigned, 201);
  }
);
app.onError((e,c)=> c.json(toApiError(e).body, toApiError(e).statusCode));
```

**Conventions:**
- `kebab-case` files, `camelCase` vars, `PascalCase` types, `SCREAMING_SNAKE` constants
- All inputs via `zod` + `zValidator`; map `ZodIssue` -> `ValidationIssue{field,message}`
- Errors always `throw new AppError(...)` with `expose:true` for 4xx, let mapper handle 500 fallback; no `errorResponse()` helper
- `drizzle-orm` only, no raw `D1.prepare` outside `client.ts` wrapper
- Presign: `aws4fetch` `AwsClient.sign(...,{aws:{signQuery:true}})`, 15m expiry, never bundle `@aws-sdk/*`
- Never read binary into Worker: `R2 HEAD` to verify, `R2 get` only for serve path with streaming if needed

## Testing Strategy

**Framework:** `vitest` (unit) + `wrangler` local bindings for integration (D1 local, R2 local via `miniflare`). No Playwright (API only).

**Locations:**
- `src/**/*.test.ts` unit (error-mapper, r2 presign, auth hash)
- `tests/integration/*` or `e2e/` for `POST /upload/init -> R2 POST -> POST /upload/confirm` happy path against `wrangler dev --local`

**Coverage:** Start  `>70%` on `lib/*`; require tests for every new route (init/confirm/serve). `pnpm test` must pass before commit (see Boundaries).

**Levels:**
- Unit: `toApiError`, `zValidator`, `createPresignedPost` signature shape, `assets` service logic (mock D1)
- Integration: full init->upload->confirm flow with local D1/R2; auth middleware 401/403; race: double confirm -> second is 409
- Manual: `curl` + `wrangler tail` for 10ms/128MB check, R2 console object existence

**To add this sprint:** `pnpm add -D vitest @cloudflare/vitest-pool-workers` + `vitest.config.ts`.

## Boundaries

- **Always do:**
  - Run `pnpm lint && pnpm exec tsc --noEmit && pnpm test` before commit/push
  - Validate all `json/query/param` with `zod`; return `422 ERR_VALIDATION` with `issues[]`
  - Use `AppError` + `toApiError` for all error paths; JSend `{status:'success'|'error',...}`
  - Presign via `aws4fetch`, never load full AWS SDK into Worker
  - Verify upload via `R2 HEAD`, conditional `UPDATE ... WHERE status='pending'` (no DO)
  - Scope presigned URL to exact `r2Key + contentType`, 15m expiry

- **Ask first:**
  - Adding any `dependencies` (especially that touches bundle/CPU): `aws4fetch` already approved, next would be `nanoid`/`uuid` etc.
  - `drizzle` schema/migration changes (`projects.ts`/`assets.ts`/`api-keys.ts`)
  - Changes to `wrangler.jsonc` bindings/env (`--config wrangler.local.jsonc`)
  - Introducing KV cache strategy, rate limiting (429), or `IMAGES` transform options
  - Changing CI/deploy steps or `compatibility_date`

- **Never do:**
  - Commit secrets (`.dev.vars`, `R2_SECRET_ACCESS_KEY`, `DB_ID`) — `.gitignore` + `.dev.vars.example` only
  - Proxy binary payloads through Worker memory (must use presigned POST direct-to-R2)
  - Add `Durable Objects`, `Queues`, `Workflows`, or custom `Wasm` for image processing without explicit approval — violates $0/YAGNI
  - Use `@aws-sdk/signature-v4` or other heavy SDK in Worker
  - Edit `migrations/*.sql` by hand; regenerate via `pnpm db:generate`
  - Remove/skip failing tests or `any`-cast to silence `tsc`

## Success Criteria

**Shippable v1 lean (testable, demo-able on free tier):**
- [ ] `GET /` -> 200 `{status:'success', data:{message:'Upload Dewek API is running'}}` and `GET /nope` -> 404 `ERR_NOT_FOUND` via `toApiError`
- [ ] `POST /projects {name}` with `x-api-key` -> 201 `{id,name}` and `GET /projects` lists; cements "gaperlu bingung" — every new project gets a `projectId` for centralization
- [ ] `POST /upload/init` with `x-api-key: <valid>` + JSON `{filename,mimeType,sizeBytes,projectId,folder?,tags?}` -> 201 `{url, fields, assetId, r2Key, expiresAt}` and `D1 assets.status='pending'` with `r2Key=projects/<projectId>/<folder?>/<uuid>-<filename>`; without/invalid key -> 401/403; invalid body -> 422 with `issues[]`
- [ ] Client can `POST` binary to returned `url`+`fields` directly to R2 without Worker touching bytes (verified by `wrangler tail` no `request.body` read, R2 object appears, Worker memory <128MB, CPU <10ms per `wrangler dev` log)
- [ ] `POST /upload/confirm {assetId}` -> Worker `R2 HEAD` succeeds then `UPDATE ... WHERE status='pending'` flips to `validated` -> 200 `{url, variants:["?width=800&format=webp",...]}`; second concurrent confirm -> 409 `ERR_CONFLICT`; `HEAD` 404 -> 404 `ERR_NOT_FOUND`
- [ ] `GET /assets?projectId=&folder=&tag=&q=&cursor=&limit=` with valid key -> 200 filtered/paginated by `folder`/`tags`/`q` (`LIKE`/JSON) + `GET /assets/:id/content?width=400&format=webp&quality=80` with valid key -> 200 stream from R2 with `IMAGES` transform (or 302), cache-hit on second request; quoted `quotaBytes` enforced if `project_usages.usedBytes + sizeBytes > quotaBytes` -> 429/413
- [ ] All routes: `pnpm lint` 0 errors, `tsc --noEmit` 0 errors, `pnpm test` green (unit + `init->upload->confirm` integration against local D1/R2 + `folder/tag` filter tests), bundle < 1MB (`wrangler deploy --dry-run` size), no `@aws-sdk/*` in bundle
- [ ] `README` + portfolio `index.mdx` accurately reflect built flow (no DO/queue/Wasm claims) and workflow `create project → folder/tag → upload → get link → use`
- [ ] No paid bindings: `wrangler.jsonc` stays `DB/CACHE/ASSETS/IMAGES` only; deployable via `pnpm deploy --minify` on $0 account

**Portfolio link stays honest:** each criterion maps to a `src/lib/...` file + test, not aspirational.

## Open Questions

- **Auth scope v1:** `x-api-key` per `projects.id` is enough? Or need `Authorization: Bearer <jwt>` for portfolio demo? Propose `x-api-key` only for YAGNI (single key + `?projectId=` filter covers centralized workflow).
- **Mime/size defaults:** allow `image/jpeg|png|webp|avif|gif, video/mp4` as in `assets.ts:17`, max 10MB image / 100MB video? Or 5MB for free-tier demo? Propose 10/100, enforce at `init`.
- **ID generation:** `nanoid` vs `crypto.randomUUID` — need decision (affects bundle/CPU). Propose `crypto.randomUUID` (native, 0 deps).
- **Quota:** enforce `projects.quotaBytes` vs just record `project_usages`? Propose enforce at `init` (409 if exceeded).
- **Visibility:** `GET /assets` listing: needed for portfolio demo or just `GET /assets/:id`? Propose `GET /assets?projectId&folder&tag&q` required for centralized "gaperlu bingung" — filter is the point.
- **Folder/tags v1 shape:** `folder?: string` (e.g. `blog/hero`) + `tags?: string[]` flat JSON with `LIKE`/JSON filter enough? Or need `tags` table + join? Propose JSON `tags` + `folder` column for v1 (no join until >200 assets).
