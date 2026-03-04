export interface OpsTenant {
    id: string
    name: string
    slug: string
    type: 'individual' | 'startup' | 'business' | 'enterprise'
    status: 'active' | 'suspended' | 'deleted'
    plan: string
    createdAt: string
}

export interface OpsTenantsResponse {
    tenants: OpsTenant[]
    total: number
    page: number
    totalPages: number
}

export interface OpsOverride {
    id: string
    tenantName: string
    featureKey: string
    enabled: boolean | null
    valueLimit: number | null
    unlimited: boolean | null
    reason: string
    grantedBy: string
    expiresAt: string | null
    status: 'active' | 'expired' | 'revoked'
}

export interface OpsOverridesResponse {
    overrides: OpsOverride[]
    total: number
    page: number
    totalPages: number
}
