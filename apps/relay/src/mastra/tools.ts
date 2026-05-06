import { MCPClient } from '@mastra/mcp'

// Connects to our existing mcp-server:3002
// No changes to mcp-server required
// Per-tenant headers injected via headers config

let mcpClient: MCPClient | null = null

export function getMCPClient(): MCPClient {
  if (mcpClient) return mcpClient

  mcpClient = new MCPClient({
    servers: {
      saarthiTools: {
        url: new URL(
          process.env.MCP_SERVER_SSE_URL ??
          'http://localhost:3002/sse'
        ),
        // Internal service key for auth
        // matches x-internal-service-key on mcp-server
        requestInit: {
          headers: {
            'x-internal-service-key':
              process.env.INTERNAL_SERVICE_KEY ?? '',
          },
        },
      },
    },
  })

  return mcpClient
}

export async function getToolsForTenant(
  tenantId: string
): Promise<Record<string, Record<string, unknown>>> {
  const client = getMCPClient()
  // listToolsets() returns tools grouped by server name
  // mcp-server uses x-tenant-id header to scope
  // credentials to this tenant
  const toolsets = await client.listToolsets()
  return toolsets
}
