import { randomUUID } from 'crypto'
import pg from 'pg'

// ---------------------------------------------------------------------------
// Direct DB writes — the public API routes require JWT auth which the MCP
// server does not have. pg.Pool with DATABASE_URL is the established pattern
// (same as getApprovalPool in gateway.ts).
// ---------------------------------------------------------------------------

let _pool: pg.Pool | null = null

function getPool(): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    _pool.on('error', (err: Error) => {
      console.error('[createPlanFromPrd] pool error:', err.message)
    })
  }
  return _pool
}

// Atomically increment tenant_counters and return next seq — mirrors
// nextSequenceId() in apps/api/src/lib/sequence.ts
async function getNextSeq(
  client: pg.PoolClient,
  tenantId: string,
  resource: 'plan' | 'milestone',
): Promise<number> {
  const { rows } = await client.query<{ last_seq: number }>(
    `INSERT INTO tenant_counters (tenant_id, resource, last_seq)
     VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, resource)
     DO UPDATE SET last_seq = tenant_counters.last_seq + 1
     RETURNING last_seq`,
    [tenantId, resource],
  )
  return rows[0].last_seq
}

// Return the first active human membership userId for the tenant.
// Used as createdBy — all three tables require a non-null FK to users.
async function getTenantUserId(client: pg.PoolClient, tenantId: string): Promise<string> {
  const { rows } = await client.query<{ user_id: string }>(
    `SELECT user_id FROM memberships
     WHERE tenant_id = $1 AND member_type = 'human' AND status = 'active'
     AND user_id IS NOT NULL
     LIMIT 1`,
    [tenantId],
  )
  if (rows.length > 0) return rows[0].user_id
  // Fallback: any membership with a user_id
  const { rows: fallback } = await client.query<{ user_id: string }>(
    `SELECT user_id FROM memberships
     WHERE tenant_id = $1 AND user_id IS NOT NULL
     LIMIT 1`,
    [tenantId],
  )
  if (fallback.length > 0) return fallback[0].user_id
  throw new Error(`No user found for tenant ${tenantId} — cannot set createdBy`)
}

// ── Input types ──────────────────────────────────────────────────────────────

interface PrdTask {
  title: string
  description: string
  acceptanceCriteria: string[]
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  estimatedHours?: number
}

interface PrdMilestone {
  title: string
  description: string
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  tasks: PrdTask[]
}

export interface PrdData {
  plan: {
    title: string
    description: string
    targetDate?: string
  }
  milestones: PrdMilestone[]
  risks: string[]
  totalEstimatedHours?: number
}

// ── Result type ──────────────────────────────────────────────────────────────

export interface CreatePlanResult {
  planId: string
  planSequenceId: string   // e.g. PLN-3
  milestoneCount: number
  taskCount: number
  planUrl: string          // /dashboard/plans/:planId
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function createPlanFromPrd(
  tenantId: string,
  prdData: PrdData,
): Promise<CreatePlanResult> {
  const client = await getPool().connect()
  try {
    // ── createdBy ────────────────────────────────────────────────────────────
    const createdBy = await getTenantUserId(client, tenantId)

    // ── Step 1: create plan ─────────────────────────────────────────────────
    const planId = randomUUID()
    const planSeq = await getNextSeq(client, tenantId, 'plan')

    await client.query(
      `INSERT INTO project_plans
         (id, tenant_id, sequence_id, title, description, status, target_date, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, NOW(), NOW())`,
      [
        planId,
        tenantId,
        planSeq,
        prdData.plan.title,
        prdData.plan.description ?? null,
        prdData.plan.targetDate ? new Date(prdData.plan.targetDate) : null,
        createdBy,
      ],
    )

    console.log(`[createPlanFromPrd] plan created id=${planId} seq=${planSeq} tenant=${tenantId}`)

    // ── Steps 2 + 3: milestones and their tasks ──────────────────────────────
    let milestoneCount = 0
    let taskCount = 0

    for (const milestone of prdData.milestones) {
      let milestoneId: string

      // Milestone insert — log and continue on failure
      try {
        milestoneId = randomUUID()
        const milestoneSeq = await getNextSeq(client, tenantId, 'milestone')

        await client.query(
          `INSERT INTO project_milestones
             (id, tenant_id, plan_id, sequence_id, title, description, status, priority, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'backlog', $7, $8, NOW(), NOW())`,
          [
            milestoneId,
            tenantId,
            planId,
            milestoneSeq,
            milestone.title,
            milestone.description ?? null,
            milestone.priority ?? 'medium',
            createdBy,
          ],
        )
        milestoneCount++
        console.log(`[createPlanFromPrd] milestone created id=${milestoneId} "${milestone.title}"`)
      } catch (err) {
        console.error(
          `[createPlanFromPrd] milestone failed "${milestone.title}":`,
          (err as Error).message,
        )
        continue
      }

      // Task bulk insert for this milestone — batches of 50
      const tasks = milestone.tasks ?? []
      if (tasks.length === 0) continue

      try {
        for (let i = 0; i < tasks.length; i += 50) {
          const batch = tasks.slice(i, i + 50)
          const values: unknown[] = []
          const placeholders: string[] = []
          let p = 1

          for (const task of batch) {
            placeholders.push(
              `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}::jsonb, $${p++}, $${p++}, 'backlog', $${p++}, $${p++}, NOW(), NOW())`,
            )
            values.push(
              randomUUID(),            // id
              tenantId,                // tenant_id
              createdBy,               // created_by
              task.title,              // title
              task.description ?? null, // description
              JSON.stringify(task.acceptanceCriteria ?? []), // acceptance_criteria
              task.priority ?? 'medium', // priority
              task.estimatedHours != null ? String(task.estimatedHours) : null, // estimated_hours (decimal)
              planId,                  // plan_id
              milestoneId,             // milestone_id
            )
          }

          await client.query(
            `INSERT INTO agent_tasks
               (id, tenant_id, created_by, title, description, acceptance_criteria, priority, estimated_hours, status, plan_id, milestone_id, created_at, updated_at)
             VALUES ${placeholders.join(', ')}`,
            values,
          )
          taskCount += batch.length
        }
        console.log(`[createPlanFromPrd] ${tasks.length} tasks inserted for milestone "${milestone.title}"`)
      } catch (err) {
        console.error(
          `[createPlanFromPrd] task insert failed for milestone "${milestone.title}":`,
          (err as Error).message,
        )
        // Continue — partial task failure does not abort remaining milestones
      }
    }

    console.log(
      `[createPlanFromPrd] done planId=${planId} milestones=${milestoneCount} tasks=${taskCount}`,
    )

    return {
      planId,
      planSequenceId: `PLN-${planSeq}`,
      milestoneCount,
      taskCount,
      planUrl: `/dashboard/plans/${planId}`,
    }
  } finally {
    client.release()
  }
}
