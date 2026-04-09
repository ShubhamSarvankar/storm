import type { Request, Response, NextFunction } from 'express';
import { verifyJwt, buildError, ERROR_CODES, type JwtPayload, type Role } from '@storm/shared';

// Augment Express Request to carry the verified JWT payload.
// The namespace declaration is intentional — this is the only supported way
// to extend Express's Request interface in TypeScript.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json(buildError(ERROR_CODES.UNAUTHORIZED, 'Authentication required'));
    return;
  }

  const token = authHeader.slice(7);
  const result = verifyJwt(token);

  if (!result.valid) {
    const code = result.reason === 'expired' ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.TOKEN_INVALID;
    const msg = result.reason === 'expired' ? 'Access token has expired' : 'Invalid access token';
    res.status(401).json(buildError(code, msg));
    return;
  }

  req.user = result.payload;
  next();
}

export function authorize(requiredRole: Role) {
  const hierarchy: Record<Role, number> = { member: 0, moderator: 1, admin: 2 };

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json(buildError(ERROR_CODES.UNAUTHORIZED, 'Authentication required'));
      return;
    }
    if (hierarchy[req.user.role] < hierarchy[requiredRole]) {
      res.status(403).json(buildError(ERROR_CODES.FORBIDDEN, 'Insufficient permissions'));
      return;
    }
    next();
  };
}