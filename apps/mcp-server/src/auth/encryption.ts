import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from 'crypto'

export function encryptCredentials(data: object, tenantId: string): string {
  const masterKey = process.env.TOKEN_ENCRYPTION_KEY!
  const key = scryptSync(masterKey, tenantId, 32)
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final()
  ])
  const authTag = cipher.getAuthTag()
  return Buffer.from(JSON.stringify({
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    data: encrypted.toString('base64')
  })).toString('base64')
}

export function decryptCredentials(encrypted: string, tenantId: string): any {
  const masterKey = process.env.TOKEN_ENCRYPTION_KEY!
  const key = scryptSync(masterKey, tenantId, 32)
  const { iv, authTag, data } = JSON.parse(
    Buffer.from(encrypted, 'base64').toString('utf8')
  )
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(authTag, 'base64'))
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final()
    ]).toString('utf8')
  )
}
