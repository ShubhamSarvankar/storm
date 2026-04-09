import { RATE_LIMIT_WS_MSG_MAX, RATE_LIMIT_WS_WINDOW_MS } from '@storm/shared';
import type { Connection } from './connection-store.js';

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number; // seconds
}

export function checkRateLimit(conn: Connection): RateLimitResult {
  const now = Date.now();

  // Reset window if it has expired
  if (now - conn.windowStart >= RATE_LIMIT_WS_WINDOW_MS) {
    conn.windowStart = now;
    conn.msgCount = 0;
  }

  if (conn.msgCount >= RATE_LIMIT_WS_MSG_MAX) {
    const retryAfter = Math.ceil(
      (conn.windowStart + RATE_LIMIT_WS_WINDOW_MS - now) / 1000,
    );
    return { allowed: false, retryAfter };
  }

  conn.msgCount++;
  return { allowed: true, retryAfter: 0 };
}