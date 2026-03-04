export interface AuditLog {
    id: string
    actorId: string
    actorType: 'human' | 'agent' | 'system'
    action: string
    resource: string
    resourceId: string | null
    ipAddress: string | null
    traceId: string
    createdAt: string
}

export interface AuditLogResponse {
    logs: AuditLog[]
    total: number
    page: number
    totalPages: number
}
