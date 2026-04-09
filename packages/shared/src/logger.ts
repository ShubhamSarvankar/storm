import pino from 'pino';

const REDACTED_PATHS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  'content',
  'encryptedContent',
  'email',
  '*.password',
  '*.token',
  '*.email',
];

export function createLogger(service: string): pino.Logger {
  return pino({
    name: service,
    level: process.env['LOG_LEVEL'] ?? 'info',
    redact: {
      paths: REDACTED_PATHS,
      censor: '[REDACTED]',
    },
    ...(process.env['NODE_ENV'] !== 'production' && {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    }),
  });
}