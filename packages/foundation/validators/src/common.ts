import { z } from 'zod';

// ============================================
// Primitives
// ============================================

export const uuidSchema = z.string().uuid();

export const emailSchema = z.string().email().toLowerCase().trim();

export const slugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be lowercase alphanumeric with hyphens');

export const isoDateSchema = z.string().datetime();

// ============================================
// Pagination
// ============================================

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const sortSchema = z.object({
  field: z.string(),
  direction: z.enum(['asc', 'desc']).default('desc'),
});

// ============================================
// Common field patterns
// ============================================

export const nameSchema = z.string().trim().min(1).max(255);

export const descriptionSchema = z.string().trim().max(1000).nullable().optional();

export const permissionStringSchema = z
  .string()
  .regex(/^[a-z_]+:(create|read|update|delete)$/, 'Must be format: resource:action');

export const permissionsArraySchema = z.array(permissionStringSchema).min(1);
