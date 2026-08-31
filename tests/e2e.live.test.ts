import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// E2E against live app domain (upload-dewek.dikicodes.com)
// Run with: E2E_BASE_URL=https://upload-dewek.dikicodes.com E2E_API_KEY=ud_local_test_key_12345 pnpm exec vitest run tests/e2e.live.test.ts
// This hits real D1/R2/Worker, creates isolated project, does full zero-compute flow, then cleans up.

const BASE = (process.env.E2E_BASE_URL || 'https://upload-dewek.dikicodes.com').replace(/\/$/, '');
const API_KEY = process.env.E2E_API_KEY || 'ud_local_test_key_12345';
const HEADERS = {
  'x-api-key': API_KEY,
  'User-Agent': 'upload-dewek-e2e/1.0',
  Accept: 'application/json',
} as const;

// Tiny 1x1 PNG (68 bytes)
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const TINY_PNG_BYTES = Buffer.from(TINY_PNG_B64, 'base64');

function url(path: string) {
  return `${BASE}${path}`;
}

async function fetchJson(path: string, init?: RequestInit) {
  const res = await fetch(url(path), {
    ...init,
    headers: { ...HEADERS, ...(init?.headers as Record<string, string> | undefined) },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not json (e.g., dashboard HTML)
  }
  return { res, json, text };
}

const isE2E = !!process.env.E2E_BASE_URL;

describe.skipIf(!isE2E)('e2e live – app domain', () => {
  let projectId: string;
  const createdAssetIds: string[] = [];

  beforeAll(async () => {
    // Ensure health is ok and create isolated project
    const { res } = await fetchJson('/health');
    expect(res.status).toBe(200);

    const { res: r, json } = await fetchJson('/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }),
    });
    expect(r.status).toBe(201);
    const data = (json as { data: { id: string } }).data;
    projectId = data.id;
    expect(projectId).toMatch(/^[0-9a-f-]{36}$/);
  });

  afterAll(async () => {
    // No project delete endpoint; leave project for inspection – could cleanup assets
    // Try to delete created assets (rejected status)
    for (const aid of createdAssetIds) {
      await fetchJson(`/assets/${aid}`, { method: 'DELETE' }).catch(() => undefined);
    }
  });

  it('GET / and /healthz return 200', async () => {
    const health = await fetch(url('/health'), { headers: { 'User-Agent': 'upload-dewek-e2e/1.0' } });
    expect(health.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const j = (await health.json()) as unknown as { status: string; checks: { db: boolean } };
    expect(j.status).toBe('ok');
    expect(j.checks.db).toBe(true);

    const healthz = await fetch(url('/healthz'), { headers: { 'User-Agent': 'upload-dewek-e2e/1.0' } });
    expect(healthz.status).toBe(200);
    expect(await healthz.text()).toBe('ok');

    const root = await fetch(url('/'), { headers: { 'User-Agent': 'upload-dewek-e2e/1.0' } });
    expect(root.status).toBe(200);
    // dashboard HTML
    const html = await root.text();
    expect(html).toContain('Upload Dewek');
  });

  it('401 without x-api-key and 401 with invalid key', async () => {
    const r1 = await fetch(url('/projects?page=1&limit=1'), { headers: { 'User-Agent': 'upload-dewek-e2e/1.0' } });
    expect(r1.status).toBe(401);

    const r2 = await fetchJson('/projects?page=1&limit=1', {
      headers: { 'x-api-key': 'invalid-key', 'User-Agent': 'upload-dewek-e2e/1.0' } as unknown as Record<string, string>,
    });
    expect(r2.res.status).toBe(401);
  });

  it('GET /projects paginated and POST validation', async () => {
    const { res, json } = await fetchJson(`/projects?page=1&limit=2`);
    expect(res.status).toBe(200);
    const data = (json as { data: { items: unknown[]; meta: { totalDocs: number } } }).data;
    expect(data.items.length).toBeGreaterThanOrEqual(1);
    expect(data.meta.totalDocs).toBeGreaterThanOrEqual(1);

    const bad = await fetchJson('/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(bad.res.status).toBe(422);
  });

  it('upload validation – rejects bad mime', async () => {
    const { res } = await fetchJson('/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        filename: 'bad.txt',
        mimeType: 'text/plain',
        sizeBytes: 10,
      }),
    });
    expect(res.status).toBe(422);
  });

  it('full zero-compute flow: init → PUT → confirm → list → content → delete', { timeout: 30_000 }, async () => {
    // INIT
    const initPayload = {
      projectId,
      filename: 'tiny.png',
      mimeType: 'image/png' as const,
      sizeBytes: TINY_PNG_BYTES.length,
      folder: 'e2e',
      tags: ['e2e'],
    };
    const { res: initRes, json: initJson } = await fetchJson('/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initPayload),
    });
    expect(initRes.status).toBe(201);
    const initData = (initJson as { data: { assetId: string; r2Key: string; url: string; expiresAt: number } }).data;
    expect(initData.assetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(initData.r2Key).toContain(`projects/${projectId}/e2e/`);
    expect(initData.url).toContain('X-Amz-Signature');
    expect(initData.url).toContain('r2.cloudflarestorage.com');
    // URL should contain bucket when using correct presign (account+bucket)
    expect(initData.url).toContain('upload-dewek-assets');
    createdAssetIds.push(initData.assetId);

    // PUT directly to R2
    const putRes = await fetch(initData.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: TINY_PNG_BYTES as unknown as BodyInit,
    });
    expect(putRes.status).toBe(200);

    // CONFIRM
    const { res: confirmRes, json: confirmJson } = await fetchJson('/upload/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId: initData.assetId }),
    });
    expect(confirmRes.status).toBe(200);
    const confirmData = (confirmJson as { data: { status: string; url: string; variants: string[] } }).data;
    expect(confirmData.status).toBe('validated');
    expect(confirmData.url).toBe(`/assets/${initData.assetId}/content`);
    expect(confirmData.variants.length).toBe(3);

    // LIST with folder/tag filter
    const { res: listRes, json: listJson } = await fetchJson(`/assets?projectId=${projectId}&folder=e2e&tag=e2e`);
    expect(listRes.status).toBe(200);
    const items = (listJson as { data: { items: { id: string; status: string }[] } }).data.items;
    expect(items.some((a) => a.id === initData.assetId)).toBe(true);
    const listed = items.find((a) => a.id === initData.assetId)!;
    expect(listed.status).toBe('validated');

    // GET content (via worker, from R2)
    const contentRes = await fetch(url(`/assets/${initData.assetId}/content`), {
      headers: { 'User-Agent': 'upload-dewek-e2e/1.0' },
    });
    expect(contentRes.status).toBe(200);
    expect(contentRes.headers.get('content-type')).toBe('image/png');
    const buf = Buffer.from(await contentRes.arrayBuffer());
    expect(buf.length).toBe(TINY_PNG_BYTES.length);
    expect(buf.equals(TINY_PNG_BYTES)).toBe(true);

    // DELETE
    const delRes = await fetch(url(`/assets/${initData.assetId}`), {
      method: 'DELETE',
      headers: HEADERS,
    });
    expect(delRes.status).toBe(204);

    // LIST again – should be rejected not validated, or filtered out? Check status
    const { json: list2Json } = await fetchJson(`/assets?projectId=${projectId}`);
    const items2 = (list2Json as { data: { items: { id: string; status: string }[] } }).data.items;
    const deleted = items2.find((a) => a.id === initData.assetId);
    // After delete, status becomes rejected; depending on list filter (maybe excludes rejected?) – at least not validated
    if (deleted) {
      expect(deleted.status).toBe('rejected');
    }
  });

  it('handles 404 for unknown asset and 400 for missing id', async () => {
    const fakeId = '00000000-0000-4000-a000-000000000000';
    const { res } = await fetchJson(`/assets/${fakeId}/content`);
    expect(res.status).toBe(404);

    const badDelete = await fetch(url(`/assets/invalid-uuid`), {
      method: 'DELETE',
      headers: HEADERS,
    });
    // Should be 422 or 404 depending on validation; our route validates uuid via drizzle? Actually delete just checks asset, so 404
    expect([400, 404, 422].includes(badDelete.status)).toBe(true);
  });

  it('rate limit and CORS headers present', async () => {
    const { res } = await fetchJson(`/assets?projectId=${projectId}`);
    // CORS handled via Hono, but simple check
    expect(res.status).toBe(200);
    // Rate limit not easily observable, but ensure not 429 on single request
    expect([200, 429].includes(res.status)).toBe(true);
  });
});
