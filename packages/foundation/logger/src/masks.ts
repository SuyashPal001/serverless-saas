const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'apiKey',
  'credential',
  'credentials',
  'credentialsEnc',
  'apiKeyEncrypted',
  'keyHash',
  'authorization',
]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***@***';
  return `${local[0]}***@${domain}`;
};

const maskIp = (ip: string): string => {
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.x.x`;
  }
  return '***';
};

export const maskValue = (key: string, value: unknown): unknown => {
  if (value === null || value === undefined) return value;

  const keyLower = key.toLowerCase();

  if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(keyLower)) {
    return '***';
  }

  if (typeof value === 'string') {
    if (keyLower === 'authorization') {
      return value.startsWith('Bearer ') ? 'Bearer ***' : '***';
    }
    if (keyLower === 'email' && EMAIL_REGEX.test(value)) {
      return maskEmail(value);
    }
    if (keyLower === 'ipaddress' || keyLower === 'ip_address' || keyLower === 'ip') {
      return maskIp(value);
    }
  }

  return value;
};

export const maskObject = (obj: Record<string, unknown>): Record<string, unknown> => {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      masked[key] = maskObject(value as Record<string, unknown>);
    } else {
      masked[key] = maskValue(key, value);
    }
  }
  return masked;
};
