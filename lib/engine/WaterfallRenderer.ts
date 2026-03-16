/**
 * WaterfallRenderer — PixiJS Canvas + Zero-Allocation Render Loop
 */

import { Application, Graphics, Container, Sprite } from 'pixi.js'
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
import { useAppStore } from '../store'

function velocityToColor(velocity: number): number {
    const v = Math.max(0, Math.min(127, velocity))
    let hue: number
    if (v <= 20) hue = 270
    else if (v >= 110) hue = 0
    else hue = 270 * (1 - ((v - 20) / 90))
    return hslToHex(hue, 85, 55)
}

function hslToHex(h: number, s: number, l: number): number {
    const sn = s / 100; const ln = l / 100
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
    return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255)
}

// ─── Particle System Interfaces ───
interface Flare {
    sprite: Sprite; active: boolean; life: number; maxLife: number
}

interface Spark {
    sprite: Sprite; active: boolean; x: number; y: number;
    vx: number; vy: number; life: number; maxLife: number;
    baseScale: number; isFlame: boolean
}

export class WaterfallRenderer {
    public app: Application | null = null
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
    private activeColorThisFrame: (string | null)[] = new Array(128).fill(null)

    // ─── Gamification FX Properties ───
    private activeHexColorThisFrame: Int32Array = new Int32Array(128)
    private activeLightningThisFrame: Uint8Array = new Uint8Array(128)
    private effectsContainer: Container | null = null
    private flares: Flare[] = []
    private sparks: Spark[] = []
    private lightnings: Sprite[] = []
    private activeNoteIdsThisFrame: Set<string> = new Set()
    private activeNoteIdsLastFrame: Set<string> = new Set()
    private lastRenderTime = 0
    private lastPhysicsTime = 0

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

        // Initialize Effects Layer (on top of notes)
        this.effectsContainer = new Container()
        this.effectsContainer.label = 'effects'
        this.app.stage.addChild(this.effectsContainer)

        this.initParticles()

        this.cacheKeyElements()
        this.recalculateLayout()

        this.resizeObserver = new ResizeObserver(() => {
            this.recalculateLayout()
            this.cacheKeyElements()
        })
        this.resizeObserver.observe(this.canvasContainer)

        this.lastPhysicsTime = performance.now()
        // In studio mode, don't attach to the auto-ticker.
        // renderFrame() will be called manually via window.__RENDER_WATERFALL__
        if (!(window as any).__STUDIO_MODE__) {
            this.app.ticker.add(this.boundRenderFrame)
        }

        console.log(`[SynthUI] WaterfallRenderer initialized (sprite-atlas render loop + FX engine)${(window as any).__STUDIO_MODE__ ? ' [STUDIO MODE]' : ''}`)
    }

    private initParticles() {
        if (!this.effectsContainer || !this.notePool) return

        const flareTex = this.notePool.getFlareTexture()
        const sparkTex = this.notePool.getSparkTexture()
        const particleTex = this.notePool.getParticleTexture()
        const lightningTex = this.notePool.getLightningTexture()

        // 128 Flares (one per key)
        for (let i = 0; i < 128; i++) {
            const s = new Sprite(flareTex)
            s.anchor.set(0.5, 0.5)
            s.blendMode = 'add'
            s.visible = false
            this.effectsContainer.addChild(s)
            this.flares.push({ sprite: s, active: false, life: 0, maxLife: 0 })
        }

        // 128 Lightnings (one per key)
        for (let i = 0; i < 128; i++) {
            const s = new Sprite(lightningTex)
            s.anchor.set(0.5, 1) // Bottom-center so it easily stretches UP
            s.blendMode = 'add'
            s.visible = false
            this.effectsContainer.addChild(s)
            this.lightnings.push(s)
        }

        // 500 Sparks (pooled)
        for (let i = 0; i < 500; i++) {
            const isFlame = i < 250 // Half are flames (soft circle), half are sparks (sharp lines)
            const s = new Sprite(isFlame ? particleTex : sparkTex)
            s.anchor.set(0.5, 0.5)
            s.blendMode = 'add'
            s.visible = false
            this.effectsContainer.addChild(s)
            this.sparks.push({
                sprite: s, active: false, x: 0, y: 0,
                vx: 0, vy: 0, life: 0, maxLife: 1, baseScale: 1, isFlame
            })
        }
    }

    private spawnSparks(x: number, y: number, color: number, width: number) {
        let spawnedSparks = 0;
        let spawnedFlames = 0;
        const targetSparks = 8 + Math.floor(Math.random() * 8);  // 8-15 Fast outward sparks
        const targetFlames = 4 + Math.floor(Math.random() * 4);  // 4-7 Slow upward fire

        for (let i = 0; i < this.sparks.length; i++) {
            const p = this.sparks[i];
            if (!p.active) {
                if (!p.isFlame && spawnedSparks < targetSparks) {
                    // SPARK: fast, shooting outward, affected by heavy gravity
                    p.active = true;
                    p.sprite.visible = true;
                    p.sprite.tint = color;
                    p.x = x + (Math.random() - 0.5) * width;
                    p.y = y;
                    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI; // Wide spread
                    const speed = 200 + Math.random() * 400;
                    p.vx = Math.cos(angle) * speed;
                    p.vy = Math.sin(angle) * speed;
                    p.baseScale = 0.3 + Math.random() * 0.4;
                    p.sprite.scale.set(p.baseScale);
                    p.maxLife = p.life = 0.2 + Math.random() * 0.3; // Short life
                    spawnedSparks++;
                } else if (p.isFlame && spawnedFlames < targetFlames) {
                    // FLAME: slow, moving straight up, fades out
                    p.active = true;
                    p.sprite.visible = true;
                    p.sprite.tint = color;
                    p.x = x + (Math.random() - 0.5) * width; // Spread across key width
                    p.y = y + (Math.random() * 10);
                    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.5; // Mostly straight up
                    const speed = 50 + Math.random() * 150;
                    p.vx = Math.cos(angle) * speed;
                    p.vy = Math.sin(angle) * speed;
                    p.baseScale = 0.6 + Math.random() * 0.8;
                    p.sprite.scale.set(p.baseScale);
                    p.maxLife = p.life = 0.3 + Math.random() * 0.2; // Slightly longer life
                    spawnedFlames++;
                }

                if (spawnedSparks >= targetSparks && spawnedFlames >= targetFlames) {
                    break;
                }
            }
        }
    }

    private cacheKeyElements(): void {
        for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
            this.keyElements[pitch] = document.getElementById(`key-${pitch}`)
        }
    }

    private recalculateLayout(): void {
        if (!this.app) return

        const rect = this.canvasContainer.getBoundingClientRect()
        if (this.canvasWidth === rect.width && this.canvasHeight === rect.height) return

        this.canvasWidth = rect.width
        this.canvasHeight = rect.height
        this.strikeLineY = this.canvasHeight - 4

        this.app.renderer.resize(this.canvasWidth, this.canvasHeight)

        const parent = this.canvasContainer.parentElement?.parentElement || this.canvasContainer
        const metrics = calculatePianoMetricsFromDOM(parent) || calculatePianoMetrics(this.canvasWidth)

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

    loadNotes(midi: ParsedMidi): void { this.notes = midi.notes }
    setTrackVisibility(leftHand: boolean, rightHand: boolean): void { this.leftHandActive = leftHand; this.rightHandActive = rightHand }
    setZoom(pps: number): void { this.pixelsPerSecond = pps }

    public renderFrame(): void {
        if (!this.notePool || this.notes.length === 0 || !this.app) return

        // ── Physics Time Step ──
        const isStudio = !!(window as any).__STUDIO_MODE__
        const now = isStudio
            ? ((this.playbackManager as any)._manualTime ?? 0) * 1000
            : performance.now()
        const dt = isStudio
            ? 1 / 30  // Fixed 30fps timestep for deterministic particles (matches render FPS)
            : Math.min((now - this.lastPhysicsTime) / 1000, 0.05) // Cap delta to prevent teleporting
        this.lastPhysicsTime = now

        const time = this.playbackManager.getVisualTime()
        // Prevent explosions if user is manually scrubbing the timeline slider
        const isSeeking = Math.abs(time - this.lastRenderTime) > 0.2
        this.lastRenderTime = time
        if (isSeeking) this.activeNoteIdsLastFrame.clear()

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
        this.activeColorThisFrame.fill(null)
        this.activeHexColorThisFrame.fill(0)
        this.activeLightningThisFrame.fill(0)

        // Swap FX active note tracking
        const tempIds = this.activeNoteIdsLastFrame
        this.activeNoteIdsLastFrame = this.activeNoteIdsThisFrame
        this.activeNoteIdsThisFrame = tempIds
        this.activeNoteIdsThisFrame.clear()

        const storeState = useAppStore.getState()
        const noteGlowOn = storeState.noteGlow

        const windowStart = time - 0.5
        const windowEnd = time + lookaheadSec

        const searchTime = Math.max(0, windowStart - 10.0)
        let lo = 0; let hi = notes.length
        while (lo < hi) {
            const mid = (lo + hi) >>> 1
            if (notes[mid].startTimeSec < searchTime) lo = mid + 1
            else hi = mid
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

            const item = this.notePool.acquire()
            if (!item) break

            const fullW = Math.round(this.keyW[note.pitch])
            const h = Math.max(Math.round(noteHeight), 12)
            const heatColor = velocityToColor(note.velocity)
            const active = time >= note.startTimeSec && time <= note.endTimeSec

            // ── Width scaling by velocity ──
            const velClamped = Math.max(0, Math.min(127, note.velocity))
            const velT = velClamped <= 20 ? 0 : velClamped >= 110 ? 1 : (velClamped - 20) / 90
            const velTSq = velT * velT
            const minScale = isBlackKey(note.pitch) ? 0.5 : 0.3
            const widthScale = minScale + (1 - minScale) * velTSq
            const w = Math.max(4, Math.round(fullW * widthScale))
            const baseX = Math.round(this.keyX[note.pitch]) + Math.round((fullW - w) / 2)
            const centerX = baseX + w / 2

            const borderLevel = Math.round(velTSq * (this.notePool.getBorderLevels() - 1))

            if (active) {
                this.activeThisFrame[note.pitch] = 1
                this.activeHexColorThisFrame[note.pitch] = heatColor
                const r = (heatColor >> 16) & 0xFF; const gn = (heatColor >> 8) & 0xFF; const b = heatColor & 0xFF
                this.activeColorThisFrame[note.pitch] = `rgb(${r},${gn},${b})`
                this.activeNoteIdsThisFrame.add(note.id)

                // ── Gamification: Sustained Lightning ──
                const lSprite = this.lightnings[note.pitch]
                // Only render electricity if the note is held for longer than 0.2s
                if (lSprite && noteGlowOn && note.durationSec >= 0.2 && noteTopY < strikeY) {
                    lSprite.visible = true
                    lSprite.tint = heatColor
                    lSprite.x = centerX + (Math.random() - 0.5) * 4 // Horizontal erratic jitter
                    lSprite.y = strikeY

                    const targetTop = Math.max(noteTopY, 0)
                    const lHeight = strikeY - targetTop

                    // Stop drawing lightning right as the note finishes
                    if (lHeight > 10) {
                        lSprite.height = lHeight
                        lSprite.width = w * (1.5 + Math.random() * 0.5)

                        // Rapid X-flipping to create chaotic sputtering motion
                        lSprite.scale.x = Math.random() > 0.5 ? Math.abs(lSprite.scale.x) : -Math.abs(lSprite.scale.x)
                        lSprite.alpha = 0.6 + Math.random() * 0.4

                        this.activeLightningThisFrame[note.pitch] = 1
                    }
                }
            }

            // ── Star Power Pulsating Glow ──
            const glowSprite = item.glow
            if (active && noteGlowOn) {
                // Organic math pulse (throbs 4 times a second)
                const pulse = 1.0 + Math.sin(time * 25) * 0.15
                const glowPad = 6 * pulse

                glowSprite.visible = true; glowSprite.tint = heatColor
                glowSprite.x = baseX - glowPad; glowSprite.y = noteTopY - glowPad
                glowSprite.width = w + glowPad * 2; glowSprite.height = h + glowPad * 2
                glowSprite.alpha = 0.7 + (pulse * 0.3)
            } else { glowSprite.visible = false }

            // ── Fill & Border ──
            const fillSprite = item.fill
            fillSprite.texture = this.notePool.getFillTexture(isBlackKey(note.pitch))
            fillSprite.x = baseX; fillSprite.y = noteTopY; fillSprite.width = w; fillSprite.height = h
            // Tint the fill with the velocity heat color when active
            fillSprite.tint = active ? heatColor : 0xFFFFFF

            const borderSprite = item.border
            borderSprite.texture = note.velocity >= 120 ? this.notePool.getSolidFillTexture() : this.notePool.getBorderTexture(borderLevel)
            borderSprite.tint = heatColor; borderSprite.x = baseX; borderSprite.y = noteTopY
            borderSprite.width = w; borderSprite.height = h
        }

        // ─── Gamification Hit Triggers ───
        const useVelColor = storeState.velocityKeyColor

        for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
            const wasActive = this.activeLastFrame[pitch]
            const isActive = this.activeThisFrame[pitch]

            // Cleanup inactive lightnings
            if (!this.activeLightningThisFrame[pitch] && this.lightnings[pitch]) {
                this.lightnings[pitch]!.visible = false
            }

            if (!wasActive && isActive) {
                // Key JUST hit! Trigger particle explosion.
                if (noteGlowOn && !isSeeking) {
                    const cx = Math.round(this.keyX[pitch] + this.keyW[pitch] / 2)

                    // Spawn Flame Shockwave
                    const flare = this.flares[pitch]
                    if (flare) {
                        flare.active = true
                        flare.life = 0.2
                        flare.maxLife = 0.2
                        flare.sprite.tint = this.activeHexColorThisFrame[pitch]
                        flare.sprite.x = cx
                        flare.sprite.y = strikeY
                        flare.sprite.visible = true
                    }

                    // Spawn Sparks
                    this.spawnSparks(cx, strikeY, this.activeHexColorThisFrame[pitch], this.keyW[pitch])
                }

                // HTML Key update
                const el = this.keyElements[pitch]
                if (el) {
                    el.dataset.active = 'true'
                    if (useVelColor) el.style.backgroundColor = this.activeColorThisFrame[pitch] || ''
                }
            } else if (wasActive && !isActive) {
                const el = this.keyElements[pitch]
                if (el) {
                    el.dataset.active = 'false'
                    el.style.backgroundColor = ''
                }
            }
        }

        // ─── Particle Physics Updates ───
        if (noteGlowOn && !isSeeking) {
            // Update Flares
            for (let i = 0; i < 128; i++) {
                const f = this.flares[i]
                if (f.active) {
                    f.life -= dt
                    if (f.life <= 0) {
                        f.active = false
                        f.sprite.visible = false
                    } else {
                        const t = 1 - (f.life / f.maxLife) // 0 to 1
                        f.sprite.scale.set(0.5 + t * 1.0)  // Expand outward slightly
                        f.sprite.alpha = (1 - t) * 0.8     // Fade out
                    }
                }
            }

            // Update Sparks
            for (let i = 0; i < this.sparks.length; i++) {
                const s = this.sparks[i]
                if (s.active) {
                    s.life -= dt
                    if (s.life <= 0) {
                        s.active = false
                        s.sprite.visible = false
                    } else {
                        if (s.isFlame) {
                            // Flames rise, shrink, no gravity
                            s.x += s.vx * dt;
                            s.y += s.vy * dt;
                            s.sprite.x = s.x;
                            s.sprite.y = s.y;
                            const lifeT = s.life / s.maxLife;
                            s.sprite.alpha = lifeT;
                            s.sprite.scale.set(lifeT * s.baseScale);
                        } else {
                            // Sparks fall (gravity) and drag
                            s.vy += 1200 * dt; // Heavy gravity
                            s.vx *= (1 - 3 * dt); // Air drag
                            s.x += s.vx * dt;
                            s.y += s.vy * dt;
                            s.sprite.x = s.x;
                            s.sprite.y = s.y;
                            // Make the line sprite face its velocity vector
                            s.sprite.rotation = Math.atan2(s.vy, s.vx) + Math.PI / 2;
                            s.sprite.alpha = s.life / s.maxLife;
                        }
                    }
                }
            }
        } else if (isSeeking || !noteGlowOn) {
            // Immediately hide all particles if seeking or glow toggled off
            for (const f of this.flares) { f.active = false; f.sprite.visible = false }
            for (const s of this.sparks) { s.active = false; s.sprite.visible = false }
        }

        this.frameCount++
        const perfNow = performance.now()
        if (perfNow - this.lastFpsTime >= 2000) {
            this.frameCount = 0
            this.lastFpsTime = perfNow
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
            if (el) {
                el.dataset.active = 'false'
                el.style.backgroundColor = ''
            }
        }

        if (this.effectsContainer) {
            this.effectsContainer.destroy({ children: true })
            this.effectsContainer = null
        }
        this.flares = []
        this.sparks = []
        this.lightnings = []
        this.activeNoteIdsThisFrame.clear()
        this.activeNoteIdsLastFrame.clear()

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
