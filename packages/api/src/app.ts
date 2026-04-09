import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'crypto';
import { createLogger, buildError, ERROR_CODES } from '@storm/shared';
import { authRouter } from './routes/auth.routes.js';
import { userRouter } from './routes/user.routes.js';
import { channelRouter } from './routes/channel.routes.js';
import { messageRouter } from './routes/message.routes.js';

const logger = createLogger('api');

export function createApp(): express.Application {
  const app = express();

  // Trust the nginx reverse proxy so req.ip reflects the real client IP
  // (required for correct rate-limit key generation)
  app.set('trust proxy', 1);

  // ── Security headers ──────────────────────────────────────
  app.use(helmet());

  // ── CORS ──────────────────────────────────────────────────
  const allowedOrigins = (process.env['CORS_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
    }),
  );

  // ── Request ID ────────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.headers['x-request-id'] ??= randomUUID();
    res.setHeader('x-request-id', req.headers['x-request-id'] as string);
    next();
  });

  // ── Structured logging ────────────────────────────────────
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.headers['x-request-id'] as string,
      redact: ['req.headers.authorization', 'req.body.password', 'req.body.refreshToken'],
    }),
  );

  // ── Body parsing ──────────────────────────────────────────
  app.use(express.json({ limit: '16kb' }));

  // ── Routes ────────────────────────────────────────────────
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', userRouter);
  app.use('/api/v1/channels', channelRouter);
  app.use('/api/v1/channels/:channelId/messages', messageRouter);

  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // ── 404 handler ───────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json(buildError(ERROR_CODES.NOT_FOUND, 'Route not found'));
  });

  // ── Global error handler ──────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.headers['x-request-id'] as string | undefined;
    logger.error({ err, requestId }, 'Unhandled error');
    res
      .status(500)
      .json(buildError(ERROR_CODES.INTERNAL_ERROR, 'An unexpected error occurred'));
  });

  return app;
}