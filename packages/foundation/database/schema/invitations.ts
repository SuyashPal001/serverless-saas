import { pgTable, uuid, text, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { memberships } from './tenancy';
import { users } from './auth';
import { roles } from './authorization';

export const invitationStatusEnum = pgEnum('invitation_status', ['pending', 'accepted', 'expired', 'revoked']);

export const invitationTokens = pgTable('invitation_tokens', {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    membershipId: uuid('membership_id').notNull().references(() => memberships.id),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    roleId: uuid('role_id').notNull().references(() => roles.id),
    invitedBy: uuid('invited_by').notNull().references(() => users.id),
    status: invitationStatusEnum('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at').notNull(),
    acceptedAt: timestamp('accepted_at'),
    revokedAt: timestamp('revoked_at'),
    revokedBy: uuid('revoked_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
    emailTenantIdx: index('invitation_tokens_email_tenant_idx').on(t.email, t.tenantId),
}));
