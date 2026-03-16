/**
 * Client-Side Video Export — WebCodecs + mp4-muxer
 *
 * Uses the browser's native GPU-accelerated VideoEncoder to capture
 * the PixiJS waterfall canvas deterministically, mux with audio via
 * mp4-muxer, and download the MP4 straight to the user's machine.
 *
 * Zero server cost. Works offline. ~2x realtime on modern GPUs.
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'

// ─── Types ────────────────────────────────────────────────────────
export interface LocalExportOptions {
  audioUrl: string
  durationSec: number
  fps?: number           // Default: 60
  width?: number         // Default: 1920
  height?: number        // Default: 1080
  onProgress?: (frame: number, totalFrames: number, phase: string) => void
  onComplete?: (url: string) => void
  onError?: (error: Error) => void
}

// ─── Globals expected to be exposed by SplitScreenLayout ──────────
declare global {
  interface Window {
    __WATERFALL_CANVAS__: HTMLCanvasElement | null
    __RENDER_WATERFALL: () => void
    __STUDIO_MODE__: boolean
    __EXPORT_FPS__: number
  }
}

// ─── Main Export Function ─────────────────────────────────────────
export async function exportVideoLocal(options: LocalExportOptions): Promise<void> {
  const {
    audioUrl,
    durationSec,
    fps = 60,
    width = 1920,
    height = 1080,
    onProgress,
    onComplete,
    onError,
  } = options

  const pm = getPlaybackManager()
  const totalFrames = Math.ceil(durationSec * fps)
  const frameDurationUs = Math.round(1_000_000 / fps) // microseconds per frame

  console.log(`[LocalExport] Starting: ${totalFrames} frames at ${fps}fps, ${width}x${height}`)

  // ─── 1. Verify canvas access ───────────────────────────────────
  const canvas = window.__WATERFALL_CANVAS__
  if (!canvas) {
    const err = new Error('Waterfall canvas not found. Make sure the visualizer is loaded.')
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
      fastStart: 'in-memory', // Enable streaming playback
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

    // ─── 7. Encode audio ───────────────────────────────────────────
    onProgress?.(0, totalFrames, 'Encoding audio...')
    await encodeAudioBuffer(audioEncoder, audioBuffer)
    console.log('[LocalExport] Audio encoding queued')

    // ─── 8. Deterministic Video Render Loop ────────────────────────
    // Create an OffscreenCanvas to composite at the target resolution
    const compositeCanvas = new OffscreenCanvas(width, height)
    const ctx = compositeCanvas.getContext('2d')!

    for (let frame = 0; frame < totalFrames; frame++) {
      const timeSec = frame / fps

      // Advance the deterministic clock
      pm.setManualTime(timeSec)

      // Force PixiJS to render synchronously
      if (window.__RENDER_WATERFALL) {
        window.__RENDER_WATERFALL()
      }

      // Composite: draw the PixiJS canvas onto our target-resolution canvas
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(canvas, 0, 0, width, height)

      // Create VideoFrame from the composite canvas
      const videoFrame = new VideoFrame(compositeCanvas, {
        timestamp: frame * frameDurationUs,
        duration: frameDurationUs,
      })

      // Encode the frame
      const isKeyframe = frame % (fps * 2) === 0 // Keyframe every 2 seconds
      videoEncoder.encode(videoFrame, { keyFrame: isKeyframe })
      videoFrame.close()

      // Progress reporting
      if (frame % fps === 0) {
        onProgress?.(frame, totalFrames, 'Rendering video...')
        console.log(`[LocalExport] Frame ${frame}/${totalFrames} (${Math.round(frame / totalFrames * 100)}%)`)
      }

      // Yield to main thread every 60 frames to keep UI responsive
      if (frame % 60 === 0) {
        await new Promise(r => setTimeout(r, 0))
      }
    }

    // ─── 9. Flush & Finalize ───────────────────────────────────────
    onProgress?.(totalFrames, totalFrames, 'Finalizing...')
    await videoEncoder.flush()
    await audioEncoder.flush()
    videoEncoder.close()
    audioEncoder.close()

    muxer.finalize()
    console.log('[LocalExport] Muxer finalized')

    // ─── 10. Download ──────────────────────────────────────────────
    const blob = new Blob([target.buffer], { type: 'video/mp4' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = `piano-export-${Date.now()}.mp4`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    // Keep URL alive for a bit in case download needs it
    setTimeout(() => URL.revokeObjectURL(url), 60_000)

    const sizeMb = (target.buffer.byteLength / 1024 / 1024).toFixed(1)
    console.log(`[LocalExport] ✅ Complete! ${sizeMb}MB`)
    onComplete?.(url)

  } finally {
    // ─── 11. Restore playback state ────────────────────────────────
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
  const audioCtx = new OfflineAudioContext(2, 1, 44100) // Just for decoding
  return audioCtx.decodeAudioData(arrayBuffer)
}

// ─── Audio Encoding Utility ────────────────────────────────────────
async function encodeAudioBuffer(encoder: AudioEncoder, audioBuffer: AudioBuffer): Promise<void> {
  const sampleRate = audioBuffer.sampleRate
  const numberOfChannels = audioBuffer.numberOfChannels
  const totalSamples = audioBuffer.length

  // Interleave channels into a single Float32Array
  const interleaved = new Float32Array(totalSamples * numberOfChannels)
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch)
    for (let i = 0; i < totalSamples; i++) {
      interleaved[i * numberOfChannels + ch] = channelData[i]
    }
  }

  // Chunk into ~1024-sample blocks and encode
  const chunkSize = 1024
  for (let offset = 0; offset < totalSamples; offset += chunkSize) {
    const samplesInChunk = Math.min(chunkSize, totalSamples - offset)
    const chunkData = new Float32Array(samplesInChunk * numberOfChannels)

    for (let i = 0; i < samplesInChunk * numberOfChannels; i++) {
      chunkData[i] = interleaved[offset * numberOfChannels + i]
    }

    const audioData = new AudioData({
      format: 'f32-planar' as AudioSampleFormat,
      sampleRate,
      numberOfFrames: samplesInChunk,
      numberOfChannels,
      timestamp: Math.round((offset / sampleRate) * 1_000_000), // microseconds
      data: deinterleaveToplanar(chunkData, samplesInChunk, numberOfChannels).buffer as ArrayBuffer,
    })

    encoder.encode(audioData)
    audioData.close()

    // Yield periodically to prevent encoder backpressure
    if (encoder.encodeQueueSize > 10) {
      await new Promise(r => setTimeout(r, 0))
    }
  }
}

// ─── Audio Channel Deinterleave ────────────────────────────────────
function deinterleaveToplanar(
  interleaved: Float32Array,
  frames: number,
  channels: number
): Float32Array {
  // WebCodecs f32-planar expects [ch0_all_samples, ch1_all_samples, ...]
  const planar = new Float32Array(frames * channels)
  for (let ch = 0; ch < channels; ch++) {
    for (let i = 0; i < frames; i++) {
      planar[ch * frames + i] = interleaved[i * channels + ch]
    }
  }
  return planar
}
