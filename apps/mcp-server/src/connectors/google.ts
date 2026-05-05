import { google, type Auth } from 'googleapis'
import { getIntegrationWithCredentials, upsertIntegration } from '../db/credentials.js'

type OAuth2Client = Auth.OAuth2Client

export type GoogleProvider = 'gmail' | 'drive' | 'calendar'

function buildOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
}

/** Load OAuth2 client pre-loaded with stored tokens for this tenant+provider */
async function getAuthedClient(tenantId: string, provider: GoogleProvider): Promise<OAuth2Client> {
  const integration = await getIntegrationWithCredentials(tenantId, provider)
  if (!integration) throw new Error(`No active ${provider} integration for tenant ${tenantId}`)

  const client = buildOAuth2Client()
  const creds = integration.credentials as any
  client.setCredentials({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
    expiry_date: creds.expiresAt,
    token_type: 'Bearer',
  })

  // Auto-save refreshed tokens
  client.on('tokens', async (tokens) => {
    const merged = {
      ...integration.credentials,
      accessToken: tokens.access_token ?? creds.accessToken,
      refreshToken: tokens.refresh_token ?? creds.refreshToken,
      expiresAt: tokens.expiry_date ?? creds.expiresAt,
    }
    await upsertIntegration({
      tenantId,
      provider,
      credentials: merged,
      createdBy: integration.created_by,
      permissions: integration.permissions,
    }).catch((err: Error) => console.error(`[google] token refresh save failed:`, err.message))
  })

  return client
}

// ─── Gmail ────────────────────────────────────────────────────────────────────

export async function gmailListMessages(tenantId: string, query: string, maxResults = 10) {
  const auth = await getAuthedClient(tenantId, 'gmail')
  const gmail = google.gmail({ version: 'v1', auth })
  const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults })
  const ids = list.data.messages ?? []
  const messages = await Promise.all(
    ids.map(async (m) => {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'] })
      const headers = msg.data.payload?.headers ?? []
      const h = (name: string) => headers.find(x => x.name === name)?.value ?? ''
      return { id: m.id, subject: h('Subject'), from: h('From'), date: h('Date'), snippet: msg.data.snippet }
    })
  )
  return messages
}

export async function gmailGetMessage(tenantId: string, messageId: string) {
  const auth = await getAuthedClient(tenantId, 'gmail')
  const gmail = google.gmail({ version: 'v1', auth })
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' })
  return msg.data
}

export async function gmailSendMessage(tenantId: string, params: {
  to: string; subject: string; body: string; replyToMessageId?: string
}) {
  const auth = await getAuthedClient(tenantId, 'gmail')
  const gmail = google.gmail({ version: 'v1', auth })

  const lines = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    params.body,
  ]
  if (params.replyToMessageId) lines.splice(3, 0, `In-Reply-To: ${params.replyToMessageId}`)
  const raw = Buffer.from(lines.join('\r\n')).toString('base64url')
  const result = await gmail.users.messages.send({ userId: 'me', requestBody: { raw,
    ...(params.replyToMessageId ? { threadId: params.replyToMessageId } : {}) } })
  return result.data
}

// ─── Google Drive ─────────────────────────────────────────────────────────────

export async function driveListFiles(tenantId: string, query = '', pageSize = 20) {
  const auth = await getAuthedClient(tenantId, 'drive')
  const drive = google.drive({ version: 'v3', auth })
  const res = await drive.files.list({
    q: query || undefined,
    pageSize,
    fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
  })
  return res.data.files ?? []
}

export async function driveGetFile(tenantId: string, fileId: string) {
  const auth = await getAuthedClient(tenantId, 'drive')
  const drive = google.drive({ version: 'v3', auth })
  const meta = await drive.files.get({ fileId,
    fields: 'id,name,mimeType,modifiedTime,size,webViewLink,description' })
  return meta.data
}

export async function driveExportDoc(tenantId: string, fileId: string, mimeType = 'text/plain') {
  const auth = await getAuthedClient(tenantId, 'drive')
  const drive = google.drive({ version: 'v3', auth })
  const res = await drive.files.export({ fileId, mimeType }, { responseType: 'text' })
  return res.data as string
}

// ─── Google Calendar ──────────────────────────────────────────────────────────

export async function calendarListEvents(tenantId: string, params: {
  calendarId?: string; timeMin?: string; timeMax?: string; maxResults?: number
}) {
  const auth = await getAuthedClient(tenantId, 'calendar')
  const calendar = google.calendar({ version: 'v3', auth })
  const res = await calendar.events.list({
    calendarId: params.calendarId ?? 'primary',
    timeMin: params.timeMin ?? new Date().toISOString(),
    timeMax: params.timeMax,
    maxResults: params.maxResults ?? 20,
    singleEvents: true,
    orderBy: 'startTime',
  })
  return res.data.items ?? []
}

export async function calendarCreateEvent(tenantId: string, params: {
  summary: string; description?: string; start: string; end: string
  attendees?: string[]; calendarId?: string
}) {
  const auth = await getAuthedClient(tenantId, 'calendar')
  const calendar = google.calendar({ version: 'v3', auth })
  const res = await calendar.events.insert({
    calendarId: params.calendarId ?? 'primary',
    requestBody: {
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.start },
      end: { dateTime: params.end },
      attendees: params.attendees?.map(email => ({ email })),
    },
  })
  return res.data
}

export async function calendarUpdateEvent(tenantId: string, params: {
  eventId: string; summary?: string; description?: string
  start?: string; end?: string; calendarId?: string
}) {
  const auth = await getAuthedClient(tenantId, 'calendar')
  const calendar = google.calendar({ version: 'v3', auth })
  const existing = await calendar.events.get({
    calendarId: params.calendarId ?? 'primary',
    eventId: params.eventId,
  })
  const res = await calendar.events.update({
    calendarId: params.calendarId ?? 'primary',
    eventId: params.eventId,
    requestBody: {
      ...existing.data,
      ...(params.summary !== undefined ? { summary: params.summary } : {}),
      ...(params.description !== undefined ? { description: params.description } : {}),
      ...(params.start !== undefined ? { start: { dateTime: params.start } } : {}),
      ...(params.end !== undefined ? { end: { dateTime: params.end } } : {}),
    },
  })
  return res.data
}
