import { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { verifyJwt, WS_CLOSE_UNAUTHORIZED, type JwtPayload } from '@storm/shared';

const AUTH_TIMEOUT_MS = 5_000;

export function extractToken(req: IncomingMessage): string | null {
  const url = req.url ?? '';
  const match = /[?&]token=([^&]+)/.exec(url);
  const token = match?.[1] ?? null;

  return token;
}

export function verifyConnection(
  ws: WebSocket,
  req: IncomingMessage,
): Promise<JwtPayload> {

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close(WS_CLOSE_UNAUTHORIZED, 'Unauthorized');
      reject(new Error('Auth timeout'));
    }, AUTH_TIMEOUT_MS);

    const token = extractToken(req);
    if (!token) {
      clearTimeout(timer);
      ws.close(WS_CLOSE_UNAUTHORIZED, 'Unauthorized');
      reject(new Error('No token'));
      return;
    }

    const result = verifyJwt(token);
    clearTimeout(timer);

    if (!result.valid) {
      ws.close(WS_CLOSE_UNAUTHORIZED, 'Unauthorized');
      reject(new Error('Invalid token'));
      return;
    }

    resolve(result.payload);
  });
}