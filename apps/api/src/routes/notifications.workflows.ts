import { and, eq, desc, sql } from 'drizzle-orm';
import { db, notificationInbox, notificationWorkflows, notificationWorkflowSteps, notificationTemplates } from '@serverless-saas/database';
import { notificationJobs } from '@serverless-saas/database/schema/notifications';
import { hasPermission } from '@serverless-saas/permissions';
import type { Context } from 'hono';
import type { AppEnv } from '../types';

// GET /notifications/workflows
export async function handleListWorkflows(c: Context<AppEnv>) {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'notifications', 'read')) return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);

    const workflows = await db
        .select({ id: notificationWorkflows.id, messageType: notificationWorkflows.messageType, critical: notificationWorkflows.critical, status: notificationWorkflows.status, createdAt: notificationWorkflows.createdAt, stepCount: sql<number>`count(${notificationWorkflowSteps.id})::int` })
        .from(notificationWorkflows)
        .leftJoin(notificationWorkflowSteps, eq(notificationWorkflowSteps.workflowId, notificationWorkflows.id))
        .where(eq(notificationWorkflows.tenantId, tenantId))
        .groupBy(notificationWorkflows.id, notificationWorkflows.messageType, notificationWorkflows.critical, notificationWorkflows.status, notificationWorkflows.createdAt)
        .orderBy(desc(notificationWorkflows.createdAt));

    return c.json({ items: workflows });
}

// GET /notifications/workflows/:id
export async function handleGetWorkflow(c: Context<AppEnv>) {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'notifications', 'read')) return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);

    const workflowId = c.req.param('id') as string;
    const workflow = await db
        .select({ id: notificationWorkflows.id, messageType: notificationWorkflows.messageType, critical: notificationWorkflows.critical, status: notificationWorkflows.status })
        .from(notificationWorkflows)
        .where(and(eq(notificationWorkflows.id, workflowId), eq(notificationWorkflows.tenantId, tenantId)))
        .limit(1);

    if (!workflow[0]) return c.json({ error: 'Workflow not found' }, 404);

    const steps = await db
        .select({ id: notificationWorkflowSteps.id, order: notificationWorkflowSteps.order, type: notificationWorkflowSteps.type, config: notificationWorkflowSteps.config, templateId: notificationWorkflowSteps.templateId, templateName: notificationTemplates.name })
        .from(notificationWorkflowSteps)
        .leftJoin(notificationTemplates, eq(notificationTemplates.id, notificationWorkflowSteps.templateId))
        .where(eq(notificationWorkflowSteps.workflowId, workflowId))
        .orderBy(notificationWorkflowSteps.order);

    return c.json({ ...workflow[0], steps: steps.map((s: typeof steps[number]) => ({ id: s.id, order: s.order, type: s.type, config: s.config, templateId: s.templateId ?? null, templateName: s.templateName ?? null })) });
}

// POST /notifications/test-fire
export async function handleTestFire(c: Context<AppEnv>) {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId') as string;

    if (!tenantId || !userId) return c.json({ error: 'Unauthorized' }, 401);

    try {
        const workflowId = crypto.randomUUID();
        const stepId = crypto.randomUUID();
        const jobId = crypto.randomUUID();
        const inboxId = crypto.randomUUID();

        await db.insert(notificationWorkflows).values({ id: workflowId, tenantId, messageType: 'test.notification', critical: false, status: 'active', createdBy: userId });
        await db.insert(notificationWorkflowSteps).values({ id: stepId, workflowId, tenantId, order: 1, type: 'channel', config: { channel: 'in_app' } });
        await db.insert(notificationJobs).values({ id: jobId, workflowId, stepId, tenantId, recipientId: userId, recipientType: 'human', scheduledAt: new Date(), executedAt: new Date(), status: 'completed', retryCount: 0, payload: { event: 'test.notification', tenantId, data: {} }, stepContext: {} });

        const [inboxEntry] = await db.insert(notificationInbox).values({ id: inboxId, tenantId, userId, jobId, workflowId, messageType: 'test.notification', title: 'Test Notification', body: 'This is a real test notification fired from the API.', read: false, archived: false }).returning();

        const { pushToConnectedClients } = await import('@serverless-saas/cache');
        await pushToConnectedClients(tenantId, userId, { type: 'notification', ...inboxEntry });

        return c.json({ success: true, inboxEntry });
    } catch (error) {
        console.error('test-fire error:', error);
        return c.json({ error: 'Failed to fire test notification' }, 500);
    }
}
