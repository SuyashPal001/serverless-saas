export interface StorageProvider {
  getUploadUrl(key: string, contentType: string, expiresIn?: number): Promise<{ url: string }>;
  getDownloadUrl(key: string, expiresIn?: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
}

export interface UploadUrlRequest {
  tenantId: string;
  filename: string;
  contentType: string;
  uploadedBy: string;
  /** User-space key (e.g. "documents/report.pdf"). Generated from filename if omitted. */
  userKey?: string;
}

export interface UploadUrlResponse {
  fileId: string;
  uploadUrl: string;
  key: string;
  expiresIn: number;
}
