import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { type VendorCredentials } from '../db/credentials';

// ── Types ─────────────────────────────────────────────────────────────────────

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface McpListResponse {
  result?: { tools?: McpToolDef[] };
  error?: { code: number; message: string };
}

interface McpCallResponse {
  result?: { content?: Array<{ type: string; text?: string }> };
  error?: { code: number; message: string };
}

export interface VendorTool extends McpToolDef {
  name: string; // prefixed, e.g. HUBSPOT_GET_CONTACT
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Build authorization header from whatever credential shape the vendor uses.
function buildAuthHeader(creds: VendorCredentials): Record<string, string> {
  if (creds.bearerToken) return { Authorization: `Bearer ${creds.bearerToken}` };
  if (creds.apiKey)      return { Authorization: `Bearer ${creds.apiKey}` };
  return {};
}

// Derive a stable UPPER_CASE prefix from the provider name.
// e.g. 'hubspot' → 'HUBSPOT', 'notion-v2' → 'NOTION_V2'
export function providerPrefix(provider: string): string {
  return provider.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

// Strip the vendor prefix from a tool name before forwarding.
// e.g. 'HUBSPOT_GET_CONTACT' with prefix 'HUBSPOT' → 'GET_CONTACT'
// Vendors may use different casing internally; we preserve what they gave us
// during list and send it back verbatim on call.
function stripPrefix(prefixedName: string, prefix: string): string {
  const stripped = prefixedName.slice(prefix.length + 1); // +1 for the '_'
  return stripped;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Fetches the tool list from a vendor MCP server and prefixes tool names
 * with the provider name to avoid conflicts with other integrations.
 *
 * e.g. HubSpot's 'get_contact' becomes 'HUBSPOT_GET_CONTACT'.
 *
 * Returns an empty array if the vendor server is unreachable rather than
 * failing the whole tools/list response.
 */
export async function getVendorTools(
  mcpServerUrl: string,
  provider: string,
  creds: VendorCredentials
): Promise<VendorTool[]> {
  try {
    const resp = await fetch(mcpServerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeader(creds),
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });

    if (!resp.ok) {
      console.warn(`[vendor-proxy] tools/list failed for ${provider}: HTTP ${resp.status}`);
      return [];
    }

    const json = (await resp.json()) as McpListResponse;
    if (json.error) {
      console.warn(`[vendor-proxy] tools/list error for ${provider}:`, json.error.message);
      return [];
    }

    const prefix = providerPrefix(provider);
    return (json.result?.tools ?? []).map((tool) => ({
      ...tool,
      name: `${prefix}_${tool.name.toUpperCase()}`,
    }));
  } catch (err) {
    console.warn(`[vendor-proxy] could not reach ${provider} at ${mcpServerUrl}:`, (err as Error).message);
    return [];
  }
}

/**
 * Forwards a tools/call to a vendor MCP server after stripping the provider
 * prefix from the tool name so the vendor sees its original tool name.
 */
export async function executeVendorTool(
  mcpServerUrl: string,
  provider: string,
  prefixedToolName: string,
  args: unknown,
  creds: VendorCredentials
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const prefix = providerPrefix(provider);
  const originalName = stripPrefix(prefixedToolName, prefix);

  let resp: Response;
  try {
    resp = await fetch(mcpServerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeader(creds),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: originalName, arguments: args },
        id: 1,
      }),
    });
  } catch (err) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to reach ${provider} MCP server: ${(err as Error).message}`
    );
  }

  if (!resp.ok) {
    throw new McpError(
      ErrorCode.InternalError,
      `${provider} MCP server returned HTTP ${resp.status}`
    );
  }

  const json = (await resp.json()) as McpCallResponse;

  if (json.error) {
    throw new McpError(ErrorCode.InternalError, json.error.message);
  }

  // Normalise to our content format
  const content = (json.result?.content ?? []).map((c) => ({
    type: 'text' as const,
    text: c.text ?? JSON.stringify(c),
  }));

  return { content };
}
