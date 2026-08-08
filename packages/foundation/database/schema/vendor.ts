import { pgTable, uuid, text, jsonb, timestamp, pgEnum, index, boolean } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';

export const vendorCategoryEnum = pgEnum('vendor_category', [
  'cpsu', 'spsu', 'mse', 'self_help_group', 'govt_body', 'civil_contractor', 'other',
]);

export const rateContractTypeEnum = pgEnum('rate_contract_type', ['limited', 'framework', 'rate']);

export const vendors = pgTable('vendors', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name:             text('name').notNull(),
  category:         vendorCategoryEnum('category').notNull().default('other'),
  countryOfOrigin:  text('country_of_origin'),
  contactEmail:     text('contact_email'),
  contactPhone:     text('contact_phone'),
  isBlacklisted:    boolean('is_blacklisted').notNull().default(false),
  blacklistReason:  text('blacklist_reason'),
  blacklistedAt:    timestamp('blacklisted_at', { withTimezone: true }),
  isOemAuthorized:  boolean('is_oem_authorized').notNull().default(false),
  oemProducts:      text('oem_products'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('idx_vendors_tenant').on(t.tenantId),
}));

export const rateContracts = pgTable('rate_contracts', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  vendorId:     uuid('vendor_id').notNull().references(() => vendors.id, { onDelete: 'cascade' }),
  contractType: rateContractTypeEnum('contract_type').notNull(),
  terms:        text('terms'),
  pricing:      jsonb('pricing').default('{}'),
  validFrom:    timestamp('valid_from', { withTimezone: true }),
  validTo:      timestamp('valid_to', { withTimezone: true }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  vendorIdx: index('idx_rate_contracts_vendor').on(t.vendorId),
}));
