/**
 * Client-Side Video Export — Hybrid Native Canvas Compositor
 *
 * Ultra-fast compositing by bypassing DOM serialization:
 * 1. Sheet music: XMLSerializer → SVG + inlined fonts → Image → drawImage
 * 2. Waterfall: zero-copy drawImage from PixiJS WebGL canvas
 * 3. Piano keyboard: pure Canvas2D rectangles
 *
 * Font fix: Bravura/BravuraText/Academico woff2 files are fetched once at
 * export start, base64-encoded, and injected as @font-face rules into the
 * serialized SVG so the Image element can render music glyphs.
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import { calculatePianoMetrics, isBlackKey, MIDI_MIN, MIDI_MAX } from '@/lib/engine/pianoMetrics'
import { useAppStore } from '@/lib/store'

// ─── Types ────────────────────────────────────────────────────────
export interface LocalExportOptions {
  audioUrl: string
  durationSec: number
  fps?: number
  width?: number
  height?: number
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

// ─── Font CDN URLs (from DreamFlow/VexFlow) ───────────────────────
const FONT_CDN = 'https://cdn.jsdelivr.net/npm/@vexflow-fonts/'
const FONTS_TO_EMBED: { name: string; file: string }[] = [
  { name: 'Bravura', file: 'bravura/bravura.woff2' },
  { name: 'Bravura Text', file: 'bravuratext/bravuratext.woff2' },
  { name: 'Academico', file: 'academico/academico.woff2' },
]

// ─── Fetch and base64-encode fonts for SVG embedding ──────────────
async function loadFontsAsBase64(): Promise<string> {
  const rules: string[] = []

  for (const font of FONTS_TO_EMBED) {
    try {
      const resp = await fetch(FONT_CDN + font.file)
      const buf = await resp.arrayBuffer()
      // Convert to base64 in chunks to avoid call stack overflow
      const bytes = new Uint8Array(buf)
      let binary = ''
      const chunkSize = 8192
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
      }
      const b64 = btoa(binary)
      rules.push(
        `@font-face { font-family: '${font.name}'; src: url('data:font/woff2;base64,${b64}') format('woff2'); font-weight: normal; font-style: normal; }`
      )
      console.log(`[LocalExport] Font loaded: ${font.name} (${(buf.byteLength / 1024).toFixed(0)}KB)`)
    } catch (e) {
      console.warn(`[LocalExport] Failed to load font ${font.name}:`, e)
    }
  }

  return rules.join('\n')
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

  ctx.fillStyle = '#18181b'
  ctx.fillRect(0, y, w, h)

  const blackKeyH = h * 0.65

  // White keys
  for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
    if (isBlackKey(pitch)) continue
    const key = pianoMetrics.keys.get(pitch)
    if (!key) continue
    ctx.fillStyle = active?.[pitch]
      ? (useVelColor && colors?.[pitch] ? colors[pitch]! : '#a855f7')
      : '#ffffff'
    ctx.fillRect(key.x, y, key.width, h)
    ctx.strokeStyle = '#d4d4d8'
    ctx.lineWidth = 0.5
    ctx.strokeRect(key.x, y, key.width, h)
  }

  // Black keys (on top)
  for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
    if (!isBlackKey(pitch)) continue
    const key = pianoMetrics.keys.get(pitch)
    if (!key) continue
    ctx.fillStyle = active?.[pitch]
      ? (useVelColor && colors?.[pitch] ? colors[pitch]! : '#a855f7')
      : '#18181b'
    ctx.fillRect(key.x, y, key.width, blackKeyH)
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 0.5
    ctx.strokeRect(key.x, y, key.width, blackKeyH)
  }
}

// ─── Score Renderer (SVG + embedded fonts) ────────────────────────
async function drawScore(
  ctx: CanvasRenderingContext2D,
  y: number,
  w: number,
  h: number,
  fontCSS: string,
  svgImageCache: { lastScrollX: number; img: HTMLImageElement | null; svgW: number; svgH: number }
): Promise<void> {
  const darkMode = useAppStore.getState().darkMode
  ctx.fillStyle = darkMode ? '#18181b' : '#ffffff'
  ctx.fillRect(0, y, w, h)

  const scrollContainer = window.__SCORE_SCROLL_CONTAINER__
  if (!scrollContainer) return

  const svgEl = scrollContainer.querySelector('svg')
  if (!svgEl) return

  const scrollX = scrollContainer.scrollLeft || 0

  // Only re-serialize SVG if scroll position changed significantly
  // (avoids re-serializing 30 times per second when not scrolling)
  const scrollChanged = Math.abs(scrollX - svgImageCache.lastScrollX) > 0.5 || !svgImageCache.img

  if (scrollChanged) {
    // Serialize the live SVG with embedded fonts
    let svgStr = new XMLSerializer().serializeToString(svgEl)
    if (!svgStr.includes('xmlns=')) {
      svgStr = svgStr.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
    }
    // Ensure xlink namespace for any use/href elements
    if (!svgStr.includes('xmlns:xlink')) {
      svgStr = svgStr.replace('<svg ', '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ')
    }

    // Inject font CSS into the SVG
    const styleTag = `<defs><style type="text/css">${fontCSS}</style></defs>`
    // Insert after the opening <svg ...> tag
    const svgOpenEnd = svgStr.indexOf('>') + 1
    svgStr = svgStr.slice(0, svgOpenEnd) + styleTag + svgStr.slice(svgOpenEnd)

    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    try {
      const img = new Image()
      img.src = url
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = (e) => {
          console.warn('[LocalExport] SVG image load failed:', e)
          reject(new Error('SVG load failed'))
        }
      })
      svgImageCache.img = img
      svgImageCache.svgW = img.naturalWidth
      svgImageCache.svgH = img.naturalHeight
      svgImageCache.lastScrollX = scrollX
    } catch {
      // If SVG fails to load, skip this frame's score
      return
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  if (!svgImageCache.img) return

  // Scale SVG to fit the score area
  const scale = h / svgImageCache.svgH

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, y, w, h)
  ctx.clip()
  ctx.drawImage(svgImageCache.img, -scrollX * scale, y, svgImageCache.svgW * scale, h)
  ctx.restore()
}

// ─── Cursor Overlay ───────────────────────────────────────────────
function drawCursor(
  ctx: CanvasRenderingContext2D,
  y: number,
  h: number
): void {
  const cursor = window.__SCORE_CURSOR__
  if (!cursor || cursor.style.display === 'none') return

  const scrollContainer = window.__SCORE_SCROLL_CONTAINER__
  const scrollX = scrollContainer?.scrollLeft || 0

  const match = (cursor.style.transform || '').match(/translateX\(([^p]+)px\)/)
  const cursorX = match ? parseFloat(match[1]) : 0
  const cursorTop = parseFloat(cursor.style.top || '0')
  const cursorHeight = parseFloat(cursor.style.height || '100')

  const svgEl = scrollContainer?.querySelector('svg')
  const svgH = svgEl?.getBoundingClientRect().height || h
  const scale = h / svgH

  ctx.fillStyle = '#10B981'
  ctx.globalAlpha = 0.85
  ctx.fillRect((cursorX - scrollX) * scale, y + cursorTop * scale, 2, cursorHeight * scale)
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

  console.log(`[LocalExport] Hybrid compositor: ${totalFrames} frames @ ${fps}fps, ${width}x${height}`)

  // ─── Layout ────────────────────────────────────────────────────
  const scoreH = Math.round(height * 0.45)
  const keyboardH = 160
  const waterfallH = height - scoreH - keyboardH

  const pianoMetrics = calculatePianoMetrics(width)

  // ─── Master compositing canvas ─────────────────────────────────
  const masterCanvas = document.createElement('canvas')
  masterCanvas.width = width
  masterCanvas.height = height
  const ctx = masterCanvas.getContext('2d', { alpha: false })!

  // ─── Enter studio mode ─────────────────────────────────────────
  const wasStudio = window.__STUDIO_MODE__
  const wasPlaying = pm.isPlaying
  if (wasPlaying) pm.pause()
  window.__STUDIO_MODE__ = true
  window.__EXPORT_FPS__ = fps
  pm.setStudioMode(true)

  try {
    // ─── 1. Load & embed fonts (one-time) ────────────────────────
    onProgress?.(0, totalFrames, 'Loading fonts...')
    const fontCSS = await loadFontsAsBase64()
    console.log(`[LocalExport] Fonts embedded (${fontCSS.length} chars of CSS)`)

    // ─── 2. Decode audio ─────────────────────────────────────────
    onProgress?.(0, totalFrames, 'Decoding audio...')
    const audioBuffer = await decodeAudio(audioUrl)
    console.log(`[LocalExport] Audio: ${audioBuffer.duration.toFixed(1)}s, ${audioBuffer.sampleRate}Hz`)

    // ─── 3. Resize PixiJS to export resolution ──────────────────
    const engine = window.__WATERFALL_ENGINE__
    let originalWidth = 0
    let originalHeight = 0
    if (engine?.app?.renderer) {
      originalWidth = engine.app.renderer.width
      originalHeight = engine.app.renderer.height
      engine.app.renderer.resize(width, waterfallH)
      // Also update the canvas CSS so it doesn't mess up layout during export
      const pixiCanvas = engine.app.canvas as HTMLCanvasElement
      if (pixiCanvas) {
        pixiCanvas.style.width = `${width}px`
        pixiCanvas.style.height = `${waterfallH}px`
      }
      console.log(`[LocalExport] PixiJS resized: ${originalWidth}x${originalHeight} → ${width}x${waterfallH}`)
    }

    // ─── 4. Set up mp4-muxer ─────────────────────────────────────
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

    // ─── 5. VideoEncoder ─────────────────────────────────────────
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
      bitrate: 12_000_000,
      framerate: fps,
    })

    // ─── 6. AudioEncoder ─────────────────────────────────────────
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

    // ─── 7. Encode audio ─────────────────────────────────────────
    onProgress?.(0, totalFrames, 'Encoding audio...')
    await encodeAudioBuffer(audioEncoder, audioBuffer)

    // ─── 8. SVG cache ────────────────────────────────────────────
    const svgImageCache = { lastScrollX: -999, img: null as HTMLImageElement | null, svgW: 0, svgH: 0 }

    // ─── 9. Deterministic Render Loop ────────────────────────────
    const startTime = Date.now()

    for (let frame = 0; frame < totalFrames; frame++) {
      const timeSec = frame / fps

      // Advance clock
      pm.setManualTime(timeSec)
      window.__RENDER_WATERFALL?.()
      window.__UPDATE_SCORE__?.()

      // Composite onto master canvas
      ctx.fillStyle = '#09090b'
      ctx.fillRect(0, 0, width, height)

      // Layer 1: Sheet music + fonts
      await drawScore(ctx, 0, width, scoreH, fontCSS, svgImageCache)

      // Layer 1b: Cursor
      drawCursor(ctx, 0, scoreH)

      // Layer 2: Waterfall (zero-copy from resized PixiJS)
      const pixiCanvas = window.__WATERFALL_CANVAS__
      if (pixiCanvas) {
        ctx.drawImage(pixiCanvas, 0, scoreH, width, waterfallH)
      }

      // Layer 3: Piano keyboard
      drawPianoKeyboard(ctx, scoreH + waterfallH, width, keyboardH, pianoMetrics)

      // Encode frame
      const videoFrame = new VideoFrame(masterCanvas, {
        timestamp: frame * frameDurationUs,
        duration: frameDurationUs,
      })
      videoEncoder.encode(videoFrame, { keyFrame: frame % (fps * 2) === 0 })
      videoFrame.close()

      // Progress
      if (frame % fps === 0) {
        const elapsed = (Date.now() - startTime) / 1000
        const fpsActual = frame / elapsed || 0
        const eta = frame > 0 ? Math.round((totalFrames - frame) / fpsActual) : 0
        onProgress?.(frame, totalFrames, `Rendering ${Math.round(frame / totalFrames * 100)}% — ETA ${eta}s`)
        console.log(`[LocalExport] F${frame}/${totalFrames} (${Math.round(frame / totalFrames * 100)}%) — ${fpsActual.toFixed(1)}fps — ETA ${eta}s`)
      }

      // Yield + GC
      if (frame % 5 === 0) {
        await new Promise(r => setTimeout(r, 0))
      }

      // Backpressure
      while (videoEncoder.encodeQueueSize > 5) {
        await new Promise(r => setTimeout(r, 10))
      }
    }

    // ─── 10. Finalize ────────────────────────────────────────────
    onProgress?.(totalFrames, totalFrames, 'Finalizing...')
    await videoEncoder.flush()
    await audioEncoder.flush()
    videoEncoder.close()
    audioEncoder.close()
    muxer.finalize()

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)

    // ─── 11. Download ────────────────────────────────────────────
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
    // ─── 12. Restore PixiJS resolution ───────────────────────────
    const engine = window.__WATERFALL_ENGINE__
    if (engine?.app?.renderer && arguments[0]) {
      // Restore to container size
      const container = engine.canvasContainer as HTMLElement
      if (container) {
        engine.app.renderer.resize(container.clientWidth, container.clientHeight)
        const pixiCanvas = engine.app.canvas as HTMLCanvasElement
        if (pixiCanvas) {
          pixiCanvas.style.width = '100%'
          pixiCanvas.style.height = '100%'
        }
      }
    }

    window.__STUDIO_MODE__ = wasStudio
    window.__EXPORT_FPS__ = 0
    pm.setStudioMode(wasStudio)
    pm.setManualTime(0)
    if (wasPlaying) pm.play()
  }
}

// ─── Audio Utilities ───────────────────────────────────────────────
async function decodeAudio(url: string): Promise<AudioBuffer> {
  const resp = await fetch(url)
  const buf = await resp.arrayBuffer()
  const ctx = new OfflineAudioContext(2, 1, 44100)
  return ctx.decodeAudioData(buf)
}

async function encodeAudioBuffer(encoder: AudioEncoder, audioBuffer: AudioBuffer): Promise<void> {
  const { sampleRate, numberOfChannels, length: totalSamples } = audioBuffer
  const chunkSize = 1024

  for (let offset = 0; offset < totalSamples; offset += chunkSize) {
    const n = Math.min(chunkSize, totalSamples - offset)
    const planar = new Float32Array(n * numberOfChannels)

    for (let ch = 0; ch < numberOfChannels; ch++) {
      const src = audioBuffer.getChannelData(ch)
      for (let i = 0; i < n; i++) {
        planar[ch * n + i] = src[offset + i]
      }
    }

    const audioData = new AudioData({
      format: 'f32-planar' as AudioSampleFormat,
      sampleRate,
      numberOfFrames: n,
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
