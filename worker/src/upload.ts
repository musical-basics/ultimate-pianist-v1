/**
 * R2 Upload Utility — Cloudflare R2 via AWS S3 SDK
 *
 * Uses PutObjectCommand with a Buffer for reliable uploads.
 * The previous @aws-sdk/lib-storage Upload.done() promise would hang
 * indefinitely despite data being sent — switched to simpler approach.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import fs from 'fs'

export async function uploadToR2(
  localPath: string,
  exportId: string
): Promise<string> {
  const endpoint = process.env.R2_ENDPOINT
    || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`

  const s3 = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })

  const key = `exports/${exportId}.mp4`
  const fileBuffer = fs.readFileSync(localPath)
  const sizeMB = (fileBuffer.length / 1024 / 1024).toFixed(1)

  console.log(`[Upload] PutObject: ${localPath} (${sizeMB}MB) → R2:${key}`)

  // AbortController with 25s timeout — prevents indefinite hang
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25_000)

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
        Body: fileBuffer,
        ContentType: 'video/mp4',
      }),
      { abortSignal: controller.signal }
    )
  } finally {
    clearTimeout(timer)
    s3.destroy()
    console.log(`[Upload] S3 client destroyed`)
  }

  const publicUrl = `${process.env.R2_PUBLIC_DOMAIN}/${key}`
  console.log(`[Upload] ✅ Upload complete: ${publicUrl} (${sizeMB}MB)`)

  return publicUrl
}

