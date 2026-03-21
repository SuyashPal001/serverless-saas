import { pgTable, uuid, varchar, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';
import { users } from './auth';

// File status enum
export const fileStatusEnum = pgEnum('file_status', ['pending', 'uploaded', 'deleted']);

// Files table - tracks uploaded files metadata
export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 255 }).notNull(),
  key: varchar('key', { length: 512 }).notNull(), // S3 key: {tenantId}/{id}/{filename}
  size: integer('size'), // bytes, set after upload confirmed
  mimeType: varchar('mime_type', { length: 127 }),
  status: fileStatusEnum('status').notNull().default('pending'),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
