import {
  ChannelModel,
  getRedis,
  decodeCursor,
  encodeCursor,
  createLogger,
  PUBSUB_SYSTEM_CHANNEL_UPDATED,
  PAGINATION_MAX_LIMIT,
  type CreateChannelInput,
  type UpdateChannelInput,
  type PaginatedResult,
} from '@storm/shared';
import mongoose from 'mongoose';

const logger = createLogger('channel-service');

export interface ChannelView {
  id: string;
  name: string;
  description?: string | undefined;
  createdBy: string;
  members: string[];
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toView(channel: InstanceType<typeof ChannelModel>): ChannelView {
  return {
    id: channel._id.toString(),
    name: channel.name,
    description: channel.description,
    createdBy: channel.createdBy.toString(),
    members: channel.members.map((m) => m.toString()),
    isArchived: channel.isArchived,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
  };
}

async function publishChannelEvent(
  event: 'channel.created' | 'channel.updated' | 'channel.deleted',
  channelId: string,
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.publish(
      PUBSUB_SYSTEM_CHANNEL_UPDATED,
      JSON.stringify({ event, channelId, ts: Date.now() }),
    );
  } catch (err) {
    logger.warn({ err, channelId, event }, 'Failed to publish channel event');
  }
}

// ── Create ────────────────────────────────────────────────────
export async function createChannel(userId: string, input: CreateChannelInput): Promise<ChannelView> {
  const existing = await ChannelModel.findOne({ name: input.name });
  if (existing) throw Object.assign(new Error('Channel name already in use'), { code: 'CONFLICT' });

  const channel = await ChannelModel.create({
    name: input.name,
    description: input.description,
    createdBy: new mongoose.Types.ObjectId(userId),
    members: [new mongoose.Types.ObjectId(userId)],
    isArchived: false,
  });

  logger.info({ channelId: channel._id.toString(), userId }, 'Channel created');
  await publishChannelEvent('channel.created', channel._id.toString());
  return toView(channel);
}

// ── Get by ID ─────────────────────────────────────────────────
export async function getChannelById(channelId: string, userId: string): Promise<ChannelView> {
  const channel = await ChannelModel.findById(channelId);
  if (!channel) throw Object.assign(new Error('Channel not found'), { code: 'NOT_FOUND' });

  const isMember = channel.members.some((m) => m.toString() === userId);
  if (!isMember) throw Object.assign(new Error('Access denied'), { code: 'FORBIDDEN' });

  return toView(channel);
}

// ── List channels for a user ──────────────────────────────────
export async function listChannels(
  userId: string,
  cursor?: string,
  limit = 50,
  includeArchived = false,
): Promise<PaginatedResult<ChannelView>> {
  const clampedLimit = Math.min(Math.max(1, limit), PAGINATION_MAX_LIMIT);
  const filter: Record<string, unknown> = {
    members: new mongoose.Types.ObjectId(userId),
    ...(!includeArchived && { isArchived: false }),
  };

  if (cursor) {
    const { createdAt, _id } = decodeCursor(cursor);
    filter['$or'] = [
      { createdAt: { $lt: new Date(createdAt) } },
      { createdAt: new Date(createdAt), _id: { $lt: new mongoose.Types.ObjectId(_id) } },
    ];
  }

  const channels = await ChannelModel.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(clampedLimit + 1);

  const hasNextPage = channels.length > clampedLimit;
  const items = hasNextPage ? channels.slice(0, clampedLimit) : channels;
  const last = items[items.length - 1];
  const nextCursor = hasNextPage && last
    ? encodeCursor(last.createdAt, last._id.toString())
    : null;

  return { items: items.map(toView), nextCursor, hasNextPage };
}

// ── Update ────────────────────────────────────────────────────
export async function updateChannel(
  channelId: string,
  userId: string,
  userRole: string,
  input: UpdateChannelInput,
): Promise<ChannelView> {
  const channel = await ChannelModel.findById(channelId);
  if (!channel) throw Object.assign(new Error('Channel not found'), { code: 'NOT_FOUND' });

  const isMember = channel.members.some((m) => m.toString() === userId);
  if (!isMember) throw Object.assign(new Error('Access denied'), { code: 'FORBIDDEN' });

  if (input.isArchived !== undefined) {
    if (userRole !== 'admin' && userRole !== 'moderator') {
      throw Object.assign(new Error('Insufficient permissions to archive channel'), { code: 'FORBIDDEN' });
    }
  }

  const updated = await ChannelModel.findByIdAndUpdate(channelId, { $set: input }, { new: true });
  if (!updated) throw Object.assign(new Error('Channel not found'), { code: 'NOT_FOUND' });

  logger.info({ channelId, userId }, 'Channel updated');
  await publishChannelEvent('channel.updated', channelId);
  return toView(updated);
}

// ── Delete (admin only) ───────────────────────────────────────
export async function deleteChannel(channelId: string, userId: string): Promise<void> {
  const channel = await ChannelModel.findByIdAndDelete(channelId);
  if (!channel) throw Object.assign(new Error('Channel not found'), { code: 'NOT_FOUND' });
  logger.info({ channelId, userId }, 'Channel deleted');
  await publishChannelEvent('channel.deleted', channelId);
}

// ── Add member ────────────────────────────────────────────────
export async function addMember(
  channelId: string,
  requesterId: string,
  targetUserId: string,
): Promise<ChannelView> {
  const channel = await ChannelModel.findById(channelId);
  if (!channel) throw Object.assign(new Error('Channel not found'), { code: 'NOT_FOUND' });

  const isMember = channel.members.some((m) => m.toString() === requesterId);
  if (!isMember) throw Object.assign(new Error('Access denied'), { code: 'FORBIDDEN' });

  const alreadyMember = channel.members.some((m) => m.toString() === targetUserId);
  if (alreadyMember) throw Object.assign(new Error('User is already a member'), { code: 'CONFLICT' });

  channel.members.push(new mongoose.Types.ObjectId(targetUserId) as unknown as (typeof channel.members)[number]);
  await channel.save();

  logger.info({ channelId, targetUserId, requesterId }, 'Member added to channel');
  await publishChannelEvent('channel.updated', channelId);
  return toView(channel);
}

// ── Remove member ─────────────────────────────────────────────
export async function removeMember(
  channelId: string,
  requesterId: string,
  requesterRole: string,
  targetUserId: string,
): Promise<void> {
  const channel = await ChannelModel.findById(channelId);
  if (!channel) throw Object.assign(new Error('Channel not found'), { code: 'NOT_FOUND' });

  const canRemove =
    requesterId === targetUserId || requesterRole === 'admin' || requesterRole === 'moderator';
  if (!canRemove) throw Object.assign(new Error('Insufficient permissions'), { code: 'FORBIDDEN' });

  const memberIndex = channel.members.findIndex((m) => m.toString() === targetUserId);
  if (memberIndex === -1) throw Object.assign(new Error('User is not a member'), { code: 'NOT_FOUND' });

  channel.members.splice(memberIndex, 1);
  await channel.save();

  logger.info({ channelId, targetUserId, requesterId }, 'Member removed from channel');
  await publishChannelEvent('channel.updated', channelId);
}