import { describe, expect, it } from 'vitest';
import { hashApiKey } from './hash';

describe('hashApiKey', () => {
  it('produces 64 char hex', async () => {
    const hash = await hashApiKey('test-key');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic', async () => {
    const a = await hashApiKey('ud_local_test_key_12345');
    const b = await hashApiKey('ud_local_test_key_12345');
    expect(a).toBe(b);
    expect(a).toBe('813ce155c9c71e7ce4349edb531d4a42da4454df8cee4db7ef1c6b020d2706d9');
  });

  it('different keys produce different hashes', async () => {
    const a = await hashApiKey('key1');
    const b = await hashApiKey('key2');
    expect(a).not.toBe(b);
  });
});
