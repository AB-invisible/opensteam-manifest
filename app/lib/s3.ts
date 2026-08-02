import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';

const s3Client = new S3Client({
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: true, // Often needed for custom endpoints like MinIO or R2
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

/**
 * Uploads a file to S3
 */
export async function uploadToS3(filePath: string, key: string, contentType?: string) {
  if (!BUCKET_NAME) {
    throw new Error('AWS_S3_BUCKET_NAME is not defined');
  }

  const fileStream = fs.createReadStream(filePath);

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: fileStream,
      ContentType: contentType,
    },
  });

  return await upload.done();
}

/**
 * Uploads a buffer directly to S3
 */
export async function uploadBufferToS3(buffer: Buffer, key: string, contentType?: string) {
  if (!BUCKET_NAME) {
    throw new Error('AWS_S3_BUCKET_NAME is not defined');
  }

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    },
  });

  return await upload.done();
}

/**
 * Generates a signed URL or simply the direct URL if public
 */
export function getS3Url(key: string) {
  if (!BUCKET_NAME) return null;

  // If using a custom endpoint, we might need to construct the URL differently
  if (process.env.AWS_ENDPOINT_URL) {
    // Check if it's a full URL or just a domain
    const endpoint = process.env.AWS_ENDPOINT_URL.endsWith('/')
      ? process.env.AWS_ENDPOINT_URL
      : `${process.env.AWS_ENDPOINT_URL}/`;
    return `${endpoint}${BUCKET_NAME}/${key}`;
  }
  return `https://${BUCKET_NAME}.s3.${process.env.AWS_DEFAULT_REGION}.amazonaws.com/${key}`;
}

/**
 * Generates an expiring presigned URL for downloading a file directly from S3
 */
export async function getS3PresignedUrl(key: string, expiresInSeconds: number = 900) {
  if (process.env.BUCKET_TYPE === 'windows') return null;
  if (!BUCKET_NAME) return null;

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return await getSignedUrl(s3Client as any, command as any, { expiresIn: expiresInSeconds });
}

/**
 * Gets a readable stream for a file in S3 with its metadata
 */
export async function getS3Stream(key: string) {
  if (!BUCKET_NAME) return null;

  const response = await s3Client.send(new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  }));

  return {
    body: response.Body,
    contentLength: response.ContentLength || null
  };
}

/**
 * Checks if a file exists in S3
 */
export async function s3FileExists(key: string) {
  if (!BUCKET_NAME) return false;

  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));
    return true;
  } catch (err) {
    return false;
  }
}

/** Returns Content-Length in bytes, or null if the object is missing. */
export async function getS3ObjectContentLength(key: string): Promise<number | null> {
  if (!BUCKET_NAME) return null;
  try {
    const r = await s3Client.send(
      new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key })
    );
    return r.ContentLength != null ? Number(r.ContentLength) : null;
  } catch {
    return null;
  }
}

/**
 * Deletes a file from S3
 */
export async function deleteFromS3(key: string) {
  if (!BUCKET_NAME) return;

  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  
  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));
  } catch (err) {
    console.error(`[S3] Failed to delete ${key}:`, err);
    throw err;
  }
}
