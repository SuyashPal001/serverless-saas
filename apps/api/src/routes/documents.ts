import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { db } from '@serverless-saas/database';
import { eq, and, desc } from 'drizzle-orm';
import { documents } from '@serverless-saas/database/schema/documents';
import { publishToQueue } from '../lib/sqs';
import type { AppEnv } from '../types';

const documentsRoutes = new Hono<AppEnv>();
const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'ap-south-1' });

// POST /api/v1/documents/upload-url
documentsRoutes.post(
  '/upload-url',
  zValidator('json', z.object({
    fileName: z.string().min(1).max(255),
    mimeType: z.enum([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ]),
  })),
  async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;

    if (!tenantId) {
      return c.json({ error: 'Tenant resolution failed', code: 'TENANT_NOT_FOUND' }, 400);
    }

    const { fileName, mimeType } = c.req.valid('json');
    const fileKey = `tenants/${tenantId}/documents/${crypto.randomUUID()}-${fileName}`;

    try {
      const command = new PutObjectCommand({
        Bucket: process.env.DOCUMENTS_BUCKET!,
        Key: fileKey,
        ContentType: mimeType,
      });

      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

      return c.json({ uploadUrl, fileKey });
    } catch (error) {
      console.error('Failed to generate presigned URL:', error);
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
  }
);

// POST /api/v1/documents
documentsRoutes.post(
  '/',
  zValidator('json', z.object({
    name: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(127),
    fileKey: z.string().min(1).max(512),
    hash: z.string().length(64),
  })),
  async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId');
    const { name, mimeType, fileKey, hash } = c.req.valid('json');

    if (!tenantId) {
      return c.json({ error: 'Tenant resolution failed', code: 'TENANT_NOT_FOUND' }, 400);
    }

    // Check for duplicate
    console.log('[documents route] db.query keys:', Object.keys((db as any).query || {}));
    console.log('[documents route] db.query.documents:', typeof (db as any).query?.documents);
    const existing = await db.query.documents.findFirst({
      where: and(
        eq(documents.tenantId, tenantId),
        eq(documents.hash, hash)
      ),
    });

    if (existing) {
      return c.json({ error: 'DUPLICATE_DOCUMENT', documentId: existing.id }, 409);
    }

    const documentId = crypto.randomUUID();

    try {
      const [inserted] = await db.insert(documents).values({
        id: documentId,
        tenantId,
        uploadedBy: userId,
        name,
        mimeType,
        fileKey,
        hash,
        status: 'pending',
      }).returning();

      // Publish SQS message for ingestion
      const queueUrl = process.env.WORKER_QUEUE_URL;
      if (queueUrl) {
        await publishToQueue(queueUrl, {
          type: "document.ingest",
          payload: {
            tenantId,
            documentId: inserted.id,
            fileKey,
            mimeType,
          }
        });
      } else {
        console.warn('WORKER_QUEUE_URL not set — document.ingest job not published');
      }

      return c.json({ documentId: inserted.id, status: 'pending' }, 201);
    } catch (error) {
      console.error('Failed to create document:', error);
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
  }
);

// GET /api/v1/documents
documentsRoutes.get('/', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id;

  if (!tenantId) {
    return c.json({ error: 'Tenant resolution failed', code: 'TENANT_NOT_FOUND' }, 400);
  }

  const data = await db.query.documents.findMany({
    where: eq(documents.tenantId, tenantId),
    orderBy: [desc(documents.createdAt)],
    columns: {
      id: true,
      name: true,
      status: true,
      chunkCount: true,
      mimeType: true,
      createdAt: true,
    },
  });

  return c.json({ documents: data });
});

// GET /api/v1/documents/:id
documentsRoutes.get('/:id', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id;
  const { id } = c.req.param();

  if (!tenantId) {
    return c.json({ error: 'Tenant resolution failed', code: 'TENANT_NOT_FOUND' }, 400);
  }

  const document = await db.query.documents.findFirst({
    where: and(
      eq(documents.id, id),
      eq(documents.tenantId, tenantId)
    ),
  });

  if (!document) {
    return c.json({ error: 'Document not found', code: 'NOT_FOUND' }, 404);
  }

  return c.json(document);
});

// DELETE /api/v1/documents/:id
documentsRoutes.delete('/:id', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id;
  const { id } = c.req.param();

  if (!tenantId) {
    return c.json({ error: 'Tenant resolution failed', code: 'TENANT_NOT_FOUND' }, 400);
  }

  const existing = await db.query.documents.findFirst({
    where: and(
      eq(documents.id, id),
      eq(documents.tenantId, tenantId)
    ),
  });

  if (!existing) {
    return c.json({ error: 'Document not found', code: 'NOT_FOUND' }, 404);
  }

  await db.delete(documents).where(and(
    eq(documents.id, id),
    eq(documents.tenantId, tenantId)
  ));

  return c.body(null, 204);
});

export default documentsRoutes;
