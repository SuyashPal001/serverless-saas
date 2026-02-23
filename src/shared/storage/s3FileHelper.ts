import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import https from "https";
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import {
  getAWSTemporaryCredentials,
  refreshIdToken,
  UploadContext,
  verifyIdToken,
} from "../identity/userIdentityHelper";
import logger from "@/shared/utils/loggerNew";
import { encryptData, generateDataKeyWithKMS } from "../services/kmsHelper";

interface UploadResult {
  location: string;
  key: string;
}

export interface EncryptedUploadResult {
  s3Key: string;
  s3Url: string;
  encryptionMetadata: {
    encryptedKey: string;
    iv: string;
    authTag: string;
  };
}

export const uploadImage = async (
  buffer: Buffer,
  mimeType: string,
  userId: string,
  identityToken: string,
  uploadContext: UploadContext,
  refreshToken: string,
  username: string,
  folderName: string,
  contentId?: string,
): Promise<UploadResult> => {
  if (!process.env.BLOG_AWS_S3_BUCKET_NAME) {
    throw new Error(
      "BLOG_AWS_S3_BUCKET_NAME environment variable is not defined",
    );
  }

  let validIdentityToken = identityToken;
  try {
    // Verify the token and get AWS temporary credentials
    await verifyIdToken(identityToken, uploadContext);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "TokenExpired") {
      // Token has expired, refresh it
      validIdentityToken = await refreshIdToken(
        refreshToken,
        username,
        uploadContext,
      );
    } else {
      // Handle other errors
      throw new Error(`Token verification failed: ${message}`);
    }
  }
  const awsCredentials = await getAWSTemporaryCredentials(
    userId,
    validIdentityToken,
    uploadContext,
  );
  if (!awsCredentials) {
    throw new Error("Failed to retrieve AWS credentials.");
  }
  const s3Client = new S3Client({
    region: process.env.FITNEARN_AWS_REGION || "ap-south-1",
    credentials: {
      accessKeyId: awsCredentials.accessKeyId,
      secretAccessKey: awsCredentials.secretAccessKey,
      sessionToken: awsCredentials.sessionToken,
    },
  });
  const params = {
    Bucket: process.env.BLOG_AWS_S3_BUCKET_NAME,
    Key: `${uploadContext}/${folderName}/${userId}${
      contentId ? `/${contentId}` : ""
    }/${uuidv4()}`,
    Body: buffer,
    ContentType: mimeType,
  };

  const command = new PutObjectCommand(params);
  await s3Client.send(command);

  const location = `https://${params.Bucket}.s3.${process.env.FITNEARN_AWS_REGION}.amazonaws.com/${params.Key}`;

  return {
    location,
    key: params.Key,
  };
};

export interface PresignedUpload {
  uploadUrl: string;
  key: string;
  bucket: string;
  publicUrl: string;
}

/**
 * Generate a PUT presigned URL for uploading a single object.
 */
export async function getPresignedUploadUrl(
  mimeType: string,
  userId: string,
  uploadContext: UploadContext,
  folderName: string,
  contentId?: string,
  expiresInSec = 300,
): Promise<PresignedUpload> {
  const bucket = process.env.BLOG_AWS_S3_BUCKET_NAME!;
  const key = `${uploadContext}/${folderName}/${userId}${
    contentId ? `/${contentId}` : ""
  }/${uuidv4()}`;

  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: mimeType,
    // ACL: "public-read",
  });
  // console.log('\n\tmimeType: ', mimeType);
  const s3Client = new S3Client({
    region: process.env.FITNEARN_AWS_REGION || "ap-south-1",
    // credentials: {
    //   accessKeyId: process.env.FITNEARN_AWS_ACCESS_KEY_ID!,
    //   secretAccessKey: process.env.FITNEARN_AWS_SECRET_ACCESS_KEY!,
    // }
  });
  const uploadUrl = await getSignedUrl(s3Client, cmd, {
    expiresIn: expiresInSec,
  });
  return {
    uploadUrl,
    key,
    bucket,
    publicUrl: `https://${bucket}.s3.${process.env.FITNEARN_AWS_REGION}.amazonaws.com/${key}`,
  };
}

export async function getPresignedUploadUrlForStudio(
  mimeType: string,
  userId: string,
  uploadContext: UploadContext,
  folderName: string,
  contentId?: string,
  expiresInSec = 300,
): Promise<PresignedUpload> {
  const bucket = process.env.BLOG_AWS_S3_BUCKET_NAME!;
  const fileExt = mimeType.split("/")[1]; // e.g., "image/jpeg" → "jpeg"
  const key = `${uploadContext}/${folderName}/${userId}${
    contentId ? `/${contentId}` : ""
  }/${uuidv4()}.${fileExt}`;

  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: mimeType,
    // ACL: "public-read",
  });
  // console.log('\n\tmimeType: ', mimeType);
  const s3Client = new S3Client({
    region: process.env.FITNEARN_AWS_REGION || "ap-south-1",
    // credentials: {
    //   accessKeyId: process.env.FITNEARN_AWS_ACCESS_KEY_ID!,
    //   secretAccessKey: process.env.FITNEARN_AWS_SECRET_ACCESS_KEY!,
    // }
  });

  const uploadUrl = await getSignedUrl(s3Client, cmd, {
    expiresIn: expiresInSec,
  });
  return {
    uploadUrl,
    key,
    bucket,
    publicUrl: `https://${bucket}.s3.${process.env.FITNEARN_AWS_REGION}.amazonaws.com/${key}`,
  };
}

export const deleteImageFromS3 = async (key: string) => {
  const s3Client = new S3Client({
    region: process.env.FITNEARN_AWS_REGION || "ap-south-1",
  });
  try {
    const bucketName = process.env.BLOG_AWS_S3_BUCKET_NAME;
    const params = {
      Bucket: bucketName!,
      Key: key,
    };
    const command = new DeleteObjectCommand(params);
    await s3Client.send(command);
    logger.info(`Image with key ${key} deleted from S3 bucket ${bucketName}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error deleting image from S3", {
      message: "Error deleting image from S3",
      errorCode: 500,
      errorString: errorMessage,
      type: "deleteImageFromS3Error",
    });
    throw new Error(`Failed to delete image from S3: ${errorMessage}`);
  }
};

export const deleteAllImagesInBucket = async (
  bucketName: string,
): Promise<void> => {
  const s3Client = new S3Client({ region: "ap-south-1" });
  let continuationToken: string | undefined;

  do {
    const listParams = {
      Bucket: bucketName,
      ContinuationToken: continuationToken,
    };

    const listResponse = await s3Client.send(
      new ListObjectsV2Command(listParams),
    );

    if (listResponse.Contents && listResponse.Contents.length > 0) {
      const deleteParams = {
        Bucket: bucketName,
        Delete: {
          Objects: listResponse.Contents.map(({ Key }) => ({ Key })),
          Quiet: false,
        },
      };

      await s3Client.send(new DeleteObjectsCommand(deleteParams));
      console.log(`Deleted ${listResponse.Contents.length} objects`);
    }

    continuationToken = listResponse.NextContinuationToken;
  } while (continuationToken);

  console.log("All images deleted from the bucket");
};

/**
 * Encrypts the provided data and uploads it to S3.
 * @param data - The data to encrypt (Buffer or string)
 * @param originalName - Original filename to use in key generation.
 * @param contentType - MIME type of the file.
 */
export const uploadEncryptedDataToS3 = async (
  data: Buffer | string,
  originalName: string,
  contentType: string,
  coachId: string,
  tag?: string,
): Promise<EncryptedUploadResult> => {
  try {
    const s3Client = new S3Client({
      region: process.env.FITNEARN_AWS_REGION || "ap-south-1",
    });
    // Convert string to Buffer if needed.
    const inputBuffer = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data, "utf8");

    // Generate a data key using AWS KMS.
    const { plaintextKey, encryptedKey } = await generateDataKeyWithKMS(
      process.env.KMS_KEY_ID as string,
    );

    // Encrypt the input data with the plaintext key.
    const { encryptedData, iv, authTag } = encryptData(
      inputBuffer,
      plaintextKey,
    );

    // Create a unique key for S3
    const uniquePrefix = Date.now();
    const s3Key = `encrypted/${coachId}/${tag}/${uniquePrefix}`;

    // Initiate multipart upload with metadata set at initiation
    const bucket = process.env.ENCRYPTED_BUCKET_NAME as string;
    const createResp = await s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: s3Key,
        ContentType: contentType,
        Metadata: {
          encryptedkey: encryptedKey.toString("base64"),
          iv: iv.toString("base64"),
          authtag: authTag.toString("base64"),
          originalname: originalName,
        },
      }),
    );

    const uploadId = createResp.UploadId as string;

    try {
      const partSize = 8 * 1024 * 1024; // 8 MB parts
      const parts: { ETag: string; PartNumber: number }[] = [];
      const totalSize = encryptedData.length;
      let partNumber = 1;
      for (
        let offset = 0;
        offset < totalSize;
        offset += partSize, partNumber++
      ) {
        const end = Math.min(offset + partSize, totalSize);
        const body = encryptedData.subarray(offset, end);
        const uploadPartCmd = new UploadPartCommand({
          Bucket: bucket,
          Key: s3Key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body,
          ContentLength: body.length,
        });
        const presignedPartUrl = await getSignedUrl(s3Client, uploadPartCmd, {
          expiresIn: 900,
        });

        const eTag = await new Promise<string>((resolve, reject) => {
          const url = new URL(presignedPartUrl);
          const req = https.request(
            {
              method: "PUT",
              hostname: url.hostname,
              path: `${url.pathname}${url.search}`,
              headers: {
                "Content-Length": body.length,
              },
            },
            (res) => {
              const statusCode = res.statusCode || 0;
              const etagHeader = res.headers["etag"];
              if (statusCode >= 200 && statusCode < 300 && etagHeader) {
                resolve(Array.isArray(etagHeader) ? etagHeader[0] : etagHeader);
              } else {
                let data = "";
                res.on("data", (chunk) => {
                  data += chunk;
                });
                res.on("end", () => {
                  reject(
                    new Error(
                      `UploadPart failed: status ${statusCode}, body: ${data}`,
                    ),
                  );
                });
              }
            },
          );
          req.on("error", reject);
          req.end(body);
        });
        parts.push({ ETag: eTag, PartNumber: partNumber });
      }

      await s3Client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: s3Key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        }),
      );
    } catch (err) {
      try {
        await s3Client.send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: s3Key,
            UploadId: uploadId,
          }),
        );
      } catch (abortError) {
        // best-effort abort; log and continue throwing original error
        const abortMsg =
          abortError instanceof Error ? abortError.message : String(abortError);
        logger.error("Abort multipart upload failed", {
          message: "Abort multipart upload failed",
          errorCode: 500,
          errorString: abortMsg,
          type: "abortMultipartUploadError",
        });
      }
      throw err;
    }
    console.log(
      "\n\t ----------encrypted url: ",
      `https://${process.env.ENCRYPTED_BUCKET_NAME}.s3.${process.env.FITNEARN_AWS_REGION}.amazonaws.com/${s3Key}`,
    );

    return {
      s3Key,
      s3Url: `https://${process.env.ENCRYPTED_BUCKET_NAME}.s3.${process.env.FITNEARN_AWS_REGION}.amazonaws.com/${s3Key}`,
      encryptionMetadata: {
        encryptedKey: encryptedKey.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Error uploading encrypted data to S3", {
      message: "Error uploading encrypted data to S3",
      errorCode: 500,
      errorString: message,
      type: "uploadEncryptedDataToS3Error",
    });
    throw new Error(`Failed to upload encrypted data to S3: ${message}`);
  }
};

export const generatePresignedUrl = async (
  key: string,
  bucket?: string,
  expiresInSec: number = 900,
) => {
  try {
    const s3Client = new S3Client({
      region: process.env.FITNEARN_AWS_REGION || "ap-south-1",
    });
    const command = new GetObjectCommand({
      Bucket: bucket || process.env.ENCRYPTED_BUCKET_NAME!,
      Key: key,
      // ContentType: "image/png", // adjust as needed
    });

    return await getSignedUrl(s3Client, command, { expiresIn: expiresInSec });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Error generating presigned URL", {
      message: "Error generating presigned URL",
      errorCode: 500,
      errorString: message,
      type: "generatePresignedUrlError",
    });
    throw new Error(`Failed to generate presigned URL: ${message}`);
  }
};
