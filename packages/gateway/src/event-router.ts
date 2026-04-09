import { wsInboundEventSchema, createLogger, WS_CLOSE_BAD_REQUEST } from '@storm/shared';
import type { Connection } from './connection-store.js';
import { send } from './sender.js';
import {
  handleMessageSend,
  handlePresenceSubscribe,
  handlePresenceUnsubscribe,
  handlePing,
} from './handlers.js';

const logger = createLogger('gateway-router');

export async function routeMessage(conn: Connection, raw: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    conn.ws.close(WS_CLOSE_BAD_REQUEST, 'Invalid JSON');
    return;
  }

  const result = wsInboundEventSchema.safeParse(parsed);
  if (!result.success) {
    send(conn, 'error.invalid_payload', {
      message: 'Invalid event shape',
      details: result.error.flatten().fieldErrors,
    }, (parsed as Record<string, string>)?.['requestId'] ?? '');
    return;
  }

  const event = result.data;
  logger.debug({ event: event.event, userId: conn.user.sub }, 'Routing WS event');

  switch (event.event) {
    case 'message.send':
      await handleMessageSend(conn, event);
      break;
    case 'presence.subscribe':
      handlePresenceSubscribe(conn, event);
      break;
    case 'presence.unsubscribe':
      handlePresenceUnsubscribe(conn, event);
      break;
    case 'ping':
      handlePing(conn, event);
      break;
  }
}