import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import { AuthenticatedRequest } from "../identity/userIdentityHelper";

// Multer storage configuration (temporary storage in memory) !!
const storage = multer.memoryStorage();
export const upload = multer({ storage });

/**
 * Uploads an image buffer to AWS S3 using temporary credentials.
 * @param {Express.Multer.File} file - The file object from multer.
 * @param {AuthenticatedRequest} req - Request object with temporary AWS credentials.
 * @returns {Promise<{ imageUrl: string, imageKey: string }>}
 */
export const uploadImageToS3 = async (
  file: Express.Multer.File,
  req: AuthenticatedRequest,
): Promise<{ imageUrl: string; imageKey: string }> => {
  if (!file) throw new Error("No image file provided");

  // Check for credentials from middleware
  if (!req.awsCredentials) {
    throw new Error("AWS temporary credentials not found in request");
  }

  const { accessKeyId, secretAccessKey, sessionToken } = req.awsCredentials;

  if (!accessKeyId || !secretAccessKey || !sessionToken) {
    throw new Error("Invalid AWS credentials: missing required fields");
  }

  console.log("Using AWS Credentials:", {
    accessKeyId,
    sessionToken: sessionToken?.slice(0, 10) + ".....",
  });

  const bucketName = process.env.USER_IMAGE_BUCKET || "userimagesfne";
  const region = process.env.FITNEARN_AWS_REGION;

  if (!bucketName || !region) {
    throw new Error(
      "AWS_BUCKET or FITNEARN_AWS_REGION is not defined in environment variables.",
    );
  }

  const s3 = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey, sessionToken },
  });

  const fileExtension = path.extname(file.originalname);
  const uniqueFileName = `profile_${crypto.randomBytes(10).toString("hex")}${fileExtension}`;
  const objectKey = `admin/profile_images/${uniqueFileName}`;

  const params = {
    Bucket: bucketName,
    Key: objectKey,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  try {
    await s3.send(new PutObjectCommand(params));
    console.log("File successfully uploaded to S3:", objectKey);
  } catch (error) {
    console.error("Error uploading file to S3:", error);
    throw new Error("Failed to upload image to S3");
  }

  const imageUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${objectKey}`;
  return { imageUrl, imageKey: objectKey };
};
