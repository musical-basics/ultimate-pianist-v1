/**
 * Video Export Worker — BullMQ Consumer (On-Demand)
 *
 * Steps 26-28: Initializes a BullMQ worker with strict concurrency (1)
 * and extended lock duration (5 min) to process video render jobs.
 *
 * AUTO-SHUTDOWN: After all jobs are processed, the worker waits 30 seconds
 * for new work. If none arrives, it exits gracefully. The Next.js export API
 * wakes the worker via Railway's redeploy API when a new job is dispatched.
 * This eliminates idle Redis polling that was burning through Upstash's
 * free tier command limit.
 *
 * This runs on Railway as a standalone Docker container.
 */

import { Worker, Job, Queue } from 'bullmq'
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

// ─── Auto-shutdown timer ─────────────────────────────────────────────
const IDLE_TIMEOUT_MS = 30_000 // 30 seconds of no work → exit
let shutdownTimer: ReturnType<typeof setTimeout> | null = null

const queue = new Queue('video-export', { connection: { ...connection } })

async function isQueueEmpty(): Promise<boolean> {
  const [waiting, active, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getDelayedCount(),
  ])
  return waiting === 0 && active === 0 && delayed === 0
}

function resetShutdownTimer() {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer)
    shutdownTimer = null
  }
}

async function scheduleShutdownIfIdle() {
  resetShutdownTimer()
  shutdownTimer = setTimeout(async () => {
    const empty = await isQueueEmpty()
    if (empty) {
      console.log(`[Worker] 💤 Queue empty for ${IDLE_TIMEOUT_MS / 1000}s — shutting down to save Redis commands`)
      await worker.close()
      await queue.close()
      process.exit(0)
    } else {
      console.log('[Worker] New jobs arrived during idle check — staying alive')
    }
  }, IDLE_TIMEOUT_MS)
}

// ─── BullMQ Worker ───────────────────────────────────────────────────
const worker = new Worker(
  'video-export',
  async (job: Job) => {
    resetShutdownTimer() // Cancel any pending shutdown while processing
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
  scheduleShutdownIfIdle()
})

worker.on('failed', (job, err) => {
  console.error(`[Worker] ❌ Job ${job?.id} failed:`, err.message)
  scheduleShutdownIfIdle()
})

worker.on('error', (err) => {
  console.error('[Worker] Worker error:', err)
})

console.log('[Worker] 🎬 Video export worker started, waiting for jobs...')

// Start the initial idle timer — if no jobs arrive within 30s of boot, shut down
scheduleShutdownIfIdle()
