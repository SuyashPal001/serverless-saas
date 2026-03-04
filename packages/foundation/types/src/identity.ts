import type { Timestamps, SoftDeletable } from './common';
import type { SessionStatus, SessionInvalidatedReason, AgentType, AgentStatus } from './enums';

// ============================================
// User
// ============================================

export interface User extends Timestamps, SoftDeletable {
  id: string;
  cognitoId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export type CreateUserInput = Pick<User, 'cognitoId' | 'email' | 'name'> & {
  avatarUrl?: string;
};

export type UpdateUserInput = Partial<Pick<User, 'name' | 'avatarUrl'>>;

// ============================================
// Session
// ============================================

export interface Session extends Pick<Timestamps, 'createdAt'> {
  id: string;
  userId: string;
  tenantId: string;
  jwtId: string;
  status: SessionStatus;
  invalidatedAt: Date | null;
  invalidatedReason: SessionInvalidatedReason | null;
  expiresAt: Date;
}

export type CreateSessionInput = Pick<Session, 'userId' | 'tenantId' | 'jwtId' | 'expiresAt'>;

// ============================================
// Agent
// ============================================

export interface Agent extends Timestamps {
  id: string;
  tenantId: string;
  name: string;
  type: AgentType;
  model: string | null;
  status: AgentStatus;
  apiKeyId: string;
  llmProviderId: string | null;
  createdBy: string;
}

export type CreateAgentInput = Pick<Agent, 'tenantId' | 'name' | 'type' | 'createdBy'> & {
  model?: string;
  llmProviderId?: string;
};

export type UpdateAgentInput = Partial<Pick<Agent, 'name' | 'type' | 'model' | 'status' | 'llmProviderId'>>;
