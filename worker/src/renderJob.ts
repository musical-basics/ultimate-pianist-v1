/**
 * Render Job Processor — The Heart of the Video Export Pipeline
 *
 * Steps 29-40: Downloads audio, launches Puppeteer, runs the deterministic
 * render loop, pipes frames to FFmpeg with backpressure handling,
 * uploads to R2, and performs ruthless cleanup.
 */

import fs from 'fs'
import { spawn, ChildProcess } from 'child_process'
import { Job } from 'bullmq'
import puppeteer, { Browser, Page } from 'puppeteer-core'
import { createClient } from '@supabase/supabase-js'
import { uploadToR2 } from './upload'

// ─── Types (mirrored from frontend lib/types/renderJob.ts) ─────────
interface RenderJobPayload {
  exportId: string
  configId: string
  audioUrl: string
  durationSec: number
}

// ─── Supabase Service Client ───────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FPS = 60
const INTERNAL_APP_URL = process.env.INTERNAL_APP_URL || 'http://localhost:3000'

// ─── Step 29: Download Audio to Local Disk ──────────────────────────
async function downloadAudio(audioUrl: string, exportId: string): Promise<string> {
  const audioPath = `/tmp/audio-${exportId}.mp3`
  console.log(`[Render] Downloading audio: ${audioUrl} → ${audioPath}`)

  const res = await fetch(audioUrl)
  if (!res.ok) throw new Error(`Failed to download audio: ${res.status} ${res.statusText}`)

  const buffer = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(audioPath, buffer)

  console.log(`[Render] Audio downloaded: ${(buffer.length / 1024 / 1024).toFixed(1)}MB`)
  return audioPath
}

// ─── Steps 33-34: Spawn FFmpeg Process ──────────────────────────────
function spawnFFmpeg(audioPath: string, outputPath: string): ChildProcess {
  const args = [
    // Input 1: Piped JPEG frames from stdin
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(FPS),
    '-vcodec', 'mjpeg',
    '-i', '-',
    // Input 2: Audio file
    '-i', audioPath,
    // Output encoding
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',  // Enable streaming playback
    outputPath,
  ]

  console.log(`[FFmpeg] Spawning: ffmpeg ${args.join(' ')}`)
  const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] })

  proc.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim()
    // Only log important FFmpeg messages (skip frame progress spam)
    if (msg.includes('Error') || msg.includes('error') || msg.includes('Output')) {
      console.log(`[FFmpeg] ${msg}`)
    }
  })

  return proc
}

// ─── Step 39: Wait for FFmpeg to Finish ──────────────────────────────
function waitForFFmpeg(ffmpeg: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log('[FFmpeg] ✅ Encoding complete')
        resolve()
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`))
      }
    })
    ffmpeg.on('error', reject)
  })
}

// ─── Main Job Processor (Steps 29-40) ───────────────────────────────
export async function processRenderJob(job: Job<RenderJobPayload>): Promise<void> {
  const { exportId, configId, audioUrl, durationSec } = job.data

  const audioPath = `/tmp/audio-${exportId}.mp3`
  const outputPath = `/tmp/output-${exportId}.mp4`

  let browser: Browser | null = null

  try {
    // ─── Update status to processing ─────────────────────────────
    await supabase.from('video_exports').update({
      status: 'processing',
      progress: 0,
    }).eq('id', exportId)

    // ─── Step 29: Download audio ─────────────────────────────────
    await downloadAudio(audioUrl, exportId)

    // ─── Step 30: Launch Puppeteer ───────────────────────────────
    console.log('[Render] Launching headless Chrome...')
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--mute-audio',
        '--disable-web-security',
        '--disable-setuid-sandbox',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
      ],
    })

    const page: Page = await browser.newPage()
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
    })

    // ─── Step 31: Navigate & await hydration ─────────────────────
    const renderUrl = `${INTERNAL_APP_URL}/render-view/${configId}`
    console.log(`[Render] Navigating to: ${renderUrl}`)

    await page.goto(renderUrl, {
      waitUntil: 'networkidle0',
      timeout: 120_000,
    })

    console.log('[Render] Waiting for hydration signal (__RENDER_READY__)...')
    await page.waitForFunction('window.__RENDER_READY__ === true', {
      timeout: 60_000,
    })
    console.log('[Render] ✅ Hydration complete')

    // ─── Step 32: Calculate loop metrics ─────────────────────────
    const totalFrames = Math.ceil(durationSec * FPS)
    console.log(`[Render] Rendering ${totalFrames} frames at ${FPS}fps (${durationSec.toFixed(1)}s)`)

    // ─── Steps 33-34: Spawn FFmpeg ───────────────────────────────
    const ffmpeg = spawnFFmpeg(audioPath, outputPath)

    // ─── Steps 35-38: Deterministic Render Loop ──────────────────
    const startTime = Date.now()
    let lastProgressUpdate = 0

    for (let frame = 0; frame < totalFrames; frame++) {
      const timeSec = frame / FPS

      // Log every 10 frames for diagnostic visibility
      if (frame % 10 === 0) console.log(`[Loop] Frame ${frame}: ADVANCE`)

      // Step 35: Advance the engine clock deterministically
      await page.evaluate(`window.__ADVANCE_FRAME__(${timeSec})`)

      if (frame % 10 === 0) console.log(`[Loop] Frame ${frame}: DELAY`)

      // Small delay for compositor to flush (rAF doesn't fire in headless Chrome)
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 1))')

      if (frame % 10 === 0) console.log(`[Loop] Frame ${frame}: SCREENSHOT`)

      // Step 36: Capture the frame (JPEG — drastically faster + less memory than PNG)
      const frameBuffer = await page.screenshot({
        type: 'jpeg',
        quality: 90,
        encoding: 'binary',
      }) as Buffer

      if (frame % 10 === 0) console.log(`[Loop] Frame ${frame}: FFMPEG_WRITE (${frameBuffer.length} bytes)`)

      // Step 37: CRITICAL — Handle stdin backpressure
      // If FFmpeg's buffer is full, PAUSE until it drains.
      // Without this, Node.js hoards thousands of frames in RAM → OOM crash.
      const canWrite = ffmpeg.stdin!.write(frameBuffer)
      if (!canWrite) {
        if (frame % 10 === 0) console.log(`[Loop] Frame ${frame}: BACKPRESSURE — waiting for drain`)
        await new Promise<void>(resolve => ffmpeg.stdin!.once('drain', resolve))
      }

      // Step 38: Emit progress every 60 frames (1 second of video)
      if (frame % FPS === 0 || frame === totalFrames - 1) {
        const percent = Math.min(99, Math.round((frame / totalFrames) * 100))

        // Throttle Supabase updates to once per ~2 seconds
        const now = Date.now()
        if (now - lastProgressUpdate > 2000 || frame === totalFrames - 1) {
          // Non-blocking progress updates — don't let them stall the render
          try {
            console.log(`[Progress] Frame ${frame}: updating Redis...`)
            await Promise.race([
              job.updateProgress(percent),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), 5000)),
            ])
            console.log(`[Progress] Frame ${frame}: updating Supabase...`)
            await Promise.race([
              supabase.from('video_exports').update({ progress: percent }).eq('id', exportId),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase timeout')), 5000)),
            ])
            console.log(`[Progress] Frame ${frame}: updates complete`)
          } catch (e) {
            console.warn(`[Progress] Frame ${frame}: progress update failed (non-fatal):`, (e as Error).message)
          }
          lastProgressUpdate = now
        }

        const elapsed = (now - startTime) / 1000
        const rate = frame / elapsed
        const eta = ((totalFrames - frame) / rate).toFixed(0)
        console.log(`[Render] Frame ${frame}/${totalFrames} (${percent}%) — ${rate.toFixed(1)} fps — ETA ${eta}s`)
      }
    }

    // ─── Step 39: Close FFmpeg pipe ──────────────────────────────
    console.log('[Render] All frames sent, closing FFmpeg stdin...')
    ffmpeg.stdin!.end()
    await waitForFFmpeg(ffmpeg)

    // Close browser before upload (free RAM)
    await browser.close()
    browser = null

    // ─── Step 40: Upload to R2 ───────────────────────────────────
    const mp4Url = await uploadToR2(outputPath, exportId)

    // Update Supabase with completed status
    await supabase.from('video_exports').update({
      status: 'completed',
      progress: 100,
      mp4_url: mp4Url,
    }).eq('id', exportId)

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[Render] ✅ Job complete in ${totalTime}s — ${mp4Url}`)

  } catch (err) {
    console.error(`[Render] ❌ Job failed:`, err)

    // Update Supabase with error
    await supabase.from('video_exports').update({
      status: 'failed',
      error_message: (err as Error).message?.substring(0, 500) || 'Unknown error',
    }).eq('id', exportId)

    throw err

  } finally {
    // ─── RUTHLESS CLEANUP — always runs, even on crash ───────────
    // Kill Chrome if still running (prevents zombie processes)
    if (browser) {
      try {
        await browser.close()
        console.log('[Cleanup] Browser closed')
      } catch (e) {
        console.warn('[Cleanup] Browser close failed:', e)
      }
    }

    // Delete temp files (prevents Railway disk from filling up)
    for (const file of [audioPath, outputPath]) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file)
          console.log(`[Cleanup] Deleted ${file}`)
        }
      } catch (e) {
        console.warn(`[Cleanup] Failed to delete ${file}:`, e)
      }
    }
  }
}
