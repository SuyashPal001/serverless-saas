import { createCipheriv, scryptSync, randomBytes } from 'crypto';

// AES-256-GCM with per-tenant key derived from the master key.
// NEVER log the return value or any value passed in.
export function encryptCredentials(data: object, tenantId: string): string {
    const masterKey = process.env.TOKEN_ENCRYPTION_KEY!;
    const key = scryptSync(masterKey, tenantId, 32);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(data), 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.from(JSON.stringify({
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        data: encrypted.toString('base64'),
    })).toString('base64');
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Provider → tool names — used to merge/remove tools in agent_skills on connect/disconnect
export const PROVIDER_TOOLS_MAP: Record<string, string[]> = {
    gmail:     ['GMAIL_SEND_EMAIL', 'GMAIL_SEARCH_EMAILS', 'GMAIL_READ_EMAIL'],
    drive:     ['GDRIVE_SEARCH_FILES', 'GDRIVE_READ_FILE'],
    calendar:  ['GCAL_LIST_EVENTS', 'GCAL_CREATE_EVENT'],
    zoho_crm:  ['ZOHO_SEARCH_CONTACTS', 'ZOHO_GET_CONTACT', 'ZOHO_CREATE_CONTACT', 'ZOHO_SEARCH_DEALS', 'ZOHO_CREATE_DEAL'],
    zoho_mail: ['ZOHO_MAIL_LIST_MESSAGES', 'ZOHO_MAIL_GET_MESSAGE', 'ZOHO_MAIL_SEND_MESSAGE'],
    zoho_cliq: ['ZOHO_CLIQ_LIST_CHANNELS', 'ZOHO_CLIQ_GET_CHANNEL_MESSAGES', 'ZOHO_CLIQ_SEND_MESSAGE'],
    jira:      ['JIRA_SEARCH_ISSUES', 'JIRA_GET_ISSUE', 'JIRA_CREATE_ISSUE', 'JIRA_UPDATE_ISSUE', 'JIRA_LIST_PROJECTS'],
};
