import { randomUUID } from 'crypto';
import type { ErrorResponse, ResponseMeta, SuccessResponse } from './types.js';

export function buildMeta(overrides: Partial<ResponseMeta> = {}): ResponseMeta {
  return {
    requestId: overrides.requestId ?? randomUUID(),
    timestamp: new Date().toISOString(),
    ...(overrides.nextCursor !== undefined && { nextCursor: overrides.nextCursor }),
    ...(overrides.hasNextPage !== undefined && { hasNextPage: overrides.hasNextPage }),
  };
}

export function buildSuccess<T>(
  data: T,
  metaOverrides: Partial<ResponseMeta> = {},
): SuccessResponse<T> {
  return {
    success: true,
    data,
    meta: buildMeta(metaOverrides),
  };
}

export function buildError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
  };
}

// Canonical error codes — import these everywhere instead of raw strings
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];