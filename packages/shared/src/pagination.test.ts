import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, clampLimit, paginateResults } from './pagination.js';

const makeItem = (id: string, createdAt: Date) => ({ _id: id, createdAt });

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a cursor correctly', () => {
    const date = new Date('2024-01-15T12:00:00.000Z');
    const id = '507f1f77bcf86cd799439011';
    const cursor = encodeCursor(date, id);
    const decoded = decodeCursor(cursor);
    expect(decoded.createdAt).toBe(date.toISOString());
    expect(decoded._id).toBe(id);
  });

  it('produces an opaque base64 string', () => {
    const cursor = encodeCursor(new Date(), 'abc123');
    expect(typeof cursor).toBe('string');
    expect(cursor).not.toContain('{'); // should not be raw JSON
  });

  it('throws on a non-base64 cursor', () => {
    expect(() => decodeCursor('not!!valid@@base64$$')).toThrow('Invalid pagination cursor');
  });

  it('throws on a cursor with missing fields', () => {
    const bad = Buffer.from(JSON.stringify({ createdAt: '2024-01-01' })).toString('base64');
    expect(() => decodeCursor(bad)).toThrow('Invalid pagination cursor shape');
  });
});

describe('clampLimit', () => {
  it('returns the requested limit when valid', () => {
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(100)).toBe(100);
  });

  it('clamps to PAGINATION_MAX_LIMIT when too large', () => {
    expect(clampLimit(999)).toBe(100);
  });

  it('returns default for invalid values', () => {
    expect(clampLimit(0)).toBe(50);
    expect(clampLimit(-1)).toBe(50);
    expect(clampLimit('bad')).toBe(50);
    expect(clampLimit(undefined)).toBe(50);
  });
});

describe('paginateResults', () => {
  it('returns all items when count <= limit', () => {
    const items = [makeItem('1', new Date()), makeItem('2', new Date())];
    const result = paginateResults(items, 10);
    expect(result.items).toHaveLength(2);
    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('slices to limit and sets hasNextPage when count > limit', () => {
    const items = [
      makeItem('1', new Date('2024-01-03T00:00:00Z')),
      makeItem('2', new Date('2024-01-02T00:00:00Z')),
      makeItem('3', new Date('2024-01-01T00:00:00Z')), // extra item
    ];
    const result = paginateResults(items, 2);
    expect(result.items).toHaveLength(2);
    expect(result.hasNextPage).toBe(true);
    expect(result.nextCursor).not.toBeNull();
  });

  it('nextCursor decodes to the last returned item', () => {
    const t1 = new Date('2024-01-02T00:00:00Z');
    const t2 = new Date('2024-01-01T00:00:00Z');
    const items = [makeItem('id-a', t1), makeItem('id-b', t2), makeItem('id-c', new Date())];
    const result = paginateResults(items, 2);
    const decoded = decodeCursor(result.nextCursor!);
    expect(decoded._id).toBe('id-b');
    expect(decoded.createdAt).toBe(t2.toISOString());
  });

  it('returns null nextCursor for an empty result', () => {
    const result = paginateResults([], 10);
    expect(result.nextCursor).toBeNull();
    expect(result.hasNextPage).toBe(false);
  });
});