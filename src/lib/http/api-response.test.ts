import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { successResponse, paginatedResponse } from './api-response';

describe('api-response', () => {
  it('successResponse returns JSend success', async () => {
    const app = new Hono();
    app.get('/t', (c) => successResponse(c, { hello: 'world' }));
    const res = await app.request('/t');
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const body = (await res.json()) as unknown as { status: string; data: unknown };
    expect(res.status).toBe(200);
    expect(body.status).toBe('success');
  });

  it('paginatedResponse returns items + meta', async () => {
    const app = new Hono();
    app.get('/p', (c) =>
      paginatedResponse(c, [{ id: '1' }], {
        page: 1,
        limit: 10,
        totalDocs: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      }),
    );
    const res = await app.request('/p');
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const body = (await res.json()) as unknown as {
      status: string;
      data: { items: unknown[]; meta: { hasNextPage: boolean } };
    };
    expect(body.data.meta.hasNextPage).toBe(false);
  });
});
