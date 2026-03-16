/**
 * R2 Upload Utility — Cloudflare R2 via AWS S3 SDK
 *
 * Step 40: Uploads the final MP4 to Cloudflare R2 and returns the public URL.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import fs from 'fs'

let _s3: S3Client | null = null

function getS3Client(): S3Client {
  if (!_s3) {
    // R2 endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
    const endpoint = process.env.R2_ENDPOINT
      || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`

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

  console.log(`[Upload] Uploading ${localPath} → R2:${key}`)

  const fileStream = fs.createReadStream(localPath)
  const fileStats = fs.statSync(localPath)

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: fileStream,
      ContentType: 'video/mp4',
      ContentLength: fileStats.size,
    })
  )

  const publicUrl = `${process.env.R2_PUBLIC_DOMAIN}/${key}`
  console.log(`[Upload] ✅ Upload complete: ${publicUrl} (${(fileStats.size / 1024 / 1024).toFixed(1)}MB)`)

  return publicUrl
}
