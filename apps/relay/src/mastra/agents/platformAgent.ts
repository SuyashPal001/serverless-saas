import { randomUUID } from 'crypto'
import { Agent } from '@mastra/core/agent'
import { RequestContext } from '@mastra/core/request-context'
import { createTool } from '@mastra/core/tools'
import { MCPClient } from '@mastra/mcp'
import { z } from 'zod'
import { Exa as ExaClass } from 'exa-js'
import pg from 'pg'

import { saarthiModel } from '../model.js'
import { getMastraMemory } from '../memory.js'
import { getMCPClientForTenant } from '../tools.js'

// ---------------------------------------------------------------------------
// Platform prompt — fetched from agentTemplates at request time.
// Queries the latest published template; falls back to static string on error.
// Uses a dedicated small pool — separate from the Mastra internal pool.
// ---------------------------------------------------------------------------

let platformPool: pg.Pool | null = null

function getPlatformPool(): pg.Pool {
  if (!platformPool) {
    platformPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2, // small — platform config queries only
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
    platformPool.on('error', (err) => {
      console.error('[mastra:platform] pool error:', err.message)
    })
  }
  return platformPool
}

async function fetchPlatformPrompt(): Promise<string> {
  try {
    const res = await getPlatformPool().query<{ system_prompt: string }>(
      `SELECT system_prompt FROM agent_templates
       WHERE status = 'published'
       ORDER BY version DESC
       LIMIT 1`
    )
    const prompt = res.rows[0]?.system_prompt
    if (prompt) return prompt
  } catch (err) {
    console.warn('[mastra:platform] fetchPlatformPrompt DB error:', (err as Error).message)
  }
  return 'You are Saarthi, a helpful AI assistant.'
}

// ---------------------------------------------------------------------------
// SERVER_TOOLS — real function-call implementations executed by Mastra.
// Named 'internet_search' (not 'web_search') to avoid Vertex AI reserved name
// conflict; 'web_search' as a functionDeclaration triggers native Search tool
// behavior which is incompatible with responseSchema/structured output.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exa = new ExaClass(process.env.EXA_API_KEY ?? '')

// ---------------------------------------------------------------------------
// Plan creation helpers — used by create_plan_from_prd SERVER_TOOL.
// Separate pool to keep plan writes isolated from platform config queries.
// ---------------------------------------------------------------------------

let _planPool: pg.Pool | null = null

function getPlanPool(): pg.Pool {
  if (!_planPool) {
    _planPool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    _planPool.on('error', (err) => {
      console.error('[mastra:plan] pool error:', err.message)
    })
  }
  return _planPool
}

async function planNextSeq(
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

async function planCreatedBy(client: pg.PoolClient, tenantId: string): Promise<string> {
  const { rows } = await client.query<{ user_id: string }>(
    `SELECT user_id FROM memberships
     WHERE tenant_id = $1 AND member_type = 'human' AND status = 'active'
     AND user_id IS NOT NULL
     LIMIT 1`,
    [tenantId],
  )
  if (rows.length > 0) return rows[0].user_id
  const { rows: fallback } = await client.query<{ user_id: string }>(
    `SELECT user_id FROM memberships
     WHERE tenant_id = $1 AND user_id IS NOT NULL
     LIMIT 1`,
    [tenantId],
  )
  if (fallback.length > 0) return fallback[0].user_id
  throw new Error(`No user found for tenant ${tenantId} — cannot set createdBy`)
}

export const SERVER_TOOLS = {
  internet_search: createTool({
    id: 'internet_search',
    description:
      'Search the internet for current information, news, facts, jobs, and real-time data.',
    inputSchema: z.object({
      query: z.string().describe('The search query'),
    }),
    execute: async ({ query }: { query: string }) => {
      const { results } = await exa.searchAndContents(query, {
        livecrawl: 'always',
        numResults: 5,
        text: { maxCharacters: 3000 },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return results.map((r: any) => ({
        title: r.title ?? null,
        url: r.url,
        content: (r.text ?? '').slice(0, 3000),
        publishedDate: r.publishedDate,
      }))
    },
  }),
  code_execution: createTool({
    id: 'code_execution',
    description: 'Execute code in a sandboxed environment and return the output.',
    inputSchema: z.object({
      code: z.string().describe('The code to execute'),
    }),
    execute: async () => ({ result: 'handled natively by the LLM provider' }),
  }),
  web_fetch: createTool({
    id: 'web_fetch',
    description: 'Fetch the content of a URL and return it as text.',
    inputSchema: z.object({
      url: z.string().describe('The URL to fetch'),
    }),
    execute: async ({ url }: { url: string }) => {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10_000)
        let response: Response
        try {
          response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Saarthi/1.0)' },
          })
        } finally {
          clearTimeout(timer)
        }
        if (!response.ok) {
          return { content: '', url, success: false as const, error: `HTTP ${response.status}` }
        }
        const raw = await response.text()
        const text = raw
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/\s{2,}/g, ' ')
          .trim()
          .slice(0, 5000)
        return { content: text, url, success: true as const }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: '', url, success: false as const, error: message }
      }
    },
  }),
  create_plan_from_prd: createTool({
    id: 'create_plan_from_prd',
    description:
      'Creates a project plan with milestones and tasks in the database from a PRD breakdown. Call this only after the user has reviewed and approved the plan.',
    inputSchema: z.object({
      tenantId: z.string(),
      plan: z.object({
        title: z.string(),
        description: z.string(),
        targetDate: z.string().optional(),
      }),
      milestones: z.array(z.object({
        title: z.string(),
        description: z.string(),
        priority: z.enum(['low', 'medium', 'high', 'urgent']),
        tasks: z.array(z.object({
          title: z.string(),
          description: z.string(),
          acceptanceCriteria: z.array(z.string()),
          priority: z.enum(['low', 'medium', 'high', 'urgent']),
          estimatedHours: z.number().optional(),
          type: z.enum(['feature', 'bug', 'chore', 'spike']),
        })),
      })),
      risks: z.array(z.string()),
      totalEstimatedHours: z.number().optional(),
    }),
    execute: async ({ tenantId, plan, milestones, risks }: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tenantId: string; plan: any; milestones: any[]; risks: string[]; totalEstimatedHours?: number
    }) => {
      const client = await getPlanPool().connect()
      try {
        const createdBy = await planCreatedBy(client, tenantId)

        // 1. Create plan
        const planId = randomUUID()
        const planSeq = await planNextSeq(client, tenantId, 'plan')
        await client.query(
          `INSERT INTO project_plans
             (id, tenant_id, sequence_id, title, description, status, target_date, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, NOW(), NOW())`,
          [planId, tenantId, planSeq, plan.title, plan.description ?? null,
           plan.targetDate ? new Date(plan.targetDate) : null, createdBy],
        )
        console.log(`[mastra:plan] plan created id=${planId} seq=${planSeq} tenant=${tenantId}`)

        let milestoneCount = 0
        let taskCount = 0

        // 2+3. Milestones and tasks
        for (const milestone of milestones) {
          let milestoneId: string
          try {
            milestoneId = randomUUID()
            const milestoneSeq = await planNextSeq(client, tenantId, 'milestone')
            await client.query(
              `INSERT INTO project_milestones
                 (id, tenant_id, plan_id, sequence_id, title, description, status, priority, created_by, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, 'backlog', $7, $8, NOW(), NOW())`,
              [milestoneId, tenantId, planId, milestoneSeq, milestone.title,
               milestone.description ?? null, milestone.priority ?? 'medium', createdBy],
            )
            milestoneCount++
          } catch (err) {
            console.error(`[mastra:plan] milestone failed "${milestone.title}":`, (err as Error).message)
            continue
          }

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
                  randomUUID(), tenantId, createdBy,
                  task.title, task.description ?? null,
                  JSON.stringify(task.acceptanceCriteria ?? []),
                  task.priority ?? 'medium',
                  task.estimatedHours != null ? String(task.estimatedHours) : null,
                  planId, milestoneId,
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
          } catch (err) {
            console.error(`[mastra:plan] task insert failed for milestone "${milestone.title}":`, (err as Error).message)
          }
        }

        console.log(`[mastra:plan] done planId=${planId} milestones=${milestoneCount} tasks=${taskCount}`)
        return {
          planId,
          planSequenceId: `PLN-${planSeq}`,
          milestoneCount,
          taskCount,
          risks,
          planUrl: `/dashboard/plans/${planId}`,
        }
      } finally {
        client.release()
      }
    },
  }),
}

// Server tool names used to filter out duplicate MCP tool registrations.
// 'web_search' is blocked because we expose it as 'internet_search' via Exa.
const SERVER_TOOL_NAMES = new Set([...Object.keys(SERVER_TOOLS), 'web_search', 'create_plan_from_prd'])

// ---------------------------------------------------------------------------
// One platform Agent — serves all tenants.
//
// instructions: dynamic — fetches latest published agentTemplate from DB.
// tools:        dynamic — builds per-request MCPClient from requestContext.
//               Falls back to SERVER_TOOLS when requestContext has no tenantId
//               (e.g., during tool discovery calls from Mastra Studio).
// memory:       getMastraMemory() singleton — isolation enforced by resourceId.
// model:        routes through vertex-proxy at VERTEX_PROXY_URL.
// ---------------------------------------------------------------------------

export const platformAgent = new Agent({
  id: 'saarthi',
  name: 'Saarthi',

  instructions: async () => {
    return fetchPlatformPrompt()
  },

  tools: async ({ requestContext }: { requestContext: RequestContext }) => {
    const tenantId = requestContext.get('tenantId') as string | undefined

    if (!tenantId) {
      // No tenant context — return SERVER_TOOLS only (Studio / health checks)
      return SERVER_TOOLS
    }

    // Reuse the pre-created MCPClient stored in requestContext by createTenantAgent().
    // This ensures one MCPClient per task execution — avoids creating a second client
    // alongside the one returned for disconnect in TenantAgentWithClient.
    const storedClient = requestContext.get('__mcpClient') as MCPClient | undefined
    const mcpClient = storedClient ?? getMCPClientForTenant(tenantId)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mcpTools: Record<string, any> = {}
    try {
      mcpTools = await mcpClient.listTools()
      console.log('[mastra] platformAgent.tools listTools keys:', Object.keys(mcpTools).join(', '))
    } catch (err) {
      console.warn(
        '[mastra] platformAgent.tools listTools failed, continuing without MCP tools:',
        (err as Error).message
      )
    }

    // Exclude MCP tools that duplicate SERVER_TOOLS.
    const filteredMcpTools = Object.fromEntries(
      Object.entries(mcpTools).filter(([key]) => {
        const blocked = Array.from(SERVER_TOOL_NAMES).some(
          (name) => key === name || key.endsWith(`_${name}`)
        )
        if (blocked) console.log(`[mastra] platformAgent filtering MCP tool: ${key}`)
        return !blocked
      })
    )

    return { ...filteredMcpTools, ...SERVER_TOOLS }
  },

  memory: getMastraMemory(),

  model: saarthiModel,
})
