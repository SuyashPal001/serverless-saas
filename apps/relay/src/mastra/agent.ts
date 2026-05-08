import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { MCPClient } from '@mastra/mcp'
import { Memory } from '@mastra/memory'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import { getMastraStore } from './memory.js'
import { getMCPClientForTenant } from './tools.js'

// Server tools — passed as definitions so vertex-proxy can translate them to
// native provider capabilities (googleSearchRetrieval, codeExecution, urlContext
// for Gemini; web_search_20260209, code_execution_20250825, web_fetch_20250910
// for Anthropic). These are never executed by Mastra; the LLM handles them natively.
const SERVER_TOOLS = {
  web_search: createTool({
    id: 'web_search',
    description: 'Search the web for current information, news, facts, and real-time data.',
    inputSchema: z.object({
      query: z.string().describe('The search query'),
    }),
    execute: async () => ({ result: 'handled natively by the LLM provider' }),
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

// Creates a per-tenant Mastra agent alongside its MCPClient.
// Returns both so the caller can disconnect() the client when done.
// instructions = tenant IDENTITY.md from DB (agent_skills.system_prompt)
// memory scoped to tenantId (resourceId)
// model routes through vertex-proxy at :4001
// MCP tools from mcp-server at :3002 — scoped to tenantId via x-tenant-id header

export interface TenantAgentConfig {
  tenantId: string
  agentId: string
  agentSlug: string
  instructions: string // tenant system prompt from agent_skills
  connectedProviders: string[]
  maxTokens?: number | null
  // Tool names from agent_skills.tools — gates which server tools are active.
  // null/undefined = all server tools enabled (default-open for existing agents).
  enabledTools?: string[] | null
}

export interface TenantAgentWithClient {
  agent: Agent
  mcpClient: MCPClient
}

export async function createTenantAgent(
  config: TenantAgentConfig
): Promise<TenantAgentWithClient> {
  const store = getMastraStore()
  const mcpClient = getMCPClientForTenant(config.tenantId)

  const memory = new Memory({
    storage: store,
    options: {
      // All memory scoped to this tenant via resourceId in generate()
      // mastra_threads, mastra_messages all keyed by tenantId
      lastMessages: 20,
      semanticRecall: false, // no vector store — disable semantic recall
      workingMemory: {
        enabled: true,
        // Working memory persists business context
        // across task sessions for this tenant
      },
    },
  })

  // listTools() returns flat Record<serverName_toolName, Tool>
  // compatible with Agent `tools` field (ToolsInput)
  // Filter SERVER_TOOLS by enabledTools from agent_skills.tools.
  // null/undefined = all server tools enabled (default-open for existing agents).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mcpTools: Record<string, any> = {}
  try {
    mcpTools = await mcpClient.listTools()
  } catch (err) {
    console.warn('[mastra] MCP listTools failed, continuing without MCP tools:', (err as Error).message)
  }
  const activeServerTools = config.enabledTools == null
    ? SERVER_TOOLS
    : Object.fromEntries(
        Object.entries(SERVER_TOOLS).filter(([name]) => config.enabledTools!.includes(name))
      )
  // Exclude MCP tools whose name matches a SERVER_TOOL — those are handled natively
  // by the LLM provider via vertex-proxy and must not be routed through the MCP gateway.
  // Handles both exact match (key === 'web_search') and prefixed form (key ends with '_web_search').
  const serverToolNames = new Set(Object.keys(activeServerTools))
  const filteredMcpTools = Object.fromEntries(
    Object.entries(mcpTools).filter(([key]) =>
      !Array.from(serverToolNames).some(
        (name) => key === name || key.endsWith(`_${name}`)
      )
    )
  )
  const tools = { ...filteredMcpTools, ...activeServerTools }

  // createGoogleGenerativeAI allows a custom baseURL at the provider level
  // Routes through vertex-proxy on :4001 which handles GCP auth + quota
  const customGoogle = createGoogleGenerativeAI({
    baseURL: process.env.VERTEX_PROXY_URL ?? 'http://localhost:4001/v1',
    apiKey: process.env.GEMINI_API_KEY ?? 'placeholder',
  })

  const agentId = `saarthi-${config.agentSlug}-${config.tenantId}`
  const modelId = process.env.MASTRA_MODEL ?? 'gemini-2.5-flash'

  const agent = new Agent({
    id: agentId,
    name: agentId,
    instructions: config.instructions,
    // maxTokens enforced per-call via modelSettings in agent.generate() —
    // @ai-sdk/google@^3.0.67 factory only accepts modelId as argument.
    model: customGoogle(modelId),
    memory,
    tools,
  })

  return { agent, mcpClient }
}
