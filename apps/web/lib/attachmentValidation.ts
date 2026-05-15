export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024 // 10MB

export const SUPPORTED_ATTACHMENT_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'text/plain': 'TXT',
  'text/markdown': 'Markdown',
  'text/csv': 'CSV',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
}

const SUPPORTED_EXTENSIONS = [
  '.md', '.txt', '.csv', '.pdf',
  '.png', '.jpg', '.jpeg', '.webp', '.docx', '.xlsx',
]

export const ATTACHMENT_ACCEPT = SUPPORTED_EXTENSIONS.join(',')

export type AttachmentValidationResult =
  | { valid: true }
  | { valid: false; error: string }

export function validateAttachment(file: File): AttachmentValidationResult {
  if (file.size > MAX_ATTACHMENT_SIZE) {
    return { valid: false, error: 'File too large. Maximum size is 10MB.' }
  }

  const effectiveType = file.type || 'application/octet-stream'
  const knownType = Object.keys(SUPPORTED_ATTACHMENT_TYPES).includes(effectiveType)
  const knownExt = SUPPORTED_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext))

  if (!knownType && !knownExt) {
    return {
      valid: false,
      error: 'Unsupported file type. Supported: PDF, TXT, MD, CSV, PNG, JPEG, WebP, DOCX, XLSX.',
    }
  }

  return { valid: true }
}
