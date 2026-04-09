import type { Request, Response, NextFunction } from 'express';
import { type ZodSchema, ZodError } from 'zod';
import { buildError, ERROR_CODES } from '@storm/shared';

type Target = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, target: Target = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const details = formatZodError(result.error);
      res
        .status(400)
        .json(buildError(ERROR_CODES.VALIDATION_ERROR, 'Request validation failed', details));
      return;
    }
    // Only reassign body — Express 5 query/params are read-only getters
    if (target === 'body') {
      req[target] = result.data as Request[Target];
    }
    next();
  };
}

function formatZodError(err: ZodError): Record<string, unknown> {
  return Object.fromEntries(
    err.errors.map((e) => [e.path.join('.') || 'root', e.message]),
  );
}