import { getIntegrationWithCredentials, upsertIntegration } from '../db/credentials.js'

const ZOHO_MAIL_API = 'https://mail.zoho.in/api'
const ZOHO_TOKEN_URL = 'https://accounts.zoho.in/oauth/v2/token'

async function getAccessToken(tenantId: string): Promise<string> {
  const integration = await getIntegrationWithCredentials(tenantId, 'zoho_mail')
  if (!integration) throw new Error(`No active zoho_mail integration for tenant ${tenantId}`)

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
    if (!res.ok) throw new Error(`Zoho Mail token refresh failed: ${res.status} ${await res.text()}`)
    const data = await res.json() as { access_token: string; expires_in: number }
    const newCreds = { ...creds, accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
    await upsertIntegration({
      tenantId,
      provider: 'zoho_mail',
      credentials: newCreds,
      createdBy: integration.created_by,
      permissions: integration.permissions,
    }).catch((err: Error) => console.error('[zoho_mail] token refresh save failed:', err.message))
    return newCreds.accessToken
  }

  return creds.accessToken
}

/** Fetch (and cache) the primary Zoho Mail account ID */
async function getAccountId(tenantId: string, token: string): Promise<string> {
  const integration = await getIntegrationWithCredentials(tenantId, 'zoho_mail')
  const creds = integration!.credentials as any
  if (typeof creds.accountId === 'string' && creds.accountId) return creds.accountId

  const res = await fetch(`${ZOHO_MAIL_API}/accounts`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  })
  if (!res.ok) throw new Error(`Zoho Mail accounts fetch failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as { data?: { accountId: string }[] }
  const accountId = data.data?.[0]?.accountId
  if (!accountId) throw new Error('No Zoho Mail account found')

  // Cache it back so subsequent calls skip the extra round-trip
  await upsertIntegration({
    tenantId,
    provider: 'zoho_mail',
    credentials: { ...creds, accountId },
    createdBy: integration!.created_by,
    permissions: integration!.permissions,
  }).catch((err: Error) => console.error('[zoho_mail] accountId cache save failed:', err.message))

  return accountId
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function zohoMailListMessages(tenantId: string, query: string, maxResults = 10) {
  const token = await getAccessToken(tenantId)
  const accountId = await getAccountId(tenantId, token)
  const params = new URLSearchParams({ searchKey: query, limit: String(maxResults) })
  const res = await fetch(`${ZOHO_MAIL_API}/accounts/${accountId}/messages/search?${params}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  })
  if (!res.ok) throw new Error(`Zoho Mail API error: ${res.status} ${await res.text()}`)
  const data = await res.json() as { data?: unknown[] }
  return data.data ?? []
}

export async function zohoMailGetMessage(tenantId: string, messageId: string, folderId: string) {
  const token = await getAccessToken(tenantId)
  const accountId = await getAccountId(tenantId, token)
  const res = await fetch(
    `${ZOHO_MAIL_API}/accounts/${accountId}/folders/${folderId}/messages/${messageId}`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
  )
  if (!res.ok) throw new Error(`Zoho Mail API error: ${res.status} ${await res.text()}`)
  const data = await res.json() as { data?: unknown }
  return data.data ?? null
}

export async function zohoMailSendMessage(tenantId: string, params: {
  toAddress: string; subject: string; content: string
  fromAddress?: string; ccAddress?: string
}) {
  const token = await getAccessToken(tenantId)
  const accountId = await getAccountId(tenantId, token)
  const body: Record<string, string> = {
    toAddress: params.toAddress,
    subject: params.subject,
    content: params.content,
    mailFormat: 'plaintext',
  }
  if (params.fromAddress) body.fromAddress = params.fromAddress
  if (params.ccAddress) body.ccAddress = params.ccAddress

  const res = await fetch(`${ZOHO_MAIL_API}/accounts/${accountId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Zoho Mail API error: ${res.status} ${await res.text()}`)
  return res.json()
}
