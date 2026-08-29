import { describe, expect, it } from 'vitest';
import { createProjectSchema, listProjectsQuerySchema } from './projects';

describe('createProjectSchema', () => {
  it('defaults quotaBytes to 1GB', () => {
    const parsed = createProjectSchema.parse({ name: 'Portfolio' });
    expect(parsed.quotaBytes).toBe(1073741824);
  });

  it('accepts custom quotaBytes', () => {
    const parsed = createProjectSchema.parse({ name: 'Test', quotaBytes: 5000 });
    expect(parsed.quotaBytes).toBe(5000);
  });

  it('rejects empty name', () => {
    expect(() => createProjectSchema.parse({ name: '' })).toThrow();
  });

  it('rejects quotaBytes >1TB', () => {
    expect(() => createProjectSchema.parse({ name: 'T', quotaBytes: 2000000000000 })).toThrow();
  });
});

describe('listProjectsQuerySchema', () => {
  it('defaults page/limit', () => {
    const parsed = listProjectsQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
  });

  it('coerces string numbers', () => {
    const parsed = listProjectsQuerySchema.parse({ page: '2', limit: '50' });
    expect(parsed.page).toBe(2);
    expect(parsed.limit).toBe(50);
  });
});
