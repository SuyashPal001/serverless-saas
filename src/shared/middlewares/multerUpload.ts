import multer from "multer";
import path from "path";
import { Request } from "express";

/**
 * Allowed file types (EXT + MIME must match)
 * ❗ NEVER allow SVG or HTML
 */
const DEFAULT_ALLOWED_SIZE = 5 * 1024 * 1024; //5MB

const DEFAULT_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/octet-stream", // flutter/dio fallback
];

const DEFAULT_ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

/**
 * File size limits (bytes)
 * Adjust per role/use-case
 */
export const FILE_SIZE_LIMITS = {
  USER: 2 * 1024 * 1024, // 2MB
  COACH: 5 * 1024 * 1024, // 5MB
  STUDIO: 10 * 1024 * 1024, // 10MB
  ADMIN: 15 * 1024 * 1024, // 15MB
};

/**
 * Secure file filter
 */
function fileFilter(allowedMimeTypes: string[], allowedExtensions: string[]) {
  return (
    req: Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback,
  ) => {
    const originalName = file.originalname || "";
    const ext = path.extname(originalName).toLowerCase();
    const mime = file.mimetype?.toLowerCase();

    const isMimeAllowed = mime && allowedMimeTypes.includes(mime);

    const isExtAllowed = ext && allowedExtensions.includes(ext);

    if (isMimeAllowed || isExtAllowed) {
      return cb(null, true);
    }

    cb(
      new Error(`Invalid file type. Allowed: ${allowedExtensions.join(", ")}`),
    );
  };
}

//  Factory to create upload middleware
export function createUpload({
  maxFileSize = DEFAULT_ALLOWED_SIZE,
  allowedMimeTypes = DEFAULT_ALLOWED_MIME_TYPES,
  allowedExtensions = DEFAULT_ALLOWED_EXTENSIONS,
}: {
  maxFileSize?: number;
  allowedMimeTypes?: string[];
  allowedExtensions?: string[];
}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSize },
    fileFilter: fileFilter(allowedMimeTypes, allowedExtensions),
  });
}
