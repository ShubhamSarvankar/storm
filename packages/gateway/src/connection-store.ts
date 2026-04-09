import type { WebSocket } from 'ws';
import type { JwtPayload } from '@storm/shared';

export interface Connection {
  ws: WebSocket;
  sessionId: string;
  user: JwtPayload;
  channelIds: Set<string>;        // channels this socket is subscribed to
  presenceUserIds: Set<string>;   // userIds whose presence this socket watches
  msgCount: number;               // rolling window message count for rate limiting
  windowStart: number;            // unix ms — start of the current rate limit window
}

// userId → Set of sessionIds (one user can have multiple connections)
const byUser = new Map<string, Set<string>>();
// sessionId → Connection
const bySession = new Map<string, Connection>();

export function addConnection(conn: Connection): void {
  bySession.set(conn.sessionId, conn);
  let sessions = byUser.get(conn.user.sub);
  if (!sessions) {
    sessions = new Set();
    byUser.set(conn.user.sub, sessions);
  }
  sessions.add(conn.sessionId);
}

export function removeConnection(sessionId: string): Connection | undefined {
  const conn = bySession.get(sessionId);
  if (!conn) return undefined;
  bySession.delete(sessionId);
  const sessions = byUser.get(conn.user.sub);
  if (sessions) {
    sessions.delete(sessionId);
    if (sessions.size === 0) byUser.delete(conn.user.sub);
  }
  return conn;
}

export function getConnection(sessionId: string): Connection | undefined {
  return bySession.get(sessionId);
}

export function getSessionsForUser(userId: string): Connection[] {
  const sessions = byUser.get(userId) ?? new Set<string>();
  return [...sessions].flatMap((sid) => {
    const c = bySession.get(sid);
    return c ? [c] : [];
  });
}

export function getSessionsForChannel(channelId: string): Connection[] {
  return [...bySession.values()].filter((c) => c.channelIds.has(channelId));
}

export function getSessionsWatchingUser(userId: string): Connection[] {
  return [...bySession.values()].filter((c) => c.presenceUserIds.has(userId));
}

export function connectionCount(): number {
  return bySession.size;
}

export function clearAll(): void {
  bySession.clear();
  byUser.clear();
}