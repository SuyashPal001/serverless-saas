import type { Timestamps } from './common';
import type { ApiKeyType, ApiKeyStatus } from './enums';

// ============================================
// API Key
// ============================================

export interface ApiKey extends Timestamps {
  id: string;
  tenantId: string;
  name: string;
  keyHash: string;
  type: ApiKeyType;
  permissions: string[];
  status: ApiKeyStatus;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdBy: string;
  revokedAt: Date | null;
  revokedBy: string | null;
}

export type CreateApiKeyInput = Pick<ApiKey, 'tenantId' | 'name' | 'type' | 'permissions' | 'createdBy'> & {
  expiresAt?: Date;
};

/** Returned once at creation — never stored or retrievable again */
export interface ApiKeyCreatedResponse {
  id: string;
  rawKey: string;
  name: string;
  type: ApiKeyType;
  permissions: string[];
  expiresAt: Date | null;
  createdAt: Date;
}
