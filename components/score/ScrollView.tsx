'use client'

import * as React from 'react'
import { useRef, useEffect, useCallback, useState, memo } from 'react'
import { useOSMD } from '@/hooks/useOSMD'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import type { Anchor, BeatAnchor, XMLEvent } from '@/lib/types'

interface ScrollViewProps {
    xmlUrl: string | null
    anchors: Anchor[]
    beatAnchors?: BeatAnchor[]
    isPlaying: boolean
    isAdmin?: boolean
    darkMode?: boolean
    revealMode?: 'OFF' | 'NOTE' | 'CURTAIN'
    highlightNote?: boolean
    glowEffect?: boolean
    popEffect?: boolean
    jumpEffect?: boolean
    isLocked?: boolean
    cursorPosition?: number
    curtainLookahead?: number
    showCursor?: boolean
    duration?: number
    onMeasureChange?: (measure: number) => void
    onUpdateAnchor?: (measure: number, time: number) => void
    onUpdateBeatAnchor?: (measure: number, beat: number, time: number) => void
    onScoreLoaded?: (totalMeasures: number, noteCounts: Map<number, number>, xmlEvents?: XMLEvent[]) => void
}

type NoteData = {
    id: string
    measureIndex: number
    timestamp: number
    element: HTMLElement | null
    stemElement: HTMLElement | null
}

const ScrollViewComponent: React.FC<ScrollViewProps> = ({
    xmlUrl, anchors, beatAnchors = [], isPlaying, isAdmin = false, darkMode = false,
    revealMode = 'OFF', highlightNote = true, glowEffect = true, popEffect = false, jumpEffect = true,
    isLocked = true, cursorPosition = 0.2, curtainLookahead = 0.25, showCursor = true, duration = 100,
    onMeasureChange, onUpdateAnchor, onUpdateBeatAnchor, onScoreLoaded
}) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const osmdContainerRef = useRef<HTMLDivElement>(null)
    const cursorRef = useRef<HTMLDivElement>(null)
    const curtainRef = useRef<HTMLDivElement>(null)
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    const { osmd, isLoaded, error } = useOSMD(osmdContainerRef, xmlUrl)
    const animationFrameRef = useRef<number>(0)

    const [measureXMap, setMeasureXMap] = useState<Map<number, number>>(new Map())
    const beatXMapRef = useRef<Map<number, Map<number, number>>>(new Map())
    const noteMap = useRef<Map<number, NoteData[]>>(new Map())
    const measureContentMap = useRef<Map<number, HTMLElement[]>>(new Map())
    const staffLinesRef = useRef<HTMLElement[]>([])
    const allSymbolsRef = useRef<HTMLElement[]>([])

    const lastMeasureIndexRef = useRef<number>(-1)
    const prevRevealModeRef = useRef<'OFF' | 'NOTE' | 'CURTAIN'>('OFF')

    const findCurrentPosition = useCallback((time: number) => {
        if (!beatAnchors || beatAnchors.length === 0) {
            if (anchors.length === 0) return { measure: 1, beat: 1, progress: 0, isBeatInterpolation: false }
            const sorted = [...anchors].sort((a, b) => a.time - b.time)

            let currentM = 1, startT = 0, endT = Infinity
            for (let i = 0; i < sorted.length; i++) {
                if (time >= sorted[i].time) {
                    currentM = sorted[i].measure
                    startT = sorted[i].time
                    endT = (i + 1 < sorted.length) ? sorted[i + 1].time : Infinity
                } else break
            }
            let progress = 0
            if (endT !== Infinity && endT > startT) progress = Math.max(0, Math.min(1, (time - startT) / (endT - startT)))
            return { measure: currentM, beat: 1, progress, isBeatInterpolation: false }
        }

        const allPoints = [
            ...anchors.map(a => ({ measure: a.measure, beat: 1, time: a.time })),
            ...beatAnchors.map(b => ({ measure: b.measure, beat: b.beat, time: b.time }))
        ].sort((a, b) => a.time - b.time)

        let currentP = allPoints[0]
        let nextP = null

        for (let i = 0; i < allPoints.length; i++) {
            if (time >= allPoints[i].time) {
                currentP = allPoints[i]
                nextP = (i + 1 < allPoints.length) ? allPoints[i + 1] : null
            } else break
        }

        let progress = 0
        if (nextP && nextP.time > currentP.time) {
            progress = Math.max(0, Math.min(1, (time - currentP.time) / (nextP.time - currentP.time)))
        }
        if (!currentP) return { measure: 1, beat: 1, progress: 0, isBeatInterpolation: true }

        return {
            measure: currentP.measure, beat: currentP.beat,
            nextMeasure: nextP?.measure, nextBeat: nextP?.beat,
            progress, isBeatInterpolation: true
        }
    }, [anchors, beatAnchors])

    const applyColor = (element: HTMLElement, color: string) => {
        if (!element) return
        Array.from(element.getElementsByTagName('path')).forEach(p => { p.style.fill = color; p.style.stroke = color; p.setAttribute('fill', color); p.setAttribute('stroke', color) })
        Array.from(element.getElementsByTagName('rect')).forEach(r => { r.style.fill = color; r.style.stroke = color; r.setAttribute('fill', color); r.setAttribute('stroke', color) })
        element.style.fill = color; element.style.stroke = color
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calculateNoteMap = useCallback(() => {
        const instance = osmd.current
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!instance || !(instance as any).GraphicSheet || !containerRef.current) return

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const measureList = (instance as any).GraphicSheet.MeasureList
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unitInPixels = (instance as any).GraphicSheet.UnitInPixels || 10

        const newNoteMap = new Map<number, NoteData[]>()
        const newMeasureContentMap = new Map<number, HTMLElement[]>()
        const newAllSymbols: HTMLElement[] = []
        const newStaffLines: HTMLElement[] = []
        const newMeasureXMap = new Map<number, number>()
        const newBeatXMap = new Map<number, Map<number, number>>()

        const xmlEventsList: XMLEvent[] = []
        let cumulativeBeats = 0 // Running global beat counter for V5

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        measureList.forEach((staves: any[], index: number) => {
            const measureNumber = index + 1
            const sourceMeasure = instance.Sheet.SourceMeasures[index]
            const numerator = sourceMeasure?.ActiveTimeSignature ? sourceMeasure.ActiveTimeSignature.Numerator : 4
            const denominator = sourceMeasure?.ActiveTimeSignature ? sourceMeasure.ActiveTimeSignature.Denominator : 4

            const beatPositions = new Map<number, number>()
            const uniqueFractionalBeats = new Set<number>()
            // V5: per-beat accumulator for pitches and smallest duration
            const beatAccumulator = new Map<number, { pitches: Set<number>, smallestDur: number }>()

            if (staves.length > 0) {
                const pos = staves[0].PositionAndShape
                const absoluteX = (pos.AbsolutePosition.x + pos.BorderLeft) * unitInPixels
                newMeasureXMap.set(measureNumber, absoluteX)

                const mStart = (pos.AbsolutePosition.x + pos.BorderLeft) * unitInPixels
                const mEnd = (pos.AbsolutePosition.x + pos.BorderRight) * unitInPixels
                const mWidth = mEnd - mStart

                try {
                    // Fallback integer beats (linear spread)
                    for (let b = 1; b <= numerator; b++) {
                        const targetFraction = (b - 1) / numerator
                        let bestX = mStart + (mWidth * targetFraction)

                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        staves.forEach((staffMeasure: any) => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            staffMeasure.staffEntries.forEach((entry: any) => {
                                const relX = entry.PositionAndShape.RelativePosition.x * unitInPixels
                                const linearX = mStart + (mWidth * targetFraction)
                                const actualEntryX = (staffMeasure.PositionAndShape.AbsolutePosition.x * unitInPixels) + relX
                                if (Math.abs(actualEntryX - linearX) < (mWidth / numerator) * 0.4) {
                                    bestX = actualEntryX
                                }
                            })
                        })
                        beatPositions.set(b, bestX)
                    }

                    // Explicit fractional beats derived exactly from XML notes
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    staves.forEach((staffMeasure: any) => {
                        const staffMWidth = staffMeasure.PositionAndShape.BorderRight - staffMeasure.PositionAndShape.BorderLeft;
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        staffMeasure.staffEntries.forEach((entry: any) => {
                            // Verify it's a real note, not a rest
                            let isRest = true;
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            entry.graphicalVoiceEntries?.forEach((gve: any) => {
                                if (gve.notes) {
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    gve.notes.forEach((n: any) => {
                                        if (n.sourceNote && n.sourceNote.Pitch) isRest = false;
                                    });
                                }
                            });
                            if (isRest) return;

                            const relX = entry.PositionAndShape.RelativePosition.x;
                            let beatVal = 1;

                            if (entry.sourceStaffEntry && entry.sourceStaffEntry.Timestamp) {
                                // EXACT musical beat: Timestamp is in whole notes. Multiply by denominator (e.g., 4 for quarter notes).
                                beatVal = 1 + (entry.sourceStaffEntry.Timestamp.RealValue * denominator);
                            } else {
                                // Fallback to visual approximation (causes B2.8 etc.)
                                beatVal = 1 + ((staffMWidth > 0 ? relX / staffMWidth : 0) * numerator);
                            }
                            beatVal = Math.round(beatVal * 1000) / 1000;
                            uniqueFractionalBeats.add(beatVal);

                            const absX = (staffMeasure.PositionAndShape.AbsolutePosition.x + relX) * unitInPixels;
                            // Map the exact fractional beat directly to the pixel coordinates!
                            beatPositions.set(beatVal, absX);

                            // V5: Collect pitches and note lengths per beat position
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            entry.graphicalVoiceEntries?.forEach((gve: any) => {
                                if (!gve.notes) return;
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                gve.notes.forEach((n: any) => {
                                    if (!n.sourceNote || !n.sourceNote.Pitch) return;
                                    const pitch = n.sourceNote.Pitch;
                                    // Build MIDI pitch explicitly from FundamentalNote + AccidentalHalfTones
                                    // FundamentalNote is NoteEnum: C=0,D=2,E=4,F=5,G=7,A=9,B=11
                                    // AccidentalHalfTones adjusts for sharps/flats
                                    const semitone = pitch.FundamentalNote + (pitch.AccidentalHalfTones || 0);
                                    const midiPitch = (pitch.Octave + 2) * 12 + semitone;

                                    // VERBOSE: Log every single note extraction
                                    if (measureNumber <= 3) {
                                        console.log(`[ScrollView PITCH] M${measureNumber} B${beatVal}: ` +
                                            `FundamentalNote=${pitch.FundamentalNote} ` +
                                            `Octave=${pitch.Octave} ` +
                                            `AccidentalHalfTones=${pitch.AccidentalHalfTones} ` +
                                            `Accidental=${pitch.Accidental} ` +
                                            `getHalfTone()=${pitch.getHalfTone()} ` +
                                            `→ semitone=${semitone} → MIDI=${midiPitch} ` +
                                            `(${pitch.ToString ? pitch.ToString() : '?'})`);
                                    }

                                    // Get note duration in quarter-note fractions
                                    const durQuarters = n.sourceNote.Length?.RealValue
                                        ? n.sourceNote.Length.RealValue * 4 // RealValue is in whole notes
                                        : 1; // default to quarter note

                                    if (!beatAccumulator.has(beatVal)) {
                                        beatAccumulator.set(beatVal, { pitches: new Set(), smallestDur: durQuarters });
                                    }
                                    const acc = beatAccumulator.get(beatVal)!;
                                    acc.pitches.add(midiPitch);
                                    if (durQuarters < acc.smallestDur) acc.smallestDur = durQuarters;
                                });
                            });
                        });
                    });

                    newBeatXMap.set(measureNumber, beatPositions)

                    // Build chronological XML Events List with V5 enrichment
                    const sortedBeats = Array.from(uniqueFractionalBeats).sort((a, b) => a - b);
                    sortedBeats.forEach(b => {
                        const acc = beatAccumulator.get(b);
                        const pitchArr = acc ? Array.from(acc.pitches) : [];
                        xmlEventsList.push({
                            measure: measureNumber,
                            beat: b,
                            globalBeat: cumulativeBeats + (b - 1), // beat 1 of measure = cumulativeBeats + 0
                            pitches: pitchArr,
                            smallestDuration: acc ? acc.smallestDur : 1,
                        });

                        // VERBOSE: Log the final XML event
                        if (measureNumber <= 3) {
                            console.log(`[ScrollView EVENT] M${measureNumber} B${b}: pitches=[${pitchArr.join(',')}] globalBeat=${cumulativeBeats + (b - 1)}`);
                        }
                    });

                } catch { /* ignore */ }
            }

            // V5: advance cumulative beat counter by this measure's beat count
            cumulativeBeats += numerator

            const measureNotes: NoteData[] = []
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            staves.forEach((staffMeasure: any) => {
                const measurePos = staffMeasure.PositionAndShape
                const measureWidth = (measurePos.BorderRight - measurePos.BorderLeft) * unitInPixels
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                staffMeasure.staffEntries.forEach((entry: any) => {
                    if (!entry.graphicalVoiceEntries) return
                    const relX = entry.PositionAndShape.RelativePosition.x * unitInPixels
                    const relativeTimestamp = measureWidth > 0 ? relX / measureWidth : 0
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    entry.graphicalVoiceEntries.forEach((gve: any) => {
                        if (!gve.notes) return
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        gve.notes.forEach((note: any) => {
                            // Foolproof rest check: OSMD rests do not have a Pitch defined. 
                            if (note.sourceNote && !note.sourceNote.Pitch) return

                            if (note.vfnote && note.vfnote.length > 0) {
                                const vfId = note.vfnote[0].attrs?.id
                                if (vfId) {
                                    const element = document.getElementById(vfId) || document.getElementById(`vf-${vfId}`)
                                    if (element) {
                                        // Ignore anything that is a rest
                                        if (element.classList.contains('vf-rest') || element.closest('.vf-rest')) return

                                        const group = element.closest('.vf-stavenote') as HTMLElement || element as HTMLElement
                                        group.querySelectorAll('path, rect').forEach(p => {
                                            const el = p as HTMLElement
                                            el.style.transformBox = 'fill-box'
                                            el.style.transformOrigin = 'center'
                                            el.style.transition = 'transform 0.1s ease-out, fill 0.1s, stroke 0.1s'
                                        })
                                        measureNotes.push({ id: vfId, measureIndex: measureNumber, timestamp: relativeTimestamp, element: group, stemElement: null })
                                    }
                                }
                            }
                        })
                    })
                })
            })
            // Always set the measure even if 0 notes, so we don't accidentally get noteCounts.size === 0 for a fully blank score (though rare)
            newNoteMap.set(measureNumber, measureNotes)
        })

        const measureBounds: { index: number, left: number, right: number }[] = []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        measureList.forEach((staves: any[], index: number) => {
            let minX = Number.MAX_VALUE, maxX = Number.MIN_VALUE
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            staves.forEach((staff: any) => {
                const pos = staff.PositionAndShape
                const absX = pos.AbsolutePosition.x
                if (absX + pos.BorderLeft < minX) minX = absX + pos.BorderLeft
                if (absX + pos.BorderRight > maxX) maxX = absX + pos.BorderRight
            })
            if (minX < Number.MAX_VALUE) {
                measureBounds.push({ index: index + 1, left: (minX * unitInPixels) - 5, right: (maxX * unitInPixels) + 5 })
            }
        })

        const allElements = containerRef.current.querySelectorAll('svg path, svg rect, svg text')
        const containerLeft = containerRef.current.getBoundingClientRect().left
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i] as HTMLElement
            const rect = el.getBoundingClientRect()
            const cl = el.classList
            const isMusical = cl.contains('vf-stavenote') || cl.contains('vf-beam') || cl.contains('vf-rest') || cl.contains('vf-clef') || cl.contains('vf-keysignature') || cl.contains('vf-timesignature') || cl.contains('vf-stem') || cl.contains('vf-modifier') || el.closest('.vf-stavenote, .vf-beam, .vf-rest, .vf-clef, .vf-keysignature, .vf-timesignature, .vf-stem, .vf-modifier') !== null

            if (!isMusical && rect.width > 50 && rect.height < 3) {
                newStaffLines.push(el); continue
            }
            newAllSymbols.push(el)

            const elCenterX = (rect.left - containerLeft) + (rect.width / 2)
            const match = measureBounds.find(b => elCenterX >= b.left && elCenterX <= b.right)
            if (match) {
                if (!newMeasureContentMap.has(match.index)) newMeasureContentMap.set(match.index, [])
                newMeasureContentMap.get(match.index)!.push(el)
            }
        }

        setMeasureXMap(newMeasureXMap)
        beatXMapRef.current = newBeatXMap
        noteMap.current = newNoteMap
        measureContentMap.current = newMeasureContentMap
        staffLinesRef.current = newStaffLines
        allSymbolsRef.current = newAllSymbols
        lastMeasureIndexRef.current = -1

        if (onScoreLoaded) {
            const counts = new Map<number, number>()
            newNoteMap.forEach((notes, measureIndex) => {
                counts.set(measureIndex, notes.length)
            })
            console.log(`[ScrollView v4.0] Exported ${xmlEventsList.length} exact XML note events for mapping.`)
            onScoreLoaded(measureList.length, counts, xmlEventsList)
        }

    }, [osmd, onScoreLoaded])

    useEffect(() => {
        if (isLoaded) setTimeout(() => calculateNoteMap(), 100)
    }, [isLoaded, calculateNoteMap])

    useEffect(() => {
        const handleResize = () => setTimeout(() => calculateNoteMap(), 500)
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [calculateNoteMap])

    const updateMeasureVisibility = useCallback((currentMeasure: number) => {
        if (revealMode !== 'NOTE' || !measureContentMap.current) return
        measureContentMap.current.forEach((elements, measureNum) => {
            if (measureNum < currentMeasure) elements.forEach(el => el.style.opacity = '1')
            else if (measureNum > currentMeasure) elements.forEach(el => el.style.opacity = '0')
        })
    }, [revealMode])

    useEffect(() => {
        if (prevRevealModeRef.current === 'NOTE' && revealMode !== 'NOTE') {
            measureContentMap.current.forEach(elements => elements.forEach(el => el.style.opacity = '1'))
        }
        if (revealMode === 'NOTE') {
            const pm = getPlaybackManager()
            const { measure } = findCurrentPosition(pm.getTime())
            updateMeasureVisibility(measure)
        }
        if (revealMode === 'CURTAIN') {
            measureContentMap.current.forEach(elements => elements.forEach(el => el.style.opacity = '1'))
        }
        prevRevealModeRef.current = revealMode
    }, [revealMode, updateMeasureVisibility, findCurrentPosition])

    useEffect(() => {
        const baseColor = darkMode ? '#e0e0e0' : '#000000'
        const bgColor = darkMode ? '#18181b' : '#ffffff'
        allSymbolsRef.current.forEach(el => applyColor(el, baseColor))
        staffLinesRef.current.forEach(el => applyColor(el, baseColor))
        if (scrollContainerRef.current) scrollContainerRef.current.style.backgroundColor = bgColor
        if (curtainRef.current) curtainRef.current.style.backgroundColor = bgColor
    }, [darkMode, isLoaded])

    const updateCursorPosition = useCallback((audioTime: number) => {
        const instance = osmd.current
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!instance || !isLoaded || !(instance as any).GraphicSheet) return

        const posData = findCurrentPosition(audioTime)
        const { measure, beat, progress, isBeatInterpolation } = posData
        const currentMeasureIndex = measure - 1

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const measureList = (instance as any).GraphicSheet.MeasureList
            if (!measureList || currentMeasureIndex >= measureList.length) return
            const measureStaves = measureList[currentMeasureIndex]
            if (!measureStaves || measureStaves.length === 0) return

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const unitInPixels = (instance as any).GraphicSheet.UnitInPixels || 10
            let firstStaffY = Number.MAX_VALUE, lastStaffY = Number.MIN_VALUE
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            measureStaves.forEach((staff: any) => {
                const absY = staff.PositionAndShape.AbsolutePosition.y
                if (absY < firstStaffY) firstStaffY = absY
                if (absY > lastStaffY) lastStaffY = absY
            })
            const systemTop = (firstStaffY - 4) * unitInPixels
            const systemHeight = ((lastStaffY - firstStaffY) + 12) * unitInPixels

            let cursorX = 0
            if (isBeatInterpolation && beatXMapRef.current.has(measure)) {
                const beatsInMeasure = beatXMapRef.current.get(measure)!
                let startX = beatsInMeasure.get(beat)
                if (startX === undefined) startX = (measureStaves[0].PositionAndShape.AbsolutePosition.x + measureStaves[0].PositionAndShape.BorderLeft) * unitInPixels

                let endX = 0
                if (posData.nextMeasure === measure && posData.nextBeat) endX = beatsInMeasure.get(posData.nextBeat) || startX
                else endX = (measureStaves[0].PositionAndShape.AbsolutePosition.x + measureStaves[0].PositionAndShape.BorderRight) * unitInPixels

                cursorX = startX + ((endX - startX) * progress)
            } else {
                let minX = Number.MAX_VALUE, maxX = Number.MIN_VALUE
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                measureStaves.forEach((staff: any) => {
                    const absX = staff.PositionAndShape.AbsolutePosition.x
                    if (absX + staff.PositionAndShape.BorderLeft < minX) minX = absX + staff.PositionAndShape.BorderLeft
                    if (absX + staff.PositionAndShape.BorderRight > maxX) maxX = absX + staff.PositionAndShape.BorderRight
                })
                cursorX = minX * unitInPixels + ((maxX - minX) * unitInPixels * progress)
            }

            if (cursorRef.current) {
                cursorRef.current.style.transform = `translateX(${cursorX}px)`
                cursorRef.current.style.top = `${systemTop}px`
                cursorRef.current.style.height = `${systemHeight}px`
                cursorRef.current.style.display = showCursor ? 'block' : 'none'
            }

            if (scrollContainerRef.current) {
                const container = scrollContainerRef.current
                const targetScrollLeft = cursorX - (container.clientWidth * cursorPosition)
                const pm = getPlaybackManager()

                if (isLocked && pm.isPlaying) {
                    if (Math.abs(container.scrollLeft - targetScrollLeft) < 250) container.scrollLeft = targetScrollLeft
                    if (currentMeasureIndex !== lastMeasureIndexRef.current && Math.abs(container.scrollLeft - targetScrollLeft) > 50) {
                        container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' })
                    }
                } else if (currentMeasureIndex !== lastMeasureIndexRef.current) {
                    container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' })
                }
            }

            if (curtainRef.current) {
                if (revealMode === 'CURTAIN') {
                    curtainRef.current.style.display = 'block'
                    const offset = curtainLookahead * 600
                    const curtainStart = cursorX + offset
                    const lastMeasure = measureList[measureList.length - 1][0]
                    const totalWidth = (lastMeasure.PositionAndShape.AbsolutePosition.x + lastMeasure.PositionAndShape.BorderRight) * unitInPixels
                    curtainRef.current.style.left = `${curtainStart}px`
                    curtainRef.current.style.width = `${Math.max(0, totalWidth - curtainStart + 800)}px`
                    curtainRef.current.style.height = `${Math.max(containerRef.current?.scrollHeight || 0, containerRef.current?.clientHeight || 0)}px`
                } else {
                    curtainRef.current.style.display = 'none'
                }
            }

            if (revealMode === 'NOTE') {
                if (currentMeasureIndex !== lastMeasureIndexRef.current || lastMeasureIndexRef.current === -1) updateMeasureVisibility(measure)
                const currentElements = measureContentMap.current.get(measure)
                if (currentElements && containerRef.current) {
                    const containerRect = containerRef.current.getBoundingClientRect()
                    currentElements.forEach(el => {
                        const elLeft = el.getBoundingClientRect().left - containerRect.left
                        el.style.opacity = elLeft > cursorX + 2 ? '0' : '1'
                    })
                }
            }

            if (currentMeasureIndex !== lastMeasureIndexRef.current && onMeasureChange) {
                onMeasureChange(measure)
            }
            lastMeasureIndexRef.current = currentMeasureIndex

            const notesInMeasure = noteMap.current.get(measure)
            if (notesInMeasure && !isAdmin) {
                let globalProgress = progress
                if (isBeatInterpolation && beatXMapRef.current.has(measure)) {
                    globalProgress = ((beat - 1) + progress) / beatXMapRef.current.get(measure)!.size
                }
                const defaultColor = darkMode ? '#e0e0e0' : '#000000'
                const highlightColor = '#10B981'; const shadowColor = '#10B981'

                notesInMeasure.forEach(note => {
                    if (!note.element) return
                    const lookahead = 0.04
                    const noteEndThreshold = note.timestamp + 0.01
                    const isActive = (globalProgress <= noteEndThreshold && globalProgress >= note.timestamp - lookahead)
                    let tFill = defaultColor, tFilter = 'none', tTransform = 'scale(1) translateY(0)'

                    if (isActive) {
                        if (highlightNote) tFill = highlightColor
                        if (glowEffect) tFilter = `drop-shadow(0 0 6px ${shadowColor})`
                        tTransform = `scale(${popEffect ? 1.4 : 1}) translateY(${jumpEffect ? -10 : 0}px)`
                    }
                    applyColor(note.element, tFill)
                    if (note.stemElement) applyColor(note.stemElement, tFill)
                    note.element.style.filter = tFilter
                    note.element.querySelectorAll('path, rect').forEach(p => (p as HTMLElement).style.transform = tTransform)
                })
            }

        } catch { /* ignore */ }
    }, [findCurrentPosition, isLoaded, revealMode, updateMeasureVisibility, popEffect, jumpEffect, glowEffect, darkMode, highlightNote, cursorPosition, isLocked, curtainLookahead, showCursor, isAdmin, onMeasureChange])

    useEffect(() => {
        if (!isLoaded) return
        const animate = () => {
            updateCursorPosition(getPlaybackManager().getVisualTime())
            animationFrameRef.current = requestAnimationFrame(animate)
        }
        animationFrameRef.current = requestAnimationFrame(animate)
        return () => cancelAnimationFrame(animationFrameRef.current)
    }, [isLoaded, updateCursorPosition])

    const handleScoreClick = useCallback((event: React.MouseEvent) => {
        const osmdInstance = osmd.current
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!osmdInstance || !(osmdInstance as any).GraphicSheet || !containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const clickX = event.clientX - rect.left
        const clickY = event.clientY - rect.top

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const measureList = (osmdInstance as any).GraphicSheet.MeasureList
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unitInPixels = (osmdInstance as any).GraphicSheet.UnitInPixels || 10
        let clickedMeasureIndex = -1

        for (let i = 0; i < measureList.length; i++) {
            const measureStaves = measureList[i]
            if (!measureStaves) continue
            let minY = Number.MAX_VALUE, maxY = Number.MIN_VALUE, minX = Number.MAX_VALUE, maxX = Number.MIN_VALUE
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            measureStaves.forEach((staff: any) => {
                const pos = staff.PositionAndShape
                if (!pos) return
                if (pos.AbsolutePosition.y + pos.BorderTop < minY) minY = pos.AbsolutePosition.y + pos.BorderTop
                if (pos.AbsolutePosition.y + pos.BorderBottom > maxY) maxY = pos.AbsolutePosition.y + pos.BorderBottom
                if (pos.AbsolutePosition.x + pos.BorderLeft < minX) minX = pos.AbsolutePosition.x + pos.BorderLeft
                if (pos.AbsolutePosition.x + pos.BorderRight > maxX) maxX = pos.AbsolutePosition.x + pos.BorderRight
            })
            if (clickX >= minX * unitInPixels && clickX <= maxX * unitInPixels && clickY >= minY * unitInPixels && clickY <= maxY * unitInPixels) {
                clickedMeasureIndex = i
                break
            }
        }

        if (clickedMeasureIndex !== -1) {
            const measureNumber = clickedMeasureIndex + 1
            const sortedAnchors = [...anchors].sort((a, b) => a.measure - b.measure)
            const targetAnchor = sortedAnchors.reverse().find(a => a.measure <= measureNumber)
            if (targetAnchor) {
                getPlaybackManager().seek(targetAnchor.time)
            }
        }
    }, [anchors, osmd])

    return (
        <div ref={scrollContainerRef} className={`relative w-full h-full overflow-auto overscroll-none ${darkMode ? 'bg-zinc-900' : 'bg-white'}`}>
            <div ref={containerRef} onClick={handleScoreClick} className="relative min-w-full w-fit min-h-[400px]">

                {!isLoaded && xmlUrl && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center space-y-2">
                            <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
                            <p className={`text-sm ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>Loading score...</p>
                        </div>
                    </div>
                )}

                <div ref={osmdContainerRef} style={{ visibility: isLoaded ? 'visible' : 'hidden', filter: darkMode ? 'brightness(0.9)' : 'none' }} />

                <div ref={cursorRef} className="absolute pointer-events-none transition-none z-[1000]" style={{ display: 'none' }} />
                <div ref={curtainRef} className="absolute pointer-events-none z-[999]" style={{ display: 'none', top: 0, bottom: 0 }} />

                {isAdmin && anchors.map(anchor => {
                    const leftPixel = measureXMap.get(anchor.measure)
                    if (leftPixel === undefined) return null

                    return (
                        <div key={`m-${anchor.measure}`} className="absolute top-0 flex flex-col items-center group z-[1001] cursor-ew-resize pointer-events-auto hover:scale-110 transition-transform origin-top"
                            style={{ left: `${leftPixel}px`, transform: 'translateX(-50%)' }}
                            onMouseDown={(e: React.MouseEvent) => {
                                e.stopPropagation()
                                const startX = e.clientX; const initialTime = anchor.time;
                                const totalWidth = containerRef.current?.scrollWidth || 1000
                                const secondsPerPixel = (duration || 100) / totalWidth
                                const handleUp = (upEvent: MouseEvent) => {
                                    if (onUpdateAnchor) onUpdateAnchor(anchor.measure, Math.max(0, initialTime + ((upEvent.clientX - startX) * secondsPerPixel)))
                                    window.removeEventListener('mouseup', handleUp)
                                }
                                window.addEventListener('mouseup', handleUp)
                            }}
                        >
                            <div className="bg-red-600/90 text-white text-[9px] font-bold px-1 rounded-sm shadow-sm mb-0.5 select-none">M{anchor.measure}</div>
                            <div className="w-0.5 h-full bg-red-600/50 shadow-[0_0_2px_rgba(0,0,0,0.3)]" />
                        </div>
                    )
                })}

                {isAdmin && beatAnchors.map(bAnchor => {
                    const beatMap = beatXMapRef.current.get(bAnchor.measure)
                    const leftPixel = beatMap ? beatMap.get(bAnchor.beat) : undefined
                    if (leftPixel === undefined) return null

                    return (
                        <div key={`b-${bAnchor.measure}-${bAnchor.beat}`} className="absolute top-6 flex flex-col items-center group z-[1000] cursor-ew-resize pointer-events-auto hover:scale-110 transition-transform origin-top"
                            style={{ left: `${leftPixel}px`, transform: 'translateX(-50%)' }}
                            onMouseDown={(e: React.MouseEvent) => {
                                e.stopPropagation()
                                const startX = e.clientX; const initialTime = bAnchor.time;
                                const totalWidth = containerRef.current?.scrollWidth || 1000
                                const secondsPerPixel = (duration || 100) / totalWidth
                                const handleUp = (upEvent: MouseEvent) => {
                                    if (onUpdateBeatAnchor) onUpdateBeatAnchor(bAnchor.measure, bAnchor.beat, Math.max(0, initialTime + ((upEvent.clientX - startX) * secondsPerPixel)))
                                    window.removeEventListener('mouseup', handleUp)
                                }
                                window.addEventListener('mouseup', handleUp)
                            }}
                        >
                            <div className="bg-yellow-500/90 text-black text-[8px] font-bold px-1 rounded-sm shadow-sm mb-0.5 select-none">{bAnchor.beat}</div>
                            <div className="w-0.5 h-full bg-yellow-500/50 shadow-[0_0_2px_rgba(0,0,0,0.3)]" />
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

export const ScrollView = memo(ScrollViewComponent)
export default ScrollView
