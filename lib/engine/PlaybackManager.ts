/**
 * PlaybackManager — Master Clock (Singleton, outside React)
 *
 * CRITICAL DESIGN RULES:
 * 1. This class is NEVER stored in React state
 * 2. getTime() = audio-driven (for AudioSynth scheduling, authoritative)
 * 3. getVisualTime() = performance.now()-driven with soft-sync to audio clock
 * 4. AudioContext is only created/resumed on user interaction (autoplay policy)
 * 5. When an HTMLAudioElement is set, it becomes the master clock source
 */

type PlaybackListener = (time: number, isPlaying: boolean) => void

export class PlaybackManager {
    private audioContext: AudioContext | null = null
    private _isPlaying = false

    // ─── Studio Mode: Deterministic Clock Override ────────────────
    private _manualTime: number | null = null
    private _studioMode = false

    /** Set a manual time value that overrides all clock sources. */
    setManualTime(t: number): void {
        this._manualTime = t
    }

    /** Enable/disable studio mode (used by render-view route). */
    setStudioMode(enabled: boolean): void {
        this._studioMode = enabled
    }

    get studioMode(): boolean {
        return this._studioMode
    }

    private _songPosition = 0
    private _playStartedAtCtx = 0
    private _playbackRate = 1.0

    private _visualTime = 0
    private _lastVisualTick = 0

    private _duration = 0

    // Master audio element (WAV) — when set, this is the authoritative clock
    private _audioElement: HTMLAudioElement | null = null

    private listeners: Set<PlaybackListener> = new Set()

    // ─── AudioContext Management ──────────────────────────────────

    getAudioContext(): AudioContext {
        if (!this.audioContext) {
            this.audioContext = new AudioContext()
        }
        return this.audioContext
    }

    async ensureResumed(): Promise<void> {
        const ctx = this.getAudioContext()
        if (ctx.state === 'suspended') {
            await ctx.resume()
        }
    }

    // ─── Audio Element (Master WAV Clock) ─────────────────────────

    /**
     * Set an HTML audio element as the master clock.
     * When set, getTime() and getVisualTime() return the audio element's currentTime.
     */
    setAudioElement(el: HTMLAudioElement | null): void {
        this._audioElement = el
    }

    get audioElement(): HTMLAudioElement | null {
        return this._audioElement
    }

    // ─── Playback Control ─────────────────────────────────────────

    get isPlaying(): boolean {
        if (this._audioElement) {
            return !this._audioElement.paused
        }
        return this._isPlaying
    }

    get duration(): number {
        return this._duration
    }

    set duration(d: number) {
        this._duration = d
    }

    get playbackRate(): number {
        return this._playbackRate
    }

    /**
     * Get the current logical playback time in seconds.
     * If an audio element is set, returns its currentTime (master clock).
     */
    getTime(): number {
        // Studio mode: deterministic manual clock
        if (this._manualTime !== null) return this._manualTime

        if (this._audioElement) {
            return this._audioElement.currentTime
        }

        if (!this._isPlaying || !this.audioContext) {
            return this._songPosition
        }

        const elapsed = (this.audioContext.currentTime - this._playStartedAtCtx) * this._playbackRate
        const t = this._songPosition + elapsed

        if (t >= this._duration) {
            this._songPosition = this._duration
            this._isPlaying = false
            this.notifyListeners()
            return this._duration
        }

        return t
    }

    /**
     * Get smooth visual playback time for the PixiJS renderer.
     * If an audio element is set, returns its currentTime directly.
     */
    getVisualTime(): number {
        // Studio mode: deterministic manual clock
        if (this._manualTime !== null) return this._manualTime

        if (this._audioElement) {
            return this._audioElement.currentTime
        }

        if (!this._isPlaying || !this.audioContext) {
            return this._songPosition
        }

        const audioElapsed = (this.audioContext.currentTime - this._playStartedAtCtx) * this._playbackRate
        const trueAudioTime = this._songPosition + audioElapsed

        const now = performance.now()
        const deltaSec = (now - this._lastVisualTick) / 1000
        this._lastVisualTick = now
        this._visualTime += deltaSec * this._playbackRate

        const drift = trueAudioTime - this._visualTime
        if (Math.abs(drift) > 0.05) {
            this._visualTime = trueAudioTime
        } else {
            this._visualTime += drift * 0.01
        }

        if (this._visualTime >= this._duration) return this._duration
        return this._visualTime
    }

    async play(): Promise<void> {
        if (this._audioElement) {
            await this._audioElement.play()
            this.notifyListeners()
            return
        }

        if (this._isPlaying) return
        await this.ensureResumed()
        const ctx = this.getAudioContext()
        this._playStartedAtCtx = ctx.currentTime
        this._lastVisualTick = performance.now()
        this._visualTime = this._songPosition
        this._isPlaying = true
        this.notifyListeners()
    }

    pause(): void {
        if (this._audioElement) {
            this._audioElement.pause()
            this.notifyListeners()
            return
        }

        if (!this._isPlaying) return
        this._songPosition = this.getTime()
        this._visualTime = this._songPosition
        this._isPlaying = false
        this.notifyListeners()
    }

    stop(): void {
        if (this._audioElement) {
            this._audioElement.pause()
            this._audioElement.currentTime = 0
            this.notifyListeners()
            return
        }

        this._songPosition = 0
        this._visualTime = 0
        this._isPlaying = false
        this.notifyListeners()
    }

    seek(timeSec: number): void {
        if (this._audioElement) {
            this._audioElement.currentTime = Math.max(0, Math.min(timeSec, this._duration))
            this.notifyListeners()
            return
        }

        const wasPlaying = this._isPlaying
        this._songPosition = Math.max(0, Math.min(timeSec, this._duration))

        if (wasPlaying && this.audioContext) {
            this._playStartedAtCtx = this.audioContext.currentTime
            this._lastVisualTick = performance.now()
        }
        this._visualTime = this._songPosition
        this.notifyListeners()
    }

    setPlaybackRate(rate: number): void {
        if (this._audioElement) {
            this._audioElement.playbackRate = rate
        }

        if (this._isPlaying) {
            this._songPosition = this.getTime()
            if (this.audioContext) {
                this._playStartedAtCtx = this.audioContext.currentTime
            }
            this._lastVisualTick = performance.now()
            this._visualTime = this._songPosition
        }
        this._playbackRate = rate
    }

    // ─── Listeners ────────────────────────────────────────────────

    addListener(fn: PlaybackListener): () => void {
        this.listeners.add(fn)
        return () => this.listeners.delete(fn)
    }

    private notifyListeners(): void {
        const time = this.getTime()
        for (const fn of this.listeners) {
            fn(time, this.isPlaying)
        }
    }

    // ─── Cleanup ──────────────────────────────────────────────────

    private _visibilityHandler: (() => void) | null = null

    /** Auto-pause when app goes to background (prevents iOS WebGL/Audio context crash) */
    setupVisibilityHandler(): void {
        if (this._visibilityHandler) return
        this._visibilityHandler = () => {
            if (document.hidden && this.isPlaying) {
                console.log('[PlaybackManager] App backgrounded — auto-pausing')
                this.pause()
            }
        }
        document.addEventListener('visibilitychange', this._visibilityHandler)
    }

    async destroy(): Promise<void> {
        this._isPlaying = false
        this._audioElement = null
        this.listeners.clear()
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler)
            this._visibilityHandler = null
        }
        if (this.audioContext) {
            await this.audioContext.close()
            this.audioContext = null
        }
    }
}

// ─── Singleton ──────────────────────────────────────────────────

let _instance: PlaybackManager | null = null

export function getPlaybackManager(): PlaybackManager {
    if (!_instance) {
        _instance = new PlaybackManager()
        if (typeof document !== 'undefined') _instance.setupVisibilityHandler()
    }
    return _instance
}

export function destroyPlaybackManager(): void {
    if (_instance) {
        _instance.destroy()
        _instance = null
    }
}
