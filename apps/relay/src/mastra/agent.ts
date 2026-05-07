import { Agent } from '@mastra/core/agent'
import { MCPClient } from '@mastra/mcp'
import { Memory } from '@mastra/memory'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getMastraStore } from './memory.js'
import { getMCPClientForTenant } from './tools.js'

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
  const tools = await mcpClient.listTools()

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
    model: customGoogle(modelId),
    memory,
    tools,
  })

  return { agent, mcpClient }
}
