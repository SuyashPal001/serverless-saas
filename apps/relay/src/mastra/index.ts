// Mastra proper orchestrator — ADR: Mastra Proper Orchestrator Adoption
//
// One Mastra instance registered at startup.
// One platform-level Agent (saarthi) serving all tenants.
// Per-tenant isolation via RequestContext + MASTRA_RESOURCE_ID_KEY.
//
// Backward-compat re-exports let app.ts and workflow.ts import unchanged.

import { Mastra } from '@mastra/core/mastra'
import { MastraEditor } from '@mastra/editor'
import { Agent } from '@mastra/core/agent'
import { RequestContext } from '@mastra/core/request-context'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createTool } from '@mastra/core/tools'
import { MCPClient } from '@mastra/mcp'
import { z } from 'zod'
import { Exa as ExaClass } from 'exa-js'
import pg from 'pg'
import { getMastraStore, getMastraMemory } from './memory.js'
import { getMCPClientForTenant } from './tools.js'

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
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return results.map((r: any) => ({
        title: r.title ?? null,
        url: r.url,
        content: (r.text ?? '').slice(0, 800),
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
    execute: async () => ({ result: 'handled natively by the LLM provider' }),
  }),
}

// Server tool names used to filter out duplicate MCP tool registrations.
// 'web_search' is blocked because we expose it as 'internet_search' via Exa.
const SERVER_TOOL_NAMES = new Set([...Object.keys(SERVER_TOOLS), 'web_search'])

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

  model: createGoogleGenerativeAI({
    baseURL: (process.env.VERTEX_PROXY_URL ?? 'http://localhost:4001') + '/v1',
    apiKey: process.env.GEMINI_API_KEY ?? 'placeholder',
  })(process.env.MASTRA_MODEL ?? 'gemini-2.5-flash'),
})

// ---------------------------------------------------------------------------
// Mastra instance — registered at startup with storage and platformAgent.
// Enables Mastra Studio, OTel spans, evals, and prompt versioning.
// Observability exporter: wire @mastra/observability in Phase 2.
// ---------------------------------------------------------------------------

export const mastra = new Mastra({
  agents: { saarthi: platformAgent },
  storage: getMastraStore(),
  editor: new MastraEditor(),
})

// ---------------------------------------------------------------------------
// Backward-compatible re-exports — app.ts / workflow.ts import unchanged.
// ---------------------------------------------------------------------------

export { getMastraStore, getMastraMemory } from './memory.js'
export { getMCPClientForTenant, getToolsForTenant } from './tools.js'
export { createTenantAgent } from './agent.js'
export type { TenantAgentWithClient } from './agent.js'
export { runMastraWorkflow } from './workflow.js'
export type { WorkflowContext } from './workflow.js'
