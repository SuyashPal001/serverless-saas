/**
 * Vendor MCP proxy — forwards tool calls to an external MCP server URL
 * stored in the integrations.mcp_server_url column.
 *
 * Supports the MCP HTTP transport (JSON-RPC 2.0 over HTTP POST).
 */

import { getIntegrationWithCredentials } from '../db/credentials.js'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** Forward a JSON-RPC request to the vendor MCP server for this tenant+provider */
export async function proxyToVendorMCP(
  tenantId: string,
  provider: string,
  method: string,
  params: unknown
): Promise<unknown> {
  const integration = await getIntegrationWithCredentials(tenantId, provider)
  if (!integration?.mcp_server_url) {
    throw new Error(`No MCP server URL configured for ${provider} / tenant ${tenantId}`)
  }

  const rpcReq: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params,
  }

  // Build auth header from stored credentials if an access_token is present
  const creds = integration.credentials
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Tenant-Id': tenantId,
  }
  if (typeof creds.access_token === 'string') {
    headers['Authorization'] = `Bearer ${creds.access_token}`
  } else if (typeof creds.api_key === 'string') {
    headers['Authorization'] = `Bearer ${creds.api_key}`
  }

  const res = await fetch(integration.mcp_server_url, {
    method: 'POST',
    headers,
    body: JSON.stringify(rpcReq),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Vendor MCP returned HTTP ${res.status}: ${body}`)
  }

  const rpcRes = (await res.json()) as JsonRpcResponse
  if (rpcRes.error) {
    throw new Error(`Vendor MCP error ${rpcRes.error.code}: ${rpcRes.error.message}`)
  }

  return rpcRes.result
}

/** List tools advertised by a vendor MCP server */
export async function listVendorTools(tenantId: string, provider: string): Promise<unknown[]> {
  const result = await proxyToVendorMCP(tenantId, provider, 'tools/list', {})
  if (Array.isArray(result)) return result
  if (result && typeof result === 'object' && Array.isArray((result as Record<string, unknown>).tools)) {
    return (result as Record<string, unknown>).tools as unknown[]
  }
  return []
}
