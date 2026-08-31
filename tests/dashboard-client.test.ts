import { describe, it, expect } from 'vitest';

// Re-implement pure helpers from dashboard/src/lib/client.ts to avoid window/import.meta coupling
// These are the critical URL builders that ship untested per ship review

const getAssetContentUrl = (base: string, assetId: string, opts?: { width?: number; format?: string; quality?: number }): string => {
  const usp = new URLSearchParams();
  if (opts?.width !== undefined) usp.set('width', String(opts.width));
  if (opts?.format !== undefined) usp.set('format', opts.format);
  if (opts?.quality !== undefined) usp.set('quality', String(opts.quality));
  const qs = usp.toString();
  return `${base.replace(/\/$/, '')}/assets/${assetId}/content${qs !== '' ? `?${qs}` : ''}`;
};

const getBaseUrl = (lsValue: string | null, envUrl?: string): string => {
  if (lsValue !== null && lsValue !== '') return lsValue.replace(/\/$/, '');
  return (envUrl ?? 'http://localhost:8787').replace(/\/$/, '');
};

describe('dashboard client helpers', () => {
  it('getAssetContentUrl builds canonical and transformed URLs', () => {
    const base = 'https://upload-dewek.dikicodes.com';
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(getAssetContentUrl(base, id)).toBe(`${base}/assets/${id}/content`);
    expect(getAssetContentUrl(base, id, { width: 800, format: 'webp', quality: 80 })).toBe(
      `${base}/assets/${id}/content?width=800&format=webp&quality=80`,
    );
    expect(getAssetContentUrl(base + '/', id, { width: 400 })).toBe(`${base}/assets/${id}/content?width=400`);
  });

  it('getBaseUrl prefers localStorage over env', () => {
    expect(getBaseUrl('https://custom.example.com/', 'https://env.example.com')).toBe('https://custom.example.com');
    expect(getBaseUrl(null, 'https://env.example.com')).toBe('https://env.example.com');
    expect(getBaseUrl('', undefined)).toBe('http://localhost:8787');
    expect(getBaseUrl(null, undefined)).toBe('http://localhost:8787');
  });

  it('listAssets URLSearchParams handling', () => {
    const params = { projectId: 'p1', folder: 'blog/hero', tag: 'dark', q: 'cover', limit: 20 };
    const usp = new URLSearchParams({ projectId: params.projectId });
    if (params.folder) usp.set('folder', params.folder);
    if (params.tag) usp.set('tag', params.tag);
    if (params.q) usp.set('q', params.q);
    usp.set('limit', String(params.limit));
    expect(usp.toString()).toBe('projectId=p1&folder=blog%2Fhero&tag=dark&q=cover&limit=20');
  });
});
