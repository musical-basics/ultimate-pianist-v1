/**
 * R2 Upload Utility — Cloudflare R2 via AWS S3 SDK
 *
 * Uses @aws-sdk/lib-storage Upload class for multipart chunked uploads.
 * This bypasses the R2 stream-hanging bug in PutObjectCommand by
 * automatically handling chunking and concurrency.
 */

import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import fs from 'fs'

let _s3: S3Client | null = null

function getS3Client(): S3Client {
  if (!_s3) {
    const endpoint = process.env.R2_ENDPOINT
      || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`

    console.log(`[Upload] Initializing S3 client → ${endpoint}`)

    _s3 = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
  }
  return _s3
}

export async function uploadToR2(
  localPath: string,
  exportId: string
): Promise<string> {
  const s3 = getS3Client()
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

  await upload.done()

  const publicUrl = `${process.env.R2_PUBLIC_DOMAIN}/${key}`
  console.log(`[Upload] ✅ Upload complete: ${publicUrl} (${sizeMB}MB)`)

  return publicUrl
}
