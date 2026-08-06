import { Hono } from 'hono'
import { submitContractForApproval, actOnApprovalStep, getApprovalChain } from '../tender/tenderApproval.js'
import { getPendingApprovalsForRole } from '../tender/tenderApprovalInbox.js'

const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY ?? ''

function checkInternalKey(c: { req: { header: (k: string) => string | undefined } }): boolean {
  const key = c.req.header('x-internal-service-key') ?? ''
  return !INTERNAL_KEY || key === INTERNAL_KEY
}

export const tenderApprovalRoutes = new Hono()

tenderApprovalRoutes.post('/internal/tender/approval/submit', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!checkInternalKey(c as any)) return c.json({ error: 'Unauthorized' }, 401)
  let body: { tenderId?: string; tenantId?: string; resourceType?: 'contract'; resourceId?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }
  const { tenderId, tenantId, resourceType, resourceId } = body
  if (!tenderId || !tenantId || resourceType !== 'contract' || !resourceId) {
    return c.json({ error: 'tenderId, tenantId, resourceType, resourceId required' }, 400)
  }
  try {
    const result = await submitContractForApproval(tenderId, tenantId, resourceId)
    return c.json({ status: 'completed', ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[tender/approval/submit] error', message)
    if (message.includes('contract not found')) return c.json({ error: message }, 404)
    return c.json({ error: message }, 500)
  }
})

tenderApprovalRoutes.post('/internal/tender/approval/act', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!checkInternalKey(c as any)) return c.json({ error: 'Unauthorized' }, 401)
  let body: { tenderId?: string; tenantId?: string; stepId?: string; action?: 'approve' | 'reject'; actorId?: string; approverRole?: string; comment?: string; signatureRef?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid JSON' }, 400) }
  const { tenderId, tenantId, stepId, action, actorId, approverRole } = body
  if (!tenderId || !tenantId || !stepId || !action || !actorId || !approverRole) {
    return c.json({ error: 'tenderId, tenantId, stepId, action, actorId, approverRole required' }, 400)
  }
  try {
    const result = await actOnApprovalStep(tenderId, tenantId, stepId, {
      action, actorId, approverRole, comment: body.comment, signatureRef: body.signatureRef,
    })
    return c.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[tender/approval/act] error', message)
    if (message.includes('approval step not found')) return c.json({ error: message }, 404)
    if (message.includes('not currently actionable')) return c.json({ error: message }, 409)
    return c.json({ error: message }, 500)
  }
})

tenderApprovalRoutes.get('/internal/tender/approval/chain/:tenderId/:resourceType/:resourceId', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!checkInternalKey(c as any)) return c.json({ error: 'Unauthorized' }, 401)
  const tenderId = c.req.param('tenderId')
  const resourceType = c.req.param('resourceType')
  const resourceId = c.req.param('resourceId')
  const tenantId = c.req.query('tenantId')
  if (!tenantId || resourceType !== 'contract') return c.json({ error: 'tenantId required, resourceType must be contract' }, 400)
  const result = await getApprovalChain(tenderId, tenantId, resourceType, resourceId)
  return c.json(result)
})

tenderApprovalRoutes.get('/internal/tender/approval/inbox/:approverRole', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!checkInternalKey(c as any)) return c.json({ error: 'Unauthorized' }, 401)
  const approverRole = c.req.param('approverRole')
  const tenantId = c.req.query('tenantId')
  if (!tenantId) return c.json({ error: 'tenantId required' }, 400)
  const items = await getPendingApprovalsForRole(tenantId, approverRole)
  return c.json({ items })
})
