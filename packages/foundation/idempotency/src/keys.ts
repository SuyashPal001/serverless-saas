export const webhookDeliveryKey = (eventId: string, endpointId: string): string =>
  `webhook:${eventId}:${endpointId}`;

export const notificationJobKey = (
  workflowId: string,
  stepId: string,
  recipientId: string,
  triggerId: string,
): string => `notification:${workflowId}:${stepId}:${recipientId}:${triggerId}`;

export const usageRecordKey = (
  tenantId: string,
  actorId: string,
  metric: string,
  actionId: string,
): string => `usage:${tenantId}:${actorId}:${metric}:${actionId}`;

export const auditLogKey = (traceId: string, action: string, resourceId: string): string =>
  `audit:${traceId}:${action}:${resourceId}`;

export const invitationEmailKey = (tokenId: string): string =>
  `invitation:${tokenId}`;

export const billingEventKey = (externalEventId: string): string =>
  `billing:${externalEventId}`;
