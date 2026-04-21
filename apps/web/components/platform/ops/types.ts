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

export interface OpsMember {
    membershipId: string
    memberType: 'human' | 'agent'
    status: 'active' | 'invited' | 'suspended'
    joinedAt: string | null
    createdAt: string
    userId: string | null
    userName: string | null
    userEmail: string | null
    roleName: string | null
}

export interface OpsTenantOverride {
    id: string
    featureKey: string
    featureName: string
    enabled: boolean | null
    valueLimit: number | null
    unlimited: boolean | null
    reason: string | null
    grantedBy: string
    expiresAt: string | null
    revokedAt: string | null
    createdAt: string
    status: 'active' | 'expired' | 'revoked'
}

export interface OpsTenantDetailResponse {
    tenant: OpsTenant
    members: OpsMember[]
    stats: {
        memberCount: number
        activeAgents: number
        totalConversations: number
    }
    overrides: OpsTenantOverride[]
}
