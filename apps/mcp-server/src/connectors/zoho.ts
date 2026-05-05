import { getIntegrationWithCredentials, upsertIntegration } from '../db/credentials.js'

const ZOHO_API_BASE = 'https://www.zohoapis.in/crm/v2'
const ZOHO_TOKEN_URL = 'https://accounts.zoho.in/oauth/v2/token'

async function getAccessToken(tenantId: string): Promise<string> {
  const integration = await getIntegrationWithCredentials(tenantId, 'zoho_crm')
  if (!integration) throw new Error(`No active zoho_crm integration for tenant ${tenantId}`)

  const creds = integration.credentials as {
    accessToken: string
    refreshToken: string
    expiresAt: number
    clientId: string
    clientSecret: string
  }

  // Refresh if expired or within 60 seconds of expiry
  if (creds.expiresAt && Date.now() >= creds.expiresAt - 60_000) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
    })
    const res = await fetch(`${ZOHO_TOKEN_URL}?${params}`, { method: 'POST' })
    if (!res.ok) throw new Error(`Zoho token refresh failed: ${res.status} ${await res.text()}`)
    const data = await res.json() as { access_token: string; expires_in: number }
    const newCreds = {
      ...creds,
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    }
    await upsertIntegration({
      tenantId,
      provider: 'zoho_crm',
      credentials: newCreds,
      createdBy: integration.created_by,
      permissions: integration.permissions,
    }).catch((err: Error) => console.error('[zoho] token refresh save failed:', err.message))
    return newCreds.accessToken
  }

  return creds.accessToken
}

async function zohoGet(tenantId: string, path: string): Promise<unknown> {
  const token = await getAccessToken(tenantId)
  const res = await fetch(`${ZOHO_API_BASE}${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  })
  if (!res.ok) throw new Error(`Zoho API error: ${res.status} ${await res.text()}`)
  return res.json()
}

async function zohoPost(tenantId: string, path: string, body: unknown): Promise<unknown> {
  const token = await getAccessToken(tenantId)
  const res = await fetch(`${ZOHO_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Zoho API error: ${res.status} ${await res.text()}`)
  return res.json()
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export async function zohoSearchContacts(tenantId: string, query: string, maxResults = 10) {
  const params = new URLSearchParams({ word: query, per_page: String(maxResults) })
  const data = await zohoGet(tenantId, `/Contacts/search?${params}`) as { data?: unknown[] }
  return data.data ?? []
}

export async function zohoGetContact(tenantId: string, contactId: string) {
  const data = await zohoGet(tenantId, `/Contacts/${contactId}`) as { data?: unknown[] }
  return data.data?.[0] ?? null
}

export async function zohoCreateContact(tenantId: string, params: {
  firstName?: string; lastName: string; email?: string; phone?: string
  accountName?: string; title?: string
}) {
  const record: Record<string, unknown> = { Last_Name: params.lastName }
  if (params.firstName) record.First_Name = params.firstName
  if (params.email) record.Email = params.email
  if (params.phone) record.Phone = params.phone
  if (params.accountName) record.Account_Name = { name: params.accountName }
  if (params.title) record.Title = params.title

  const data = await zohoPost(tenantId, '/Contacts', { data: [record] }) as { data?: unknown[] }
  return data.data?.[0] ?? null
}

// ─── Deals ────────────────────────────────────────────────────────────────────

export async function zohoSearchDeals(tenantId: string, query: string, maxResults = 10) {
  const params = new URLSearchParams({ word: query, per_page: String(maxResults) })
  const data = await zohoGet(tenantId, `/Deals/search?${params}`) as { data?: unknown[] }
  return data.data ?? []
}

export async function zohoCreateDeal(tenantId: string, params: {
  dealName: string; stage: string; amount?: number; closingDate?: string
  accountName?: string; contactName?: string
}) {
  const record: Record<string, unknown> = {
    Deal_Name: params.dealName,
    Stage: params.stage,
  }
  if (params.amount !== undefined) record.Amount = params.amount
  if (params.closingDate) record.Closing_Date = params.closingDate
  if (params.accountName) record.Account_Name = { name: params.accountName }
  if (params.contactName) record.Contact_Name = { name: params.contactName }

  const data = await zohoPost(tenantId, '/Deals', { data: [record] }) as { data?: unknown[] }
  return data.data?.[0] ?? null
}
