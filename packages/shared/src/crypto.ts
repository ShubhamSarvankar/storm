import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface EncryptedPayload {
  encryptedContent: string;  // base64 ciphertext
  iv: string;                // base64 IV
  authTag: string;           // base64 GCM auth tag
}

function getKey(): Buffer {
  const hex = process.env['MESSAGE_ENCRYPTION_KEY'];
  if (!hex) {
    throw new Error('MESSAGE_ENCRYPTION_KEY environment variable is not set');
  }
  if (hex.length !== KEY_BYTES * 2) {
    throw new Error(
      `MESSAGE_ENCRYPTION_KEY must be ${KEY_BYTES * 2} hex characters (${KEY_BYTES} bytes)`
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encryptMessage(plaintext: string): EncryptedPayload {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    encryptedContent: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptMessage(payload: EncryptedPayload): string {
  const key = getKey();
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const encryptedContent = Buffer.from(payload.encryptedContent, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(authTag);

  return (
    decipher.update(encryptedContent).toString('utf8') +
    decipher.final('utf8')
  );
}