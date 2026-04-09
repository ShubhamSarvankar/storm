import { Router, type Request, type Response } from 'express';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  buildSuccess,
  buildError,
  ERROR_CODES,
} from '@storm/shared';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { publicRateLimit } from '../middleware/rate-limit.js';
import * as authService from '../services/auth.service.js';

export const authRouter = Router();

// POST /auth/register
authRouter.post(
  '/register',
  publicRateLimit,
  validate(registerSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tokens = await authService.register(req.body as Parameters<typeof authService.register>[0]);
      res.status(201).json(buildSuccess(tokens, { requestId: req.headers['x-request-id'] as string }));
    } catch (err) {
      handleAuthError(err, res);
    }
  },
);

// POST /auth/login
authRouter.post(
  '/login',
  publicRateLimit,
  validate(loginSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tokens = await authService.login(req.body as Parameters<typeof authService.login>[0]);
      res.status(200).json(buildSuccess(tokens, { requestId: req.headers['x-request-id'] as string }));
    } catch (err) {
      handleAuthError(err, res);
    }
  },
);

// POST /auth/refresh
authRouter.post(
  '/refresh',
  publicRateLimit,
  validate(refreshTokenSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { refreshToken } = req.body as { refreshToken: string };
      const tokens = await authService.refresh(refreshToken);
      res.status(200).json(buildSuccess(tokens, { requestId: req.headers['x-request-id'] as string }));
    } catch (err) {
      handleAuthError(err, res);
    }
  },
);

// POST /auth/logout
authRouter.post(
  '/logout',
  authenticate,
  validate(refreshTokenSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { refreshToken } = req.body as { refreshToken: string };
      await authService.logout(refreshToken);
      res.status(200).json(buildSuccess({}, { requestId: req.headers['x-request-id'] as string }));
    } catch (err) {
      handleAuthError(err, res);
    }
  },
);

// ── Error normaliser ─────────────────────────────────────────
function handleAuthError(err: unknown, res: Response): void {
  if (err instanceof Error && 'code' in err) {
    const code = (err as Error & { code: string }).code;
    if (code === 'CONFLICT') {
      res.status(409).json(buildError(ERROR_CODES.CONFLICT, err.message));
      return;
    }
    if (code === 'TOKEN_REUSE_DETECTED') {
      res.status(401).json(buildError(ERROR_CODES.TOKEN_REUSE_DETECTED, err.message));
      return;
    }
    if (code === 'UNAUTHORIZED') {
      res.status(401).json(buildError(ERROR_CODES.UNAUTHORIZED, err.message));
      return;
    }
  }
  // Re-throw anything unexpected — global error handler catches it
  throw err;
}