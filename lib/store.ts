import { create } from 'zustand'
import type { ParsedMidi, Anchor, BeatAnchor, SongConfig } from './types'

// ─── Store Interface ───────────────────────────────────────────────
// CRITICAL: currentTime and animation frame data are NEVER stored here.
// They live in PlaybackManager (polled by PixiJS Ticker) to avoid
// React re-rendering 60+ times per second.

export type AppMode = 'PLAYBACK' | 'RECORD'

interface AppStore {
    // === Synth State ===
    isPlaying: boolean
    tempo: number // percentage (50-200), default 100
    leftHandActive: boolean
    rightHandActive: boolean
    parsedMidi: ParsedMidi | null
    songTitle: string
    duration: number // total song duration in seconds
    zoomLevel: number // pixels per second for waterfall
    velocityKeyColor: boolean // true = keys match note color, false = default purple

    // === Score Follower State ===
    anchors: Anchor[]
    beatAnchors: BeatAnchor[]
    revealMode: 'OFF' | 'NOTE' | 'CURTAIN'
    darkMode: boolean
    highlightNote: boolean
    glowEffect: boolean
    popEffect: boolean
    jumpEffect: boolean
    previewEffects: boolean
    isLocked: boolean
    cursorPosition: number
    curtainLookahead: number
    showCursor: boolean
    isLevel2Mode: boolean
    subdivision: number
    currentMeasure: number
    mode: AppMode

    // === Active Configuration ===
    activeConfig: SongConfig | null

    // === Synth Actions ===
    setPlaying: (playing: boolean) => void
    setTempo: (tempo: number) => void
    toggleLeftHand: () => void
    toggleRightHand: () => void
    loadMidi: (midi: ParsedMidi) => void
    clearMidi: () => void
    setZoomLevel: (zoom: number) => void
    setVelocityKeyColor: (on: boolean) => void

    // === Score Follower Actions ===
    setAnchors: (anchors: Anchor[]) => void
    setBeatAnchors: (beatAnchors: BeatAnchor[] | ((prev: BeatAnchor[]) => BeatAnchor[])) => void
    setRevealMode: (mode: 'OFF' | 'NOTE' | 'CURTAIN') => void
    setDarkMode: (dark: boolean) => void
    setHighlightNote: (highlight: boolean) => void
    setGlowEffect: (glow: boolean) => void
    setPopEffect: (pop: boolean) => void
    setJumpEffect: (jump: boolean) => void
    setPreviewEffects: (preview: boolean) => void
    setIsLocked: (locked: boolean) => void
    setCursorPosition: (pos: number) => void
    setCurtainLookahead: (lookahead: number) => void
    setShowCursor: (show: boolean) => void
    setIsLevel2Mode: (level2: boolean) => void
    setSubdivision: (sub: number) => void
    setCurrentMeasure: (measure: number) => void
    setMode: (mode: AppMode) => void

    // === Config Actions ===
    setActiveConfig: (config: SongConfig | null) => void
}

export const useAppStore = create<AppStore>((set) => ({
    // === Synth Initial State ===
    isPlaying: false,
    tempo: 100,
    leftHandActive: true,
    rightHandActive: true,
    parsedMidi: null,
    songTitle: '',
    duration: 0,
    zoomLevel: 200,
    velocityKeyColor: false,

    // === Score Follower Initial State ===
    anchors: [{ measure: 1, time: 0 }],
    beatAnchors: [],
    revealMode: 'OFF',
    darkMode: false,
    highlightNote: true,
    glowEffect: true,
    popEffect: false,
    jumpEffect: true,
    previewEffects: false,
    isLocked: true,
    cursorPosition: 0.2,
    curtainLookahead: 0.25,
    showCursor: true,
    isLevel2Mode: false,
    subdivision: 4,
    currentMeasure: 1,
    mode: 'PLAYBACK',

    // === Active Configuration ===
    activeConfig: null,

    // === Synth Actions ===
    setPlaying: (playing) => set({ isPlaying: playing }),
    setTempo: (tempo) => set({ tempo }),
    toggleLeftHand: () => set((s) => ({ leftHandActive: !s.leftHandActive })),
    toggleRightHand: () => set((s) => ({ rightHandActive: !s.rightHandActive })),
    loadMidi: (midi) =>
        set({
            parsedMidi: midi,
            songTitle: midi.name,
            duration: midi.durationSec,
        }),
    clearMidi: () =>
        set({
            parsedMidi: null,
            songTitle: '',
            duration: 0,
            isPlaying: false,
        }),
    setZoomLevel: (zoom) => set({ zoomLevel: zoom }),
    setVelocityKeyColor: (velocityKeyColor) => set({ velocityKeyColor }),

    // === Score Follower Actions ===
    setAnchors: (anchors) => set({ anchors }),
    setBeatAnchors: (beatAnchors) => set((s) => ({ beatAnchors: typeof beatAnchors === 'function' ? beatAnchors(s.beatAnchors) : beatAnchors })),
    setRevealMode: (revealMode) => set({ revealMode }),
    setDarkMode: (darkMode) => set({ darkMode }),
    setHighlightNote: (highlightNote) => set({ highlightNote }),
    setGlowEffect: (glowEffect) => set({ glowEffect }),
    setPopEffect: (popEffect) => set({ popEffect }),
    setJumpEffect: (jumpEffect) => set({ jumpEffect }),
    setPreviewEffects: (previewEffects) => set({ previewEffects }),
    setIsLocked: (isLocked) => set({ isLocked }),
    setCursorPosition: (cursorPosition) => set({ cursorPosition }),
    setCurtainLookahead: (curtainLookahead) => set({ curtainLookahead }),
    setShowCursor: (showCursor) => set({ showCursor }),
    setIsLevel2Mode: (isLevel2Mode) => set({ isLevel2Mode }),
    setSubdivision: (subdivision) => set({ subdivision }),
    setCurrentMeasure: (currentMeasure) => set({ currentMeasure }),
    setMode: (mode) => set({ mode }),

    // === Config Actions ===
    setActiveConfig: (activeConfig) => set({ activeConfig }),
}))

// Legacy alias for synth-only components
export const useSynthStore = useAppStore
