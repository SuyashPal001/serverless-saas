import { pgTable, uuid, text, timestamp, boolean, pgEnum, unique } from 'drizzle-orm/pg-core';

export const actionEnum = pgEnum('action', ['create', 'read', 'update', 'delete']);

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'),
  name: text('name').notNull(),
  description: text('description'),
  isDefault: boolean('is_default').notNull().default(false),
  isAgentRole: boolean('is_agent_role').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uniqueNameTenant: unique().on(t.name, t.tenantId),
}));

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  resource: text('resource').notNull(),
  action: actionEnum('action').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uniqueResourceAction: unique().on(t.resource, t.action),
}));

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  uniqueRolePermission: unique().on(t.roleId, t.permissionId),
}));
