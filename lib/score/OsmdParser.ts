// lib/score/OsmdParser.ts
//
// Headless OSMD parser — loads MusicXML, produces:
//   1. XMLEvent[] (the exact data contract for AutoMapper / AutoMapperV5)
//   2. IntermediateScore (the bridge to VexFlow rendering)
//
// This file NEVER touches the visible DOM. OSMD renders to a hidden off-screen div.

import { OpenSheetMusicDisplay as OSMD } from 'opensheetmusicdisplay'
import type { XMLEvent } from '@/lib/types'
import type {
    IntermediateScore,
    IntermediateMeasure,
    IntermediateStaff,
    IntermediateVoice,
    IntermediateNote,
} from './IntermediateScore'

// ─── OSMD internal type aliases (untyped) ──────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OsmdAny = any

// ─── Helpers ───────────────────────────────────────────────────────

/** OSMD FundamentalNote enum → VexFlow note letter */
const FUNDAMENTAL_TO_LETTER: Record<number, string> = {
    0: 'c', 1: 'd', 2: 'e', 3: 'f', 4: 'g', 5: 'a', 6: 'b',
}

/** OSMD AccidentalEnum → VexFlow accidental string */
const ACCIDENTAL_TO_VF: Record<number, string> = {
    // OSMD enum: -2=bb, -1=b, 0=none, 1=#, 2=##
    [-2]: 'bb',
    [-1]: 'b',
    0: '',      // natural — we still may need 'n' if explicit
    1: '#',
    2: '##',
}

/** Convert OSMD note length (in whole-note fractions) to VexFlow duration string */
function realValueToDuration(realValue: number): { duration: string; dots: number } {
    // RealValue is fraction of a whole note: 1 = whole, 0.5 = half, 0.25 = quarter, etc.
    // Check dotted values first (from longest to shortest)
    const lookup: [number, string, number][] = [
        [1.5, 'w', 1],   // dotted whole
        [1.0, 'w', 0],   // whole
        [0.75, 'h', 1],   // dotted half
        [0.5, 'h', 0],   // half
        [0.375, 'q', 1],   // dotted quarter
        [0.25, 'q', 0],   // quarter
        [0.1875, '8', 1],   // dotted eighth
        [0.125, '8', 0],   // eighth
        [0.09375, '16', 1],   // dotted 16th
        [0.0625, '16', 0],   // 16th
        [0.03125, '32', 0],   // 32nd
        [0.015625, '64', 0],   // 64th
    ]

    const tolerance = 0.001
    for (const [rv, dur, dots] of lookup) {
        if (Math.abs(realValue - rv) < tolerance) {
            return { duration: dur, dots }
        }
    }

    // Fallback — find closest match
    let bestDur = 'q'
    let bestDots = 0
    let bestDiff = Infinity
    for (const [rv, dur, dots] of lookup) {
        const diff = Math.abs(realValue - rv)
        if (diff < bestDiff) {
            bestDiff = diff
            bestDur = dur
            bestDots = dots
        }
    }
    return { duration: bestDur, dots: bestDots }
}

/** Convert OSMD Pitch to VexFlow key string, e.g. "c#/4" */
function pitchToVexFlowKey(pitch: OsmdAny): { key: string; accidental: string | null } {
    try {
        const fund: number = pitch.FundamentalNote       // 0-6 enum
        const octave: number = pitch.Octave              // OSMD octave (needs +3 for VexFlow)
        const accValue: number = pitch.Accidental || 0   // AccidentalEnum

        const letter = FUNDAMENTAL_TO_LETTER[fund] || 'c'
        const vfOctave = octave + 3  // OSMD octave 1 = VexFlow octave 4 for middle C
        const accStr = ACCIDENTAL_TO_VF[accValue] ?? ''

        // VexFlow key format: "c#/4" or "eb/5"
        const key = `${letter}${accStr}/${vfOctave}`
        // Only return explicit accidental if non-empty
        const accidental = accStr || null

        return { key, accidental }
    } catch {
        return { key: 'c/4', accidental: null }
    }
}

/** Compute MIDI pitch via frequency (same bulletproof approach as ScrollView) */
function pitchToMidi(pitch: OsmdAny): number {
    let midiPitch = 60
    try {
        const freq = pitch.Frequency || pitch.frequency
        if (freq && freq > 0) {
            midiPitch = Math.round(12 * Math.log2(freq / 440) + 69)
        } else {
            midiPitch = pitch.getHalfTone() + 12
        }
    } catch {
        try { midiPitch = pitch.getHalfTone() + 12 } catch { /* give up */ }
    }
    return midiPitch
}

/** OSMD key enum → VexFlow key spec string */
function osmdKeyToVexFlow(keyInstruction: OsmdAny): string | undefined {
    if (!keyInstruction) return undefined
    try {
        // OSMD KeyInstruction has .Key (KeyEnum: 0=C,1=G,2=D...  negatives for flats)
        // and .Mode (0=major, 1=minor)
        const keyVal: number = keyInstruction.Key ?? keyInstruction.keyTypeOriginal ?? 0
        const mode: number = keyInstruction.Mode ?? 0

        // Map key number to VexFlow key spec
        const majorKeys: Record<number, string> = {
            [-7]: 'Cb', [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F',
            0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
        }
        const minorKeys: Record<number, string> = {
            [-7]: 'Abm', [-6]: 'Ebm', [-5]: 'Bbm', [-4]: 'Fm', [-3]: 'Cm', [-2]: 'Gm', [-1]: 'Dm',
            0: 'Am', 1: 'Em', 2: 'Bm', 3: 'F#m', 4: 'C#m', 5: 'G#m', 6: 'D#m', 7: 'A#m',
        }

        return mode === 1 ? minorKeys[keyVal] : majorKeys[keyVal]
    } catch {
        return 'C'
    }
}

/** OSMD clef type → VexFlow clef string */
function osmdClefToVexFlow(clef: OsmdAny): 'treble' | 'bass' {
    if (!clef) return 'treble'
    try {
        // ClefType enum: 0=G (treble), 1=F (bass), 2=C, etc.
        const clefType = clef.ClefType ?? 0
        return clefType === 1 ? 'bass' : 'treble'
    } catch {
        return 'treble'
    }
}

// ─── Public API ────────────────────────────────────────────────────

export interface OsmdParseResult {
    xmlEvents: XMLEvent[]
    intermediateScore: IntermediateScore
    totalMeasures: number
}

/**
 * Load and parse a MusicXML URL using OSMD in headless mode.
 * Returns the xmlEvents list and IntermediateScore for VexFlow rendering.
 */
export async function parseWithOsmd(xmlUrl: string): Promise<OsmdParseResult> {
    // Create hidden container for OSMD (it requires a DOM element)
    const hiddenDiv = document.createElement('div')
    hiddenDiv.style.position = 'absolute'
    hiddenDiv.style.left = '-9999px'
    hiddenDiv.style.top = '-9999px'
    hiddenDiv.style.width = '2000px'
    hiddenDiv.style.visibility = 'hidden'
    document.body.appendChild(hiddenDiv)

    try {
        const osmd = new OSMD(hiddenDiv, {
            autoResize: false,
            drawTitle: false,
            drawSubtitle: false,
            drawPartNames: false,
            drawPartAbbreviations: false,
            drawFingerings: false,
            drawCredits: false,
            drawComposer: false,
            drawLyricist: false,
            backend: 'svg',
            renderSingleHorizontalStaffline: true,
        })

        await osmd.load(xmlUrl)
        osmd.render()

        const xmlEvents = extractXmlEvents(osmd)
        const intermediateScore = buildIntermediateScore(osmd)
        const totalMeasures = osmd.Sheet?.SourceMeasures?.length || 0

        console.log(`[OsmdParser] Parsed ${totalMeasures} measures, ${xmlEvents.length} XML events, ${intermediateScore.measures.length} intermediate measures`)

        return { xmlEvents, intermediateScore, totalMeasures }
    } finally {
        document.body.removeChild(hiddenDiv)
    }
}

// ─── XML Events Extraction ─────────────────────────────────────────
// Replicated EXACTLY from ScrollView.tsx lines 137-335

function extractXmlEvents(osmd: OSMD): XMLEvent[] {
    const xmlEventsList: XMLEvent[] = []
    let cumulativeBeats = 0

    const sourceMeasures = osmd.Sheet?.SourceMeasures
    if (!sourceMeasures) return xmlEventsList

    for (let index = 0; index < sourceMeasures.length; index++) {
        const sourceMeasure = sourceMeasures[index]
        const measureNumber = index + 1
        const numerator = sourceMeasure?.ActiveTimeSignature?.Numerator ?? 4
        const denominator = sourceMeasure?.ActiveTimeSignature?.Denominator ?? 4

        const uniqueFractionalBeats = new Set<number>()
        const beatAccumulator = new Map<number, { pitches: Set<number>; smallestDur: number; hasFermata: boolean }>()

        // Iterate over all voice entries in the source measure
        for (const verticalStaffEntry of (sourceMeasure.VerticalSourceStaffEntryContainers || [])) {
            if (!verticalStaffEntry) continue

            for (const staffEntry of (verticalStaffEntry.StaffEntries || [])) {
                if (!staffEntry) continue

                // Get the beat from Timestamp
                let beatVal = 1
                if (staffEntry.Timestamp) {
                    beatVal = 1 + (staffEntry.Timestamp.RealValue * denominator)
                }
                beatVal = Math.round(beatVal * 1000) / 1000

                let hasRealNote = false
                for (const voiceEntry of (staffEntry.VoiceEntries || [])) {
                    if (!voiceEntry) continue

                    for (const note of (voiceEntry.Notes || [])) {
                        if (!note || !note.Pitch) continue
                        hasRealNote = true

                        const midiPitch = pitchToMidi(note.Pitch)
                        const durQuarters = note.Length?.RealValue
                            ? note.Length.RealValue * 4
                            : 1

                        if (!beatAccumulator.has(beatVal)) {
                            beatAccumulator.set(beatVal, { pitches: new Set(), smallestDur: durQuarters, hasFermata: false })
                        }
                        const acc = beatAccumulator.get(beatVal)!
                        acc.pitches.add(midiPitch)
                        if (durQuarters < acc.smallestDur) acc.smallestDur = durQuarters

                        // Check for fermata
                        try {
                            if (voiceEntry.Articulations) {
                                for (const art of voiceEntry.Articulations) {
                                    if (art.articulationEnum === 10 || art.articulationEnum === 11) {
                                        acc.hasFermata = true
                                    }
                                }
                            }
                        } catch { /* ignore */ }
                    }
                }

                if (hasRealNote) {
                    uniqueFractionalBeats.add(beatVal)
                }
            }
        }

        // Build chronological XML Events
        const sortedBeats = Array.from(uniqueFractionalBeats).sort((a, b) => a - b)
        for (const b of sortedBeats) {
            const acc = beatAccumulator.get(b)
            xmlEventsList.push({
                measure: measureNumber,
                beat: b,
                globalBeat: cumulativeBeats + (b - 1),
                pitches: acc ? Array.from(acc.pitches) : [],
                smallestDuration: acc ? acc.smallestDur : 1,
                hasFermata: acc ? acc.hasFermata : false,
            })
        }

        cumulativeBeats += numerator
    }

    return xmlEventsList
}

// ─── IntermediateScore Builder ──────────────────────────────────────

function buildIntermediateScore(osmd: OSMD): IntermediateScore {
    const sourceMeasures = osmd.Sheet?.SourceMeasures
    if (!sourceMeasures) return { measures: [] }

    const measures: IntermediateMeasure[] = []
    let prevNumerator: number | undefined
    let prevDenominator: number | undefined
    let prevKeySignature: string | undefined
    const prevClefs: ('treble' | 'bass')[] = []

    for (let mIdx = 0; mIdx < sourceMeasures.length; mIdx++) {
        const src: OsmdAny = sourceMeasures[mIdx]
        const measureNumber = mIdx + 1

        // Time signature — only emit when changed
        const numerator: number = src.ActiveTimeSignature?.Numerator ?? 4
        const denominator: number = src.ActiveTimeSignature?.Denominator ?? 4
        let tsNum: number | undefined
        let tsDen: number | undefined
        if (numerator !== prevNumerator || denominator !== prevDenominator) {
            tsNum = numerator
            tsDen = denominator
            prevNumerator = numerator
            prevDenominator = denominator
        }

        // Key signature — only emit when changed
        let keySig: string | undefined
        try {
            const keyInstr = src.KeyInstruction ?? src.keyInstruction
            const vfKey = osmdKeyToVexFlow(keyInstr)
            if (vfKey && vfKey !== prevKeySignature) {
                keySig = vfKey
                prevKeySignature = vfKey
            }
        } catch { /* ignore */ }

        // Build staves
        const staffCount = src.CompleteNumberOfStaves ?? 2
        const staves: IntermediateStaff[] = []

        for (let sIdx = 0; sIdx < staffCount; sIdx++) {
            // Clef — only emit when changed
            let clef: 'treble' | 'bass' | undefined
            try {
                const clefInstr = src.FirstInstructionsStaffEntries?.[sIdx]?.Instructions?.[0]
                    ?? (sIdx === 0 ? null : null)
                if (clefInstr) {
                    const vfClef = osmdClefToVexFlow(clefInstr)
                    if (vfClef !== prevClefs[sIdx]) {
                        clef = vfClef
                        prevClefs[sIdx] = vfClef
                    }
                } else if (prevClefs[sIdx] === undefined) {
                    // First measure — set default
                    clef = sIdx === 0 ? 'treble' : 'bass'
                    prevClefs[sIdx] = clef
                }
            } catch {
                if (prevClefs[sIdx] === undefined) {
                    clef = sIdx === 0 ? 'treble' : 'bass'
                    prevClefs[sIdx] = clef
                }
            }

            // Build voices for this staff
            const voiceMap = new Map<number, IntermediateNote[]>()

            for (const vsse of (src.VerticalSourceStaffEntryContainers || [])) {
                if (!vsse) continue
                const staffEntry = vsse.StaffEntries?.[sIdx]
                if (!staffEntry) continue

                for (const voiceEntry of (staffEntry.VoiceEntries || [])) {
                    if (!voiceEntry) continue
                    const voiceIdx = voiceEntry.ParentVoice?.VoiceId ?? 0

                    if (!voiceMap.has(voiceIdx)) voiceMap.set(voiceIdx, [])
                    const voiceNotes = voiceMap.get(voiceIdx)!

                    // Determine beat
                    let beatVal = 1
                    if (staffEntry.Timestamp) {
                        beatVal = 1 + (staffEntry.Timestamp.RealValue * denominator)
                    }
                    beatVal = Math.round(beatVal * 1000) / 1000

                    // Collect all notes in this voice entry (chord or single)
                    const keys: string[] = []
                    const accidentals: (string | null)[] = []
                    const tiesToNext: boolean[] = []
                    let isRest = true
                    let realValue = 0.25 // default quarter note
                    const articulations: string[] = []

                    for (const note of (voiceEntry.Notes || [])) {
                        if (!note) continue

                        if (note.Pitch) {
                            isRest = false
                            const { key, accidental } = pitchToVexFlowKey(note.Pitch)
                            keys.push(key)
                            accidentals.push(accidental)

                            // Tie detection
                            const hasTie = note.NoteSlurs?.some((s: OsmdAny) =>
                                s?.StartNote === note && s?.type === 'Tie'
                            ) || note.NoteTie?.StartNote === note
                            tiesToNext.push(!!hasTie)
                        } else {
                            // Rest
                            const restKey = (prevClefs[sIdx] === 'bass') ? 'd/3' : 'b/4'
                            keys.push(restKey)
                            accidentals.push(null)
                            tiesToNext.push(false)
                        }

                        // Duration from the first note (all notes in a chord share duration)
                        if (note.Length?.RealValue) {
                            realValue = note.Length.RealValue
                        }
                    }

                    // Articulations from the voice entry
                    try {
                        if (voiceEntry.Articulations) {
                            for (const art of voiceEntry.Articulations) {
                                const e = art.articulationEnum
                                if (e === 10 || e === 11) articulations.push('a@a')    // fermata
                                else if (e === 0 || e === 1) articulations.push('a.')   // staccato
                                else if (e === 4 || e === 5) articulations.push('a>')   // accent
                                else if (e === 6) articulations.push('a-')              // tenuto
                            }
                        }
                    } catch { /* ignore */ }

                    if (keys.length === 0) continue

                    // Convert duration
                    const { duration: durStr, dots } = realValueToDuration(realValue)
                    let finalDuration = durStr
                    if (isRest) finalDuration += 'r'
                    if (dots > 0) finalDuration += 'd'

                    const vfId = `vf-M${measureNumber}-S${sIdx}-V${voiceIdx}-B${beatVal}`

                    voiceNotes.push({
                        keys,
                        duration: finalDuration,
                        dots,
                        isRest,
                        accidentals,
                        tiesToNext,
                        articulations,
                        beat: beatVal,
                        vfId,
                    })
                }
            }

            // Build voice objects
            const voices: IntermediateVoice[] = []
            voiceMap.forEach((notes, voiceIdx) => {
                // Sort notes by beat
                notes.sort((a, b) => a.beat - b.beat)
                voices.push({ voiceIndex: voiceIdx, notes })
            })

            // If no voices found, create a whole rest for the measure
            if (voices.length === 0) {
                const restKey = (prevClefs[sIdx] === 'bass') ? 'd/3' : 'b/4'
                voices.push({
                    voiceIndex: 0,
                    notes: [{
                        keys: [restKey],
                        duration: 'wr',
                        dots: 0,
                        isRest: true,
                        accidentals: [null],
                        tiesToNext: [false],
                        articulations: [],
                        beat: 1,
                        vfId: `vf-M${measureNumber}-S${sIdx}-V0-Brest`,
                    }],
                })
            }

            staves.push({
                staffIndex: sIdx,
                clef,
                voices,
            })
        }

        measures.push({
            measureNumber,
            timeSignatureNumerator: tsNum,
            timeSignatureDenominator: tsDen,
            keySignature: keySig,
            staves,
        })
    }

    const title = osmd.Sheet?.TitleString || undefined
    return { title, measures }
}
