import { randomUUID } from 'crypto'
import {
  gmailListMessages, gmailGetMessage, gmailSendMessage,
  driveListFiles, driveGetFile, driveExportDoc,
  calendarListEvents, calendarCreateEvent, calendarUpdateEvent,
} from './connectors/google.js'
import {
  zohoSearchContacts, zohoGetContact, zohoCreateContact,
  zohoSearchDeals, zohoCreateDeal,
} from './connectors/zoho.js'
import {
  zohoMailListMessages, zohoMailGetMessage, zohoMailSendMessage,
} from './connectors/zoho_mail.js'
import {
  zohoCliqListChannels, zohoCliqGetChannelMessages, zohoCliqSendMessage,
} from './connectors/zoho_cliq.js'
import {
  jiraSearchIssues, jiraGetIssue, jiraCreateIssue, jiraUpdateIssue, jiraListProjects,
} from './connectors/jira.js'
import { proxyToVendorMCP, listVendorTools } from './proxy/vendor.js'
import { getIntegrations } from './db/credentials.js'

// Tools that create, send, or mutate external state — require explicit user confirmation
// before execution. Read-only tools (list, get, search, export) are excluded.
const WRITE_TOOLS = new Set([
  'gmail_send_message',
  'calendar_create_event',
  'calendar_update_event',
  'zoho_create_contact',
  'zoho_create_deal',
  'zoho_mail_send_message',
  'zoho_cliq_send_message',
  'jira_create_issue',
  'jira_update_issue',
])

async function requestApproval(
  tenantId: string,
  relaySessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<void> {
  const relayUrl = process.env.RELAY_INTERNAL_URL
  if (!relayUrl) {
    throw new Error(`${toolName} requires user approval but RELAY_INTERNAL_URL is not configured`)
  }
  const approvalId = randomUUID()
  let res: Response
  try {
    res = await fetch(`${relayUrl}/mcp/approval-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY ?? '',
      },
      body: JSON.stringify({ tenantId, sessionId: relaySessionId, approvalId, toolName, args }),
      signal: AbortSignal.timeout(35_000),
    })
  } catch (err) {
    throw new Error(`${toolName}: could not reach approval relay — ${(err as Error).message}`)
  }
  if (!res.ok) {
    throw new Error(`${toolName}: approval request failed (relay returned ${res.status})`)
  }
  const data = await res.json() as { approved: boolean; reason?: string }
  if (!data.approved) {
    throw new Error(`User denied ${toolName}${data.reason ? ` (${data.reason})` : ''}`)
  }
}

const BUILTIN_TOOLS = [
  // Gmail
  { name: 'gmail_list_messages', description: 'List Gmail messages matching a query', provider: 'gmail',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'number' } }, required: ['query'] } },
  { name: 'gmail_get_message', description: 'Fetch a single Gmail message by ID', provider: 'gmail',
    inputSchema: { type: 'object', properties: { messageId: { type: 'string' } }, required: ['messageId'] } },
  { name: 'gmail_send_message', description: 'Send an email via Gmail', provider: 'gmail',
    inputSchema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, replyToMessageId: { type: 'string' } }, required: ['to', 'subject', 'body'] } },
  // Drive
  { name: 'drive_list_files', description: 'List Google Drive files', provider: 'drive',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, pageSize: { type: 'number' } } } },
  { name: 'drive_get_file', description: 'Get Google Drive file metadata', provider: 'drive',
    inputSchema: { type: 'object', properties: { fileId: { type: 'string' } }, required: ['fileId'] } },
  { name: 'drive_export_doc', description: 'Export a Google Doc as plain text', provider: 'drive',
    inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, mimeType: { type: 'string' } }, required: ['fileId'] } },
  // Calendar
  { name: 'calendar_list_events', description: 'List Google Calendar events', provider: 'calendar',
    inputSchema: { type: 'object', properties: { calendarId: { type: 'string' }, timeMin: { type: 'string' }, timeMax: { type: 'string' }, maxResults: { type: 'number' } } } },
  { name: 'calendar_create_event', description: 'Create a Google Calendar event', provider: 'calendar',
    inputSchema: { type: 'object', properties: { summary: { type: 'string' }, description: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'start', 'end'] } },
  { name: 'calendar_update_event', description: 'Update an existing calendar event', provider: 'calendar',
    inputSchema: { type: 'object', properties: { eventId: { type: 'string' }, summary: { type: 'string' }, description: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' } }, required: ['eventId'] } },
  // Zoho CRM
  { name: 'zoho_search_contacts', description: 'Search contacts in Zoho CRM', provider: 'zoho_crm',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'number' } }, required: ['query'] } },
  { name: 'zoho_get_contact', description: 'Get a Zoho CRM contact by ID', provider: 'zoho_crm',
    inputSchema: { type: 'object', properties: { contactId: { type: 'string' } }, required: ['contactId'] } },
  { name: 'zoho_create_contact', description: 'Create a new contact in Zoho CRM', provider: 'zoho_crm',
    inputSchema: { type: 'object', properties: { firstName: { type: 'string' }, lastName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, accountName: { type: 'string' }, title: { type: 'string' } }, required: ['lastName'] } },
  { name: 'zoho_search_deals', description: 'Search deals in Zoho CRM', provider: 'zoho_crm',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'number' } }, required: ['query'] } },
  { name: 'zoho_create_deal', description: 'Create a new deal in Zoho CRM', provider: 'zoho_crm',
    inputSchema: { type: 'object', properties: { dealName: { type: 'string' }, stage: { type: 'string' }, amount: { type: 'number' }, closingDate: { type: 'string' }, accountName: { type: 'string' }, contactName: { type: 'string' } }, required: ['dealName', 'stage'] } },
  // Zoho Mail
  { name: 'zoho_mail_list_messages', description: 'Search and list Zoho Mail messages', provider: 'zoho_mail',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'number' } }, required: ['query'] } },
  { name: 'zoho_mail_get_message', description: 'Get a Zoho Mail message by ID', provider: 'zoho_mail',
    inputSchema: { type: 'object', properties: { messageId: { type: 'string' }, folderId: { type: 'string' } }, required: ['messageId', 'folderId'] } },
  { name: 'zoho_mail_send_message', description: 'Send an email via Zoho Mail', provider: 'zoho_mail',
    inputSchema: { type: 'object', properties: { toAddress: { type: 'string' }, subject: { type: 'string' }, content: { type: 'string' }, fromAddress: { type: 'string' }, ccAddress: { type: 'string' } }, required: ['toAddress', 'subject', 'content'] } },
  // Zoho Cliq
  { name: 'zoho_cliq_list_channels', description: 'List Zoho Cliq channels', provider: 'zoho_cliq',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'zoho_cliq_get_channel_messages', description: 'Get messages from a Zoho Cliq channel', provider: 'zoho_cliq',
    inputSchema: { type: 'object', properties: { channelName: { type: 'string' }, count: { type: 'number' } }, required: ['channelName'] } },
  { name: 'zoho_cliq_send_message', description: 'Send a message to a Zoho Cliq channel or user', provider: 'zoho_cliq',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, channelName: { type: 'string' }, userEmail: { type: 'string' } }, required: ['text'] } },
  // Jira
  { name: 'jira_search_issues', description: 'Search Jira issues by keyword', provider: 'jira',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'jira_get_issue', description: 'Get a Jira issue by key (e.g. PROJ-123)', provider: 'jira',
    inputSchema: { type: 'object', properties: { issueKey: { type: 'string' } }, required: ['issueKey'] } },
  { name: 'jira_create_issue', description: 'Create a new Jira issue', provider: 'jira',
    inputSchema: { type: 'object', properties: { projectKey: { type: 'string' }, summary: { type: 'string' }, issueType: { type: 'string' }, description: { type: 'string' }, assigneeEmail: { type: 'string' }, priority: { type: 'string' } }, required: ['projectKey', 'summary'] } },
  { name: 'jira_update_issue', description: 'Update fields on an existing Jira issue', provider: 'jira',
    inputSchema: { type: 'object', properties: { issueKey: { type: 'string' }, summary: { type: 'string' }, description: { type: 'string' }, assigneeEmail: { type: 'string' }, priority: { type: 'string' } }, required: ['issueKey'] } },
  { name: 'jira_list_projects', description: 'List all Jira projects', provider: 'jira',
    inputSchema: { type: 'object', properties: {} } },
]

interface RpcBody {
  jsonrpc: string
  id?: string | number
  method: string
  params?: { name?: string; arguments?: Record<string, unknown> }
}

function ok(id: string | number | undefined, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function err(id: string | number | undefined, message: string, code = -32000) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

async function toolsList(tenantId: string): Promise<unknown[]> {
  const integrations = await getIntegrations(tenantId)
  const activeProviders = new Set(integrations.map(i => i.provider))
  const available = BUILTIN_TOOLS.filter(t => activeProviders.has(t.provider))

  const vendorTools: unknown[] = []
  for (const integration of integrations) {
    if (integration.mcp_server_url) {
      try {
        vendorTools.push(...await listVendorTools(tenantId, integration.provider))
      } catch (e) {
        console.error(`[gateway] vendor tools failed for ${integration.provider}:`, (e as Error).message)
      }
    }
  }

  return [...available, ...vendorTools]
}

async function toolsCall(tenantId: string, name: string, args: Record<string, unknown>, relaySessionId?: string): Promise<unknown> {
  if (WRITE_TOOLS.has(name)) {
    if (!relaySessionId) {
      throw new Error(`${name} requires user approval but no active user session is available`)
    }
    await requestApproval(tenantId, relaySessionId, name, args)
  }
  switch (name) {
    case 'gmail_list_messages':
      return gmailListMessages(tenantId, args.query as string, args.maxResults as number | undefined)
    case 'gmail_get_message':
      return gmailGetMessage(tenantId, args.messageId as string)
    case 'gmail_send_message':
      return gmailSendMessage(tenantId, args as Parameters<typeof gmailSendMessage>[1])
    case 'drive_list_files':
      return driveListFiles(tenantId, args.query as string | undefined, args.pageSize as number | undefined)
    case 'drive_get_file':
      return driveGetFile(tenantId, args.fileId as string)
    case 'drive_export_doc':
      return driveExportDoc(tenantId, args.fileId as string, args.mimeType as string | undefined)
    case 'calendar_list_events':
      return calendarListEvents(tenantId, args as Parameters<typeof calendarListEvents>[1])
    case 'calendar_create_event':
      return calendarCreateEvent(tenantId, args as Parameters<typeof calendarCreateEvent>[1])
    case 'calendar_update_event':
      return calendarUpdateEvent(tenantId, args as Parameters<typeof calendarUpdateEvent>[1])
    case 'zoho_search_contacts':
      return zohoSearchContacts(tenantId, args.query as string, args.maxResults as number | undefined)
    case 'zoho_get_contact':
      return zohoGetContact(tenantId, args.contactId as string)
    case 'zoho_create_contact':
      return zohoCreateContact(tenantId, args as Parameters<typeof zohoCreateContact>[1])
    case 'zoho_search_deals':
      return zohoSearchDeals(tenantId, args.query as string, args.maxResults as number | undefined)
    case 'zoho_create_deal':
      return zohoCreateDeal(tenantId, args as Parameters<typeof zohoCreateDeal>[1])
    case 'zoho_mail_list_messages':
      return zohoMailListMessages(tenantId, args.query as string, args.maxResults as number | undefined)
    case 'zoho_mail_get_message':
      return zohoMailGetMessage(tenantId, args.messageId as string, args.folderId as string)
    case 'zoho_mail_send_message':
      return zohoMailSendMessage(tenantId, args as Parameters<typeof zohoMailSendMessage>[1])
    case 'zoho_cliq_list_channels':
      return zohoCliqListChannels(tenantId)
    case 'zoho_cliq_get_channel_messages':
      return zohoCliqGetChannelMessages(tenantId, args.channelName as string, args.count as number | undefined)
    case 'zoho_cliq_send_message':
      return zohoCliqSendMessage(tenantId, args as Parameters<typeof zohoCliqSendMessage>[1])
    case 'jira_search_issues':
      return jiraSearchIssues(tenantId, args.query as string)
    case 'jira_get_issue':
      return jiraGetIssue(tenantId, args.issueKey as string)
    case 'jira_create_issue':
      return jiraCreateIssue(tenantId, args as Parameters<typeof jiraCreateIssue>[1])
    case 'jira_update_issue':
      return jiraUpdateIssue(tenantId, args.issueKey as string, args as Parameters<typeof jiraUpdateIssue>[2])
    case 'jira_list_projects':
      return jiraListProjects(tenantId)
    default: {
      // Fall through to vendor proxy — find first integration with an mcp_server_url
      const integrations = await getIntegrations(tenantId)
      const vendor = integrations.find(i => i.mcp_server_url)
      if (!vendor) throw new Error(`Unknown tool: ${name}`)
      return proxyToVendorMCP(tenantId, vendor.provider, 'tools/call', { name, arguments: args })
    }
  }
}

export async function handleRequest(tenantId: string, body: RpcBody, relaySessionId?: string): Promise<object> {
  const { id, method } = body

  try {
    switch (method) {
      case 'tools/list': {
        const tools = await toolsList(tenantId)
        return ok(id, { tools })
      }
      case 'tools/call': {
        const name = body.params?.name
        if (!name) return err(id, 'params.name required')
        const args = body.params?.arguments ?? {}
        console.log(`[gateway] tools/call tenant=${tenantId} tool=${name} sessionId=${relaySessionId ?? '(none)'}`)
        const result = await toolsCall(tenantId, name, args, relaySessionId)
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
      }
      default:
        return err(id, `Method not found: ${method}`, -32601)
    }
  } catch (e) {
    const message = (e as Error).message
    console.error(`[gateway] error method=${method} tenant=${tenantId}:`, message)
    return err(id, message)
  }
}
