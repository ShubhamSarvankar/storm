import { Router, type Request, type Response } from 'express';
import {
  sendMessageSchema,
  paginationQuerySchema,
  buildSuccess,
  buildError,
  ERROR_CODES,
  clampLimit,
} from '@storm/shared';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { authRateLimit } from '../middleware/rate-limit.js';
import * as messageService from '../services/message.service.js';

export const messageRouter = Router({ mergeParams: true });

messageRouter.use(authenticate);

// GET /channels/:channelId/messages
messageRouter.get(
  '/',
  validate(paginationQuerySchema, 'query'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const channelId = req.params['channelId'] as string;
      const cursor = req.query['cursor'] as string | undefined;
      const limit = clampLimit(Number(req.query['limit']));

      const result = await messageService.getMessageHistory(
        channelId,
        req.user!.sub,
        cursor,
        limit,
      );

      res.json(
        buildSuccess(
          { messages: result.items },
          {
            requestId: req.headers['x-request-id'] as string,
            nextCursor: result.nextCursor,
            hasNextPage: result.hasNextPage,
          },
        ),
      );
    } catch (err) {
      handleMessageError(err, res);
    }
  },
);

// POST /channels/:channelId/messages
messageRouter.post(
  '/',
  authRateLimit,
  validate(sendMessageSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const channelId = req.params['channelId'] as string;
      const result = await messageService.sendMessage(
        channelId,
        req.user!.sub,
        req.body as Parameters<typeof messageService.sendMessage>[2],
      );
      res.status(202).json(
        buildSuccess(result, { requestId: req.headers['x-request-id'] as string }),
      );
    } catch (err) {
      handleMessageError(err, res);
    }
  },
);

// DELETE /channels/:channelId/messages/:messageId
messageRouter.delete(
  '/:messageId',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const channelId = req.params['channelId'] as string;
      const messageId = req.params['messageId'] as string;
      await messageService.deleteMessage(
        channelId,
        messageId,
        req.user!.sub,
        req.user!.role,
      );
      res.json(buildSuccess({}, { requestId: req.headers['x-request-id'] as string }));
    } catch (err) {
      handleMessageError(err, res);
    }
  },
);

function handleMessageError(err: unknown, res: Response): void {
  if (err instanceof Error && 'code' in err) {
    const code = (err as Error & { code: string }).code;
    if (code === 'NOT_FOUND') {
      res.status(404).json(buildError(ERROR_CODES.NOT_FOUND, err.message));
      return;
    }
    if (code === 'FORBIDDEN') {
      res.status(403).json(buildError(ERROR_CODES.FORBIDDEN, err.message));
      return;
    }
  }
  throw err;
}