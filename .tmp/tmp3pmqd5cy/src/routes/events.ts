import { Hono } from 'hono';
import { hasPermission } from '@serverless-saas/permissions';
import type { AppEnv } from '../types';

export const eventsRoutes = new Hono<AppEnv>();

// Static catalog of all webhook-deliverable events, grouped by category.
// Consumed by the Create Webhook modal to render the event picker.
const EVENT_CATALOG: Record<string, { event: string; description: string }[]> = {
    members: [
        { event: 'member.invited',      description: 'A new member was invited to the workspace.' },
        { event: 'member.joined',       description: 'An invited member accepted and joined.' },
        { event: 'member.removed',      description: 'A member was removed from the workspace.' },
        { event: 'member.role_changed', description: "A member's role was updated." },
    ],
    roles: [
        { event: 'role.created', description: 'A custom role was created.' },
        { event: 'role.updated', description: 'A custom role was modified.' },
        { event: 'role.deleted', description: 'A custom role was deleted.' },
    ],
    api_keys: [
        { event: 'api_key.created', description: 'A new API key was generated.' },
        { event: 'api_key.revoked',  description: 'An API key was revoked.' },
    ],
    files: [
        { event: 'file.uploaded', description: 'A file upload was confirmed.' },
        { event: 'file.deleted',  description: 'A file was deleted from the workspace.' },
    ],
    agents: [
        { event: 'agent.created',          description: 'A new agent was created.' },
        { event: 'agent.run.completed',    description: 'An agent run finished successfully.' },
        { event: 'agent.run.failed',       description: 'An agent run encountered an error.' },
    ],
    webhooks: [
        { event: 'webhook.created', description: 'A new webhook endpoint was registered.' },
        { event: 'webhook.updated', description: 'A webhook endpoint was modified.' },
        { event: 'webhook.deleted', description: 'A webhook endpoint was removed.' },
    ],
    billing: [
        { event: 'subscription.updated', description: 'The workspace subscription plan changed.' },
    ],
};

// GET /events — returns the full event catalog for the webhook event picker
eventsRoutes.get('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'webhooks', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    return c.json({ data: EVENT_CATALOG });
});
