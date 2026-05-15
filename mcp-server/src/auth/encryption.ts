import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

interface EncryptedPayload {
  iv: string;
  authTag: string;
  data: string;
}

function deriveKey(tenantId: string): Buffer {
  const masterKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!masterKey) throw new Error('TOKEN_ENCRYPTION_KEY env var not set');
  return scryptSync(masterKey, tenantId, 32);
}

/**
 * Encrypts a plaintext string using AES-256-GCM with a per-tenant key
 * derived from the master key via scrypt(masterKey, tenantId, 32).
 *
 * Returns a base64-encoded JSON envelope: { iv, authTag, data }.
 * Never log the return value — it contains encrypted token material.
 */
export function encryptToken(plaintext: string, tenantId: string): string {
  const key = deriveKey(tenantId);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload: EncryptedPayload = {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    data: encrypted.toString('base64'),
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Decrypts a token previously encrypted with encryptToken().
 * Verifies the GCM auth tag — throws if tampered.
 */
export function decryptToken(encrypted: string, tenantId: string): string {
  const key = deriveKey(tenantId);
  const payload: EncryptedPayload = JSON.parse(
    Buffer.from(encrypted, 'base64').toString('utf8')
  );
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const data = Buffer.from(payload.data, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}
