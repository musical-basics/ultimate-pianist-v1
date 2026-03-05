/**
 * NotePool — Pre-Baked Texture Atlas + Sprite Pool (Zero GC, Zero Per-Frame Geometry)
 *
 * Bakes 14 RenderTextures at init time, then pools reusable Container objects
 * with 3 child Sprites (glow, fill, border). Per-frame render only swaps
 * textures and sets tint/position — no Graphics.clear() or path rebuilding.
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

    // Pre-baked textures
    private fillWhiteTex: Texture = Texture.EMPTY
    private fillBlackTex: Texture = Texture.EMPTY
    private solidFillTex: Texture = Texture.EMPTY
    private glowTex: Texture = Texture.EMPTY
    private borderTextures: Texture[] = []

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
            `${BORDER_LEVELS + 4} pre-baked textures`
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

    destroy(): void {
        // Destroy pre-baked textures
        this.fillWhiteTex.destroy(true)
        this.fillBlackTex.destroy(true)
        this.solidFillTex.destroy(true)
        this.glowTex.destroy(true)
        for (const tex of this.borderTextures) tex.destroy(true)
        this.borderTextures = []

        this.rootContainer.destroy({ children: true })
    }
}
