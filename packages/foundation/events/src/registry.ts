export const PLATFORM_EVENTS = {

  // IDENTITY
  'user.created':             { category: 'identity',      description: 'New user account created' },
  'user.updated':             { category: 'identity',      description: 'User profile updated' },
  'user.deleted':             { category: 'identity',      description: 'User account deleted' },
  'user.invited':             { category: 'identity',      description: 'User invited to tenant' },
  'user.joined':              { category: 'identity',      description: 'User accepted invite and joined tenant' },
  'user.suspended':           { category: 'identity',      description: 'User membership suspended' },
  'user.reactivated':         { category: 'identity',      description: 'User membership reactivated' },
  'user.role_changed':        { category: 'identity',      description: 'User role changed within tenant' },

  // TENANCY
  'tenant.created':           { category: 'tenancy',       description: 'New tenant created' },
  'tenant.updated':           { category: 'tenancy',       description: 'Tenant details updated' },
  'tenant.suspended':         { category: 'tenancy',       description: 'Tenant suspended' },
  'tenant.reactivated':       { category: 'tenancy',       description: 'Tenant reactivated' },
  'tenant.deleted':           { category: 'tenancy',       description: 'Tenant deleted' },

  // AUTH
  'auth.login':               { category: 'auth',          description: 'User logged in' },
  'auth.logout':              { category: 'auth',          description: 'User logged out' },
  'auth.password_reset':      { category: 'auth',          description: 'Password reset completed' },
  'auth.session_invalidated': { category: 'auth',          description: 'Session forcefully invalidated' },
  'auth.tenant_switched':     { category: 'auth',          description: 'User switched active tenant' },

  // BILLING
  'subscription.created':     { category: 'billing',       description: 'New subscription created' },
  'subscription.upgraded':    { category: 'billing',       description: 'Plan upgraded' },
  'subscription.downgraded':  { category: 'billing',       description: 'Plan downgraded' },
  'subscription.cancelled':   { category: 'billing',       description: 'Subscription cancelled' },
  'subscription.expired':     { category: 'billing',       description: 'Subscription expired' },
  'invoice.created':          { category: 'billing',       description: 'Invoice generated' },
  'invoice.paid':             { category: 'billing',       description: 'Invoice paid' },
  'invoice.failed':           { category: 'billing',       description: 'Invoice payment failed' },
  'invoice.overdue':          { category: 'billing',       description: 'Invoice past due date' },
  'dispute.opened':           { category: 'billing',       description: 'Payment dispute opened' },
  'dispute.resolved':         { category: 'billing',       description: 'Payment dispute resolved' },
  'usage.limit_approaching':  { category: 'billing',       description: 'Usage nearing plan limit (80%)' },
  'usage.limit_reached':      { category: 'billing',       description: 'Usage hit plan limit (100%)' },

  // API ACCESS
  'api_key.created':          { category: 'access',        description: 'API key created' },
  'api_key.revoked':          { category: 'access',        description: 'API key revoked' },
  'api_key.expired':          { category: 'access',        description: 'API key expired' },

  // AGENTS
  'agent.created':            { category: 'agents',        description: 'AI agent created' },
  'agent.paused':             { category: 'agents',        description: 'AI agent paused' },
  'agent.retired':            { category: 'agents',        description: 'AI agent retired' },
  'agent.workflow_started':   { category: 'agents',        description: 'Agent workflow execution started' },
  'agent.workflow_completed': { category: 'agents',        description: 'Agent workflow execution completed' },
  'agent.workflow_failed':    { category: 'agents',        description: 'Agent workflow execution failed' },
  'agent.approval_required':  { category: 'agents',        description: 'Agent action awaiting human approval' },

  // INTEGRATIONS
  'integration.connected':    { category: 'integrations',  description: 'External integration connected' },
  'integration.disconnected': { category: 'integrations',  description: 'External integration disconnected' },
  'integration.error':        { category: 'integrations',  description: 'External integration encountered error' },

  // WEBHOOKS
  'webhook.endpoint_created': { category: 'webhooks',      description: 'Webhook endpoint registered' },
  'webhook.delivery_failed':  { category: 'webhooks',      description: 'Webhook delivery failed after all retries' },
  'webhook.endpoint_disabled': { category: 'webhooks',     description: 'Webhook endpoint auto-disabled due to failures' },

  // ENTITLEMENTS
  'entitlement.override_granted': { category: 'entitlements', description: 'Feature override granted to tenant' },
  'entitlement.override_revoked': { category: 'entitlements', description: 'Feature override revoked' },
  'entitlement.override_expired': { category: 'entitlements', description: 'Feature override expired' },

  // SECURITY
  'security.cross_tenant_attempt': { category: 'security', description: 'Cross-tenant access attempt blocked' },
  'security.rate_limit_exceeded':  { category: 'security', description: 'Rate limit exceeded' },
  'security.suspicious_activity':  { category: 'security', description: 'Suspicious activity detected' },

} as const;

export type PlatformEvent = keyof typeof PLATFORM_EVENTS;

export interface EventMeta {
  category: string;
  description: string;
}

export type EventCategory = (typeof PLATFORM_EVENTS)[PlatformEvent]['category'];

export const VALID_EVENTS = Object.keys(PLATFORM_EVENTS) as PlatformEvent[];

export const eventsByCategory = (): Record<string, PlatformEvent[]> => {
  const grouped: Record<string, PlatformEvent[]> = {};
  for (const [event, meta] of Object.entries(PLATFORM_EVENTS)) {
    if (!grouped[meta.category]) grouped[meta.category] = [];
    grouped[meta.category].push(event as PlatformEvent);
  }
  return grouped;
};
