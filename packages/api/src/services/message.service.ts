import { Queue } from 'bullmq';
import mongoose from 'mongoose';
import {
  MessageModel,
  ChannelModel,
  getRedis,
  decodeCursor,
  encodeCursor,
  createLogger,
  QUEUE_MESSAGE_INBOUND,
  PAGINATION_MAX_LIMIT,
  type SendMessageInput,
  type PaginatedResult,
  type InboundMessageJob,
} from '@storm/shared';

const logger = createLogger('message-service');

// Lazy queue — only created when Redis is available
let messageQueue: Queue | null = null;

function getQueue(): Queue {
  if (!messageQueue) {
    messageQueue = new Queue(QUEUE_MESSAGE_INBOUND, {
      connection: getRedis(),
    });
  }
  return messageQueue;
}

export interface MessageView {
  id: string;
  messageId: string;
  channelId: string;
  senderId: string;
  deliveryStatus: string;
  clientTs: Date;
  createdAt: Date;
}

function toView(msg: InstanceType<typeof MessageModel>): MessageView {
  return {
    id: msg._id.toString(),
    messageId: msg.messageId,
    channelId: msg.channelId.toString(),
    senderId: msg.senderId.toString(),
    deliveryStatus: msg.deliveryStatus,
    clientTs: msg.clientTs,
    createdAt: msg.createdAt,
  };
}

// ── Send (enqueue) ────────────────────────────────────────────
export async function sendMessage(
  channelId: string,
  senderId: string,
  input: SendMessageInput,
): Promise<{ messageId: string; status: 'pending' | 'duplicate' }> {
  const channel = await ChannelModel.findById(channelId);
  if (!channel) throw Object.assign(new Error('Channel not found'), { code: 'NOT_FOUND' });

  const isMember = channel.members.some((m) => m.toString() === senderId);
  if (!isMember) throw Object.assign(new Error('Access denied'), { code: 'FORBIDDEN' });

  // Idempotency check — if this messageId was already seen, treat as duplicate
  const existing = await MessageModel.findOne({ messageId: input.messageId });
  if (existing) {
    logger.info({ messageId: input.messageId, senderId }, 'Duplicate message submission');
    return { messageId: input.messageId, status: 'duplicate' };
  }

  const job: InboundMessageJob = {
    jobId: input.messageId,
    messageId: input.messageId,
    channelId,
    senderId,
    content: input.content,
    clientTs: new Date(input.clientTs).getTime(),
    enqueuedAt: Date.now(),
  };

  // Skip queue in test environment — Worker isn't running
  if (process.env['NODE_ENV'] !== 'test') {
    await getQueue().add(input.messageId, job, {
      jobId: input.messageId,
    });
  }

  logger.info({ messageId: input.messageId, channelId, senderId }, 'Message enqueued');
  return { messageId: input.messageId, status: 'pending' };
}

// ── History ───────────────────────────────────────────────────
export async function getMessageHistory(
  channelId: string,
  userId: string,
  cursor?: string,
  limit = 50,
): Promise<PaginatedResult<MessageView>> {
  const channel = await ChannelModel.findById(channelId);
  if (!channel) throw Object.assign(new Error('Channel not found'), { code: 'NOT_FOUND' });

  const isMember = channel.members.some((m) => m.toString() === userId);
  if (!isMember) throw Object.assign(new Error('Access denied'), { code: 'FORBIDDEN' });

  const clampedLimit = Math.min(Math.max(1, limit), PAGINATION_MAX_LIMIT);
  const filter: Record<string, unknown> = {
    channelId: new mongoose.Types.ObjectId(channelId),
  };

  if (cursor) {
    const { createdAt, _id } = decodeCursor(cursor);
    filter['$or'] = [
      { createdAt: { $lt: new Date(createdAt) } },
      { createdAt: new Date(createdAt), _id: { $lt: new mongoose.Types.ObjectId(_id) } },
    ];
  }

  const messages = await MessageModel.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(clampedLimit + 1);

  const hasNextPage = messages.length > clampedLimit;
  const items = hasNextPage ? messages.slice(0, clampedLimit) : messages;
  const last = items[items.length - 1];
  const nextCursor = hasNextPage && last
    ? encodeCursor(last.createdAt, last._id.toString())
    : null;

  return { items: items.map(toView), nextCursor, hasNextPage };
}

// ── Delete ────────────────────────────────────────────────────
export async function deleteMessage(
  channelId: string,
  messageId: string,
  requesterId: string,
  requesterRole: string,
): Promise<void> {
  const message = await MessageModel.findOne({ messageId, channelId });
  if (!message) throw Object.assign(new Error('Message not found'), { code: 'NOT_FOUND' });

  const isOwner = message.senderId.toString() === requesterId;
  const canDeleteAny = requesterRole === 'admin' || requesterRole === 'moderator';

  if (!isOwner && !canDeleteAny) {
    throw Object.assign(new Error('Insufficient permissions'), { code: 'FORBIDDEN' });
  }

  await message.deleteOne();
  logger.info({ messageId, channelId, requesterId }, 'Message deleted');
}