/**
 * Encryption utilities for secrets
 *
 * Handles decryption of API keys stored in llm_providers.api_key_encrypted.
 *
 * TODO: Replace with AWS KMS decrypt once production key management is wired.
 * Check how integrations.credentials_enc is handled elsewhere in the codebase
 * and align with that approach.
 *
 * Current convention (dev/staging):
 *   - Plaintext stored as-is
 *   - Simple base64-wrapped values prefixed with "enc:"
 */

/**
 * Decrypt a secret value from the database.
 *
 * @param encryptedValue - Raw value from api_key_encrypted column
 * @returns Decrypted plaintext
 */
export function decryptSecret(encryptedValue: string): string {
  if (encryptedValue.startsWith('enc:')) {
    // Simple base64 envelope used in dev/staging
    const encoded = encryptedValue.slice(4);
    return Buffer.from(encoded, 'base64').toString('utf-8');
  }

  // Plaintext fallback (dev mode or pre-encryption migration)
  return encryptedValue;
}

/**
 * Encrypt a secret for storage.
 *
 * TODO: Use KMS in production.
 */
export function encryptSecret(plainValue: string): string {
  return `enc:${Buffer.from(plainValue).toString('base64')}`;
}
