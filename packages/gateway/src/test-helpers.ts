import { signJwt as coreSignJwt } from '@storm/shared';
import type { Role } from '@storm/shared';
import { clearAll } from './connection-store.js';

// Re-export clearAll for test teardown
export { clearAll };

// Sign a JWT for testing — expiresInSeconds defaults to 15 min
// Pass a negative value to create an already-expired token
export function signJwt(
  sub: string,
  role: Role,
  expiresInSeconds = 900,
): string {
  return coreSignJwt(sub, role, { expiresInSeconds });
}