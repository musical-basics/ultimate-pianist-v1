/**
 * Client-Side Video Export — Hybrid Native Canvas Compositor
 *
 * Ultra-fast compositing by bypassing DOM serialization:
 * 1. Sheet music: XMLSerializer → Blob → Image → drawImage (~5ms/frame)
 * 2. Waterfall: zero-copy drawImage from PixiJS WebGL canvas (~0.1ms)
 * 3. Piano keyboard: pure Canvas2D rectangles (~0.1ms)
 *
 * Target: ~40 seconds for a 2-minute song (vs 97min with html-to-image)
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import { calculatePianoMetrics, isBlackKey, MIDI_MIN, MIDI_MAX } from '@/lib/engine/pianoMetrics'
import { useAppStore } from '@/lib/store'

// ─── Types ────────────────────────────────────────────────────────
export interface LocalExportOptions {
  audioUrl: string
  durationSec: number
  fps?: number           // Default: 30
  width?: number         // Default: 1920
  height?: number        // Default: 1080
  onProgress?: (frame: number, totalFrames: number, phase: string) => void
  onComplete?: (url: string) => void
  onError?: (error: Error) => void
}

// ─── Globals ──────────────────────────────────────────────────────
declare global {
  interface Window {
    __WATERFALL_CANVAS__: HTMLCanvasElement | null
    __WATERFALL_ENGINE__: any
    __RENDER_WATERFALL: () => void
    __UPDATE_SCORE__: (() => void) | undefined
    __SCORE_SCROLL_CONTAINER__: HTMLElement | null
    __SCORE_CURSOR__: HTMLElement | null
    __STUDIO_MODE__: boolean
    __EXPORT_FPS__: number
  }
}

// ─── Piano Keyboard Renderer (Canvas2D) ───────────────────────────
function drawPianoKeyboard(
  ctx: CanvasRenderingContext2D,
  y: number,
  w: number,
  h: number,
  pianoMetrics: ReturnType<typeof calculatePianoMetrics>
): void {
  const engine = window.__WATERFALL_ENGINE__
  const active = engine?.activeThisFrame as Uint8Array | undefined
  const colors = engine?.activeColorThisFrame as (string | null)[] | undefined
  const useVelColor = useAppStore.getState().velocityKeyColor

  // Background
  ctx.fillStyle = '#18181b'
  ctx.fillRect(0, y, w, h)

  const blackKeyH = h * 0.65

  // Pass 1: White keys
  for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
    if (isBlackKey(pitch)) continue
    const key = pianoMetrics.keys.get(pitch)
    if (!key) continue

    const isActive = active?.[pitch]
    if (isActive) {
      ctx.fillStyle = useVelColor && colors?.[pitch] ? colors[pitch]! : '#a855f7'
    } else {
      ctx.fillStyle = '#ffffff'
    }
    ctx.fillRect(key.x, y, key.width, h)

    // Key border
    ctx.strokeStyle = '#d4d4d8'
    ctx.lineWidth = 0.5
    ctx.strokeRect(key.x, y, key.width, h)
  }

  // Pass 2: Black keys (on top)
  for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
    if (!isBlackKey(pitch)) continue
    const key = pianoMetrics.keys.get(pitch)
    if (!key) continue

    const isActive = active?.[pitch]
    if (isActive) {
      ctx.fillStyle = useVelColor && colors?.[pitch] ? colors[pitch]! : '#a855f7'
    } else {
      ctx.fillStyle = '#18181b'
    }
    ctx.fillRect(key.x, y, key.width, blackKeyH)

    // Subtle border for definition
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 0.5
    ctx.strokeRect(key.x, y, key.width, blackKeyH)
  }
}

// ─── Score Renderer (SVG Serialization) ───────────────────────────
async function drawScore(
  ctx: CanvasRenderingContext2D,
  y: number,
  w: number,
  h: number,
  scoreSvgCache: { img: HTMLImageElement | null }
): Promise<void> {
  const darkMode = useAppStore.getState().darkMode

  // Background
  ctx.fillStyle = darkMode ? '#18181b' : '#ffffff'
  ctx.fillRect(0, y, w, h)

  const scrollContainer = window.__SCORE_SCROLL_CONTAINER__
  if (!scrollContainer) return

  const svgEl = scrollContainer.querySelector('svg')
  if (!svgEl) return

  // Serialize the SVG to a data URL
  let svgStr = new XMLSerializer().serializeToString(svgEl)
  if (!svgStr.includes('xmlns=')) {
    svgStr = svgStr.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
  }

  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  try {
    const img = new Image()
    img.src = url
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('SVG load failed'))
    })

    // Draw with scroll offset
    const scrollX = scrollContainer.scrollLeft || 0

    // Scale SVG to fit the score area height
    const svgW = img.naturalWidth
    const svgH = img.naturalHeight
    const scale = h / svgH

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, y, w, h)
    ctx.clip()
    ctx.drawImage(img, -scrollX * scale, y, svgW * scale, h)
    ctx.restore()
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ─── Cursor Renderer ──────────────────────────────────────────────
function drawCursor(
  ctx: CanvasRenderingContext2D,
  y: number,
  h: number
): void {
  const cursor = window.__SCORE_CURSOR__
  if (!cursor || cursor.style.display === 'none') return

  const scrollContainer = window.__SCORE_SCROLL_CONTAINER__
  const scrollX = scrollContainer?.scrollLeft || 0

  // Parse cursor X from transform
  const transform = cursor.style.transform || ''
  const match = transform.match(/translateX\(([^p]+)px\)/)
  const cursorX = match ? parseFloat(match[1]) : 0

  // Parse cursor top offset
  const cursorTop = parseFloat(cursor.style.top || '0')
  const cursorHeight = parseFloat(cursor.style.height || '100')

  // Scale factor: the SVG rendering in drawScore uses the score area height
  // The cursor positions are in the SVG's coordinate space
  const svgEl = scrollContainer?.querySelector('svg')
  const svgH = svgEl?.getBoundingClientRect().height || h
  const scale = h / svgH

  ctx.fillStyle = '#10B981'
  ctx.globalAlpha = 0.85
  ctx.fillRect(
    (cursorX - scrollX) * scale,
    y + cursorTop * scale,
    2,
    cursorHeight * scale
  )
  ctx.globalAlpha = 1.0
}

// ─── Main Export Function ─────────────────────────────────────────
export async function exportVideoLocal(options: LocalExportOptions): Promise<void> {
  const {
    audioUrl,
    durationSec,
    fps = 30,
    width = 1920,
    height = 1080,
    onProgress,
    onComplete,
    onError,
  } = options

  const pm = getPlaybackManager()
  const totalFrames = Math.ceil(durationSec * fps)
  const frameDurationUs = Math.round(1_000_000 / fps)

  console.log(`[LocalExport] Hybrid compositor: ${totalFrames} frames at ${fps}fps, ${width}x${height}`)

  // ─── Layout proportions ────────────────────────────────────────
  const scoreH = Math.round(height * 0.45)
  const keyboardH = 160
  const waterfallH = height - scoreH - keyboardH

  // ─── Pre-calculate piano metrics ───────────────────────────────
  const pianoMetrics = calculatePianoMetrics(width)

  // ─── Create master compositing canvas ──────────────────────────
  const masterCanvas = document.createElement('canvas')
  masterCanvas.width = width
  masterCanvas.height = height
  const ctx = masterCanvas.getContext('2d', { alpha: false, willReadFrequently: false })!

  // ─── Enter studio mode ─────────────────────────────────────────
  const wasStudio = window.__STUDIO_MODE__
  const wasPlaying = pm.isPlaying
  if (wasPlaying) pm.pause()
  window.__STUDIO_MODE__ = true
  window.__EXPORT_FPS__ = fps
  pm.setStudioMode(true)

  // Set up __UPDATE_SCORE__ for the local export if not already set
  // (ScrollView's useEffect may not have run with studio mode)
  const scrollContainer = window.__SCORE_SCROLL_CONTAINER__
  if (scrollContainer && !window.__UPDATE_SCORE__) {
    // Create a simple update function that reads the current visual time
    ;(window as any).__UPDATE_SCORE__ = () => {
      // Force the score cursor to re-render by dispatching a custom event
      // or by reading from PlaybackManager directly
      // (The cursor position is driven by the waterfall renderer's active notes)
    }
  }

  try {
    // ─── Decode audio ────────────────────────────────────────────
    onProgress?.(0, totalFrames, 'Decoding audio...')
    const audioBuffer = await decodeAudio(audioUrl)
    console.log(`[LocalExport] Audio: ${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.sampleRate}Hz`)

    // ─── Set up mp4-muxer ────────────────────────────────────────
    const target = new ArrayBufferTarget()
    const muxer = new Muxer({
      target,
      video: { codec: 'avc', width, height },
      audio: {
        codec: 'aac',
        numberOfChannels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
      },
      fastStart: 'in-memory',
    })

    // ─── Set up VideoEncoder ─────────────────────────────────────
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta ?? undefined),
      error: (e) => {
        console.error('[LocalExport] VideoEncoder error:', e)
        onError?.(new Error(`VideoEncoder: ${e.message}`))
      },
    })

    videoEncoder.configure({
      codec: 'avc1.640028',
      width,
      height,
      bitrate: 12_000_000,  // 12 Mbps for crisp UI
      framerate: fps,
    })

    // ─── Set up AudioEncoder ─────────────────────────────────────
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta ?? undefined),
      error: (e) => {
        console.error('[LocalExport] AudioEncoder error:', e)
        onError?.(new Error(`AudioEncoder: ${e.message}`))
      },
    })

    audioEncoder.configure({
      codec: 'mp4a.40.2',
      numberOfChannels: audioBuffer.numberOfChannels,
      sampleRate: audioBuffer.sampleRate,
      bitrate: 192_000,
    })

    // ─── Encode audio ────────────────────────────────────────────
    onProgress?.(0, totalFrames, 'Encoding audio...')
    await encodeAudioBuffer(audioEncoder, audioBuffer)
    console.log('[LocalExport] Audio queued')

    // ─── SVG cache for score ─────────────────────────────────────
    const scoreSvgCache = { img: null as HTMLImageElement | null }

    // ─── Deterministic Render Loop ───────────────────────────────
    const startTime = Date.now()

    for (let frame = 0; frame < totalFrames; frame++) {
      const timeSec = frame / fps

      // Step 21: Advance the deterministic clock
      pm.setManualTime(timeSec)

      // Force PixiJS waterfall render
      if (window.__RENDER_WATERFALL) {
        window.__RENDER_WATERFALL()
      }

      // Force score cursor update
      if (window.__UPDATE_SCORE__) {
        window.__UPDATE_SCORE__()
      }

      // Step 22: Composite the layers onto the master canvas
      // Background
      ctx.fillStyle = '#09090b'
      ctx.fillRect(0, 0, width, height)

      // Layer 1: Sheet music SVG (~5ms)
      await drawScore(ctx, 0, width, scoreH, scoreSvgCache)

      // Layer 1b: Cursor overlay
      drawCursor(ctx, 0, scoreH)

      // Layer 2: Waterfall — zero-copy from PixiJS GPU canvas (~0.1ms)
      const pixiCanvas = window.__WATERFALL_CANVAS__
      if (pixiCanvas) {
        ctx.drawImage(pixiCanvas, 0, scoreH, width, waterfallH)
      }

      // Layer 3: Piano keyboard — Canvas2D (~0.1ms)
      drawPianoKeyboard(ctx, scoreH + waterfallH, width, keyboardH, pianoMetrics)

      // Create VideoFrame from the composite
      const videoFrame = new VideoFrame(masterCanvas, {
        timestamp: frame * frameDurationUs,
        duration: frameDurationUs,
      })

      const isKeyframe = frame % (fps * 2) === 0
      videoEncoder.encode(videoFrame, { keyFrame: isKeyframe })
      videoFrame.close()

      // Progress & ETA reporting
      if (frame % fps === 0) {
        const elapsed = (Date.now() - startTime) / 1000
        const fpsActual = frame / elapsed || 0
        const eta = frame > 0 ? Math.round((totalFrames - frame) / fpsActual) : 0
        onProgress?.(frame, totalFrames, `Rendering ${Math.round(frame / totalFrames * 100)}% — ETA ${eta}s`)
        console.log(`[LocalExport] F${frame}/${totalFrames} (${Math.round(frame / totalFrames * 100)}%) — ${fpsActual.toFixed(1)}fps — ETA ${eta}s`)
      }

      // Yield to main thread + GC breathing room
      if (frame % 10 === 0) {
        await new Promise(r => setTimeout(r, 0))
      }

      // Step 24: Backpressure
      while (videoEncoder.encodeQueueSize > 5) {
        await new Promise(r => setTimeout(r, 10))
      }
    }

    // ─── Flush & Finalize ────────────────────────────────────────
    onProgress?.(totalFrames, totalFrames, 'Finalizing...')
    await videoEncoder.flush()
    await audioEncoder.flush()
    videoEncoder.close()
    audioEncoder.close()
    muxer.finalize()

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)

    // ─── Download ────────────────────────────────────────────────
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
    console.log(`[LocalExport] ✅ ${sizeMb}MB in ${totalTime}s`)
    onComplete?.(url)

  } finally {
    window.__STUDIO_MODE__ = wasStudio
    window.__EXPORT_FPS__ = 0
    pm.setStudioMode(wasStudio)
    pm.setManualTime(0)
    if (wasPlaying) pm.play()
  }
}

// ─── Audio Utilities ───────────────────────────────────────────────
async function decodeAudio(url: string): Promise<AudioBuffer> {
  const response = await fetch(url)
  const arrayBuffer = await response.arrayBuffer()
  const audioCtx = new OfflineAudioContext(2, 1, 44100)
  return audioCtx.decodeAudioData(arrayBuffer)
}

async function encodeAudioBuffer(encoder: AudioEncoder, audioBuffer: AudioBuffer): Promise<void> {
  const sampleRate = audioBuffer.sampleRate
  const numberOfChannels = audioBuffer.numberOfChannels
  const totalSamples = audioBuffer.length
  const chunkSize = 1024

  for (let offset = 0; offset < totalSamples; offset += chunkSize) {
    const samplesInChunk = Math.min(chunkSize, totalSamples - offset)
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

    if (encoder.encodeQueueSize > 10) {
      await new Promise(r => setTimeout(r, 0))
    }
  }
}
