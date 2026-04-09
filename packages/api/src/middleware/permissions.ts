import type { Request, Response, NextFunction } from 'express';
import { hasPermission, buildError, ERROR_CODES, type Permission } from '@storm/shared';

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json(buildError(ERROR_CODES.UNAUTHORIZED, 'Authentication required'));
      return;
    }
    if (!hasPermission(req.user.role, permission)) {
      res.status(403).json(buildError(ERROR_CODES.FORBIDDEN, 'Insufficient permissions'));
      return;
    }
    next();
  };
}