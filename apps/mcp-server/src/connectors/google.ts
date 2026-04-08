import { z } from 'zod';
import { google } from 'googleapis';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  getCredentials,
  saveRefreshedToken,
  decryptAs,
  type GoogleCredentials,
} from '../db/credentials';

// ── Tool definitions ──────────────────────────────────────────────────────────
// JSON Schema is hand-written to avoid a zod-to-json-schema dependency.
// Zod schemas are used for argument validation inside executeTool.

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; default?: unknown }>;
    required?: string[];
  };
}

export function getTools(): ToolDefinition[] {
  return [
    // ── Gmail ───────────────────────────────────────────────────────────────
    {
      name: 'GMAIL_SEND_EMAIL',
      description: 'Send an email from the connected Gmail account',
      inputSchema: {
        type: 'object',
        properties: {
          to:      { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body:    { type: 'string', description: 'Email body in plain text' },
          cc:      { type: 'string', description: 'CC addresses comma separated' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
    {
      name: 'GMAIL_READ_EMAIL',
      description: 'Read a Gmail message by its ID',
      inputSchema: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'Gmail message ID to read' },
        },
        required: ['messageId'],
      },
    },
    {
      name: 'GMAIL_SEARCH_EMAILS',
      description: 'Search Gmail messages using a query string',
      inputSchema: {
        type: 'object',
        properties: {
          query:      { type: 'string',  description: "Gmail search query e.g. from:john" },
          maxResults: { type: 'number',  description: 'Max results to return', default: 10 },
        },
        required: ['query'],
      },
    },
    {
      name: 'GMAIL_REPLY_EMAIL',
      description: 'Reply to an existing Gmail message',
      inputSchema: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'Message ID to reply to' },
          body:      { type: 'string', description: 'Reply body' },
        },
        required: ['messageId', 'body'],
      },
    },
    // ── Google Drive ─────────────────────────────────────────────────────────
    {
      name: 'GDRIVE_SEARCH_FILES',
      description: 'Search files in Google Drive',
      inputSchema: {
        type: 'object',
        properties: {
          query:      { type: 'string', description: 'Search query for files' },
          maxResults: { type: 'number', description: 'Max results', default: 10 },
        },
        required: ['query'],
      },
    },
    {
      name: 'GDRIVE_READ_FILE',
      description: 'Read a Google Drive file by ID (exports Docs/Sheets as plain text)',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'Google Drive file ID' },
        },
        required: ['fileId'],
      },
    },
    // ── Google Calendar ───────────────────────────────────────────────────────
    {
      name: 'GCAL_LIST_EVENTS',
      description: 'List events from a Google Calendar',
      inputSchema: {
        type: 'object',
        properties: {
          calendarId:  { type: 'string', description: 'Calendar ID', default: 'primary' },
          maxResults:  { type: 'number', description: 'Max events to return', default: 10 },
          timeMin:     { type: 'string', description: 'Start time ISO format' },
          timeMax:     { type: 'string', description: 'End time ISO format' },
        },
      },
    },
    {
      name: 'GCAL_CREATE_EVENT',
      description: 'Create a new Google Calendar event',
      inputSchema: {
        type: 'object',
        properties: {
          summary:     { type: 'string', description: 'Event title' },
          startTime:   { type: 'string', description: 'Start time ISO format' },
          endTime:     { type: 'string', description: 'End time ISO format' },
          attendees:   { type: 'string', description: 'Attendee emails comma separated' },
          description: { type: 'string', description: 'Event description' },
        },
        required: ['summary', 'startTime', 'endTime'],
      },
    },
  ];
}

// ── Argument schemas (runtime validation) ─────────────────────────────────────

const GmailSendSchema = z.object({
  to:      z.string(),
  subject: z.string(),
  body:    z.string(),
  cc:      z.string().optional(),
});

const GmailReadSchema = z.object({
  messageId: z.string(),
});

const GmailSearchSchema = z.object({
  query:      z.string(),
  maxResults: z.number().optional().default(10),
});

const GmailReplySchema = z.object({
  messageId: z.string(),
  body:      z.string(),
});

const GDriveSearchSchema = z.object({
  query:      z.string(),
  maxResults: z.number().optional().default(10),
});

const GDriveReadSchema = z.object({
  fileId: z.string(),
});

const GCalListSchema = z.object({
  calendarId:  z.string().optional().default('primary'),
  maxResults:  z.number().optional().default(10),
  timeMin:     z.string().optional(),
  timeMax:     z.string().optional(),
});

const GCalCreateSchema = z.object({
  summary:     z.string(),
  startTime:   z.string(),
  endTime:     z.string(),
  attendees:   z.string().optional(),
  description: z.string().optional(),
});

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getAuthClient(tenantId: string) {
  const { credentialsEnc } = await getCredentials(tenantId, 'google');
  const creds = decryptAs<GoogleCredentials>(credentialsEnc, tenantId);

  // Refresh if token expires within 5 minutes
  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  if (Date.now() + FIVE_MINUTES_MS >= creds.expiresAt) {
    const clientId     = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars not set');
    }

    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: creds.refreshToken,
        grant_type:    'refresh_token',
      }),
    });

    if (!resp.ok) {
      throw new Error(`Google token refresh failed: ${resp.status}`);
    }

    const data = (await resp.json()) as { access_token: string; expires_in: number };
    const refreshed: GoogleCredentials = {
      accessToken:  data.access_token,
      refreshToken: creds.refreshToken,
      expiresAt:    Date.now() + data.expires_in * 1000,
    };

    // Persist without logging token values
    await saveRefreshedToken(tenantId, 'google', refreshed);
    creds.accessToken = refreshed.accessToken;
    creds.expiresAt   = refreshed.expiresAt;
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: creds.accessToken });
  return auth;
}

// ── Tool executor ─────────────────────────────────────────────────────────────

type ToolResult = { content: Array<{ type: 'text'; text: string }> };

export async function executeTool(
  tenantId: string,
  toolName: string,
  args: unknown
): Promise<ToolResult> {
  const auth = await getAuthClient(tenantId);
  const text = (val: unknown) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(val, null, 2) }] });

  try {
    // ── Gmail ──────────────────────────────────────────────────────────────
    if (toolName === 'GMAIL_SEND_EMAIL') {
      const { to, subject, body, cc } = GmailSendSchema.parse(args);
      const gmail = google.gmail({ version: 'v1', auth });
      const lines = [
        `To: ${to}`,
        ...(cc ? [`Cc: ${cc}`] : []),
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        body,
      ];
      const raw = Buffer.from(lines.join('\r\n')).toString('base64url');
      const result = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      return text({ messageId: result.data.id, threadId: result.data.threadId });
    }

    if (toolName === 'GMAIL_READ_EMAIL') {
      const { messageId } = GmailReadSchema.parse(args);
      const gmail = google.gmail({ version: 'v1', auth });
      const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
      const headers = msg.data.payload?.headers ?? [];
      const get = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
      const bodyData =
        msg.data.payload?.parts?.[0]?.body?.data ?? msg.data.payload?.body?.data ?? '';
      const bodyText = bodyData
        ? Buffer.from(bodyData, 'base64').toString('utf8')
        : (msg.data.snippet ?? '');
      return text({
        from: get('from'), to: get('to'), subject: get('subject'),
        date: get('date'), body: bodyText,
      });
    }

    if (toolName === 'GMAIL_SEARCH_EMAILS') {
      const { query, maxResults } = GmailSearchSchema.parse(args);
      const gmail = google.gmail({ version: 'v1', auth });
      const list = await gmail.users.messages.list({
        userId: 'me', q: query, maxResults: Math.min(maxResults, 50),
      });
      const messages = list.data.messages ?? [];
      const summaries = await Promise.all(
        messages.map(async (m) => {
          const msg = await gmail.users.messages.get({
            userId: 'me', id: m.id!, format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          });
          const hdr = msg.data.payload?.headers ?? [];
          const get = (n: string) =>
            hdr.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value ?? '';
          return { id: m.id, from: get('from'), subject: get('subject'), date: get('date') };
        })
      );
      return text(summaries);
    }

    if (toolName === 'GMAIL_REPLY_EMAIL') {
      const { messageId, body } = GmailReplySchema.parse(args);
      const gmail = google.gmail({ version: 'v1', auth });
      const orig = await gmail.users.messages.get({
        userId: 'me', id: messageId, format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Message-ID', 'References'],
      });
      const hdr = orig.data.payload?.headers ?? [];
      const get = (n: string) =>
        hdr.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value ?? '';
      const msgIdHeader = get('message-id');
      const references = get('references')
        ? `${get('references')} ${msgIdHeader}` : msgIdHeader;
      const subject = get('subject').startsWith('Re:') ? get('subject') : `Re: ${get('subject')}`;
      const lines = [
        `To: ${get('from')}`, `Subject: ${subject}`,
        `In-Reply-To: ${msgIdHeader}`, `References: ${references}`,
        'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', body,
      ];
      const raw = Buffer.from(lines.join('\r\n')).toString('base64url');
      const result = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw, threadId: orig.data.threadId ?? undefined },
      });
      return text({ messageId: result.data.id });
    }

    // ── Google Drive ───────────────────────────────────────────────────────
    if (toolName === 'GDRIVE_SEARCH_FILES') {
      const { query, maxResults } = GDriveSearchSchema.parse(args);
      const drive = google.drive({ version: 'v3', auth });
      const result = await drive.files.list({
        q: query, pageSize: Math.min(maxResults, 50),
        fields: 'files(id,name,mimeType,modifiedTime,size)',
      });
      return text(result.data.files ?? []);
    }

    if (toolName === 'GDRIVE_READ_FILE') {
      const { fileId } = GDriveReadSchema.parse(args);
      const drive = google.drive({ version: 'v3', auth });
      const meta = await drive.files.get({ fileId, fields: 'mimeType,name' });
      const mimeType = meta.data.mimeType ?? '';

      // Export Google Workspace documents as plain text
      if (mimeType.startsWith('application/vnd.google-apps')) {
        const exported = await drive.files.export(
          { fileId, mimeType: 'text/plain' },
          { responseType: 'text' }
        );
        return text({ name: meta.data.name, content: exported.data });
      }

      // Binary files: return metadata only
      return text({ name: meta.data.name, mimeType, note: 'Binary file — download not supported' });
    }

    // ── Google Calendar ────────────────────────────────────────────────────
    if (toolName === 'GCAL_LIST_EVENTS') {
      const { calendarId, maxResults, timeMin, timeMax } = GCalListSchema.parse(args);
      const cal = google.calendar({ version: 'v3', auth });
      const result = await cal.events.list({
        calendarId,
        maxResults: Math.min(maxResults, 50),
        singleEvents: true,
        orderBy: 'startTime',
        ...(timeMin ? { timeMin } : {}),
        ...(timeMax ? { timeMax } : {}),
      });
      return text(result.data.items ?? []);
    }

    if (toolName === 'GCAL_CREATE_EVENT') {
      const { summary, startTime, endTime, attendees, description } =
        GCalCreateSchema.parse(args);
      const cal = google.calendar({ version: 'v3', auth });
      const result = await cal.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary,
          description,
          start: { dateTime: startTime },
          end:   { dateTime: endTime },
          attendees: attendees
            ? attendees.split(',').map((e) => ({ email: e.trim() }))
            : undefined,
        },
      });
      return text({ eventId: result.data.id, htmlLink: result.data.htmlLink });
    }

    throw new McpError(ErrorCode.MethodNotFound, `Unknown Google tool: ${toolName}`);
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(
      ErrorCode.InternalError,
      `${toolName} failed: ${(err as Error).message}`
    );
  }
}
