import { Router, type Request, type Response } from 'express';
import {
  createChannelSchema,
  updateChannelSchema,
  addChannelMemberSchema,
  paginationQuerySchema,
  buildSuccess,
  buildError,
  ERROR_CODES,
  clampLimit,
} from '@storm/shared';
import { authenticate, authorize } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { authRateLimit } from '../middleware/rate-limit.js';
import * as channelService from '../services/channel.service.js';

export const channelRouter = Router();

channelRouter.use(authenticate);

// GET /channels
channelRouter.get(
  '/',
  validate(paginationQuerySchema, 'query'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const cursor = req.query['cursor'] as string | undefined;
      const limit = clampLimit(Number(req.query['limit']));
      const includeArchived = req.query['includeArchived'] === 'true';
      const result = await channelService.listChannels(req.user!.sub, cursor, limit, includeArchived);
      res.json(
        buildSuccess(
          { channels: result.items },
          {
            requestId: req.headers['x-request-id'] as string,
            nextCursor: result.nextCursor,
            hasNextPage: result.hasNextPage,
          },
        ),
      );
    } catch (err) {
      handleChannelError(err, res);
    }
  },
);

// POST /channels
channelRouter.post(
  '/',
  authRateLimit,
  validate(createChannelSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const channel = await channelService.createChannel(
        req.user!.sub,
        req.body as Parameters<typeof channelService.createChannel>[1],
      );
      res.status(201).json(
        buildSuccess(channel, { requestId: req.headers['x-request-id'] as string }),
      );
    } catch (err) {
      handleChannelError(err, res);
    }
  },
);

// GET /channels/:channelId
channelRouter.get('/:channelId', async (req: Request, res: Response): Promise<void> => {
  try {
    const channelId = req.params['channelId'] as string;
    const channel = await channelService.getChannelById(channelId, req.user!.sub);
    res.json(buildSuccess(channel, { requestId: req.headers['x-request-id'] as string }));
  } catch (err) {
    handleChannelError(err, res);
  }
});

// PATCH /channels/:channelId
channelRouter.patch(
  '/:channelId',
  validate(updateChannelSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const channelId = req.params['channelId'] as string;
      const channel = await channelService.updateChannel(
        channelId,
        req.user!.sub,
        req.user!.role,
        req.body as Parameters<typeof channelService.updateChannel>[3],
      );
      res.json(buildSuccess(channel, { requestId: req.headers['x-request-id'] as string }));
    } catch (err) {
      handleChannelError(err, res);
    }
  },
);

// DELETE /channels/:channelId — admin only
channelRouter.delete(
  '/:channelId',
  authorize('admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const channelId = req.params['channelId'] as string;
      await channelService.deleteChannel(channelId, req.user!.sub);
      res.json(buildSuccess({}, { requestId: req.headers['x-request-id'] as string }));
    } catch (err) {
      handleChannelError(err, res);
    }
  },
);

// POST /channels/:channelId/members
channelRouter.post(
  '/:channelId/members',
  validate(addChannelMemberSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const channelId = req.params['channelId'] as string;
      const { userId } = req.body as { userId: string };
      const channel = await channelService.addMember(channelId, req.user!.sub, userId);
      res.json(buildSuccess(channel, { requestId: req.headers['x-request-id'] as string }));
    } catch (err) {
      handleChannelError(err, res);
    }
  },
);

// DELETE /channels/:channelId/members/:userId
channelRouter.delete(
  '/:channelId/members/:userId',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const channelId = req.params['channelId'] as string;
      const targetUserId = req.params['userId'] as string;
      await channelService.removeMember(channelId, req.user!.sub, req.user!.role, targetUserId);
      res.json(buildSuccess({}, { requestId: req.headers['x-request-id'] as string }));
    } catch (err) {
      handleChannelError(err, res);
    }
  },
);

function handleChannelError(err: unknown, res: Response): void {
  if (err instanceof Error && 'code' in err) {
    const code = (err as Error & { code: string }).code;
    if (code === 'NOT_FOUND') {
      res.status(404).json(buildError(ERROR_CODES.NOT_FOUND, err.message));
      return;
    }
    if (code === 'CONFLICT') {
      res.status(409).json(buildError(ERROR_CODES.CONFLICT, err.message));
      return;
    }
    if (code === 'FORBIDDEN') {
      res.status(403).json(buildError(ERROR_CODES.FORBIDDEN, err.message));
      return;
    }
  }
  throw err;
}