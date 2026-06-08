import { createHash } from 'crypto'
import { db, auditLog } from '@serverless-saas/database'
import { eq, desc } from 'drizzle-orm'

interface TenderAuditLogInput {
  tenantId: string
  actorId: string
  actorType?: 'human' | 'agent' | 'system'
  action: string
  resource: string
  resourceId: string
  metadata: Record<string, unknown>
  traceId?: string
}

export async function writeTenderAuditLog(input: TenderAuditLogInput): Promise<void> {
  try {
    const [latest] = await db
      .select({ entryHash: auditLog.entryHash })
      .from(auditLog)
      .where(eq(auditLog.tenantId, input.tenantId))
      .orderBy(desc(auditLog.createdAt))
      .limit(1)

    const prevHash = latest?.entryHash ?? null

    const entryHash = createHash('sha256')
      .update(JSON.stringify({
        prevHash: prevHash ?? '',
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId,
        previousState: null,
        newState: null,
      }))
      .digest('hex')

    await db.insert(auditLog).values({
      tenantId: input.tenantId,
      actorId: input.actorId,
      actorType: input.actorType ?? 'system',
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      metadata: input.metadata,
      previousState: null,
      newState: null,
      traceId: input.traceId ?? '',
      prevHash,
      entryHash,
      createdAt: new Date(),
    })
  } catch (err) {
    console.error(
      `[tenderAuditLog] failed action=${input.action} resource=${input.resource}:`,
      (err as Error).message,
    )
  }
}
