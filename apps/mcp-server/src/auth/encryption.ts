import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EncryptedEnvelope {
  iv: string;       // base64
  authTag: string;  // base64
  data: string;     // base64
}

// ── Key derivation ────────────────────────────────────────────────────────────

// Per-tenant key is derived from the master key using scrypt so that
// credentials encrypted for tenant A cannot be decrypted with tenant B's key.
function deriveKey(tenantId: string): Buffer {
  const masterKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!masterKey) throw new Error('TOKEN_ENCRYPTION_KEY env var is not set');
  return scryptSync(masterKey, tenantId, 32); // 32 bytes = AES-256
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Encrypts any JSON-serialisable object using AES-256-GCM.
 * Returns a base64-encoded JSON envelope: { iv, authTag, data }.
 *
 * NEVER log the return value — it is a reversible representation of secrets.
 */
export function encryptCredentials(data: object, tenantId: string): string {
  const key = deriveKey(tenantId);
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const envelope: EncryptedEnvelope = {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    data: encrypted.toString('base64'),
  };

  return Buffer.from(JSON.stringify(envelope)).toString('base64');
}

/**
 * Decrypts an envelope produced by encryptCredentials().
 * Verifies the GCM auth tag — throws if the ciphertext has been tampered with.
 *
 * NEVER log the return value.
 */
export function decryptCredentials(encrypted: string, tenantId: string): object {
  const key = deriveKey(tenantId);

  const envelope: EncryptedEnvelope = JSON.parse(
    Buffer.from(encrypted, 'base64').toString('utf8')
  );

  const iv = Buffer.from(envelope.iv, 'base64');
  const authTag = Buffer.from(envelope.authTag, 'base64');
  const data = Buffer.from(envelope.data, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}
