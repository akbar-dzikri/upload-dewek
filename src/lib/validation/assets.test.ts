import { describe, expect, it } from 'vitest';
import { listAssetsQuerySchema, serveAssetQuerySchema } from './assets';

describe('listAssetsQuerySchema', () => {
  const validProjectId = '550e8400-e29b-41d4-a716-446655440000';

  it('requires projectId', () => {
    expect(() => listAssetsQuerySchema.parse({})).toThrow();
  });

  it('accepts minimal with projectId', () => {
    const parsed = listAssetsQuerySchema.parse({ projectId: validProjectId });
    expect(parsed.projectId).toBe(validProjectId);
    expect(parsed.limit).toBe(20);
  });

  it('accepts folder/tag/q', () => {
    const parsed = listAssetsQuerySchema.parse({
      projectId: validProjectId,
      folder: 'blog/hero',
      tag: 'hero',
      q: 'cover',
      limit: 10,
    });
    expect(parsed.folder).toBe('blog/hero');
    expect(parsed.tag).toBe('hero');
    expect(parsed.q).toBe('cover');
  });

  it('rejects invalid folder chars', () => {
    expect(() => listAssetsQuerySchema.parse({ projectId: validProjectId, folder: 'Bad!' })).toThrow();
  });

  it('rejects invalid tag', () => {
    expect(() => listAssetsQuerySchema.parse({ projectId: validProjectId, tag: 'Bad!' })).toThrow();
  });

  it('coerces limit string', () => {
    const parsed = listAssetsQuerySchema.parse({ projectId: validProjectId, limit: '5' });
    expect(parsed.limit).toBe(5);
  });
});

describe('serveAssetQuerySchema', () => {
  it('accepts empty', () => {
    const parsed = serveAssetQuerySchema.parse({});
    expect(parsed.width).toBeUndefined();
  });

  it('accepts width/format/quality', () => {
    const parsed = serveAssetQuerySchema.parse({ width: '800', format: 'webp', quality: '80' });
    expect(parsed.width).toBe(800);
    expect(parsed.format).toBe('webp');
    expect(parsed.quality).toBe(80);
  });

  it('rejects invalid format', () => {
    expect(() => serveAssetQuerySchema.parse({ format: 'bmp' })).toThrow();
  });

  it('rejects width out of range', () => {
    expect(() => serveAssetQuerySchema.parse({ width: 5000 })).toThrow();
  });
});
