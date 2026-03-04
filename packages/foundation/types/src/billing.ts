import type { Timestamps } from './common';
import type {
  Plan,
  SubscriptionStatus,
  BillingCycle,
  InvoiceStatus,
  PaymentMethodType,
  DisputeStatus,
  BillingProvider,
  ActorType,
} from './enums';

// ============================================
// Subscription
// ============================================

export interface Subscription extends Pick<Timestamps, 'createdAt'> {
  id: string;
  tenantId: string;
  plan: Plan;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  startedAt: Date;
  endedAt: Date | null;
  trialEndsAt: Date | null;
}

export type CreateSubscriptionInput = Pick<Subscription, 'tenantId' | 'plan' | 'billingCycle'> & {
  trialEndsAt?: Date;
};

// ============================================
// Invoice
// ============================================

export interface Invoice extends Pick<Timestamps, 'createdAt'> {
  id: string;
  tenantId: string;
  subscriptionId: string | null;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  dueAt: Date | null;
  paidAt: Date | null;
  externalId: string | null;
}

// ============================================
// Payment Method
// ============================================

export interface PaymentMethod extends Pick<Timestamps, 'createdAt'> {
  id: string;
  tenantId: string;
  type: PaymentMethodType;
  isDefault: boolean;
  externalId: string;
  lastFour: string | null;
  expiresAt: Date | null;
}

// ============================================
// Dispute
// ============================================

export interface Dispute extends Pick<Timestamps, 'createdAt'> {
  id: string;
  tenantId: string;
  invoiceId: string;
  reason: string;
  status: DisputeStatus;
  externalId: string | null;
  resolvedAt: Date | null;
}

// ============================================
// Billing Provider
// ============================================

export interface BillingProviderRecord extends Pick<Timestamps, 'createdAt'> {
  id: string;
  tenantId: string | null;
  provider: BillingProvider;
  externalId: string;
  isActive: boolean;
}

// ============================================
// Usage Record
// ============================================

export interface UsageRecord {
  id: string;
  tenantId: string;
  actorId: string;
  actorType: ActorType;
  metric: string;
  quantity: number;
  recordedAt: Date;
}

export type CreateUsageRecordInput = Pick<UsageRecord, 'tenantId' | 'actorId' | 'actorType' | 'metric' | 'quantity'>;
