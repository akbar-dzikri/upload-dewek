```txt
npm install
npm run dev
```

```txt
npm run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>();
```

## Drizzle + D1

Generate SQL migrations from `src/lib/db/schema/*`:

```txt
pnpm db:generate
```

Apply migrations (pass your D1 database name or ID):

```txt
pnpm db:migrate:local <DB_NAME_OR_ID>
```
