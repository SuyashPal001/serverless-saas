import {
  GenerateDataKeyCommand,
  DecryptCommand,
  KMSClient,
} from "@aws-sdk/client-kms";
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const kmsClient = new KMSClient({ region: "ap-south-1" });

/**
 * Generate data key using AWS KMS. Returns plaintext key and encrypted key.
 */
export const generateDataKeyWithKMS = async (
  cmkKeyId: string
): Promise<{ plaintextKey: Buffer; encryptedKey: Buffer }> => {
  // console.log('\n\t generating key')
  const { Plaintext, CiphertextBlob } = await kmsClient.send(
    new GenerateDataKeyCommand({
      KeyId: cmkKeyId,
      KeySpec: "AES_256",
    })
  );
  if (!Plaintext || !CiphertextBlob) {
    throw new Error("Failed to generate data key");
  }
  //   console.log('\n\t generated plaintext: ', Plaintext)
  //   console.log('\n\t generated ciphertext: ', CiphertextBlob)
  return {
    plaintextKey: Buffer.from(Plaintext as Uint8Array),
    encryptedKey: Buffer.from(CiphertextBlob as Uint8Array),
  };
};

/**
 * Encrypts input data (Buffer or string) using AES-256-GCM with the provided key.
 */
export const encryptData = (
  data: Buffer | string,
  key: Buffer
): { encryptedData: Buffer; iv: Buffer; authTag: Buffer } => {
  // console.log('\n\t encrypting data');
  const bufferData = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  const iv = crypto.randomBytes(16); // 16 bytes for AES
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(bufferData), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { encryptedData: encrypted, iv, authTag };
};

/**
 * Decrypts input data (Buffer or string) using AES-256-GCM with the provided key, IV, and authentication tag.
 */
export const decryptData = (
  encryptedData: Buffer | string,
  key: Buffer,
  iv: Buffer,
  authTag: Buffer
): Buffer => {
  const encryptedBuffer = Buffer.isBuffer(encryptedData)
    ? encryptedData
    : Buffer.from(encryptedData, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
};

/**
 * Uses AWS KMS to decrypt the encryptedKey and return the plaintext key.
 */
export const decryptDataKeyWithKMS = async (
  encryptedKey: Buffer
): Promise<Buffer> => {
  const { Plaintext } = await kmsClient.send(
    new DecryptCommand({
      CiphertextBlob: encryptedKey,
    })
  );
  if (!Plaintext) {
    throw new Error("Failed to decrypt data key");
  }
  return Buffer.from(Plaintext as Uint8Array);
};
