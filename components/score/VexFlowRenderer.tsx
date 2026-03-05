'use client'

// components/score/VexFlowRenderer.tsx
//
// Renders an IntermediateScore using VexFlow's SVG backend.
// Produces: measureXMap, beatXMap, noteMap, systemYMap via onRenderComplete.
// Does NOT touch xmlEvents — that comes from OsmdParser.

import * as React from 'react'
import { useRef, useEffect, useCallback, useState } from 'react'
import { VexFlow } from 'vexflow'
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
    Fraction,
    type RenderContext,
    VoiceMode,
} from 'vexflow'
import type { IntermediateScore } from '@/lib/score/IntermediateScore'
import {
    STAVE_WIDTH, STAVE_Y_TREBLE, STAVE_SPACING, LEFT_MARGIN, SYSTEM_HEIGHT,
    createStaveNote, isBeamable, addArticulation, detectHeuristicTuplets,
    attachGraceNotes, processSlurs,
    type NoteData, type VexFlowRenderResult, type TupletData, type ActiveSlurs,
} from './VexFlowHelpers'

export type { NoteData, VexFlowRenderResult }

interface VexFlowRendererProps {
    score: IntermediateScore | null
    onRenderComplete?: (result: VexFlowRenderResult) => void
    darkMode?: boolean
    musicFont?: string
}

// ─── Component ─────────────────────────────────────────────────────

const VexFlowRendererComponent: React.FC<VexFlowRendererProps> = ({
    score,
    onRenderComplete,
    darkMode = false,
    musicFont = '',
}) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const rendererRef = useRef<Renderer | null>(null)
    const [isRendered, setIsRendered] = useState(false)
    const [fontsLoaded, setFontsLoaded] = useState(false)

    // Preload ALL music fonts once on mount (VexFlow v5 requires explicit font loading)
    useEffect(() => {
        console.log('[FONT DEBUG] Preloading all VexFlow fonts...')
        VexFlow.loadFonts('Bravura', 'Gonville', 'Petaluma', 'Academico')
            .then(() => {
                // FORCE the browser to download the fonts before rendering the SVG
                return Promise.all([
                    document.fonts.load('30px "Bravura"'),
                    document.fonts.load('30px "Gonville"'),
                    document.fonts.load('30px "Petaluma"'),
                    document.fonts.load('30px "Academico"')
                ]);
            })
            .then(() => {
                setFontsLoaded(true)
            }).catch((err: unknown) => {
                console.warn('[VEXFLOW] Font preloading failed, using defaults', err)
                setFontsLoaded(true)
            })
    }, [])

    const renderScore = useCallback(() => {
        if (!score || !containerRef.current || score.measures.length === 0 || !fontsLoaded) return
        // Set the active font synchronously BEFORE creating any VexFlow objects
        if (musicFont) VexFlow.setFonts(musicFont)
        const fontAvailable = musicFont ? document.fonts.check(`30px "${musicFont}"`) : true
        console.log('[FONT DEBUG] renderScore: musicFont =', JSON.stringify(musicFont), 'fontAvailable:', fontAvailable, 'getFonts():', VexFlow.getFonts())

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

        // Track active slurs across measures
        const activeSlurs: ActiveSlurs = new Map()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allCurves: any[] = []

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
            const multiVoiceVoices = new Set<Voice>() // voices from multi-voice staves
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

                const isMultiVoice = staff.voices.length > 1

                for (const voice of staff.voices) {
                    if (voice.notes.length === 0) continue

                    // Multi-voice: first voice stems UP (1), second voice stems DOWN (-1)
                    // Single voice: undefined → autoStem
                    const stemDir = isMultiVoice
                        ? (voice.voiceIndex === Math.min(...staff.voices.map(v => v.voiceIndex)) ? 1 : -1)
                        : undefined

                    const vfNotes: StaveNote[] = []
                    const beamableNotes: StaveNote[] = []

                    for (const note of voice.notes) {
                        const staveClef = staff.staffIndex === 0 ? currentTrebleClef : currentBassClef
                        const staveNote = createStaveNote(note, staff.staffIndex, stemDir, staveClef)

                        for (let ki = 0; ki < note.accidentals.length; ki++) {
                            const acc = note.accidentals[ki]
                            if (acc) staveNote.addModifier(new Accidental(acc), ki)
                        }

                        if (note.dots > 0) Dot.buildAndAttach([staveNote], { all: true })

                        for (const artCode of note.articulations) {
                            addArticulation(staveNote, artCode)
                        }

                        // NOTE: Do NOT call staveNote.setAttribute('id', ...) — this corrupts
                        // VexFlow's internal attrs.id, causing getSVGElement() to double-prefix
                        vfNotes.push(staveNote)

                        // Grace notes: attach to this main note
                        if (note.graceNotes && note.graceNotes.length > 0) {
                            try {
                                attachGraceNotes(staveNote, note.graceNotes, staff.staffIndex, staveClef)
                            } catch (e) {
                                console.warn(`[GRACE] Failed to attach grace notes:`, e)
                            }
                        }

                        // Slurs: track start/stop and collect completed curves
                        const completedCurves = processSlurs(note, staveNote, activeSlurs)
                        allCurves.push(...completedCurves)

                        // Tuplet tracking

                        if (note.tupletStart) {
                            currentTupletNotes = [staveNote]
                            currentTupletActual = note.tupletActual || 3
                            currentTupletNormal = note.tupletNormal || 2
                        } else if (currentTupletNotes) {
                            currentTupletNotes.push(staveNote)
                        }
                        if (note.tupletStop && currentTupletNotes && currentTupletNotes.length > 0) {
                            measureTuplets.push({
                                notes: currentTupletNotes,
                                actual: currentTupletActual,
                                normal: currentTupletNormal,
                            })
                            currentTupletNotes = null
                        }

                        // All beamable notes go into auto-beam pool (including tuplets)
                        if (!note.isRest && isBeamable(note.duration)) {
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
                        coordinateExtractors.push(() => {
                            if (!note.isRest) {
                                try {
                                    measureBeatPositions.set(note.beat, staveNote.getAbsoluteX())
                                } catch { /* ignore */ }
                            }

                            // Get SVG element using VexFlow's native method
                            // getSVGElement() calls document.getElementById(prefix(attrs.id))
                            let element: HTMLElement | null = null
                            let pathsAndRects: HTMLElement[] | undefined
                            try {
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                const svgEl = (staveNote as any).getSVGElement?.() as HTMLElement | undefined
                                if (svgEl) {
                                    const group = (svgEl.closest('.vf-stavenote') as HTMLElement) || svgEl
                                    element = group
                                    pathsAndRects = Array.from(group.querySelectorAll('path, rect')) as HTMLElement[]
                                }
                            } catch { /* ignore */ }

                            measureNoteData.push({
                                id: note.vfId,
                                measureIndex: measureNumber,
                                timestamp: (note.beat - 1) / currentTimeSigNum,
                                isRest: note.isRest,
                                numerator: currentTimeSigNum,
                                element,
                                stemElement: null,
                                pathsAndRects,
                            })
                        })
                    }

                    // Heuristic triplet detection: detect unmarked triplets when
                    // voice's total note values overflow the measure capacity
                    const heuristicTuplets = detectHeuristicTuplets(
                        voice.notes, vfNotes, measureTuplets,
                        currentTimeSigNum, currentTimeSigDen, measureNumber
                    )
                    measureTuplets.push(...heuristicTuplets)

                    // Flush any unclosed tuplet at end of voice
                    // Only flush unclosed tuplets with 2+ notes
                    // Single-note unclosed tuplets are cross-measure starts (e.g. M16 Voice 1)
                    // that would produce a misplaced "3" over the wrong notes
                    if (currentTupletNotes && currentTupletNotes.length >= 2) {
                        measureTuplets.push({
                            notes: currentTupletNotes,
                            actual: currentTupletActual,
                            normal: currentTupletNormal,
                        })
                    }
                    currentTupletNotes = null

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
                    if (isMultiVoice) multiVoiceVoices.add(vfVoice)

                    if (beamableNotes.length >= 2) {
                        try {
                            // Use generous beam groups to avoid splitting across beat boundaries
                            const groups = [new Fraction(currentTimeSigNum, currentTimeSigDen)]
                            // For multi-voice, force beam stem direction to match voice
                            const beamOpts: any = { groups }
                            if (stemDir !== undefined) {
                                beamOpts.stemDirection = stemDir
                                beamOpts.maintainStemDirections = true
                            }
                            measureBeams.push(...Beam.generateBeams(beamableNotes, beamOpts))
                        } catch { /* ignore */ }
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

                // Create Tuplet objects BEFORE formatting so VexFlow adjusts tick counts
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const vfTuplets: any[] = []
                measureTuplets.forEach(t => {
                    try {
                        // Manually apply tick ratio BEFORE Tuplet constructor
                        // (Tuplet constructor in VexFlow v5 does NOT modify ticks)
                        for (const note of t.notes) {
                            try {
                                const n = note as any
                                n.applyTickMultiplier(t.normal, t.actual)
                            } catch { /* ignore */ }
                        }

                        const tuplet = new Tuplet(t.notes, {
                            numNotes: t.actual,
                            notesOccupied: t.normal,
                            bracketed: false,
                        })
                        vfTuplets.push(tuplet)
                    } catch { /* ignore */ }
                })

                // Synchronize note start X across all staves so beats align vertically
                // (prevents clef changes, key sigs, grace notes from offsetting one stave)
                const staves = Object.values(staveMap)
                const maxNoteStartX = Math.max(...staves.map(s => {
                    try { return s.getNoteStartX() } catch { return 0 }
                }))
                staves.forEach(s => {
                    try {
                        if (s.getNoteStartX() < maxNoteStartX) {
                            s.setNoteStartX(maxNoteStartX)
                        }
                    } catch { /* ignore */ }
                })

                // Format all voices together using the available width after decorations
                // Use actual stave width minus padding to prevent notes spilling past barline
                const noteEndX = Math.min(...staves.map(s => {
                    try { return s.getNoteEndX() } catch { return maxNoteStartX + STAVE_WIDTH - 40 }
                }))
                const availableWidth = noteEndX - maxNoteStartX - 10 // 10px right margin
                formatter.format(vfVoices, Math.max(availableWidth, 100))

                // Post-format: reposition articulations based on resolved stem direction
                vfVoices.forEach(v => {
                    const isMulti = multiVoiceVoices.has(v)
                    const tickables = v.getTickables()
                    for (const t of tickables) {
                        const sn = t as StaveNote
                        try {
                            const stemDir = sn.getStemDirection()
                            const mods = sn.getModifiers()
                            for (const m of mods) {
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                const mod = m as any
                                if (mod.getCategory?.() === 'articulations' || mod.constructor?.name === 'Articulation') {
                                    // Fermatas always go above the staff (position 3)
                                    // VexFlow uses 'a@' prefix for fermata codes: a@a, a@u, a@s, etc.
                                    const artType = mod.type ?? ''
                                    const isFermata = typeof artType === 'string' && artType.startsWith('a@')

                                    let pos: number
                                    if (isFermata) {
                                        pos = 3 // always above
                                    } else if (isMulti) {
                                        pos = stemDir === 1 ? 3 : 4
                                    } else {
                                        pos = stemDir === 1 ? 4 : 3
                                    }
                                    mod.setPosition(pos)
                                    mod.setYShift(isFermata ? -2 : (pos === 4 ? 2 : -2))
                                }
                            }
                        } catch { /* ignore */ }
                    }
                })

                // Pre-draw: reposition notes in tuplet measures for proportional spacing
                // Uses tickContext.getX() (relative positions set by formatter) + setXShift()
                // Must happen BEFORE draw() so beams/stems render at correct positions
                if (measureTuplets.length > 0) {
                    vfVoices.forEach(v => {
                        const tickables = v.getTickables() as StaveNote[]
                        if (tickables.length < 2) return

                        try {
                            // Read formatter-assigned relative X positions via TickContext
                            const relPositions: number[] = []
                            const tickValues: number[] = []
                            for (const t of tickables) {
                                const tc = (t as any).getTickContext?.()
                                const relX = tc?.getX?.() ?? 0
                                relPositions.push(relX)
                                const ticks = (t as any).getTicks?.()?.value?.() ?? 2048
                                tickValues.push(ticks)
                            }

                            const firstX = relPositions[0]
                            const lastX = relPositions[relPositions.length - 1]
                            const totalWidth = lastX - firstX
                            if (totalWidth <= 0) return

                            const totalTicks = tickValues.reduce((s, t) => s + t, 0)

                            // Calculate proportional targets and apply X shifts
                            let accumulated = 0
                            for (let i = 0; i < tickables.length; i++) {
                                const targetX = firstX + (accumulated / totalTicks) * totalWidth
                                // Dampen shift to 65% — pure proportional is too tight for triplets
                                const shift = (targetX - relPositions[i]) * 0.65
                                accumulated += tickValues[i]

                                if (Math.abs(shift) >= 1) {
                                    try { (tickables[i] as any).setXShift(shift) } catch { /* ignore */ }
                                }
                            }
                        } catch (e) { console.warn(`[TUPLET-SPACE] M${measureNumber} error:`, e) }
                    })
                }

                // Draw voices and beams (with XShift applied for proportional spacing)
                vfVoices.forEach(v => v.draw(context, voiceStaveMap.get(v)!))
                measureBeams.forEach(b => b.setContext(context).draw())

                // Draw tuplets, then center the "3" between first and last tuplet note
                if (containerRef.current) {
                    const svgEl = containerRef.current.querySelector('svg')
                    vfTuplets.forEach((t, tIdx) => {
                        try {
                            const tupletData = measureTuplets[tIdx]
                            let centerX = 0
                            if (tupletData && tupletData.notes.length >= 3) {
                                // Visual center of middle note: absoluteX + half of xShift
                                const midIdx = Math.floor(tupletData.notes.length / 2)
                                const midNote = tupletData.notes[midIdx]
                                const xShift = (midNote as any).getXShift?.() ?? 0
                                centerX = midNote.getAbsoluteX() + xShift / 2
                            } else if (tupletData && tupletData.notes.length > 0) {
                                const first = tupletData.notes[0]
                                const last = tupletData.notes[tupletData.notes.length - 1]
                                const fShift = (first as any).getXShift?.() ?? 0
                                const lShift = (last as any).getXShift?.() ?? 0
                                centerX = ((first.getAbsoluteX() + fShift / 2) + (last.getAbsoluteX() + lShift / 2)) / 2
                            }

                            const textCountBefore = svgEl ? svgEl.querySelectorAll('text').length : 0
                            t.setContext(context).draw()
                            if (svgEl) {
                                const allTexts = svgEl.querySelectorAll('text')
                                for (let i = textCountBefore; i < allTexts.length; i++) {
                                    const textEl = allTexts[i]
                                    const currentY = parseFloat(textEl.getAttribute('y') || '0')

                                    textEl.setAttribute('transform', `scale(0.65)`)
                                    if (centerX > 0) {
                                        textEl.setAttribute('x', String(centerX / 0.65))
                                        textEl.setAttribute('text-anchor', 'middle')
                                    } else {
                                        const origX = parseFloat(textEl.getAttribute('x') || '0')
                                        textEl.setAttribute('x', String(origX / 0.65))
                                    }
                                    textEl.setAttribute('y', String((currentY + 20) / 0.65))
                                }
                            }
                        } catch { /* ignore */ }
                    })
                } else {
                    vfTuplets.forEach(t => {
                        try { t.setContext(context).draw() } catch { /* ignore */ }
                    })
                }
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

        // Draw all slur curves
        for (const curve of allCurves) {
            try {
                curve.setContext(context).draw()
            } catch {
                // Curve rendering may fail if notes are malformed — skip
            }
        }

        // ── Post-render: configure CSS transforms + cache absoluteX ──
        requestAnimationFrame(() => {
            if (!containerRef.current) return

            const cLeft = containerRef.current.getBoundingClientRect().left

            let populatedCount = 0, missingCount = 0
            allNoteData.forEach((notes) => {
                for (const note of notes) {
                    if (!note.element) { missingCount++; continue }
                    populatedCount++

                    // Configure the <g> group for CSS transforms so stems don't detach
                    note.element.style.transformBox = 'fill-box'
                    note.element.style.transformOrigin = 'center center'
                    note.element.style.transition = 'transform 0.1s ease-out, filter 0.1s'

                    if (note.pathsAndRects) {
                        note.pathsAndRects.forEach(p => {
                            p.style.transition = 'fill 0.1s, stroke 0.1s'
                        })
                    }

                    // Cache absoluteX for reveal mode calculations
                    note.absoluteX = note.element.getBoundingClientRect().left - cLeft
                }
            })
            console.log(`[VFR DOM] Elements: populated=${populatedCount} missing=${missingCount}`)

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

    }, [score, onRenderComplete, fontsLoaded, musicFont])

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

