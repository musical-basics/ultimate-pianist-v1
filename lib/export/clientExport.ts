/**
 * Client-Side Video Export — WebCodecs + mp4-muxer + html-to-image
 *
 * Captures the FULL viewport (sheet music + waterfall + piano keyboard)
 * using html-to-image for DOM rasterization, combined with direct
 * PixiJS canvas capture for the WebGL waterfall.
 *
 * Uses the browser's native GPU-accelerated VideoEncoder to encode
 * H.264 at native Retina resolution, mux with audio via mp4-muxer,
 * and download the MP4 straight to the user's machine.
 *
 * Zero server cost. Full quality. Uses hardware WebGL + native DPR.
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { toCanvas } from 'html-to-image'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'

// ─── Types ────────────────────────────────────────────────────────
export interface LocalExportOptions {
  audioUrl: string
  durationSec: number
  fps?: number           // Default: 30 (full viewport is ~50-100ms/frame)
  width?: number         // Default: 1920
  height?: number        // Default: 1080
  onProgress?: (frame: number, totalFrames: number, phase: string) => void
  onComplete?: (url: string) => void
  onError?: (error: Error) => void
}

// ─── Globals expected to be exposed by SplitScreenLayout ──────────
declare global {
  interface Window {
    __EXPORT_CONTAINER__: HTMLElement | null
    __WATERFALL_CANVAS__: HTMLCanvasElement | null
    __RENDER_WATERFALL: () => void
    __UPDATE_SCORE__: (() => void) | undefined
    __STUDIO_MODE__: boolean
    __EXPORT_FPS__: number
  }
}

// ─── Main Export Function ─────────────────────────────────────────
export async function exportVideoLocal(options: LocalExportOptions): Promise<void> {
  const {
    audioUrl,
    durationSec,
    fps = 30,    // 30fps for full viewport (html-to-image is ~50-100ms/frame)
    width = 1920,
    height = 1080,
    onProgress,
    onComplete,
    onError,
  } = options

  const pm = getPlaybackManager()
  const totalFrames = Math.ceil(durationSec * fps)
  const frameDurationUs = Math.round(1_000_000 / fps) // microseconds per frame

  console.log(`[LocalExport] Starting full viewport: ${totalFrames} frames at ${fps}fps, ${width}x${height}`)

  // ─── 1. Verify container access ────────────────────────────────
  const container = window.__EXPORT_CONTAINER__
  if (!container) {
    const err = new Error('Export container not found. Make sure the visualizer is loaded.')
    onError?.(err)
    throw err
  }

  // ─── 2. Enter studio mode ──────────────────────────────────────
  const wasStudio = window.__STUDIO_MODE__
  const wasPlaying = pm.isPlaying
  if (wasPlaying) pm.pause()
  window.__STUDIO_MODE__ = true
  window.__EXPORT_FPS__ = fps
  pm.setStudioMode(true)

  // Hide any UI chrome that shouldn't be in the export
  const body = document.body
  body.classList.add('studio-mode')

  try {
    // ─── 3. Decode audio into PCM ──────────────────────────────────
    onProgress?.(0, totalFrames, 'Decoding audio...')
    const audioBuffer = await decodeAudio(audioUrl)
    console.log(`[LocalExport] Audio decoded: ${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.sampleRate}Hz, ${audioBuffer.numberOfChannels}ch`)

    // ─── 4. Set up mp4-muxer ───────────────────────────────────────
    const target = new ArrayBufferTarget()
    const muxer = new Muxer({
      target,
      video: {
        codec: 'avc',
        width,
        height,
      },
      audio: {
        codec: 'aac',
        numberOfChannels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
      },
      fastStart: 'in-memory',
    })

    // ─── 5. Set up VideoEncoder ────────────────────────────────────
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        muxer.addVideoChunk(chunk, meta ?? undefined)
      },
      error: (e) => {
        console.error('[LocalExport] VideoEncoder error:', e)
        onError?.(new Error(`VideoEncoder: ${e.message}`))
      },
    })

    videoEncoder.configure({
      codec: 'avc1.640028', // H.264 High Profile
      width,
      height,
      bitrate: 8_000_000,   // 8 Mbps — crisp for UI elements
      framerate: fps,
    })

    // ─── 6. Set up AudioEncoder ────────────────────────────────────
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        muxer.addAudioChunk(chunk, meta ?? undefined)
      },
      error: (e) => {
        console.error('[LocalExport] AudioEncoder error:', e)
        onError?.(new Error(`AudioEncoder: ${e.message}`))
      },
    })

    audioEncoder.configure({
      codec: 'mp4a.40.2', // AAC-LC
      numberOfChannels: audioBuffer.numberOfChannels,
      sampleRate: audioBuffer.sampleRate,
      bitrate: 192_000,
    })

    // ─── 7. Encode audio first ─────────────────────────────────────
    onProgress?.(0, totalFrames, 'Encoding audio...')
    await encodeAudioBuffer(audioEncoder, audioBuffer)
    console.log('[LocalExport] Audio encoding queued')

    // ─── 8. Full Viewport Deterministic Render Loop ────────────────
    const startTime = Date.now()

    for (let frame = 0; frame < totalFrames; frame++) {
      const timeSec = frame / fps

      // Advance the deterministic clock
      pm.setManualTime(timeSec)

      // Force PixiJS to render synchronously (waterfall + particles)
      if (window.__RENDER_WATERFALL) {
        window.__RENDER_WATERFALL()
      }

      // Force sheet music cursor update
      if (window.__UPDATE_SCORE__) {
        window.__UPDATE_SCORE__()
      }

      // Capture the FULL viewport (DOM + SVG + WebGL Canvas)
      // html-to-image rasterizes everything including the PixiJS canvas
      const capturedCanvas = await toCanvas(container, {
        width,
        height,
        canvasWidth: width,
        canvasHeight: height,
        pixelRatio: 1,          // We handle resolution via width/height
        backgroundColor: '#09090b', // zinc-950
        skipFonts: true,        // Fonts are already loaded, skip re-fetching
        cacheBust: false,       // Don't append cache-busting params to URLs
      })

      // Create VideoFrame from the captured canvas
      const videoFrame = new VideoFrame(capturedCanvas, {
        timestamp: frame * frameDurationUs,
        duration: frameDurationUs,
      })

      // Encode the frame
      const isKeyframe = frame % (fps * 2) === 0
      videoEncoder.encode(videoFrame, { keyFrame: isKeyframe })
      videoFrame.close()

      // Progress reporting (every second)
      if (frame % fps === 0) {
        const elapsed = (Date.now() - startTime) / 1000
        const fpsActual = frame / elapsed || 0
        const eta = frame > 0 ? Math.round((totalFrames - frame) / fpsActual) : 0
        onProgress?.(frame, totalFrames, `Rendering ${Math.round(frame / totalFrames * 100)}% — ETA ${eta}s`)
        console.log(`[LocalExport] Frame ${frame}/${totalFrames} (${Math.round(frame / totalFrames * 100)}%) — ${fpsActual.toFixed(1)} fps — ETA ${eta}s`)
      }

      // Yield to main thread every frame to keep UI responsive
      // (html-to-image is async so this naturally yields, but add safety)
      if (frame % 10 === 0) {
        await new Promise(r => setTimeout(r, 0))
      }

      // Backpressure: wait for encoder to catch up if queue is large
      while (videoEncoder.encodeQueueSize > 5) {
        await new Promise(r => setTimeout(r, 10))
      }
    }

    // ─── 9. Flush & Finalize ───────────────────────────────────────
    onProgress?.(totalFrames, totalFrames, 'Finalizing...')
    await videoEncoder.flush()
    await audioEncoder.flush()
    videoEncoder.close()
    audioEncoder.close()

    muxer.finalize()

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[LocalExport] Muxer finalized in ${totalTime}s`)

    // ─── 10. Download ──────────────────────────────────────────────
    const blob = new Blob([target.buffer], { type: 'video/mp4' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = `piano-export-${Date.now()}.mp4`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    setTimeout(() => URL.revokeObjectURL(url), 60_000)

    const sizeMb = (target.buffer.byteLength / 1024 / 1024).toFixed(1)
    console.log(`[LocalExport] ✅ Complete! ${sizeMb}MB in ${totalTime}s`)
    onComplete?.(url)

  } finally {
    // ─── 11. Restore state ─────────────────────────────────────────
    body.classList.remove('studio-mode')
    window.__STUDIO_MODE__ = wasStudio
    window.__EXPORT_FPS__ = 0
    pm.setStudioMode(wasStudio)
    pm.setManualTime(0)
    if (wasPlaying) pm.play()
  }
}

// ─── Audio Decoding Utility ────────────────────────────────────────
async function decodeAudio(url: string): Promise<AudioBuffer> {
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()
  const audioCtx = new OfflineAudioContext(2, 1, 44100)
  return audioCtx.decodeAudioData(arrayBuffer)
}

// ─── Audio Encoding Utility ────────────────────────────────────────
async function encodeAudioBuffer(encoder: AudioEncoder, audioBuffer: AudioBuffer): Promise<void> {
  const sampleRate = audioBuffer.sampleRate
  const numberOfChannels = audioBuffer.numberOfChannels
  const totalSamples = audioBuffer.length

  // Chunk into ~1024-sample blocks and encode as planar f32
  const chunkSize = 1024
  for (let offset = 0; offset < totalSamples; offset += chunkSize) {
    const samplesInChunk = Math.min(chunkSize, totalSamples - offset)

    // Build planar data: [ch0_all_samples, ch1_all_samples, ...]
    const planar = new Float32Array(samplesInChunk * numberOfChannels)
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const channelData = audioBuffer.getChannelData(ch)
      for (let i = 0; i < samplesInChunk; i++) {
        planar[ch * samplesInChunk + i] = channelData[offset + i]
      }
    }

    const audioData = new AudioData({
      format: 'f32-planar' as AudioSampleFormat,
      sampleRate,
      numberOfFrames: samplesInChunk,
      numberOfChannels,
      timestamp: Math.round((offset / sampleRate) * 1_000_000),
      data: planar.buffer as ArrayBuffer,
    })

    encoder.encode(audioData)
    audioData.close()

    // Yield periodically to prevent encoder backpressure
    if (encoder.encodeQueueSize > 10) {
      await new Promise(r => setTimeout(r, 0))
    }
  }
}
