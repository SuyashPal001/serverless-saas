import { Agent } from '@mastra/core/agent'
import { Memory } from '@mastra/memory'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getMastraStore } from './memory.js'
import { getMCPClient } from './tools.js'

// Creates a per-tenant Mastra agent
// instructions = tenant IDENTITY.md from DB (agent_skills.system_prompt)
// memory scoped to tenantId (resourceId)
// model routes through vertex-proxy at :4001
// MCP tools from mcp-server at :3002

export interface TenantAgentConfig {
  tenantId: string
  agentId: string
  agentSlug: string
  instructions: string // tenant system prompt from agent_skills
}

export async function createTenantAgent(
  config: TenantAgentConfig
): Promise<Agent> {
  const store = getMastraStore()
  const mcpClient = getMCPClient()

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

  const agent = new Agent({
    id: agentId,
    name: agentId,
    instructions: config.instructions,
    model: customGoogle('gemini-2.0-flash'),
    memory,
    tools,
  })

  return agent
}
