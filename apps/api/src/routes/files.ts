import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { storageService } from '@serverless-saas/storage';
import { db } from '@serverless-saas/database';
import { auditLog } from '@serverless-saas/database/schema';
import type { AppEnv } from '../types';

const filesRoutes = new Hono<AppEnv>();

// Get presigned upload URL
filesRoutes.post(
  '/upload-url',
  zValidator('json', z.object({
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1).max(127),
  })),
  async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId');
    const { filename, contentType } = c.req.valid('json');

    if (!userId) {
      return c.json({ error: 'Forbidden', message: 'Missing userId' }, 403);
    }

    const permissions = requestContext?.permissions || [];
    if (!permissions.includes('files:create')) {
      return c.json({ error: 'Forbidden', message: 'Missing permission: files:create' }, 403);
    }

    const result = await storageService.getUploadUrl({
      tenantId,
      filename,
      contentType,
      uploadedBy: userId,
    });

    // Audit log
    await db.insert(auditLog).values({
      tenantId,
      actorId: userId,
      actorType: 'human',
      action: 'file_upload_requested',
      resource: 'file',
      resourceId: result.fileId,
      metadata: { filename, contentType },
    });

    return c.json(result, 201);
  }
);

// Confirm upload completed
filesRoutes.post(
  '/:id/confirm',
  zValidator('json', z.object({
    size: z.number().int().positive(),
  })),
  async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId');
    const fileId = c.req.param('id');
    const { size } = c.req.valid('json');

    const permissions = requestContext?.permissions || [];
    if (!permissions.includes('files:create')) {
      return c.json({ error: 'Forbidden', message: 'Missing permission: files:create' }, 403);
    }

    await storageService.confirmUpload(tenantId, fileId, size);

    // Audit log
    await db.insert(auditLog).values({
      tenantId,
      actorId: userId,
      actorType: 'human',
      action: 'file_uploaded',
      resource: 'file',
      resourceId: fileId,
      metadata: { size },
    });

    return c.json({ success: true });
  }
);

// Get presigned download URL
filesRoutes.get('/:id', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id;
  const fileId = c.req.param('id');

  const permissions = requestContext?.permissions || [];
  if (!permissions.includes('files:read')) {
    return c.json({ error: 'Forbidden', message: 'Missing permission: files:read' }, 403);
  }

  try {
    const downloadUrl = await storageService.getDownloadUrl(tenantId, fileId);
    return c.json({ downloadUrl });
  } catch (error) {
    return c.json({ error: 'Not Found', message: 'File not found' }, 404);
  }
});

// List files
filesRoutes.get('/', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id;
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  const permissions = requestContext?.permissions || [];
  if (!permissions.includes('files:read')) {
    return c.json({ error: 'Forbidden', message: 'Missing permission: files:read' }, 403);
  }

  const filesList = await storageService.listFiles(tenantId, limit, offset);
  return c.json({ files: filesList });
});

// Delete file
filesRoutes.delete('/:id', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id;
  const userId = c.get('userId');
  const fileId = c.req.param('id');

  const permissions = requestContext?.permissions || [];
  if (!permissions.includes('files:delete')) {
    return c.json({ error: 'Forbidden', message: 'Missing permission: files:delete' }, 403);
  }

  await storageService.deleteFile(tenantId, fileId);

  // Audit log
  await db.insert(auditLog).values({
    tenantId,
    actorId: userId,
    actorType: 'human',
    action: 'file_deleted',
    resource: 'file',
    resourceId: fileId,
  });

  return c.json({ success: true });
});

export { filesRoutes };
