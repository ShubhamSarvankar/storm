import { describe, it, expect, beforeEach } from 'vitest';
import { encryptMessage, decryptMessage } from './crypto.js';

const TEST_KEY = 'a'.repeat(64); // 32 bytes as hex

beforeEach(() => {
  process.env['MESSAGE_ENCRYPTION_KEY'] = TEST_KEY;
});

describe('encryptMessage', () => {
  it('returns base64 encryptedContent, iv, and authTag', () => {
    const result = encryptMessage('hello world');
    expect(result.encryptedContent).toBeTruthy();
    expect(result.iv).toBeTruthy();
    expect(result.authTag).toBeTruthy();
    // All three should be valid base64
    expect(() => Buffer.from(result.encryptedContent, 'base64')).not.toThrow();
    expect(() => Buffer.from(result.iv, 'base64')).not.toThrow();
    expect(() => Buffer.from(result.authTag, 'base64')).not.toThrow();
  });

  it('produces a unique IV on every call', () => {
    const a = encryptMessage('same plaintext');
    const b = encryptMessage('same plaintext');
    expect(a.iv).not.toBe(b.iv);
    expect(a.encryptedContent).not.toBe(b.encryptedContent);
  });

  it('throws if MESSAGE_ENCRYPTION_KEY is not set', () => {
    delete process.env['MESSAGE_ENCRYPTION_KEY'];
    expect(() => encryptMessage('hello')).toThrow('MESSAGE_ENCRYPTION_KEY');
  });

  it('throws if MESSAGE_ENCRYPTION_KEY is the wrong length', () => {
    process.env['MESSAGE_ENCRYPTION_KEY'] = 'tooshort';
    expect(() => encryptMessage('hello')).toThrow();
  });
});

describe('decryptMessage', () => {
  it('round-trips plaintext correctly', () => {
    const plaintext = 'The quick brown fox jumps over the lazy dog';
    const encrypted = encryptMessage(plaintext);
    const decrypted = decryptMessage(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('round-trips unicode content', () => {
    const plaintext = '🔒 Héllo wörld — こんにちは';
    const encrypted = encryptMessage(plaintext);
    expect(decryptMessage(encrypted)).toBe(plaintext);
  });

  it('round-trips an empty string', () => {
    // Edge case: empty content is valid
    const encrypted = encryptMessage('');
    expect(decryptMessage(encrypted)).toBe('');
  });

  it('throws on a tampered authTag', () => {
    const encrypted = encryptMessage('sensitive data');
    const tampered = {
      ...encrypted,
      authTag: Buffer.from('bad_tag_bad_tag__').toString('base64'),
    };
    expect(() => decryptMessage(tampered)).toThrow();
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = encryptMessage('sensitive data');
    const buf = Buffer.from(encrypted.encryptedContent, 'base64');
    buf[0] = buf[0] !== undefined ? buf[0] ^ 0xff : 0xff; // flip bits
    const tampered = { ...encrypted, encryptedContent: buf.toString('base64') };
    expect(() => decryptMessage(tampered)).toThrow();
  });
});