// TypeScript interfaces for Ultimate Pianist
// Merged types from Synth + Score Follower

// ─── MIDI Data Types ───────────────────────────────────────────────

/** A single normalized MIDI note event with absolute timing */
export interface NoteEvent {
    id: string
    /** MIDI pitch: 21 (A0) to 108 (C8) */
    pitch: number
    /** Absolute start time in seconds */
    startTimeSec: number
    /** Absolute end time in seconds */
    endTimeSec: number
    /** Duration in seconds */
    durationSec: number
    /** Note velocity (0-127) */
    velocity: number
    /** Track index from MIDI file */
    trackId: number
}

/** Parsed MIDI file data */
export interface ParsedMidi {
    /** Song/file name */
    name: string
    /** Total duration in seconds */
    durationSec: number
    /** Flattened, sorted (by startTimeSec) note events */
    notes: NoteEvent[]
    /** Number of tracks */
    trackCount: number
    /** Tempo map entries */
    tempoChanges: { time: number; bpm: number }[]
}

// ─── Score Follower Types ──────────────────────────────────────────

/** A measure-level anchor mapping absolute time to a measure number */
export interface Anchor {
    measure: number
    time: number
}

/** A beat-level anchor mapping absolute time to a measure + beat */
export interface BeatAnchor {
    measure: number
    beat: number
    time: number
}

/** An exact rhythmic event extracted from MusicXML */
export interface XMLEvent {
    measure: number
    beat: number
    /** Cumulative beat position from start of piece (for beatsElapsed calc across measures) */
    globalBeat: number
    /** MIDI pitch numbers expected at this beat (e.g. [57, 64] for A3+E4 chord) */
    pitches: number[]
    /** Smallest note duration in quarter-note fractions (1=quarter, 0.5=eighth, 0.25=16th, 0.125=32nd) */
    smallestDuration: number
    /** Whether this beat has a fermata marking */
    hasFermata?: boolean
}

/** Interactive V5 mapper state machine */
export interface V5MapperState {
    status: 'idle' | 'running' | 'paused' | 'done'
    /** How far through the xmlEvents array we've mapped */
    currentEventIndex: number
    /** Confirmed anchors so far */
    anchors: Anchor[]
    beatAnchors: BeatAnchor[]
    /** Ghost anchor placed when a match fails — user must confirm/adjust */
    ghostAnchor: { measure: number; beat: number; time: number } | null
    /** Current average quarter-note time length in seconds */
    aqntl: number
    /** MIDI cursor position (index into sorted notes) */
    midiCursor: number
    /** User-chosen chord cluster threshold fraction (default 0.0625 = 64th note) */
    chordThresholdFraction: number
    /** Time of last confirmed anchor in seconds */
    lastAnchorTime: number
    /** Global beat of last confirmed anchor */
    lastAnchorGlobalBeat: number
    /** Recent event outcomes for runaway detection */
    recentOutcomes: ('match' | 'dead-reckon' | 'stray')[]
    /** Consecutive non-match count — after 3+ triggers fresh scanning mode */
    consecutiveMisses: number
    /** Whether we just passed a fermata beat and need fresh scanning */
    afterFermata?: boolean
}

/** A full song configuration (stored in DB) */
export interface SongConfig {
    id: string
    title: string
    audio_url: string
    xml_url: string
    midi_url?: string | null
    anchors: Anchor[]
    beat_anchors?: BeatAnchor[] | null
    subdivision?: number | null
    is_level2?: boolean | null
    is_published?: boolean
    music_font?: string | null
    // AI Anchor Mapping (stores Gemini's initial predictions)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ai_anchors?: any[] | null
    created_at: string
    updated_at: string
}

// ─── UI Component Props ────────────────────────────────────────────

export interface AppState {
    isPlaying: boolean
    currentTime: number
    duration: number
    tempo: number
    leftHandActive: boolean
    rightHandActive: boolean
    songTitle: string
}

export interface PianoKeyProps {
    noteNumber: number
    isBlack: boolean
    leftOffset?: number
}

export interface TransportBarProps {
    isPlaying: boolean
    currentTime: number
    duration: number
    tempo: number
    volume: number
    leftHandActive: boolean
    rightHandActive: boolean
    onPlayPause: () => void
    onStop: () => void
    onStepBackward: () => void
    onTimeChange: (time: number) => void
    onTempoChange: (tempo: number) => void
    onVolumeChange: (volume: number) => void
    onLeftHandToggle: () => void
    onRightHandToggle: () => void
}

export interface ToolbarProps {
    songTitle: string
    onLoadMidi: () => void
    onOpenSettings: () => void
}
