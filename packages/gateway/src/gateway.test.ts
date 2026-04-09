import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { signJwt, clearAll } from './test-helpers.js';
import { handleConnection } from './connection.js';

// ── Test server setup ─────────────────────────────────────────
let server: http.Server;
let wss: WebSocketServer;
let port: number;

beforeAll(async () => {
  process.env['JWT_SECRET'] = 'ab'.repeat(64);
  process.env['NODE_ENV'] = 'test';

  server = http.createServer();
  wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => void handleConnection(ws, req));

  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  clearAll();
});

// ── Helpers ───────────────────────────────────────────────────

// Registers the message listener BEFORE the socket is open to avoid
// missing frames sent immediately on connection (common on Windows).
function connectAndFirstMessage(token: string): Promise<{ ws: WebSocket; first: Record<string, unknown> }> {
  const url = `ws://localhost:${port}?token=${token}`;
  const ws = new WebSocket(url);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 10_000);
    ws.once('message', (data) => {
      clearTimeout(t);
      resolve({ ws, first: JSON.parse(data.toString()) as Record<string, unknown> });
    });
    ws.once('error', (err) => { clearTimeout(t); reject(err); });
  });
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Message timeout')), 5_000);
    ws.once('message', (data) => {
      clearTimeout(t);
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    });
  });
}

function closeCode(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once('close', (code) => resolve(code));
  });
}

// ── Auth handshake ────────────────────────────────────────────
describe('Auth handshake', () => {
  it('sends connection.ready on valid JWT', async () => {
    const token = signJwt('user-1', 'member');
    const { ws, first: msg } = await connectAndFirstMessage(token);
    expect(msg['event']).toBe('connection.ready');
    expect((msg['payload'] as Record<string, unknown>)['userId']).toBe('user-1');
    ws.close();
  });

  it('closes with 4001 when no token is provided', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const code = await closeCode(ws);
    expect(code).toBe(4001);
  });

  it('closes with 4001 on invalid token', async () => {
    const ws = new WebSocket(`ws://localhost:${port}?token=notavalidtoken`);
    const code = await closeCode(ws);
    expect(code).toBe(4001);
  });

  it('closes with 4001 on expired token', async () => {
    const token = signJwt('user-1', 'member', -1);
    const ws = new WebSocket(`ws://localhost:${port}?token=${token}`);
    const code = await closeCode(ws);
    expect(code).toBe(4001);
  });
});

// ── Ping / Pong ───────────────────────────────────────────────
describe('ping / pong', () => {
  it('responds to ping with pong', async () => {
    const token = signJwt('user-1', 'member');
    const { ws } = await connectAndFirstMessage(token); // connection.ready

    ws.send(JSON.stringify({ event: 'ping', requestId: uuidv4(), payload: {} }));
    const pong = await nextMessage(ws);
    expect(pong['event']).toBe('pong');
    expect((pong['payload'] as Record<string, unknown>)['serverTs']).toBeTruthy();
    ws.close();
  });
});

// ── message.send ──────────────────────────────────────────────
describe('message.send', () => {
  it('acks the message with status queued', async () => {
    const token = signJwt('user-1', 'member');
    const { ws } = await connectAndFirstMessage(token); // connection.ready

    const msgId = uuidv4();
    ws.send(JSON.stringify({
      event: 'message.send',
      requestId: uuidv4(),
      payload: {
        messageId: msgId,
        channelId: '000000000000000000000001',
        content: 'Hello',
        clientTs: new Date().toISOString(),
      },
    }));

    const ack = await nextMessage(ws);
    expect(ack['event']).toBe('message.ack');
    expect((ack['payload'] as Record<string, unknown>)['messageId']).toBe(msgId);
    expect((ack['payload'] as Record<string, unknown>)['status']).toBe('queued');
    ws.close();
  });

  it('returns error.invalid_payload on malformed event', async () => {
    const token = signJwt('user-1', 'member');
    const { ws } = await connectAndFirstMessage(token); // connection.ready

    ws.send(JSON.stringify({
      event: 'message.send',
      requestId: uuidv4(),
      payload: { content: 'missing required fields' },
    }));

    const err = await nextMessage(ws);
    expect(err['event']).toBe('error.invalid_payload');
    ws.close();
  });

  it('rate limits after 60 messages per minute', async () => {
    const token = signJwt('user-2', 'member');
    const { ws } = await connectAndFirstMessage(token); // connection.ready

    const sends = Array.from({ length: 60 }, (_, i) =>
      JSON.stringify({
        event: 'message.send',
        requestId: uuidv4(),
        payload: {
          messageId: uuidv4(),
          channelId: '000000000000000000000001',
          content: `msg ${i}`,
          clientTs: new Date().toISOString(),
        },
      }),
    );

    const responses: Record<string, unknown>[] = [];
    const collector = new Promise<void>((resolve) => {
      ws.on('message', (data) => {
        responses.push(JSON.parse(data.toString()) as Record<string, unknown>);
        if (responses.length >= 60) resolve();
      });
    });

    for (const msg of sends) ws.send(msg);
    await collector;

    ws.send(JSON.stringify({
      event: 'message.send',
      requestId: uuidv4(),
      payload: {
        messageId: uuidv4(),
        channelId: '000000000000000000000001',
        content: 'over limit',
        clientTs: new Date().toISOString(),
      },
    }));

    const rateLimitMsg = await nextMessage(ws);
    expect(rateLimitMsg['event']).toBe('error.rate_limited');
    ws.close();
  });
});

// ── presence.unsubscribe ──────────────────────────────────────
describe('presence.unsubscribe', () => {
  it('unsubscribes without error', async () => {
    const token = signJwt('user-1', 'member');
    const { ws } = await connectAndFirstMessage(token); // connection.ready

    // Subscribe first
    ws.send(JSON.stringify({
      event: 'presence.subscribe',
      requestId: uuidv4(),
      payload: { userIds: ['000000000000000000000002'] },
    }));
    await nextMessage(ws); // presence.snapshot

    // Now unsubscribe — no response expected, just confirm no error
    ws.send(JSON.stringify({
      event: 'presence.unsubscribe',
      requestId: uuidv4(),
      payload: { userIds: ['000000000000000000000002'] },
    }));

    // Send a ping to confirm the connection is still alive
    ws.send(JSON.stringify({ event: 'ping', requestId: uuidv4(), payload: {} }));
    const pong = await nextMessage(ws);
    expect(pong['event']).toBe('pong');
    ws.close();
  });
});
describe('presence.subscribe', () => {
  it('returns a presence snapshot', async () => {
    const token = signJwt('user-1', 'member');
    const { ws } = await connectAndFirstMessage(token); // connection.ready

    ws.send(JSON.stringify({
      event: 'presence.subscribe',
      requestId: uuidv4(),
      payload: { userIds: ['000000000000000000000002', '000000000000000000000003'] },
    }));

    const snapshot = await nextMessage(ws);
    expect(snapshot['event']).toBe('presence.snapshot');
    const users = (snapshot['payload'] as Record<string, unknown>)['users'] as unknown[];
    expect(users).toHaveLength(2);
    ws.close();
  });
});