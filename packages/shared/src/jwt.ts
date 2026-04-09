import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import type { JwtPayload, Role } from './types.js';
import { JWT_ALGORITHM } from './constants.js';

// Minimal hand-rolled HS256 JWT — no external dependency.
// Only used internally; never expose raw token bytes in logs.

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

function getSecret(): Buffer {
  const secret = process.env['JWT_SECRET'];
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return Buffer.from(secret, 'hex');
}

export interface SignOptions {
  expiresInSeconds: number;
}

export function signJwt(
  sub: string,
  role: Role,
  options: SignOptions,
): string {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);
  const jti = randomBytes(16).toString('hex');

  const header = base64url(Buffer.from(JSON.stringify({ alg: JWT_ALGORITHM, typ: 'JWT' })));
  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        sub,
        role,
        jti,
        iat: now,
        exp: now + options.expiresInSeconds,
      } satisfies JwtPayload),
    ),
  );

  const signature = base64url(
    createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest(),
  );

  return `${header}.${payload}.${signature}`;
}

export interface VerifyResult {
  valid: true;
  payload: JwtPayload;
}

export interface VerifyError {
  valid: false;
  reason: 'expired' | 'invalid';
}

export function verifyJwt(token: string): VerifyResult | VerifyError {
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'invalid' };

  const [header, payloadB64, sig] = parts as [string, string, string];

  const secret = getSecret();
  const expected = base64url(
    createHmac('sha256', secret)
      .update(`${header}.${payloadB64}`)
      .digest(),
  );

  // Timing-safe comparison
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(sig);
  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    return { valid: false, reason: 'invalid' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return { valid: false, reason: 'invalid' };
  }

  if (!isJwtPayload(payload)) return { valid: false, reason: 'invalid' };

  if (Math.floor(Date.now() / 1000) > payload.exp) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, payload };
}

function isJwtPayload(val: unknown): val is JwtPayload {
  if (typeof val !== 'object' || val === null) return false;
  const v = val as Record<string, unknown>;
  return (
    typeof v['sub'] === 'string' &&
    typeof v['role'] === 'string' &&
    typeof v['jti'] === 'string' &&
    typeof v['iat'] === 'number' &&
    typeof v['exp'] === 'number'
  );
}