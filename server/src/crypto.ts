// Encryption of player keys at rest (AES-256-GCM) and session token helpers.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';

function keyFrom(masterKeyBase64: string): Buffer {
  const key = Buffer.from(masterKeyBase64, 'base64');
  if (key.length !== 32) throw new Error('MASTER_KEY must be 32 bytes encoded as base64');
  return key;
}

/** Encrypts a secret. Output: "v1:<iv>:<tag>:<ciphertext>" (base64 parts). */
export function encryptSecret(plaintext: string, masterKeyBase64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(masterKeyBase64), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(encrypted: string, masterKeyBase64: string): string {
  const [version, iv, tag, ciphertext] = encrypted.split(':');
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error('Unknown secret format');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(masterKeyBase64), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Deterministic number in [0, 1) from a text seed (used for daily prices). */
export function seededRandom(seed: string): number {
  const h = createHash('sha256').update(seed).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000;
}
