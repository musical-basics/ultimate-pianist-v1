/**
 * BullMQ Queue Producer — Video Export Pipeline
 *
 * Instantiates a BullMQ queue connected to Upstash Redis.
 * Used by the Next.js API route to dispatch render jobs.
 * The Railway worker consumes from this same queue.
 */

import { Queue } from 'bullmq'
import IORedis from 'ioredis'

const getConnection = () => {
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL environment variable is not set')
  }

  return new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
    tls: process.env.REDIS_URL.startsWith('rediss://')
      ? { rejectUnauthorized: false }
      : undefined,
  })
}

let _queue: Queue | null = null

export function getVideoExportQueue(): Queue {
  if (!_queue) {
    _queue = new Queue('video-export', {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    })
  }
  return _queue
}
