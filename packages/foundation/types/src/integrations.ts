import type { Timestamps } from './common';
import type { IntegrationStatus, LlmProvider, EmailProvider, StorageProvider } from './enums';

// ============================================
// Integration (external MCP servers)
// ============================================

export interface Integration extends Timestamps {
  id: string;
  tenantId: string;
  provider: string;
  mcpServerUrl: string;
  credentialsEnc: string;
  status: IntegrationStatus;
  permissions: string[];
  createdBy: string;
}

export type CreateIntegrationInput = Pick<Integration, 'tenantId' | 'provider' | 'mcpServerUrl' | 'credentialsEnc' | 'permissions' | 'createdBy'>;

export type UpdateIntegrationInput = Partial<Pick<Integration, 'mcpServerUrl' | 'credentialsEnc' | 'status' | 'permissions'>>;

// ============================================
// LLM Provider
// ============================================

export interface LlmProviderRecord extends Pick<Timestamps, 'createdAt'> {
  id: string;
  tenantId: string | null;
  provider: LlmProvider;
  model: string;
  apiKeyEncrypted: string;
  isDefault: boolean;
  costPerToken: number | null;
}

// ============================================
// Email Provider
// ============================================

export interface EmailProviderRecord extends Pick<Timestamps, 'createdAt'> {
  id: string;
  tenantId: string | null;
  provider: EmailProvider;
  credentialsEnc: string;
  fromDomain: string | null;
  isDefault: boolean;
}

// ============================================
// Storage Provider
// ============================================

export interface StorageProviderRecord extends Pick<Timestamps, 'createdAt'> {
  id: string;
  tenantId: string | null;
  provider: StorageProvider;
  bucket: string;
  region: string | null;
  credentialsEnc: string;
  isDefault: boolean;
}
