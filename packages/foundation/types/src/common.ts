// ============================================
// Base entity types
// ============================================

/** Fields present on every entity */
export interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}

/** Entities that support soft delete */
export interface SoftDeletable {
  deletedAt: Date | null;
}

/** Entities scoped to a tenant */
export interface TenantScoped {
  tenantId: string;
}

/** Entities that track who created them */
export interface Creatable {
  createdBy: string;
}

// ============================================
// Pagination
// ============================================

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

// ============================================
// API Response
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================
// Sort & Filter
// ============================================

export type SortDirection = 'asc' | 'desc';

export interface SortParams {
  field: string;
  direction: SortDirection;
}

// ============================================
// Utility types
// ============================================

/** Make specific fields optional */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/** Make specific fields required */
export type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

/** Extract only string keys from an object type */
export type StringKeys<T> = Extract<keyof T, string>;
