import { describe, expect, it } from 'vitest';
import { createPresignedPost } from './presign';

describe('createPresignedPost', () => {
  const env = {
    R2_ACCESS_KEY_ID: 'test-access-key-id-test-access-key-id-test12',
    R2_SECRET_ACCESS_KEY: 'test-secret-access-key-test-secret-access-key-test12',
    R2_BUCKET: 'test-bucket',
  };

  it('returns url with signature and expiresAt', async () => {
    const r2Key = 'projects/550e8400-e29b-41d4-a716-446655440000/abcd-photo.jpg';
    const result = await createPresignedPost(env, r2Key, 'image/jpeg');
    expect(result.url).toContain(r2Key);
    expect(result.url).toContain('X-Amz-Signature');
    expect(result.url).toContain('X-Amz-Expires=900');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it('uses custom expiry', async () => {
    const r2Key = 'projects/550e8400-e29b-41d4-a716-446655440000/photo.png';
    const result = await createPresignedPost(env, r2Key, 'image/png', 60);
    expect(result.url).toContain('X-Amz-Expires=60');
  });

  it('throws when env missing', async () => {
    await expect(createPresignedPost({ R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET: '' }, 'key', 'image/jpeg')).rejects.toThrow();
  });

  it('url contains bucket host', async () => {
    const r2Key = 'projects/123/folder/file.jpg';
    const result = await createPresignedPost(env, r2Key, 'image/jpeg');
    expect(result.url).toContain('test-bucket');
  });
});
