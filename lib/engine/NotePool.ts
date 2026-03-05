/**
 * NotePool — Object Pool for Composite PixiJS Note Items (Zero GC)
 *
 * Each pool item is a Container holding two Sprites:
 *   - fill:   solid rounded rect (opacity varies by velocity for density)
 *   - border: stroke-only rounded rect (stays opaque so outlines are always visible)
 */

import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js'
import type { Application } from 'pixi.js'

export interface NoteItem {
    container: Container
    fill: Sprite
    border: Sprite
}

export class NotePool {
    private pool: NoteItem[] = []
    private activeCount = 0
    private rootContainer: Container
    private fillTexture: RenderTexture | null = null
    private borderTexture: RenderTexture | null = null

    constructor(
        private app: Application,
        private poolSize: number = 1500
    ) {
        this.rootContainer = new Container()
        this.rootContainer.label = 'note-pool'
        this.app.stage.addChild(this.rootContainer)
    }

    async init(): Promise<void> {
        this.fillTexture = this.bakeFillTexture()
        this.borderTexture = this.bakeBorderTexture()

        for (let i = 0; i < this.poolSize; i++) {
            const container = new Container()
            container.visible = false
            container.label = `note-${i}`

            const fill = new Sprite(this.fillTexture)
            fill.label = 'fill'

            const border = new Sprite(this.borderTexture)
            border.label = 'border'

            container.addChild(fill)
            container.addChild(border)
            this.rootContainer.addChild(container)

            this.pool.push({ container, fill, border })
        }
        console.log(`[SynthUI] NotePool initialized: ${this.poolSize} composite items pre-allocated`)
    }

    /** Solid white rounded rect — no stroke */
    private bakeFillTexture(): RenderTexture {
        const width = 64
        const height = 64
        const radius = 6

        const g = new Graphics()
        g.roundRect(0, 0, width, height, radius)
        g.fill({ color: 0xFFFFFF, alpha: 1.0 })

        const texture = RenderTexture.create({ width, height })
        this.app.renderer.render({ container: g, target: texture })
        g.destroy()

        return texture
    }

    /** Transparent center with white stroke outline */
    private bakeBorderTexture(): RenderTexture {
        const width = 64
        const height = 64
        const radius = 6
        const strokeWidth = 2

        const g = new Graphics()
        g.roundRect(strokeWidth / 2, strokeWidth / 2, width - strokeWidth, height - strokeWidth, radius)
        g.stroke({ color: 0xFFFFFF, width: strokeWidth, alpha: 1.0 })

        const texture = RenderTexture.create({ width, height })
        this.app.renderer.render({ container: g, target: texture })
        g.destroy()

        return texture
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
            this.pool[i].container.visible = false
        }
        this.activeCount = 0
    }

    getContainer(): Container {
        return this.rootContainer
    }

    destroy(): void {
        this.rootContainer.destroy({ children: true })
        if (this.fillTexture) {
            this.fillTexture.destroy(true)
            this.fillTexture = null
        }
        if (this.borderTexture) {
            this.borderTexture.destroy(true)
            this.borderTexture = null
        }
    }
}
