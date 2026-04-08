import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { getIntegrations, getCredentials, decryptAs, type VendorCredentials } from './db/credentials';
import { getTools as getGoogleTools, executeTool as executeGoogleTool } from './connectors/google';
import { getVendorTools, executeVendorTool, providerPrefix } from './proxy/vendor';

// ── Types ─────────────────────────────────────────────────────────────────────

// Loose shape of an incoming JSON-RPC body
interface JsonRpcRequest {
  jsonrpc?: string;
  method: string;
  params?: {
    name?: string;
    arguments?: unknown;
  };
  id?: string | number | null;
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; result: unknown; id: unknown }
  | { jsonrpc: '2.0'; error: { code: number; message: string }; id: unknown };

// ── Google tool prefix detection ──────────────────────────────────────────────

const GOOGLE_PREFIXES = ['GMAIL_', 'GDRIVE_', 'GCAL_'];

function isGoogleTool(toolName: string): boolean {
  return GOOGLE_PREFIXES.some((p) => toolName.startsWith(p));
}

// Extract provider slug from a vendor-prefixed tool name.
// e.g. 'HUBSPOT_GET_CONTACT' → 'hubspot'
function vendorProviderFromTool(toolName: string): string {
  return toolName.split('_')[0].toLowerCase();
}

// ── Gateway ───────────────────────────────────────────────────────────────────

export async function handleRequest(
  tenantId: string,
  body: unknown
): Promise<JsonRpcResponse> {
  const req = body as JsonRpcRequest;
  const id = req.id ?? null;

  try {
    // ── tools/list ─────────────────────────────────────────────────────────
    if (req.method === 'tools/list') {
      const allTools: unknown[] = [];

      // Fetch all connected integrations once
      const integrations = await getIntegrations(tenantId);

      for (const integration of integrations) {
        if (integration.provider === 'google') {
          // Google Workspace: tools are defined locally, no network call needed
          allTools.push(...getGoogleTools());
          continue;
        }

        // Vendor MCP server: fetch their tools/list and prefix names
        if (integration.mcpServerUrl) {
          const creds = decryptAs<VendorCredentials>(integration.credentialsEnc, tenantId);
          const vendorTools = await getVendorTools(
            integration.mcpServerUrl,
            integration.provider,
            creds
          );
          allTools.push(...vendorTools);
        }
      }

      return { jsonrpc: '2.0', result: { tools: allTools }, id };
    }

    // ── tools/call ─────────────────────────────────────────────────────────
    if (req.method === 'tools/call') {
      const toolName = req.params?.name;
      if (!toolName) {
        return error(id, -32602, 'params.name is required for tools/call');
      }

      const args = req.params?.arguments ?? {};

      // Route: Google tools handled by our connector
      if (isGoogleTool(toolName)) {
        const result = await executeGoogleTool(tenantId, toolName, args);
        return { jsonrpc: '2.0', result, id };
      }

      // Route: vendor tool — identify provider from prefix, look up integration
      const provider = vendorProviderFromTool(toolName);
      let row: Awaited<ReturnType<typeof getCredentials>>;
      try {
        row = await getCredentials(tenantId, provider);
      } catch {
        return error(id, -32000, `No connected ${provider} integration for this tenant`);
      }

      if (!row.mcpServerUrl) {
        return error(id, -32000, `Integration ${provider} has no mcp_server_url configured`);
      }

      const creds = decryptAs<VendorCredentials>(row.credentialsEnc, tenantId);
      const result = await executeVendorTool(
        row.mcpServerUrl,
        provider,
        toolName,
        args,
        creds
      );

      return { jsonrpc: '2.0', result, id };
    }

    // ── Unknown method ─────────────────────────────────────────────────────
    return error(id, -32601, `Method not found: ${req.method}`);

  } catch (err) {
    if (err instanceof McpError) {
      return error(id, err.code, err.message);
    }
    console.error('[gateway] unhandled error:', (err as Error).message);
    return error(id, -32603, 'Internal server error');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function error(
  id: unknown,
  code: number,
  message: string
): JsonRpcResponse {
  return { jsonrpc: '2.0', error: { code, message }, id };
}
