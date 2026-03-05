/**
 * NotePool — Pre-Baked Texture Atlas + Sprite Pool (Zero GC, Zero Per-Frame Geometry)
 *
 * Bakes RenderTextures at init time, then pools reusable Container objects
 * with Sprites. Per-frame render only swaps textures and sets tint/position.
 */

import { Container, Sprite, Graphics, Texture } from 'pixi.js'
import type { Application } from 'pixi.js'

/** Returned by acquire() — the renderer sets properties on these sprites */
export interface NoteItem {
    container: Container
    glow: Sprite
    fill: Sprite
    border: Sprite
}

/** Number of discrete border thickness levels (0 = thinnest, 9 = thickest outline) */
const BORDER_LEVELS = 10
/** Base texture resolution for baking */
const TEX_W = 32
const TEX_H = 64
const TEX_RADIUS = 4

export class NotePool {
    private pool: NoteItem[] = []
    private activeCount = 0
    private rootContainer: Container

    // Base Textures
    private fillWhiteTex: Texture = Texture.EMPTY
    private fillBlackTex: Texture = Texture.EMPTY
    private solidFillTex: Texture = Texture.EMPTY
    private glowTex: Texture = Texture.EMPTY
    private borderTextures: Texture[] = []

    // ── NEW: Gamification Textures ──
    private flareTex: Texture = Texture.EMPTY
    private sparkTex: Texture = Texture.EMPTY
    private particleTex: Texture = Texture.EMPTY
    private lightningTex: Texture = Texture.EMPTY

    constructor(
        private app: Application,
        private poolSize: number = 1500
    ) {
        this.rootContainer = new Container()
        this.rootContainer.label = 'note-pool'
        this.app.stage.addChild(this.rootContainer)
    }

    async init(): Promise<void> {
        this.bakeTextures()
        this.allocatePool()
        console.log(
            `[SynthUI] NotePool initialized: ${this.poolSize} sprite containers, ` +
            `${BORDER_LEVELS + 8} pre-baked textures`
        )
    }

    private bakeTextures(): void {
        const renderer = this.app.renderer
        const g = new Graphics()

        // ── Fill textures (white / black solid rounded rect) ──
        g.clear()
        g.roundRect(0, 0, TEX_W, TEX_H, TEX_RADIUS)
        g.fill({ color: 0xFFFFFF, alpha: 1.0 })
        this.fillWhiteTex = renderer.generateTexture(g)

        g.clear()
        g.roundRect(0, 0, TEX_W, TEX_H, TEX_RADIUS)
        g.fill({ color: 0x000000, alpha: 1.0 })
        this.fillBlackTex = renderer.generateTexture(g)

        // ── Solid fill texture (for vel ≥ 120, fully opaque white — tinted at runtime) ──
        g.clear()
        g.roundRect(0, 0, TEX_W, TEX_H, TEX_RADIUS)
        g.fill({ color: 0xFFFFFF, alpha: 1.0 })
        this.solidFillTex = renderer.generateTexture(g)

        // ── Border textures at 10 thickness levels (white stroke, tinted at runtime) ──
        const maxThickness = Math.min(TEX_W, TEX_H) / 2
        for (let level = 0; level < BORDER_LEVELS; level++) {
            const t = level / (BORDER_LEVELS - 1) // 0..1
            const thickness = 1 + t * (maxThickness - 1)

            g.clear()
            g.roundRect(0, 0, TEX_W, TEX_H, TEX_RADIUS)
            g.stroke({ color: 0xFFFFFF, width: thickness, alignment: 1, alpha: 1.0 })
            this.borderTextures.push(renderer.generateTexture(g))
        }

        // ── Glow texture (larger padded rounded rect, semi-transparent) ──
        const glowPad = 6
        g.clear()
        // Outer glow layer
        g.roundRect(0, 0, TEX_W + glowPad * 2, TEX_H + glowPad * 2, TEX_RADIUS + 4)
        g.fill({ color: 0xFFFFFF, alpha: 0.15 })
        // Inner glow layer
        g.roundRect(glowPad / 2, glowPad / 2, TEX_W + glowPad, TEX_H + glowPad, TEX_RADIUS + 2)
        g.fill({ color: 0xFFFFFF, alpha: 0.2 })
        this.glowTex = renderer.generateTexture(g)

        // ── NEW: Flare Texture (Radial Flame Glow) ──
        g.clear()
        for (let r = 40; r > 0; r -= 4) {
            g.circle(40, 40, r)
            g.fill({ color: 0xFFFFFF, alpha: 0.08 })
        }
        this.flareTex = renderer.generateTexture(g)

        // ── NEW: Particle Texture (Soft round flame/spark) ──
        g.clear()
        g.circle(8, 8, 8); g.fill({ color: 0xFFFFFF, alpha: 0.2 })
        g.circle(8, 8, 4); g.fill({ color: 0xFFFFFF, alpha: 1.0 })
        this.particleTex = renderer.generateTexture(g)

        // ── NEW: Spark Texture (Short line) ──
        g.clear()
        g.roundRect(0, 0, 3, 12, 1.5)
        g.fill({ color: 0xFFFFFF, alpha: 1.0 })
        this.sparkTex = renderer.generateTexture(g)

        // ── NEW: Lightning Texture (Jagged Electricity) ──
        g.clear()
        g.moveTo(16, 0); g.lineTo(24, 16); g.lineTo(8, 32); g.lineTo(26, 48); g.lineTo(16, 64)
        g.stroke({ color: 0xFFFFFF, width: 2, alpha: 1.0 })
        // Outer electrical glow
        g.moveTo(16, 0); g.lineTo(24, 16); g.lineTo(8, 32); g.lineTo(26, 48); g.lineTo(16, 64)
        g.stroke({ color: 0xFFFFFF, width: 8, alpha: 0.4 })
        this.lightningTex = renderer.generateTexture(g)

        // Dispose the temporary Graphics
        g.destroy()
    }

    private allocatePool(): void {
        for (let i = 0; i < this.poolSize; i++) {
            const container = new Container()
            container.visible = false
            container.label = `note-${i}`

            // Glow sprite — behind everything, wider/taller than note
            const glow = new Sprite(this.glowTex)
            glow.visible = false
            glow.label = 'glow'
            container.addChild(glow)

            // Fill sprite — white or black base
            const fill = new Sprite(this.fillWhiteTex)
            fill.label = 'fill'
            container.addChild(fill)

            // Border sprite — tinted with velocity color
            const border = new Sprite(this.borderTextures[0])
            border.label = 'border'
            container.addChild(border)

            this.rootContainer.addChild(container)
            this.pool.push({ container, glow, fill, border })
        }
    }

    acquire(): NoteItem | null {
        if (this.activeCount >= this.poolSize) return null
        const item = this.pool[this.activeCount]
        item.container.visible = true
        this.activeCount++
        return item
    }

    releaseAll(): void {
        for (let i = 0; i < this.activeCount; i++) {
            const item = this.pool[i]
            item.container.visible = false
            item.glow.visible = false
        }
        this.activeCount = 0
    }

    // ── Texture accessors for the renderer ──
    getFillTexture(isBlack: boolean): Texture {
        return isBlack ? this.fillBlackTex : this.fillWhiteTex
    }

    getBorderTexture(level: number): Texture {
        const idx = Math.max(0, Math.min(BORDER_LEVELS - 1, level))
        return this.borderTextures[idx]
    }

    getSolidFillTexture(): Texture {
        return this.solidFillTex
    }

    getGlowTexture(): Texture {
        return this.glowTex
    }

    getBorderLevels(): number {
        return BORDER_LEVELS
    }

    getContainer(): Container {
        return this.rootContainer
    }

    // FX Accessors
    getFlareTexture(): Texture { return this.flareTex }
    getSparkTexture(): Texture { return this.sparkTex }
    getParticleTexture(): Texture { return this.particleTex }
    getLightningTexture(): Texture { return this.lightningTex }

    destroy(): void {
        this.fillWhiteTex.destroy(true)
        this.fillBlackTex.destroy(true)
        this.solidFillTex.destroy(true)
        this.glowTex.destroy(true)
        this.flareTex.destroy(true)
        this.sparkTex.destroy(true)
        this.particleTex.destroy(true)
        this.lightningTex.destroy(true)
        for (const tex of this.borderTextures) tex.destroy(true)
        this.borderTextures = []
        this.rootContainer.destroy({ children: true })
    }
}
