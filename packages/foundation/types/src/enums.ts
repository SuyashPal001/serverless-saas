// ============================================
// Identity & Auth
// ============================================
export const SessionStatus = {
  ACTIVE: 'active',
  INVALIDATED: 'invalidated',
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export const SessionInvalidatedReason = {
  ROLE_CHANGED: 'role_changed',
  SUSPENDED: 'suspended',
  LOGOUT: 'logout',
  EXPIRED: 'expired',
  TENANT_DELETED: 'tenant_deleted',
} as const;
export type SessionInvalidatedReason = (typeof SessionInvalidatedReason)[keyof typeof SessionInvalidatedReason];

export const AgentType = {
  OPS: 'ops',
  SUPPORT: 'support',
  BILLING: 'billing',
  CUSTOM: 'custom',
} as const;
export type AgentType = (typeof AgentType)[keyof typeof AgentType];

export const AgentStatus = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  RETIRED: 'retired',
} as const;
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

// ============================================
// Tenancy
// ============================================
export const TenantType = {
  INDIVIDUAL: 'individual',
  STARTUP: 'startup',
  BUSINESS: 'business',
  ENTERPRISE: 'enterprise',
} as const;
export type TenantType = (typeof TenantType)[keyof typeof TenantType];

export const TenantStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DELETED: 'deleted',
} as const;
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

export const MemberType = {
  HUMAN: 'human',
  AGENT: 'agent',
} as const;
export type MemberType = (typeof MemberType)[keyof typeof MemberType];

export const MembershipStatus = {
  ACTIVE: 'active',
  INVITED: 'invited',
  SUSPENDED: 'suspended',
} as const;
export type MembershipStatus = (typeof MembershipStatus)[keyof typeof MembershipStatus];

// ============================================
// Authorization
// ============================================
export const PermissionAction = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
} as const;
export type PermissionAction = (typeof PermissionAction)[keyof typeof PermissionAction];

// ============================================
// Billing
// ============================================
export const Plan = {
  FREE: 'free',
  STARTER: 'starter',
  BUSINESS: 'business',
  ENTERPRISE: 'enterprise',
} as const;
export type Plan = (typeof Plan)[keyof typeof Plan];

export const SubscriptionStatus = {
  ACTIVE: 'active',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  TRIALING: 'trialing',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const BillingCycle = {
  MONTHLY: 'monthly',
  ANNUAL: 'annual',
} as const;
export type BillingCycle = (typeof BillingCycle)[keyof typeof BillingCycle];

export const InvoiceStatus = {
  DRAFT: 'draft',
  OPEN: 'open',
  PAID: 'paid',
  VOID: 'void',
  UNCOLLECTIBLE: 'uncollectible',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const PaymentMethodType = {
  CARD: 'card',
  BANK_ACCOUNT: 'bank_account',
  INVOICE: 'invoice',
} as const;
export type PaymentMethodType = (typeof PaymentMethodType)[keyof typeof PaymentMethodType];

export const DisputeStatus = {
  OPEN: 'open',
  WON: 'won',
  LOST: 'lost',
  CLOSED: 'closed',
} as const;
export type DisputeStatus = (typeof DisputeStatus)[keyof typeof DisputeStatus];

export const BillingProvider = {
  STRIPE: 'stripe',
  PADDLE: 'paddle',
  CHARGEBEE: 'chargebee',
} as const;
export type BillingProvider = (typeof BillingProvider)[keyof typeof BillingProvider];

export const ActorType = {
  HUMAN: 'human',
  AGENT: 'agent',
  SYSTEM: 'system',
} as const;
export type ActorType = (typeof ActorType)[keyof typeof ActorType];

// ============================================
// Integrations
// ============================================
export const IntegrationStatus = {
  ACTIVE: 'active',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
} as const;
export type IntegrationStatus = (typeof IntegrationStatus)[keyof typeof IntegrationStatus];

export const LlmProvider = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  MISTRAL: 'mistral',
  OPENROUTER: 'openrouter',
} as const;
export type LlmProvider = (typeof LlmProvider)[keyof typeof LlmProvider];

export const EmailProvider = {
  SES: 'ses',
  SENDGRID: 'sendgrid',
  RESEND: 'resend',
  POSTMARK: 'postmark',
} as const;
export type EmailProvider = (typeof EmailProvider)[keyof typeof EmailProvider];

export const StorageProvider = {
  S3: 's3',
  GCS: 'gcs',
  R2: 'r2',
} as const;
export type StorageProvider = (typeof StorageProvider)[keyof typeof StorageProvider];

// ============================================
// AI Agents
// ============================================
export const WorkflowTrigger = {
  INCIDENT_CREATED: 'incident_created',
  SCHEDULED: 'scheduled',
  MANUAL: 'manual',
} as const;
export type WorkflowTrigger = (typeof WorkflowTrigger)[keyof typeof WorkflowTrigger];

export const WorkflowStatus = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  ARCHIVED: 'archived',
} as const;
export type WorkflowStatus = (typeof WorkflowStatus)[keyof typeof WorkflowStatus];

export const WorkflowRunStatus = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  AWAITING_APPROVAL: 'awaiting_approval',
} as const;
export type WorkflowRunStatus = (typeof WorkflowRunStatus)[keyof typeof WorkflowRunStatus];

// ============================================
// API Access
// ============================================
export const ApiKeyType = {
  REST: 'rest',
  MCP: 'mcp',
  OAUTH: 'oauth',
  AGENT: 'agent',
} as const;
export type ApiKeyType = (typeof ApiKeyType)[keyof typeof ApiKeyType];

export const ApiKeyStatus = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
} as const;
export type ApiKeyStatus = (typeof ApiKeyStatus)[keyof typeof ApiKeyStatus];

// ============================================
// Notifications
// ============================================
export const NotificationChannel = {
  EMAIL: 'email',
  SMS: 'sms',
  IN_APP: 'in_app',
  SLACK: 'slack',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationStepType = {
  CHANNEL: 'channel',
  DELAY: 'delay',
  CONDITION: 'condition',
} as const;
export type NotificationStepType = (typeof NotificationStepType)[keyof typeof NotificationStepType];

export const NotificationJobStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
export type NotificationJobStatus = (typeof NotificationJobStatus)[keyof typeof NotificationJobStatus];

export const DeliveryStatus = {
  QUEUED: 'queued',
  SENT: 'sent',
  DELIVERED: 'delivered',
  OPENED: 'opened',
  CLICKED: 'clicked',
  BOUNCED: 'bounced',
  FAILED: 'failed',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const PreferenceSetBy = {
  USER: 'user',
  TENANT_ADMIN: 'tenant_admin',
  PLATFORM: 'platform',
} as const;
export type PreferenceSetBy = (typeof PreferenceSetBy)[keyof typeof PreferenceSetBy];

// ============================================
// Entitlements
// ============================================
export const FeatureType = {
  BOOLEAN: 'boolean',
  LIMIT: 'limit',
  METERED: 'metered',
} as const;
export type FeatureType = (typeof FeatureType)[keyof typeof FeatureType];

export const FeatureResetPeriod = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
} as const;
export type FeatureResetPeriod = (typeof FeatureResetPeriod)[keyof typeof FeatureResetPeriod];

export const FeatureStatus = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
} as const;
export type FeatureStatus = (typeof FeatureStatus)[keyof typeof FeatureStatus];

// ============================================
// Webhooks
// ============================================
export const WebhookEndpointStatus = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
} as const;
export type WebhookEndpointStatus = (typeof WebhookEndpointStatus)[keyof typeof WebhookEndpointStatus];

// ============================================
// Audit
// ============================================
export const AuditSource = {
  UI: 'ui',
  API: 'api',
  AGENT: 'agent',
  SYSTEM: 'system',
  WEBHOOK: 'webhook',
} as const;
export type AuditSource = (typeof AuditSource)[keyof typeof AuditSource];
