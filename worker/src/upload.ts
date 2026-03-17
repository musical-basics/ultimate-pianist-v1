/**
 * R2 Upload Utility — Cloudflare R2 via AWS S3 SDK
 *
 * Uses @aws-sdk/lib-storage Upload class for multipart chunked uploads.
 * Creates a FRESH S3Client per upload to avoid stale TCP connections
 * that cause the second upload to hang.
 */

import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import fs from 'fs'

function createS3Client(): S3Client {
  const endpoint = process.env.R2_ENDPOINT
    || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`

  console.log(`[Upload] Creating fresh S3 client → ${endpoint}`)

  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

export async function uploadToR2(
  localPath: string,
  exportId: string
): Promise<string> {
  const s3 = createS3Client()
  const key = `exports/${exportId}.mp4`
  const fileStats = fs.statSync(localPath)
  const sizeMB = (fileStats.size / 1024 / 1024).toFixed(1)

  console.log(`[Upload] Starting multipart upload: ${localPath} (${sizeMB}MB) → R2:${key}`)

  const fileStream = fs.createReadStream(localPath)

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: fileStream,
      ContentType: 'video/mp4',
    },
    // 5MB chunks, 4 concurrent parts
    queueSize: 4,
    partSize: 5 * 1024 * 1024,
    leavePartsOnError: false,
  })

  upload.on('httpUploadProgress', (progress) => {
    const uploaded = progress.loaded ? (progress.loaded / 1024 / 1024).toFixed(1) : '?'
    console.log(`[Upload] Progress: ${uploaded}MB / ${sizeMB}MB`)
  })

  try {
    await upload.done()
  } finally {
    // Destroy the client to release TCP connections — prevents hang on next job
    s3.destroy()
    console.log(`[Upload] S3 client destroyed (connections released)`)
  }

  const publicUrl = `${process.env.R2_PUBLIC_DOMAIN}/${key}`
  console.log(`[Upload] ✅ Upload complete: ${publicUrl} (${sizeMB}MB)`)

  return publicUrl
}

