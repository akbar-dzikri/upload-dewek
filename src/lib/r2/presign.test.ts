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

  it('uses R2_ACCOUNT_ID to build account host with bucket', async () => {
    const r2Key = 'projects/123/file.jpg';
    const result = await createPresignedPost({ ...env, R2_ACCOUNT_ID: 'abc123def456' }, r2Key, 'image/jpeg');
    expect(result.url).toContain('abc123def456.r2.cloudflarestorage.com');
    expect(result.url).toContain('test-bucket');
    expect(result.url).toContain(r2Key);
  });

  it('uses R2_ENDPOINT with bucket already included', async () => {
    const r2Key = 'projects/123/file.jpg';
    const endpoint = 'https://abc123.r2.cloudflarestorage.com/test-bucket';
    const result = await createPresignedPost({ ...env, R2_ENDPOINT: endpoint }, r2Key, 'image/jpeg');
    expect(result.url).toContain('abc123.r2.cloudflarestorage.com/test-bucket');
    expect(result.url).toContain(r2Key);
    // Should not double bucket
    expect(result.url).not.toContain('test-bucket/test-bucket');
  });

  it('uses R2_ENDPOINT account host without bucket and adds bucket', async () => {
    const r2Key = 'projects/123/file.jpg';
    const endpoint = 'https://abc123.r2.cloudflarestorage.com';
    const result = await createPresignedPost({ ...env, R2_ENDPOINT: endpoint }, r2Key, 'image/jpeg');
    expect(result.url).toContain('abc123.r2.cloudflarestorage.com/test-bucket');
    expect(result.url).toContain(r2Key);
  });

  it('signs correct content-type header', async () => {
    const r2Key = 'projects/123/file.jpg';
    const result = await createPresignedPost(env, r2Key, 'image/png');
    // SignedHeaders should include content-type
    expect(result.url).toContain('content-type');
    expect(result.url).toContain('X-Amz-SignedHeaders');
  });
});
