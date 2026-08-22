import crypto from 'crypto';
import { logger } from './logger';

// ============================================================================
// AT-REST ENCRYPTION for secrets stored in the DB (MFA TOTP secrets, connector
// API keys, etc). Uses Node's built-in crypto (AES-256-GCM), not the
// deprecated `crypto-js` package that was previously only a listed dependency
// with no actual encryption code anywhere in the codebase - columns named
// `*_encrypted` were storing plaintext until this was wired in.
// ============================================================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended for GCM

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and set it in the environment ' +
        'before storing or reading any encrypted secret (MFA, connector API keys).'
    );
  }
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be a 32-byte value, hex-encoded (64 hex characters).');
  }
  return key;
}

/**
 * Encrypts a plaintext string for storage. Output format: iv:authTag:ciphertext,
 * all hex-encoded, so it's a single string safe to store in a text column.
 */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a string produced by encryptSecret. Throws if the value isn't in
 * the expected format or the auth tag doesn't verify (tampered/corrupted).
 */
export function decryptSecret(stored: string): string {
  const key = getKey();
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('Stored secret is not in the expected iv:authTag:ciphertext format.');
  }
  const [ivHex, authTagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * True if a stored value looks like our encrypted format (iv:authTag:cipher,
 * three hex segments) rather than legacy plaintext. Lets read paths handle
 * pre-existing plaintext rows gracefully instead of crashing on them.
 */
export function looksEncrypted(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split(':');
  return parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p));
}

if (!process.env.ENCRYPTION_KEY) {
  logger.warn(
    '[encryption] ENCRYPTION_KEY is not set. MFA secrets and connector API keys cannot be encrypted or ' +
      'decrypted until it is configured - encryptSecret()/decryptSecret() will throw when called.'
  );
}
