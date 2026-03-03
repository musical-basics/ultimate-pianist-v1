'use client'

// components/score/VexFlowRenderer.tsx
//
// Renders an IntermediateScore using VexFlow's SVG backend.
// Produces: measureXMap, beatXMap, noteMap, systemYMap via onRenderComplete.
// Does NOT touch xmlEvents — that comes from OsmdParser.

import * as React from 'react'
import { useRef, useEffect, useCallback, useState } from 'react'
import {
    Renderer,
    Stave,
    StaveNote,
    Voice,
    Formatter,
    Beam,
    StaveTie,
    Accidental,
    Dot,
    StaveConnector,
    Tuplet,
    type RenderContext,
    VoiceMode,
} from 'vexflow'
import type { IntermediateScore } from '@/lib/score/IntermediateScore'
import {
    STAVE_WIDTH, STAVE_Y_TREBLE, STAVE_SPACING, LEFT_MARGIN, SYSTEM_HEIGHT,
    createStaveNote, isBeamable, addArticulation,
    type NoteData, type VexFlowRenderResult,
} from './VexFlowHelpers'

export type { NoteData, VexFlowRenderResult }

interface VexFlowRendererProps {
    score: IntermediateScore | null
    onRenderComplete?: (result: VexFlowRenderResult) => void
    darkMode?: boolean
}

// ─── Component ─────────────────────────────────────────────────────

const VexFlowRendererComponent: React.FC<VexFlowRendererProps> = ({
    score,
    onRenderComplete,
    darkMode = false,
}) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const rendererRef = useRef<Renderer | null>(null)
    const [isRendered, setIsRendered] = useState(false)

    const renderScore = useCallback(() => {
        if (!score || !containerRef.current || score.measures.length === 0) return

        // Clear previous render
        containerRef.current.innerHTML = ''
        setIsRendered(false)

        const measures = score.measures
        const totalWidth = LEFT_MARGIN + (measures.length * STAVE_WIDTH) + 40

        // Create SVG renderer
        const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG)
        renderer.resize(totalWidth, SYSTEM_HEIGHT)
        rendererRef.current = renderer

        const context = renderer.getContext() as RenderContext

        // Track state for rendering
        const measureXMap = new Map<number, number>()
        const beatXMap = new Map<number, Map<number, number>>()
        const allNoteData = new Map<number, NoteData[]>()

        // Track current clefs
        let currentTrebleClef = 'treble'
        let currentBassClef = 'bass'
        let currentKeySig = 'C'
        let currentTimeSigNum = 4
        let currentTimeSigDen = 4

        // Track previous measure's last notes for ties
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prevMeasureLastNotes: Map<string, { staveNote: any; keyIndex: number }> = new Map()

        // Store tie data for cross-measure ties
        interface TieRequest {
            firstNote: StaveNote
            lastNote: StaveNote
            firstIndices: number[]
            lastIndices: number[]
        }
        const tieRequests: TieRequest[] = []

        // Render each measure
        for (let mIdx = 0; mIdx < measures.length; mIdx++) {
            const measure = measures[mIdx]
            const measureNumber = measure.measureNumber
            const x = LEFT_MARGIN + (mIdx * STAVE_WIDTH)

            // Update running state
            if (measure.keySignature) currentKeySig = measure.keySignature
            if (measure.timeSignatureNumerator) currentTimeSigNum = measure.timeSignatureNumerator
            if (measure.timeSignatureDenominator) currentTimeSigDen = measure.timeSignatureDenominator

            // ── Create staves ──
            const trebleStave = new Stave(x, STAVE_Y_TREBLE, STAVE_WIDTH)
            const bassStave = new Stave(x, STAVE_Y_TREBLE + STAVE_SPACING, STAVE_WIDTH)

            // Clefs
            for (const staff of measure.staves) {
                if (staff.staffIndex === 0 && staff.clef) {
                    currentTrebleClef = staff.clef
                }
                if (staff.staffIndex === 1 && staff.clef) {
                    currentBassClef = staff.clef
                }
            }

            if (mIdx === 0) {
                trebleStave.addClef(currentTrebleClef)
                bassStave.addClef(currentBassClef)

                if (currentKeySig && currentKeySig !== 'C' && currentKeySig !== 'Am') {
                    trebleStave.addKeySignature(currentKeySig)
                    bassStave.addKeySignature(currentKeySig)
                }

                trebleStave.addTimeSignature(`${currentTimeSigNum}/${currentTimeSigDen}`)
                bassStave.addTimeSignature(`${currentTimeSigNum}/${currentTimeSigDen}`)
            } else {
                // Only add if changed
                if (measure.staves[0]?.clef) trebleStave.addClef(currentTrebleClef)
                if (measure.staves[1]?.clef) bassStave.addClef(currentBassClef)

                if (measure.keySignature) {
                    if (currentKeySig !== 'C' && currentKeySig !== 'Am') {
                        trebleStave.addKeySignature(currentKeySig)
                        bassStave.addKeySignature(currentKeySig)
                    }
                }

                if (measure.timeSignatureNumerator) {
                    trebleStave.addTimeSignature(`${currentTimeSigNum}/${currentTimeSigDen}`)
                    bassStave.addTimeSignature(`${currentTimeSigNum}/${currentTimeSigDen}`)
                }
            }

            trebleStave.setContext(context).draw()
            bassStave.setContext(context).draw()

            // Brace + line connector on first measure
            if (mIdx === 0) {
                new StaveConnector(trebleStave, bassStave).setType('brace').setContext(context).draw()
                new StaveConnector(trebleStave, bassStave).setType('singleLeft').setContext(context).draw()
            }
            // End barline connector
            new StaveConnector(trebleStave, bassStave).setType('singleRight').setContext(context).draw()

            // Record measure X position
            measureXMap.set(measureNumber, trebleStave.getX() + trebleStave.getNoteStartX() - trebleStave.getX())

            // ── Create notes for each staff ──
            const staveMap: { [staffIdx: number]: Stave } = {
                0: trebleStave,
                1: bassStave,
            }

            const measureNoteData: NoteData[] = []
            const measureBeatPositions = new Map<number, number>()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const currentMeasureFirstNotes: Map<string, { staveNote: any; keyIndex: number }> = new Map()

            // Collections for synchronous formatting
            const vfVoices: Voice[] = []
            const voiceStaveMap = new Map<Voice, Stave>()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const measureBeams: any[] = []
            const measureTuplets: { notes: StaveNote[]; actual: number; normal: number }[] = []
            let currentTupletNotes: StaveNote[] | null = null
            let currentTupletActual = 3
            let currentTupletNormal = 2
            const coordinateExtractors: (() => void)[] = []

            for (const staff of measure.staves) {
                const stave = staveMap[staff.staffIndex]
                if (!stave) continue

                for (const voice of staff.voices) {
                    if (voice.notes.length === 0) continue

                    const vfNotes: StaveNote[] = []
                    const beamableNotes: StaveNote[] = []
                    const tupletNoteSet = new Set<StaveNote>()

                    for (const note of voice.notes) {
                        const staveNote = createStaveNote(note, staff.staffIndex)

                        for (let ki = 0; ki < note.accidentals.length; ki++) {
                            const acc = note.accidentals[ki]
                            if (acc) staveNote.addModifier(new Accidental(acc), ki)
                        }

                        if (note.dots > 0) Dot.buildAndAttach([staveNote], { all: true })

                        for (const artCode of note.articulations) {
                            addArticulation(staveNote, artCode)
                        }

                        staveNote.setAttribute('id', note.vfId)
                        vfNotes.push(staveNote)

                        // Tuplet tracking (before beaming decision)
                        if (note.tupletStart) {
                            currentTupletNotes = [staveNote]
                            currentTupletActual = note.tupletActual || 3
                            currentTupletNormal = note.tupletNormal || 2
                        } else if (currentTupletNotes) {
                            currentTupletNotes.push(staveNote)
                        }
                        if (note.tupletStop && currentTupletNotes && currentTupletNotes.length > 0) {
                            // Mark all notes in this tuplet group
                            currentTupletNotes.forEach(n => tupletNoteSet.add(n))
                            // Explicitly beam the tuplet group
                            if (currentTupletNotes.length >= 2) {
                                try { measureBeams.push(new Beam(currentTupletNotes)) } catch { /* ignore */ }
                            }
                            measureTuplets.push({
                                notes: currentTupletNotes,
                                actual: currentTupletActual,
                                normal: currentTupletNormal,
                            })
                            currentTupletNotes = null
                        }

                        // Only add to auto-beam pool if NOT part of a tuplet
                        if (!note.isRest && isBeamable(note.duration) && !tupletNoteSet.has(staveNote) && !currentTupletNotes?.includes(staveNote)) {
                            beamableNotes.push(staveNote)
                        }

                        // Tie tracking
                        if (!note.isRest) {
                            for (let ki = 0; ki < note.keys.length; ki++) {
                                const tieKey = `${staff.staffIndex}-${note.keys[ki]}`
                                if (!currentMeasureFirstNotes.has(tieKey)) {
                                    currentMeasureFirstNotes.set(tieKey, { staveNote, keyIndex: ki })
                                }
                                const prev = prevMeasureLastNotes.get(tieKey)
                                if (prev) {
                                    tieRequests.push({
                                        firstNote: prev.staveNote,
                                        lastNote: staveNote,
                                        firstIndices: [prev.keyIndex],
                                        lastIndices: [ki],
                                    })
                                    prevMeasureLastNotes.delete(tieKey)
                                }
                            }
                            for (let ki = 0; ki < note.tiesToNext.length; ki++) {
                                if (note.tiesToNext[ki]) {
                                    const tieKey = `${staff.staffIndex}-${note.keys[ki]}`
                                    prevMeasureLastNotes.set(tieKey, { staveNote, keyIndex: ki })
                                }
                            }
                        }

                        // DELAY coordinate extraction until after the master Formatter runs
                        if (!note.isRest) {
                            coordinateExtractors.push(() => {
                                try {
                                    measureBeatPositions.set(note.beat, staveNote.getAbsoluteX())
                                } catch { /* ignore */ }
                                measureNoteData.push({
                                    id: note.vfId,
                                    measureIndex: measureNumber,
                                    timestamp: (note.beat - 1) / currentTimeSigNum,
                                    element: null,
                                    stemElement: null,
                                })
                            })
                        }
                    }

                    // Within-measure ties
                    for (let ni = 0; ni < voice.notes.length - 1; ni++) {
                        const note = voice.notes[ni]
                        if (note.isRest) continue
                        for (let ki = 0; ki < note.tiesToNext.length; ki++) {
                            if (note.tiesToNext[ki] && ni + 1 < vfNotes.length) {
                                const nextNote = voice.notes[ni + 1]
                                if (nextNote && !nextNote.isRest) {
                                    const matchIdx = nextNote.keys.indexOf(note.keys[ki])
                                    if (matchIdx >= 0) {
                                        tieRequests.push({
                                            firstNote: vfNotes[ni],
                                            lastNote: vfNotes[ni + 1],
                                            firstIndices: [ki],
                                            lastIndices: [matchIdx],
                                        })
                                        prevMeasureLastNotes.delete(`${staff.staffIndex}-${note.keys[ki]}`)
                                    }
                                }
                            }
                        }
                    }

                    const vfVoice = new Voice({
                        numBeats: currentTimeSigNum,
                        beatValue: currentTimeSigDen,
                    }).setMode(VoiceMode.SOFT)

                    vfVoice.addTickables(vfNotes)
                    vfVoices.push(vfVoice)
                    voiceStaveMap.set(vfVoice, stave)

                    if (beamableNotes.length >= 2) {
                        try { measureBeams.push(...Beam.generateBeams(beamableNotes)) } catch { /* ignore */ }
                    }
                }
            }

            // ── Format: joinVoices per-stave, format all together ──
            if (vfVoices.length > 0) {
                const formatter = new Formatter()
                // Group voices by stave for joinVoices (collision handling within a stave)
                const voicesByStave = new Map<Stave, Voice[]>()
                vfVoices.forEach(v => {
                    const stave = voiceStaveMap.get(v)!
                    if (!voicesByStave.has(stave)) voicesByStave.set(stave, [])
                    voicesByStave.get(stave)!.push(v)
                })
                voicesByStave.forEach(voices => formatter.joinVoices(voices))
                // Format all voices together for cross-stave X alignment
                formatter.format(vfVoices, STAVE_WIDTH - 40)
                vfVoices.forEach(v => v.draw(context, voiceStaveMap.get(v)!))
                measureBeams.forEach(b => b.setContext(context).draw())

                // Draw tuplets
                measureTuplets.forEach(t => {
                    try {
                        new Tuplet(t.notes, {
                            numNotes: t.actual,
                            notesOccupied: t.normal,
                        }).setContext(context).draw()
                    } catch { /* ignore */ }
                })
            }

            // Extract accurate coordinates now that formatting is complete
            coordinateExtractors.forEach(extract => extract())

            beatXMap.set(measureNumber, measureBeatPositions)
            allNoteData.set(measureNumber, measureNoteData)
        }

        // Draw all ties
        for (const tie of tieRequests) {
            try {
                new StaveTie({
                    firstNote: tie.firstNote,
                    lastNote: tie.lastNote,
                    firstIndexes: tie.firstIndices,
                    lastIndexes: tie.lastIndices,
                }).setContext(context).draw()
            } catch {
                // Tie rendering may fail if notes are malformed — skip
            }
        }

        // ── Post-render: populate DOM element references ──
        requestAnimationFrame(() => {
            if (!containerRef.current) return

            // Populate noteMap element references
            allNoteData.forEach((notes) => {
                for (const note of notes) {
                    const el = containerRef.current?.querySelector(`[id="${note.id}"]`) as HTMLElement
                    if (el) {
                        const group = el.closest('.vf-stavenote') as HTMLElement || el
                        group.querySelectorAll('path, rect').forEach(p => {
                            const pathEl = p as HTMLElement
                            pathEl.style.transformBox = 'fill-box'
                            pathEl.style.transformOrigin = 'center'
                            pathEl.style.transition = 'transform 0.1s ease-out, fill 0.1s, stroke 0.1s'
                        })
                        note.element = group
                    }
                }
            })

            setIsRendered(true)

            // Fire callback with all rendering data
            if (onRenderComplete) {
                const systemYMap = {
                    top: STAVE_Y_TREBLE - 20,
                    height: SYSTEM_HEIGHT,
                }

                onRenderComplete({
                    measureXMap,
                    beatXMap,
                    noteMap: allNoteData,
                    systemYMap,
                    measureCount: measures.length,
                })
            }
        })

    }, [score, onRenderComplete])

    // Render when score changes
    useEffect(() => {
        renderScore()
    }, [renderScore])

    // Handle resize
    useEffect(() => {
        const handleResize = () => setTimeout(() => renderScore(), 500)
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [renderScore])

    return (
        <div
            ref={containerRef}
            className="vexflow-container"
            style={{
                minWidth: '100%',
                minHeight: `${SYSTEM_HEIGHT}px`,
                opacity: isRendered ? 1 : 0,
                transition: 'opacity 0.2s',
            }}
        />
    )
}

export const VexFlowRenderer = React.memo(VexFlowRendererComponent)
export default VexFlowRenderer

