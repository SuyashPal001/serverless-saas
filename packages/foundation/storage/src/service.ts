import { db } from '@serverless-saas/database';
import { files, storageProviders } from '@serverless-saas/database/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { S3StorageProvider } from './providers/s3';
import type { StorageProvider, UploadUrlRequest, UploadUrlResponse } from './types';

export class StorageService {
  private async resolveProvider(tenantId: string): Promise<StorageProvider> {
    // Check for tenant-specific provider
    const [tenantProvider] = await db
      .select()
      .from(storageProviders)
      .where(and(
        eq(storageProviders.tenantId, tenantId),
        eq(storageProviders.isDefault, true)
      ))
      .limit(1);

    if (tenantProvider) {
      return new S3StorageProvider({
        region: tenantProvider.region || 'ap-south-1',
        bucket: tenantProvider.bucket,
      });
    }

    // Fall back to platform default
    const [platformProvider] = await db
      .select()
      .from(storageProviders)
      .where(and(
        isNull(storageProviders.tenantId),
        eq(storageProviders.isDefault, true)
      ))
      .limit(1);

    if (platformProvider) {
      return new S3StorageProvider({
        region: platformProvider.region || 'ap-south-1',
        bucket: platformProvider.bucket,
      });
    }

    // Fallback to env vars
    return new S3StorageProvider({
      region: process.env.AWS_REGION || 'ap-south-1',
      bucket: process.env.STORAGE_BUCKET!,
    });
  }

  async getUploadUrl(request: UploadUrlRequest): Promise<UploadUrlResponse> {
    const { tenantId, filename, contentType, uploadedBy } = request;
    
    // Create file record with pending status
    const [file] = await db
      .insert(files)
      .values({
        tenantId,
        name: filename,
        key: '', // Set after we generate it
        mimeType: contentType,
        status: 'pending',
        uploadedBy,
      })
      .returning();

    // Generate S3 key: tenantId/fileId/filename
    const key = `${tenantId}/${file.id}/${filename}`;
    
    // Update file with key
    await db
      .update(files)
      .set({ key })
      .where(eq(files.id, file.id));

    // Get presigned URL
    const provider = await this.resolveProvider(tenantId);
    const { url } = await provider.getUploadUrl(key, contentType);

    return {
      fileId: file.id,
      uploadUrl: url,
      key,
      expiresIn: 3600,
    };
  }

  async confirmUpload(tenantId: string, fileId: string, size: number): Promise<void> {
    await db
      .update(files)
      .set({ 
        status: 'uploaded', 
        size,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(files.id, fileId),
        eq(files.tenantId, tenantId)
      ));
  }

  async getDownloadUrl(tenantId: string, fileId: string): Promise<string> {
    const [file] = await db
      .select()
      .from(files)
      .where(and(
        eq(files.id, fileId),
        eq(files.tenantId, tenantId),
        isNull(files.deletedAt)
      ))
      .limit(1);

    if (!file) throw new Error('File not found');

    const provider = await this.resolveProvider(tenantId);
    return provider.getDownloadUrl(file.key);
  }

  async deleteFile(tenantId: string, fileId: string): Promise<void> {
    await db
      .update(files)
      .set({ 
        status: 'deleted',
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(files.id, fileId),
        eq(files.tenantId, tenantId)
      ));
  }

  async listFiles(tenantId: string, limit = 50, offset = 0) {
    return db
      .select()
      .from(files)
      .where(and(
        eq(files.tenantId, tenantId),
        isNull(files.deletedAt)
      ))
      .limit(limit)
      .offset(offset)
      .orderBy(files.createdAt);
  }
}

export const storageService = new StorageService();
