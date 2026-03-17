/**
 * R2 Upload Utility — Cloudflare R2 via AWS S3 SDK
 *
 * Step 40: Uploads the final MP4 to Cloudflare R2 and returns the public URL.
 *
 * KEY FIX: Uses fs.readFileSync (buffered) instead of createReadStream
 * because AWS SDK v3 streaming uploads to R2 can hang silently.
 * Also adds requestTimeout and AbortSignal for safety.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
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
      // Prevent silent hangs
      requestHandler: {
        requestTimeout: 60_000, // 60 second timeout per request
      } as any,
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

  console.log(`[Upload] Reading file into memory: ${localPath} (${sizeMB}MB)`)

  // Read entire file into buffer (avoids streaming hang)
  const fileBuffer = fs.readFileSync(localPath)

  console.log(`[Upload] Uploading ${sizeMB}MB → R2:${key}`)

  // Create an AbortController with 90s timeout as final safety net
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    console.error('[Upload] ⛔ AbortController timeout (90s) — aborting upload')
    controller.abort()
  }, 90_000)

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
        Body: fileBuffer,
        ContentType: 'video/mp4',
        ContentLength: fileStats.size,
      }),
      { abortSignal: controller.signal }
    )
  } finally {
    clearTimeout(timeoutId)
  }

  const publicUrl = `${process.env.R2_PUBLIC_DOMAIN}/${key}`
  console.log(`[Upload] ✅ Upload complete: ${publicUrl} (${sizeMB}MB)`)

  return publicUrl
}
