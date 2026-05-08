import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { MCPClient } from '@mastra/mcp'
import { Memory } from '@mastra/memory'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import { Exa as ExaClass } from 'exa-js'
import { getMastraStore } from './memory.js'
import { getMCPClientForTenant } from './tools.js'

// Exa search client — real web search via function call (compatible with structured output)
const exa = new ExaClass(process.env.EXA_API_KEY ?? '')

// Server tools — real function-call implementations executed by Mastra.
// web_search uses Exa API (avoids Gemini native googleSearch which is incompatible
// with responseSchema/structured output and functionDeclarations in same request).
const SERVER_TOOLS = {
  // Named 'internet_search' (not 'web_search') to avoid Vertex AI reserved name conflict.
  // Vertex AI treats any functionDeclaration named 'web_search' as the native Search tool
  // which is incompatible with responseSchema (structured output).
  internet_search: createTool({
    id: 'internet_search',
    description: 'Search the internet for current information, news, facts, jobs, and real-time data.',
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
  // SERVER_TOOLS (web_search, code_execution, web_fetch) are always active — they are
  // native LLM capabilities handled by vertex-proxy, not gated by agent_skills.tools.
  // agent_skills.tools contains MCP tool names only (e.g. ZOHO_MAIL_LIST_MESSAGES).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mcpTools: Record<string, any> = {}
  try {
    mcpTools = await mcpClient.listTools()
    console.log('[mastra] listTools keys:', Object.keys(mcpTools).join(', '))
  } catch (err) {
    console.warn('[mastra] MCP listTools failed, continuing without MCP tools:', (err as Error).message)
  }
  // Exclude MCP tools whose name matches a SERVER_TOOL (or its canonical aliases).
  // 'web_search' from MCP is blocked because we handle it via Exa as 'internet_search'.
  // Handles both exact match and prefixed form (e.g. 'saarthiTools_web_search').
  const serverToolNames = new Set([...Object.keys(SERVER_TOOLS), 'web_search'])
  const filteredMcpTools = Object.fromEntries(
    Object.entries(mcpTools).filter(([key]) => {
      const blocked = Array.from(serverToolNames).some(
        (name) => key === name || key.endsWith(`_${name}`)
      )
      if (blocked) console.log(`[mastra] filtering out MCP tool: ${key}`)
      return !blocked
    })
  )
  const tools = { ...filteredMcpTools, ...SERVER_TOOLS }
  console.log('[mastra] agent tools:', Object.keys(tools).join(', '))

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
