import { timingSafeEqual } from 'crypto';
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { integrations } from '@serverless-saas/database/schema/integrations';
import type { AppEnv } from '../../types';

function isAuthorized(provided: string): boolean {
  const expected = process.env.INTERNAL_SERVICE_KEY;
  if (!expected) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

const internalIntegrationsRoute = new Hono<AppEnv>();

// GET /internal/integrations/:tenantId
// Returns active integrations for the tenant, including mcpServerUrl.
// Used by the relay to build the per-tenant MCP server list before each step.
internalIntegrationsRoute.get('/:tenantId', async (c) => {
  if (!isAuthorized(c.req.header('x-internal-service-key') ?? '')) return c.json({ error: 'Unauthorized' }, 401);

  const tenantId = c.req.param('tenantId');

  const rows = await db
    .select({
      provider: integrations.provider,
      mcpServerUrl: integrations.mcpServerUrl,
      status: integrations.status,
    })
    .from(integrations)
    .where(and(
      eq(integrations.tenantId, tenantId),
      eq(integrations.status, 'active'),
    ));

  return c.json({ data: rows });
});

export default internalIntegrationsRoute;
