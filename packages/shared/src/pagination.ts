import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from './constants.js';
import type { CursorPayload, PaginatedResult } from './types.js';

export function encodeCursor(createdAt: Date, id: string): string {
  const payload: CursorPayload = {
    createdAt: createdAt.toISOString(),
    _id: id,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

export function decodeCursor(cursor: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
  } catch {
    throw new Error('Invalid pagination cursor');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)['createdAt'] !== 'string' ||
    typeof (parsed as Record<string, unknown>)['_id'] !== 'string'
  ) {
    throw new Error('Invalid pagination cursor shape');
  }

  return parsed as CursorPayload;
}

export function clampLimit(requested: unknown): number {
  const n = typeof requested === 'number' ? requested : PAGINATION_DEFAULT_LIMIT;
  if (!Number.isInteger(n) || n < 1) return PAGINATION_DEFAULT_LIMIT;
  return Math.min(n, PAGINATION_MAX_LIMIT);
}

// Slice results and compute pagination metadata.
// Callers must fetch limit + 1 items and pass them here.
export function paginateResults<T extends { createdAt: Date; _id: string }>(
  results: T[],
  limit: number,
): PaginatedResult<T> {
  const hasNextPage = results.length > limit;
  const items = hasNextPage ? results.slice(0, limit) : results;
  const last = items[items.length - 1];
  const nextCursor =
    hasNextPage && last ? encodeCursor(last.createdAt, last._id) : null;

  return { items, nextCursor, hasNextPage };
}