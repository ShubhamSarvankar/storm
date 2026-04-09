import { Router, type Request, type Response } from 'express';
import {
  updateUserSchema,
  updatePasswordSchema,
  adminUpdateUserSchema,
  paginationQuerySchema,
  buildSuccess,
  buildError,
  ERROR_CODES,
  clampLimit,
  hasPermission,
} from '@storm/shared';
import { authenticate, authorize } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { authRateLimit } from '../middleware/rate-limit.js';
import * as userService from '../services/user.service.js';

export const userRouter = Router();

userRouter.use(authenticate);

// ── Permission guard (inline — avoids separate file resolution issue) ──
function guardPermission(req: Request, res: Response, permission: Parameters<typeof hasPermission>[1]): boolean {
  if (!req.user) {
    res.status(401).json(buildError(ERROR_CODES.UNAUTHORIZED, 'Authentication required'));
    return false;
  }
  if (!hasPermission(req.user.role, permission)) {
    res.status(403).json(buildError(ERROR_CODES.FORBIDDEN, 'Insufficient permissions'));
    return false;
  }
  return true;
}

// GET /users — admin only
userRouter.get(
  '/',
  authorize('admin'),
  validate(paginationQuerySchema, 'query'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const cursor = req.query['cursor'] as string | undefined;
      const limit = clampLimit(Number(req.query['limit']));
      const result = await userService.listUsers(cursor, limit);
      res.json(
        buildSuccess(
          { users: result.items },
          {
            requestId: req.headers['x-request-id'] as string,
            nextCursor: result.nextCursor,
            hasNextPage: result.hasNextPage,
          },
        ),
      );
    } catch (err) {
      handleUserError(err, res);
    }
  },
);

// GET /users/me
userRouter.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await userService.getUserById(req.user!.sub);
    res.json(buildSuccess(user, { requestId: req.headers['x-request-id'] as string }));
  } catch (err) {
    handleUserError(err, res);
  }
});

// PATCH /users/me
userRouter.patch(
  '/me',
  authRateLimit,
  validate(updateUserSchema),
  async (req: Request, res: Response): Promise<void> => {
    if (!guardPermission(req, res, 'user:update:own')) return;
    try {
      const user = await userService.updateUser(
        req.user!.sub,
        req.body as Parameters<typeof userService.updateUser>[1],
      );
      res.json(buildSuccess(user, { requestId: req.headers['x-request-id'] as string }));
    } catch (err) {
      handleUserError(err, res);
    }
  },
);

// PUT /users/me/password
userRouter.put(
  '/me/password',
  authRateLimit,
  validate(updatePasswordSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      await userService.updatePassword(
        req.user!.sub,
        req.body as Parameters<typeof userService.updatePassword>[1],
      );
      res.json(buildSuccess({}, { requestId: req.headers['x-request-id'] as string }));
    } catch (err) {
      handleUserError(err, res);
    }
  },
);

// GET /users/:userId
userRouter.get('/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.params['userId'] as string;
    const user = await userService.getUserById(userId);
    res.json(buildSuccess(user, { requestId: req.headers['x-request-id'] as string }));
  } catch (err) {
    handleUserError(err, res);
  }
});

// PATCH /users/:userId — admin only
userRouter.patch(
  '/:userId',
  authorize('admin'),
  validate(adminUpdateUserSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.params['userId'] as string;
      const user = await userService.adminUpdateUser(
        userId,
        req.body as Parameters<typeof userService.adminUpdateUser>[1],
      );
      res.json(buildSuccess(user, { requestId: req.headers['x-request-id'] as string }));
    } catch (err) {
      handleUserError(err, res);
    }
  },
);

// DELETE /users/:userId — admin only
userRouter.delete(
  '/:userId',
  authorize('admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.params['userId'] as string;
      await userService.deactivateUser(userId);
      res.json(buildSuccess({}, { requestId: req.headers['x-request-id'] as string }));
    } catch (err) {
      handleUserError(err, res);
    }
  },
);

function handleUserError(err: unknown, res: Response): void {
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
    if (code === 'UNAUTHORIZED') {
      res.status(401).json(buildError(ERROR_CODES.UNAUTHORIZED, err.message));
      return;
    }
  }
  throw err;
}