import { describe, expect, it } from 'vitest';
import { confirmUploadSchema, initUploadSchema } from './uploads';

describe('initUploadSchema', () => {
  const base = {
    projectId: '550e8400-e29b-41d4-a716-446655440000',
    filename: 'photo.jpg',
    mimeType: 'image/jpeg' as const,
    sizeBytes: 1024,
  };

  it('accepts minimal valid', () => {
    const parsed = initUploadSchema.parse(base);
    expect(parsed.projectId).toBe(base.projectId);
    expect(parsed.tags).toEqual([]);
  });

  it('accepts folder and tags', () => {
    const parsed = initUploadSchema.parse({ ...base, folder: 'blog/hero', tags: ['hero', 'dark'] });
    expect(parsed.folder).toBe('blog/hero');
    expect(parsed.tags).toEqual(['hero', 'dark']);
  });

  it('rejects invalid projectId', () => {
    expect(() => initUploadSchema.parse({ ...base, projectId: 'not-uuid' })).toThrow();
  });

  it('rejects filename with slash', () => {
    expect(() => initUploadSchema.parse({ ...base, filename: 'a/b.jpg' })).toThrow();
  });

  it('rejects invalid mimeType', () => {
    expect(() => initUploadSchema.parse({ ...base, mimeType: 'text/plain' as never })).toThrow();
  });

  it('rejects sizeBytes too large', () => {
    expect(() => initUploadSchema.parse({ ...base, sizeBytes: 200_000_000 })).toThrow();
  });

  it('rejects folder with invalid chars', () => {
    expect(() => initUploadSchema.parse({ ...base, folder: 'Blog/Hero!' })).toThrow();
  });

  it('rejects folder with //', () => {
    expect(() => initUploadSchema.parse({ ...base, folder: 'a//b' })).toThrow();
  });

  it('rejects too many tags', () => {
    expect(() => initUploadSchema.parse({ ...base, tags: ['a', 'b', 'c', 'd', 'e', 'f'] })).toThrow();
  });

  it('rejects tag with invalid chars', () => {
    expect(() => initUploadSchema.parse({ ...base, tags: ['Hello!'] })).toThrow();
  });

  it('trims folder slashes', () => {
    const parsed = initUploadSchema.parse({ ...base, folder: '/blog/hero/' });
    expect(parsed.folder).toBe('blog/hero');
  });
});

describe('confirmUploadSchema', () => {
  it('accepts uuid', () => {
    const parsed = confirmUploadSchema.parse({ assetId: '550e8400-e29b-41d4-a716-446655440000' });
    expect(parsed.assetId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });
  it('rejects non-uuid', () => {
    expect(() => confirmUploadSchema.parse({ assetId: 'not-uuid' })).toThrow();
  });
});
