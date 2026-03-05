/**
 * NotePool — Object Pool for PixiJS Graphics (Zero GC)
 *
 * Pools reusable Graphics objects for dynamic per-frame drawing.
 * Each frame, the renderer clears and redraws each Graphics with
 * the appropriate color, fill, and inner stroke.
 */

import { Container, Graphics } from 'pixi.js'
import type { Application } from 'pixi.js'

export class NotePool {
    private pool: Graphics[] = []
    private activeCount = 0
    private rootContainer: Container

    constructor(
        private app: Application,
        private poolSize: number = 1500
    ) {
        this.rootContainer = new Container()
        this.rootContainer.label = 'note-pool'
        this.app.stage.addChild(this.rootContainer)
    }

    async init(): Promise<void> {
        for (let i = 0; i < this.poolSize; i++) {
            const g = new Graphics()
            g.visible = false
            g.label = `note-${i}`
            this.rootContainer.addChild(g)
            this.pool.push(g)
        }
        console.log(`[SynthUI] NotePool initialized: ${this.poolSize} Graphics objects pre-allocated`)
    }

    acquire(): Graphics | null {
        if (this.activeCount >= this.poolSize) return null
        const g = this.pool[this.activeCount]
        g.visible = true
        this.activeCount++
        return g
    }

    releaseAll(): void {
        for (let i = 0; i < this.activeCount; i++) {
            this.pool[i].visible = false
            this.pool[i].clear()
        }
        this.activeCount = 0
    }

    getContainer(): Container {
        return this.rootContainer
    }

    destroy(): void {
        this.rootContainer.destroy({ children: true })
    }
}
