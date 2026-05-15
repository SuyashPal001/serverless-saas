import { getIntegrationWithCredentials, upsertIntegration } from '../db/credentials.js'

const ZOHO_CLIQ_API = 'https://cliq.zoho.in/api/v2'
const ZOHO_TOKEN_URL = 'https://accounts.zoho.in/oauth/v2/token'

async function getAccessToken(tenantId: string): Promise<string> {
  const integration = await getIntegrationWithCredentials(tenantId, 'zoho_cliq')
  if (!integration) throw new Error(`No active zoho_cliq integration for tenant ${tenantId}`)

  const creds = integration.credentials as {
    accessToken: string
    refreshToken: string
    expiresAt: number
    clientId: string
    clientSecret: string
  }

  if (creds.expiresAt && Date.now() >= creds.expiresAt - 60_000) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
    })
    const res = await fetch(`${ZOHO_TOKEN_URL}?${params}`, { method: 'POST' })
    if (!res.ok) throw new Error(`Zoho Cliq token refresh failed: ${res.status} ${await res.text()}`)
    const data = await res.json() as { access_token: string; expires_in: number }
    const newCreds = { ...creds, accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
    await upsertIntegration({
      tenantId,
      provider: 'zoho_cliq',
      credentials: newCreds,
      createdBy: integration.created_by,
      permissions: integration.permissions,
    }).catch((err: Error) => console.error('[zoho_cliq] token refresh save failed:', err.message))
    return newCreds.accessToken
  }

  return creds.accessToken
}

async function cliqGet(tenantId: string, path: string): Promise<unknown> {
  const token = await getAccessToken(tenantId)
  const res = await fetch(`${ZOHO_CLIQ_API}${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  })
  if (!res.ok) throw new Error(`Zoho Cliq API error: ${res.status} ${await res.text()}`)
  return res.json()
}

async function cliqPost(tenantId: string, path: string, body: unknown): Promise<unknown> {
  const token = await getAccessToken(tenantId)
  const res = await fetch(`${ZOHO_CLIQ_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Zoho Cliq API error: ${res.status} ${await res.text()}`)
  return res.json()
}

// ─── Channels ─────────────────────────────────────────────────────────────────

export async function zohoCliqListChannels(tenantId: string) {
  const data = await cliqGet(tenantId, '/channels') as { channels?: unknown[] }
  return data.channels ?? []
}

export async function zohoCliqGetChannelMessages(tenantId: string, channelName: string, count = 20) {
  const params = new URLSearchParams({ count: String(count) })
  const data = await cliqGet(tenantId, `/channelsbyname/${encodeURIComponent(channelName)}/chats?${params}`) as { data?: unknown[] }
  return data.data ?? []
}

// ─── Messaging ────────────────────────────────────────────────────────────────

export async function zohoCliqSendMessage(tenantId: string, params: {
  text: string; channelName?: string; userEmail?: string
}) {
  if (!params.channelName && !params.userEmail) {
    throw new Error('Either channelName or userEmail is required')
  }
  const path = params.channelName
    ? `/channelsbyname/${encodeURIComponent(params.channelName)}/message`
    : `/buddies/${encodeURIComponent(params.userEmail!)}/message`
  return cliqPost(tenantId, path, { text: params.text })
}
