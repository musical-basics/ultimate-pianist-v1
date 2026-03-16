/**
 * Video Export Worker — BullMQ Consumer
 *
 * Steps 26-28: Initializes a BullMQ worker with strict concurrency (1)
 * and extended lock duration (5 min) to process video render jobs.
 *
 * This runs on Railway as a standalone Docker container.
 */

import { Worker, Job } from 'bullmq'
import { processRenderJob } from './renderJob'

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is required')
}

const redisUrl = new URL(process.env.REDIS_URL)
const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  password: redisUrl.password || undefined,
  username: redisUrl.username || 'default',
  tls: process.env.REDIS_URL.startsWith('rediss://')
    ? { rejectUnauthorized: false }
    : undefined,
  maxRetriesPerRequest: null as null,
}

const worker = new Worker(
  'video-export',
  async (job: Job) => {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`[Worker] Starting job ${job.id}: ${JSON.stringify(job.data)}`)
    console.log(`${'='.repeat(60)}\n`)
    await processRenderJob(job)
  },
  {
    connection,
    concurrency: 1,           // Step 27: One Chrome at a time — prevents OOM
    lockDuration: 300_000,     // Step 28: 5 minutes — long renders won't be reclaimed
  }
)

worker.on('completed', (job) => {
  console.log(`[Worker] ✅ Job ${job.id} completed successfully`)
})

worker.on('failed', (job, err) => {
  console.error(`[Worker] ❌ Job ${job?.id} failed:`, err.message)
})

worker.on('error', (err) => {
  console.error('[Worker] Worker error:', err)
})

console.log('[Worker] 🎬 Video export worker started, waiting for jobs...')
