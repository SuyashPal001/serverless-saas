import { getIntegrationWithCredentials, upsertIntegration } from '../db/credentials.js'

const JIRA_TOKEN_URL = 'https://auth.atlassian.com/oauth/token'
const JIRA_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources'
const JIRA_API_BASE = (cloudId: string) => `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`

async function getAccessToken(tenantId: string): Promise<string> {
  const integration = await getIntegrationWithCredentials(tenantId, 'jira')
  if (!integration) throw new Error(`No active jira integration for tenant ${tenantId}`)

  const creds = integration.credentials as {
    accessToken: string
    refreshToken: string
    expiresAt: number
    clientId: string
    clientSecret: string
  }

  if (creds.expiresAt && Date.now() >= creds.expiresAt - 60_000) {
    const res = await fetch(JIRA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
      }),
    })
    if (!res.ok) throw new Error(`Jira token refresh failed: ${res.status} ${await res.text()}`)
    const data = await res.json() as { access_token: string; expires_in: number; refresh_token?: string }
    const newCreds = {
      ...creds,
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      // Atlassian rotates refresh tokens — save the new one if provided
      ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    }
    await upsertIntegration({
      tenantId,
      provider: 'jira',
      credentials: newCreds,
      createdBy: integration.created_by,
      permissions: integration.permissions,
    }).catch((err: Error) => console.error('[jira] token refresh save failed:', err.message))
    return newCreds.accessToken
  }

  return creds.accessToken
}

/** Fetch (and cache) the primary Jira cloud ID */
async function getCloudId(tenantId: string, token: string): Promise<string> {
  const integration = await getIntegrationWithCredentials(tenantId, 'jira')
  const creds = integration!.credentials as any
  if (typeof creds.cloudId === 'string' && creds.cloudId) return creds.cloudId

  const res = await fetch(JIRA_RESOURCES_URL, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Jira accessible-resources failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as { id: string; name: string }[]
  const cloudId = data[0]?.id
  if (!cloudId) throw new Error('No Jira cloud resource found')

  await upsertIntegration({
    tenantId,
    provider: 'jira',
    credentials: { ...creds, cloudId },
    createdBy: integration!.created_by,
    permissions: integration!.permissions,
  }).catch((err: Error) => console.error('[jira] cloudId cache save failed:', err.message))

  return cloudId
}

async function jiraGet(tenantId: string, path: string): Promise<unknown> {
  const token = await getAccessToken(tenantId)
  const cloudId = await getCloudId(tenantId, token)
  const res = await fetch(`${JIRA_API_BASE(cloudId)}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Jira API error: ${res.status} ${await res.text()}`)
  return res.json()
}

async function jiraPost(tenantId: string, path: string, body: unknown): Promise<unknown> {
  const token = await getAccessToken(tenantId)
  const cloudId = await getCloudId(tenantId, token)
  const res = await fetch(`${JIRA_API_BASE(cloudId)}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Jira API error: ${res.status} ${await res.text()}`)
  return res.json()
}

async function jiraPut(tenantId: string, path: string, body: unknown): Promise<unknown> {
  const token = await getAccessToken(tenantId)
  const cloudId = await getCloudId(tenantId, token)
  const res = await fetch(`${JIRA_API_BASE(cloudId)}${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
  // PUT /issue returns 204 No Content on success
  if (!res.ok) throw new Error(`Jira API error: ${res.status} ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : { success: true }
}

// ─── Issues ───────────────────────────────────────────────────────────────────

export async function jiraSearchIssues(tenantId: string, query: string) {
  const params = new URLSearchParams({ query })
  const data = await jiraGet(tenantId, `/issue/picker?${params}`) as {
    sections?: { issues?: { key: string; summaryText: string }[] }[]
  }
  // picker returns sections (e.g. "Current Search", "History") — flatten all issues
  return data.sections?.flatMap(s => s.issues ?? []) ?? []
}

export async function jiraGetIssue(tenantId: string, issueKey: string) {
  return jiraGet(tenantId, `/issue/${issueKey}`)
}

export async function jiraCreateIssue(tenantId: string, params: {
  projectKey: string; summary: string; issueType?: string
  description?: string; assigneeEmail?: string; priority?: string
}) {
  const body: Record<string, unknown> = {
    fields: {
      project: { key: params.projectKey },
      summary: params.summary,
      issuetype: { name: params.issueType ?? 'Task' },
      ...(params.description ? { description: {
        type: 'doc', version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: params.description }] }],
      } } : {}),
      ...(params.assigneeEmail ? { assignee: { emailAddress: params.assigneeEmail } } : {}),
      ...(params.priority ? { priority: { name: params.priority } } : {}),
    },
  }
  return jiraPost(tenantId, '/issue', body)
}

export async function jiraUpdateIssue(tenantId: string, issueKey: string, params: {
  summary?: string; description?: string; assigneeEmail?: string
  priority?: string; status?: string
}) {
  const fields: Record<string, unknown> = {}
  if (params.summary) fields.summary = params.summary
  if (params.description) fields.description = {
    type: 'doc', version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: params.description }] }],
  }
  if (params.assigneeEmail) fields.assignee = { emailAddress: params.assigneeEmail }
  if (params.priority) fields.priority = { name: params.priority }

  return jiraPut(tenantId, `/issue/${issueKey}`, { fields })
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function jiraListProjects(tenantId: string) {
  const data = await jiraGet(tenantId, '/project') as unknown[]
  return data
}
