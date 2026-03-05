/**
 * WaterfallRenderer — PixiJS Canvas + Zero-Allocation Render Loop
 */

import { Application, Graphics, Container } from 'pixi.js'
import type { NoteEvent, ParsedMidi } from '../types'
import { NotePool } from './NotePool'
import {
    calculatePianoMetricsFromDOM,
    calculatePianoMetrics,
    isBlackKey,
    MIDI_MIN,
    MIDI_MAX,
} from './pianoMetrics'
import type { PlaybackManager } from './PlaybackManager'

/**
 * Smooth velocity → rainbow color.
 *   ≤ 20  → purple (hue 270)
 *   ≥ 100 → red    (hue 0)
 *   20..100 → continuous rainbow from purple → blue → cyan → green → yellow → red
 */
function velocityToColor(velocity: number): number {
    const v = Math.max(0, Math.min(127, velocity))
    let hue: number
    if (v <= 20) {
        hue = 270
    } else if (v >= 100) {
        hue = 0
    } else {
        const t = (v - 20) / (100 - 20) // 0..1
        hue = 270 * (1 - t)
    }
    return hslToHex(hue, 85, 55)
}

function hslToHex(h: number, s: number, l: number): number {
    const sn = s / 100
    const ln = l / 100
    const c = (1 - Math.abs(2 * ln - 1)) * sn
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = ln - c / 2
    let r = 0, g = 0, b = 0
    if (h < 60) { r = c; g = x; b = 0 }
    else if (h < 120) { r = x; g = c; b = 0 }
    else if (h < 180) { r = 0; g = c; b = x }
    else if (h < 240) { r = 0; g = x; b = c }
    else if (h < 300) { r = x; g = 0; b = c }
    else { r = c; g = 0; b = x }
    const ri = Math.round((r + m) * 255)
    const gi = Math.round((g + m) * 255)
    const bi = Math.round((b + m) * 255)
    return (ri << 16) | (gi << 8) | bi
}

export class WaterfallRenderer {
    private app: Application | null = null
    private notePool: NotePool | null = null
    private playbackManager: PlaybackManager

    private canvasContainer: HTMLElement
    private resizeObserver: ResizeObserver | null = null

    private pixelsPerSecond = 200
    private strikeLineY = 0
    private canvasHeight = 0
    private canvasWidth = 0

    private keyX: Float64Array = new Float64Array(128)
    private keyW: Float64Array = new Float64Array(128)
    private keyValid: Uint8Array = new Uint8Array(128)

    private strikeLineGraphics: Graphics | null = null

    private keyElements: (HTMLElement | null)[] = new Array(128).fill(null)

    private activeThisFrame: Uint8Array = new Uint8Array(128)
    private activeLastFrame: Uint8Array = new Uint8Array(128)

    private notes: NoteEvent[] = []
    private leftHandActive = true
    private rightHandActive = true

    private boundRenderFrame: () => void

    private frameCount = 0
    private lastFpsTime = 0

    constructor(
        canvasContainer: HTMLElement,
        playbackManager: PlaybackManager
    ) {
        this.canvasContainer = canvasContainer
        this.playbackManager = playbackManager
        this.boundRenderFrame = this.renderFrame.bind(this)
    }

    async init(): Promise<void> {
        this.app = new Application()

        await this.app.init({
            preference: 'webgl',
            powerPreference: 'high-performance',
            antialias: false,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
            backgroundAlpha: 0,
            resizeTo: this.canvasContainer,
        })

        const canvas = this.app.canvas as HTMLCanvasElement
        canvas.style.position = 'absolute'
        canvas.style.top = '0'
        canvas.style.left = '0'
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        this.canvasContainer.appendChild(canvas)

        this.strikeLineGraphics = new Graphics()
        this.strikeLineGraphics.label = 'strike-line'
        this.app.stage.addChild(this.strikeLineGraphics)

        this.notePool = new NotePool(this.app, 1500)
        await this.notePool.init()

        this.cacheKeyElements()
        this.recalculateLayout()

        this.resizeObserver = new ResizeObserver(() => {
            this.recalculateLayout()
            this.cacheKeyElements()
        })
        this.resizeObserver.observe(this.canvasContainer)

        this.app.ticker.add(this.boundRenderFrame)

        console.log('[SynthUI] WaterfallRenderer initialized (Graphics-based render loop)')
    }

    private cacheKeyElements(): void {
        for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
            this.keyElements[pitch] = document.getElementById(`key-${pitch}`)
        }
    }

    private recalculateLayout(): void {
        if (!this.app) return

        const rect = this.canvasContainer.getBoundingClientRect()

        if (this.canvasWidth === rect.width && this.canvasHeight === rect.height) {
            return
        }

        this.canvasWidth = rect.width
        this.canvasHeight = rect.height
        this.strikeLineY = this.canvasHeight - 4

        const parent = this.canvasContainer.parentElement?.parentElement || this.canvasContainer
        const metrics =
            calculatePianoMetricsFromDOM(parent) ||
            calculatePianoMetrics(this.canvasWidth)

        this.keyValid.fill(0)
        for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
            const key = metrics.keys.get(pitch)
            if (key) {
                this.keyX[pitch] = key.x
                this.keyW[pitch] = key.width
                this.keyValid[pitch] = 1
            }
        }

        this.drawStrikeLine()
    }

    private drawStrikeLine(): void {
        if (!this.strikeLineGraphics) return
        this.strikeLineGraphics.clear()
        this.strikeLineGraphics.rect(0, this.strikeLineY - 1, this.canvasWidth, 2)
        this.strikeLineGraphics.fill({ color: 0xffffff, alpha: 0.15 })
        this.strikeLineGraphics.rect(0, this.strikeLineY - 3, this.canvasWidth, 6)
        this.strikeLineGraphics.fill({ color: 0xa855f7, alpha: 0.08 })
    }

    loadNotes(midi: ParsedMidi): void {
        this.notes = midi.notes
    }

    setTrackVisibility(leftHand: boolean, rightHand: boolean): void {
        this.leftHandActive = leftHand
        this.rightHandActive = rightHand
    }

    setZoom(pps: number): void {
        this.pixelsPerSecond = pps
    }

    private renderFrame(): void {
        if (!this.notePool || this.notes.length === 0) return

        const time = this.playbackManager.getVisualTime()
        const pps = this.pixelsPerSecond
        const strikeY = this.strikeLineY
        const canvasH = this.canvasHeight
        const lookaheadSec = canvasH / pps
        const notes = this.notes

        this.notePool.releaseAll()

        const temp = this.activeLastFrame
        this.activeLastFrame = this.activeThisFrame
        this.activeThisFrame = temp
        this.activeThisFrame.fill(0)

        const windowStart = time - 0.5
        const windowEnd = time + lookaheadSec

        const searchTime = Math.max(0, windowStart - 10.0)
        let lo = 0
        let hi = notes.length
        while (lo < hi) {
            const mid = (lo + hi) >>> 1
            if (notes[mid].startTimeSec < searchTime) {
                lo = mid + 1
            } else {
                hi = mid
            }
        }

        for (let i = lo; i < notes.length; i++) {
            const note = notes[i]
            if (note.startTimeSec > windowEnd) break
            if (note.endTimeSec < windowStart) continue
            if (!this.rightHandActive && note.trackId === 0) continue
            if (!this.leftHandActive && note.trackId === 1) continue
            if (!this.keyValid[note.pitch]) continue

            const timeUntilStart = note.startTimeSec - time
            const noteBottomY = strikeY - (timeUntilStart * pps)
            const noteHeight = note.durationSec * pps
            const noteTopY = noteBottomY - noteHeight

            if ((noteTopY + noteHeight) < 0 || noteTopY > canvasH) continue

            const g = this.notePool.acquire()
            if (!g) break

            const fullW = Math.round(this.keyW[note.pitch])
            const h = Math.max(Math.round(noteHeight), 12)
            const heatColor = velocityToColor(note.velocity)
            const active = time >= note.startTimeSec && time <= note.endTimeSec

            if (active) this.activeThisFrame[note.pitch] = 1

            // ── Width scaling by velocity ──
            // White keys: 50%→100%, Black keys: 70%→100%
            const velClamped = Math.max(0, Math.min(127, note.velocity))
            const velT = velClamped <= 20 ? 0 : velClamped >= 100 ? 1 : (velClamped - 20) / 80
            const minScale = isBlackKey(note.pitch) ? 0.7 : 0.5
            const widthScale = minScale + (1 - minScale) * velT
            const w = Math.max(4, Math.round(fullW * widthScale))
            const baseX = Math.round(this.keyX[note.pitch]) + Math.round((fullW - w) / 2) // center on key

            // Calculate inner border thickness based on velocity
            const maxThickness = Math.min(w, h) / 2
            // Maps velocity 0-127 → thickness from 2px to full fill
            const thickness = 2 + (note.velocity / 127) * (maxThickness - 2)

            // Clear and redraw this Graphics object
            g.clear()

            // Base fill: white for white keys, black for black keys
            const isBlack = isBlackKey(note.pitch)
            const baseFill = isBlack ? 0x000000 : 0xFFFFFF
            g.roundRect(baseX, noteTopY, w, h, 4)
            g.fill({ color: baseFill, alpha: 1.0 })

            if (note.velocity >= 120) {
                // Max velocity: completely fill with color at 70% opacity (blends with base)
                g.roundRect(baseX, noteTopY, w, h, 4)
                g.fill({ color: heatColor, alpha: active ? 0.7 : 0.6 })
            } else {
                // Dynamic inner border at 70% opacity: blends with white/black base
                g.roundRect(baseX, noteTopY, w, h, 4)
                g.stroke({ color: heatColor, width: thickness, alignment: 1, alpha: active ? 0.7 : 0.6 })
            }
        }

        for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
            const wasActive = this.activeLastFrame[pitch]
            const isActive = this.activeThisFrame[pitch]

            if (wasActive && !isActive) {
                const el = this.keyElements[pitch]
                if (el) el.dataset.active = 'false'
            } else if (!wasActive && isActive) {
                const el = this.keyElements[pitch]
                if (el) el.dataset.active = 'true'
            }
        }

        this.frameCount++
        const now = performance.now()
        if (now - this.lastFpsTime >= 2000) {
            this.frameCount = 0
            this.lastFpsTime = now
        }
    }

    destroy(): void {
        if (this.app) {
            this.app.ticker.remove(this.boundRenderFrame)
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect()
            this.resizeObserver = null
        }

        for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
            const el = this.keyElements[pitch]
            if (el) el.dataset.active = 'false'
        }

        if (this.notePool) {
            this.notePool.destroy()
            this.notePool = null
        }

        if (this.app) {
            const canvas = this.app.canvas
            this.app.destroy(true, { children: true, texture: true })
            if (canvas?.parentElement) {
                canvas.parentElement.removeChild(canvas)
            }
            this.app = null
        }

        this.strikeLineGraphics = null
        this.keyElements.fill(null)

        console.log('[SynthUI] WaterfallRenderer destroyed')
    }
}
