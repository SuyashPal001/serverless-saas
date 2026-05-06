import { MCPClient } from '@mastra/mcp'

// Creates a per-tenant MCPClient instance.
// Each call returns a new client — no singleton.
// Both headers required:
//   x-internal-service-key — auth against mcp-server
//   x-tenant-id            — scopes tool credentials to this tenant
// Caller is responsible for calling mcpClient.disconnect() when done.

export function getMCPClientForTenant(tenantId: string): MCPClient {
  return new MCPClient({
    servers: {
      saarthiTools: {
        url: new URL(
          process.env.MCP_SERVER_SSE_URL ??
          'http://localhost:3002/sse'
        ),
        requestInit: {
          headers: {
            'x-internal-service-key':
              process.env.INTERNAL_SERVICE_KEY ?? '',
            'x-tenant-id': tenantId,
          },
        },
      },
    },
  })
}

export async function getToolsForTenant(
  tenantId: string
): Promise<Record<string, Record<string, unknown>>> {
  const client = getMCPClientForTenant(tenantId)
  // listToolsets() returns tools grouped by server name
  // mcp-server uses x-tenant-id header to scope
  // credentials to this tenant
  const toolsets = await client.listToolsets()
  return toolsets
}
