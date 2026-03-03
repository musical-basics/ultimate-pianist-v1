// lib/score/IntermediateScore.ts

/**
 * IntermediateScore serves as the bridge between OSMD's MusicXML parser
 * and our custom VexFlow rendering engine.
 */
export interface IntermediateScore {
    title?: string;
    measures: IntermediateMeasure[];
}

export interface IntermediateMeasure {
    /** 1-indexed measure number */
    measureNumber: number;

    /** Top number of the time signature (e.g., 3 for 3/4 time). Only present if it changes. */
    timeSignatureNumerator?: number;
    /** Bottom number of the time signature (e.g., 4 for 3/4 time). Only present if it changes. */
    timeSignatureDenominator?: number;

    /** VexFlow formatted key signature (e.g., 'G', 'Fm', 'C'). Only present if it changes. */
    keySignature?: string;

    /** Typically 2 staves for piano: 0 for Treble (Right Hand), 1 for Bass (Left Hand) */
    staves: IntermediateStaff[];
}

export interface IntermediateStaff {
    /** 0 for upper staff, 1 for lower staff */
    staffIndex: number;

    /** 'treble' or 'bass'. Only present if it changes in this measure for this staff. */
    clef?: 'treble' | 'bass';

    /** Multiple voices handle complex rhythms on the same staff (e.g., holding a half note while playing quarters) */
    voices: IntermediateVoice[];
}

export interface IntermediateVoice {
    voiceIndex: number;
    notes: IntermediateNote[];
}

export interface IntermediateNote {
    /**
     * VexFlow keys array: e.g., ["c/4", "e/4", "g/4"] for a C major chord.
     * Rests must include a nominal key, e.g., ["b/4"] for a treble rest.
     */
    keys: string[];

    /**
     * VexFlow duration string: 'w', 'h', 'q', '8', '16', '32'.
     * Append 'r' for rests: 'qr', '8r'.
     * Append 'd' for dotted notes: 'qd' (VexFlow requires the dot in the duration string for bounding box calculations).
     */
    duration: string;

    /** Number of dots applied to this note/chord */
    dots: number;

    isRest: boolean;

    /**
     * Array of accidental strings matching the length of `keys`.
     * Use null for keys that don't need an accidental drawn.
     * e.g., ["b", null, "#"]
     */
    accidentals: (string | null)[];

    /**
     * Array of ties matching the length of `keys`.
     * True if this specific note in the chord is tied to the NEXT note.
     */
    tiesToNext: boolean[];

    /**
     * VexFlow articulation codes.
     * e.g., 'a.' for staccato, 'a@a' for fermata, 'a>' for accent.
     */
    articulations: string[];

    /**
     * The exact musical beat this note lands on (1-indexed).
     * CRITICAL: We need this to pass directly to `beatXMap` so your
     * Echolocation/V5 algorithm can map audio time directly to pixel X-coordinates.
     */
    beat: number;

    /**
     * A unique ID generated during the OSMD parsing phase.
     * VexFlow must apply this ID to the rendered SVG group:
     * `note.setAttribute('id', vfId)`
     */
    vfId: string;
}
