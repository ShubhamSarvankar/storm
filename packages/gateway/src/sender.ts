import { WebSocket } from 'ws';
import type { Connection } from './connection-store.js';

export function send(conn: Connection, event: string, payload: unknown, requestId = ''): void {
  if (conn.ws.readyState !== WebSocket.OPEN) return;
  conn.ws.send(JSON.stringify({ event, payload, requestId }));
}

export function sendToUser(
  connections: Connection[],
  event: string,
  payload: unknown,
): void {
  for (const conn of connections) {
    send(conn, event, payload);
  }
}

export function broadcast(
  connections: Connection[],
  event: string,
  payload: unknown,
  excludeSessionId?: string,
): void {
  for (const conn of connections) {
    if (conn.sessionId !== excludeSessionId) {
      send(conn, event, payload);
    }
  }
}