'use client'

import * as React from 'react'
import { useRef, useEffect, useCallback, useState, memo } from 'react'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import type { Anchor, BeatAnchor, XMLEvent } from '@/lib/types'
import { useAppStore } from '@/lib/store'
import { parseWithOsmd } from '@/lib/score/OsmdParser'
import { parseMusicXml } from '@/lib/score/MusicXmlParser'
import type { IntermediateScore } from '@/lib/score/IntermediateScore'
import { VexFlowRenderer, type NoteData, type VexFlowRenderResult } from './VexFlowRenderer'

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
    musicFont?: string
}

const ScrollViewComponent: React.FC<ScrollViewProps> = ({
    xmlUrl, anchors, beatAnchors = [], isPlaying, isAdmin = false, darkMode = false,
    revealMode = 'OFF', highlightNote = true, glowEffect = true, popEffect = false, jumpEffect = true,
    isLocked = true, cursorPosition = 0.2, curtainLookahead = 0.25, showCursor = true, duration = 100,
    onMeasureChange, onUpdateAnchor, onUpdateBeatAnchor, onScoreLoaded, musicFont,
}) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const cursorRef = useRef<HTMLDivElement>(null)
    const curtainRef = useRef<HTMLDivElement>(null)
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    const animationFrameRef = useRef<number>(0)

    const [measureXMap, setMeasureXMap] = useState<Map<number, number>>(new Map())
    const beatXMapRef = useRef<Map<number, Map<number, number>>>(new Map())
    const noteMap = useRef<Map<number, NoteData[]>>(new Map())
    const measureContentMap = useRef<Map<number, HTMLElement[]>>(new Map())
    const staffLinesRef = useRef<HTMLElement[]>([])
    const allSymbolsRef = useRef<HTMLElement[]>([])
    // Beams & ties are separate SVG groups — need their own reveal handling
    const beamTieElementsRef = useRef<{ el: HTMLElement, x: number, isRevealed?: boolean }[]>([])

    const lastMeasureIndexRef = useRef<number>(-1)
    const prevRevealModeRef = useRef<'OFF' | 'NOTE' | 'CURTAIN'>('OFF')
    const revealModeRef = useRef(revealMode) // Always-current ref for callbacks
    revealModeRef.current = revealMode

    // ─── Parsing State ─────────────────────────────────────────────
    const [intermediateScore, setIntermediateScore] = useState<IntermediateScore | null>(null)
    const [isLoaded, setIsLoaded] = useState(false)
    const [parseError, setParseError] = useState<string | null>(null)
    const xmlEventsRef = useRef<XMLEvent[]>([])
    const totalMeasuresRef = useRef<number>(0)
    const systemYMapRef = useRef<{ top: number; height: number }>({ top: 20, height: 260 })

    // ─── Parse MusicXML: direct parser for rendering, OSMD for xmlEvents
    useEffect(() => {
        if (!xmlUrl) return

        let cancelled = false
        setIsLoaded(false)
        setParseError(null)

        const parse = async () => {
            try {
                // Run both parsers in parallel:
                // 1. Direct MusicXML → IntermediateScore (accurate notes for VexFlow)
                // 2. Headless OSMD → xmlEvents (preserved data contract for AutoMapper)
                console.log('[ScrollView] Starting parallel parse: MusicXML + OSMD...')

                const [score, osmdResult] = await Promise.all([
                    parseMusicXml(xmlUrl),
                    parseWithOsmd(xmlUrl),
                ])

                if (cancelled) return

                xmlEventsRef.current = osmdResult.xmlEvents
                totalMeasuresRef.current = osmdResult.totalMeasures
                setIntermediateScore(score)

                console.log(`[ScrollView] Parse complete: ${score.measures.length} measures (MusicXML), ${osmdResult.xmlEvents.length} XML events (OSMD)`)
            } catch (err) {
                if (!cancelled) {
                    const msg = err instanceof Error ? err.message : 'Failed to parse score'
                    setParseError(msg)
                    console.error('[ScrollView] Parse error:', msg)
                }
            }
        }

        parse()
        return () => { cancelled = true }
    }, [xmlUrl])

    // ─── VexFlowRenderer completion callback ───────────────────────
    const handleRenderComplete = useCallback((result: VexFlowRenderResult) => {
        setMeasureXMap(result.measureXMap)
        beatXMapRef.current = result.beatXMap
        noteMap.current = result.noteMap
        systemYMapRef.current = result.systemYMap

        // Build measureContentMap and allSymbols from the rendered SVG
        const newMeasureContentMap = new Map<number, HTMLElement[]>()
        const newStaffLines: HTMLElement[] = []
        const newAllSymbols: HTMLElement[] = []

        if (containerRef.current) {
            // Compute measure bounds from measureXMap
            const measureBounds: { index: number; left: number; right: number }[] = []
            const sortedMeasures = Array.from(result.measureXMap.entries()).sort((a, b) => a[0] - b[0])
            for (let i = 0; i < sortedMeasures.length; i++) {
                const [mNum, mX] = sortedMeasures[i]
                const nextX = (i + 1 < sortedMeasures.length) ? sortedMeasures[i + 1][1] : mX + 250
                measureBounds.push({ index: mNum, left: mX - 5, right: nextX + 5 })
            }

            const allElements = containerRef.current.querySelectorAll('svg path, svg rect, svg text')
            const containerLeft = containerRef.current.getBoundingClientRect().left
            for (let i = 0; i < allElements.length; i++) {
                const el = allElements[i] as HTMLElement
                const rect = el.getBoundingClientRect()
                const cl = el.classList
                const isMusical = cl.contains('vf-stavenote') || cl.contains('vf-beam') ||
                    cl.contains('vf-rest') || cl.contains('vf-clef') ||
                    cl.contains('vf-keysignature') || cl.contains('vf-timesignature') ||
                    cl.contains('vf-stem') || cl.contains('vf-modifier') ||
                    el.closest('.vf-stavenote, .vf-beam, .vf-rest, .vf-clef, .vf-keysignature, .vf-timesignature, .vf-stem, .vf-modifier') !== null

                if (!isMusical && rect.width > 50 && rect.height < 3) {
                    newStaffLines.push(el)
                    continue
                }
                newAllSymbols.push(el)

                const elCenterX = (rect.left - containerLeft) + (rect.width / 2)
                const match = measureBounds.find(b => elCenterX >= b.left && elCenterX <= b.right)
                if (match) {
                    if (!newMeasureContentMap.has(match.index)) newMeasureContentMap.set(match.index, [])
                    newMeasureContentMap.get(match.index)!.push(el)
                }
            }
        }

        measureContentMap.current = newMeasureContentMap
        staffLinesRef.current = newStaffLines
        allSymbolsRef.current = newAllSymbols
        lastMeasureIndexRef.current = -1

        // Pre-cache absoluteX positions for reveal mode
        // (note.element, note.pathsAndRects already set by VexFlowRenderer's requestAnimationFrame)
        if (containerRef.current) {
            const cLeft = containerRef.current.getBoundingClientRect().left
            let populatedCount = 0

            // Collect ALL VexFlow SVG groups outside .vf-stavenote for NOTE reveal
            // (beams, ties, curves, tuplets, slurs and other decorative elements)
            const beamTieEls: { el: HTMLElement, x: number, isRevealed?: boolean }[] = []
            const extraGroups = containerRef.current.querySelectorAll(
                'g[class*="vf-"]:not(.vf-stavenote):not(.vf-stave):not(.vf-clef):not(.vf-keysignature):not(.vf-timesignature)'
            )
            extraGroups.forEach(el => {
                const htmlEl = el as HTMLElement
                const rect = htmlEl.getBoundingClientRect()
                const cls = htmlEl.getAttribute('class') || ''
                // Ties/slurs/curves span ahead → use RIGHT edge (wait for cursor to pass end)
                // Beams/stems/articulations are structural → use LEFT edge (appear with first note)
                const isTieOrCurve = cls.includes('vf-stavetie') || cls.includes('vf-curve')
                beamTieEls.push({ el: htmlEl, x: (isTieOrCurve ? rect.right : rect.left) - cLeft })
            })

            // Also collect bare <path>/<line> elements at the SVG top level
            // that aren't inside .vf-stavenote or .vf-stave groups (orphaned curves/slurs)
            const svgEl = containerRef.current.querySelector('svg')
            if (svgEl) {
                svgEl.querySelectorAll(':scope > path, :scope > line, :scope > g:not([class]) > path').forEach(el => {
                    const htmlEl = el as HTMLElement
                    // Bare paths at SVG top level are likely curves/slurs → use RIGHT edge
                    beamTieEls.push({ el: htmlEl, x: htmlEl.getBoundingClientRect().right - cLeft })
                })
            }

            beamTieElementsRef.current = beamTieEls
            console.log(`[ScrollView] Collected ${beamTieEls.length} beam/tie elements for reveal`)
            result.noteMap.forEach((notes) => {
                for (const note of notes) {
                    if (note.element) {
                        note.absoluteX = note.element.getBoundingClientRect().left - cLeft
                        populatedCount++
                    }
                }
            })
            console.log(`[ScrollView] Pre-cached absoluteX for ${populatedCount} notes`)
        }

        setIsLoaded(true)

        // FIX: If NOTE reveal mode is already active when the score finishes rendering,
        // we need to hide all the newly-created note elements (the useEffect already fired
        // before elements existed, so those opacity sets were no-ops)
        if (revealModeRef.current === 'NOTE') {
            console.log('[ScrollView] NOTE mode active at render complete — hiding all notes + beams/ties')
            result.noteMap.forEach(notes => {
                notes.forEach(n => {
                    if (n.element) n.element.style.opacity = '0'
                    n.isRevealed = false
                })
            })
            beamTieElementsRef.current.forEach(bt => {
                bt.el.style.opacity = '0'
                bt.isRevealed = false
            })
            lastMeasureIndexRef.current = -1
        }

        // Fire onScoreLoaded with the preserved xmlEvents
        if (onScoreLoaded) {
            const counts = new Map<number, number>()
            result.noteMap.forEach((notes, measureIndex) => {
                counts.set(measureIndex, notes.length)
            })
            console.log(`[ScrollView VexFlow] Exported ${xmlEventsRef.current.length} exact XML note events for mapping.`)
            onScoreLoaded(result.measureCount, counts, xmlEventsRef.current)
        }
    }, [onScoreLoaded])

    // ─── Position Finding (unchanged from original) ────────────────
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

    // ─── Color Application (uses cached elements when available) ───
    const applyColor = (element: HTMLElement, color: string, cachedPaths?: HTMLElement[]) => {
        if (!element) return
        if (cachedPaths) {
            cachedPaths.forEach(p => {
                p.style.fill = color; p.style.stroke = color
                p.setAttribute('fill', color); p.setAttribute('stroke', color)
            })
        } else {
            Array.from(element.getElementsByTagName('path')).forEach(p => { p.style.fill = color; p.style.stroke = color; p.setAttribute('fill', color); p.setAttribute('stroke', color) })
            Array.from(element.getElementsByTagName('rect')).forEach(r => { r.style.fill = color; r.style.stroke = color; r.setAttribute('fill', color); r.setAttribute('stroke', color) })
        }
        element.style.fill = color; element.style.stroke = color
    }

    // ─── Reveal Mode transitions ────────────────────────────────────
    useEffect(() => {
        // When leaving NOTE mode: restore all note opacities & reset states
        if (prevRevealModeRef.current === 'NOTE' && revealMode !== 'NOTE') {
            noteMap.current.forEach(notes => {
                notes.forEach(n => {
                    if (n.element) n.element.style.opacity = '1'
                    n.isRevealed = undefined
                })
            })
            // Restore beams/ties
            beamTieElementsRef.current.forEach(bt => {
                bt.el.style.opacity = '1'
                bt.isRevealed = undefined
            })
        }

        // When entering NOTE mode: hide all notes + beams/ties initially
        if (revealMode === 'NOTE') {
            noteMap.current.forEach(notes => {
                notes.forEach(n => {
                    if (n.element) n.element.style.opacity = '0'
                    n.isRevealed = false
                })
            })
            beamTieElementsRef.current.forEach(bt => {
                bt.el.style.opacity = '0'
                bt.isRevealed = false
            })
            lastMeasureIndexRef.current = -1
        }

        if (curtainRef.current && revealMode !== 'CURTAIN') {
            curtainRef.current.style.display = 'none'
        }

        prevRevealModeRef.current = revealMode
    }, [revealMode])

    // ─── Dark Mode & Effects coloring invalidation ────────────────────
    const previewEffects = useAppStore((s) => s.previewEffects)
    useEffect(() => {
        const baseColor = darkMode ? '#e0e0e0' : '#000000'
        const bgColor = darkMode ? '#18181b' : '#ffffff'
        allSymbolsRef.current.forEach(el => applyColor(el, baseColor))
        staffLinesRef.current.forEach(el => applyColor(el, baseColor))
        if (scrollContainerRef.current) scrollContainerRef.current.style.backgroundColor = bgColor
        if (curtainRef.current) curtainRef.current.style.backgroundColor = bgColor

        // Invalidate isActive state so notes re-render immediately when toggling settings
        noteMap.current.forEach(notes => notes.forEach(n => { n.isActive = undefined }))
    }, [darkMode, isLoaded, highlightNote, glowEffect, popEffect, jumpEffect, previewEffects])

    // ─── Cursor Positioning (rewritten for VexFlow maps) ───────────
    const updateCursorPosition = useCallback((audioTime: number) => {
        if (!isLoaded || measureXMap.size === 0) return

        const posData = findCurrentPosition(audioTime)
        const { measure, beat, progress, isBeatInterpolation } = posData
        const currentMeasureIndex = measure - 1

        try {
            // Use systemYMap for cursor positioning
            const systemTop = systemYMapRef.current.top
            const systemHeight = systemYMapRef.current.height

            let cursorX = 0
            if (isBeatInterpolation && beatXMapRef.current.has(measure)) {
                const beatsInMeasure = beatXMapRef.current.get(measure)!
                let startX = beatsInMeasure.get(beat)
                if (startX === undefined) startX = measureXMap.get(measure) || 0

                let endX = 0
                if (posData.nextMeasure === measure && posData.nextBeat) {
                    endX = beatsInMeasure.get(posData.nextBeat) || startX
                } else {
                    // End of measure: use next measure's X or estimated end
                    const nextMeasureX = measureXMap.get(measure + 1)
                    endX = nextMeasureX || (startX + 200)
                }

                cursorX = startX + ((endX - startX) * progress)
            } else {
                const mX = measureXMap.get(measure)
                const nextMX = measureXMap.get(measure + 1)
                if (mX !== undefined) {
                    const mWidth = (nextMX !== undefined ? nextMX - mX : 250)
                    cursorX = mX + (mWidth * progress)
                }
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

            // ─── CURTAIN reveal ─────────────────
            if (curtainRef.current) {
                if (revealMode === 'CURTAIN') {
                    curtainRef.current.style.display = 'block'
                    const offset = curtainLookahead * 600
                    const curtainStart = cursorX + offset
                    const lastMeasureNum = Math.max(...Array.from(measureXMap.keys()), 1)
                    const lastMeasureX = measureXMap.get(lastMeasureNum) || 0
                    const totalWidth = lastMeasureX + 500
                    curtainRef.current.style.left = `${curtainStart}px`
                    curtainRef.current.style.width = `${Math.max(0, totalWidth - curtainStart)}px`
                    curtainRef.current.style.backgroundColor = darkMode ? '#18181b' : '#ffffff'
                } else {
                    curtainRef.current.style.display = 'none'
                }
            }

            // ─── NOTE reveal (Fixed Math Bug) ─
            if (revealMode === 'NOTE') {
                let revealedCount = 0, hiddenCount = 0, noElementCount = 0, noAbsXCount = 0
                noteMap.current.forEach((notes) => {
                    for (const n of notes) {
                        if (!n.element) { noElementCount++; continue }
                        if (n.absoluteX === undefined) { noAbsXCount++; continue }
                        const noteX = n.absoluteX
                        const isRevealed = noteX <= cursorX + 5
                        if (n.isRevealed !== isRevealed) {
                            n.isRevealed = isRevealed
                            n.element.style.opacity = isRevealed ? '1' : '0'
                        }
                        if (isRevealed) revealedCount++; else hiddenCount++
                    }
                })
                // Also reveal beams/ties by their X position
                for (const bt of beamTieElementsRef.current) {
                    const isRevealed = bt.x <= cursorX + 5
                    if (bt.isRevealed !== isRevealed) {
                        bt.isRevealed = isRevealed
                        bt.el.style.opacity = isRevealed ? '1' : '0'
                    }
                }
                // Log once per ~60 frames to avoid flooding
                if (Math.random() < 0.016) {
                    console.log(`[NOTE REVEAL] cursorX=${cursorX.toFixed(0)} revealed=${revealedCount} hidden=${hiddenCount} noElement=${noElementCount} noAbsX=${noAbsXCount}`)
                }
            }

            // Clean up ALL stale measures if we changed measure boundaries or did a rapid seek
            if (currentMeasureIndex !== lastMeasureIndexRef.current) {
                const defaultColor = darkMode ? '#e0e0e0' : '#000000'
                noteMap.current.forEach((notes, mIdx) => {
                    if (mIdx !== measure) {
                        notes.forEach(n => {
                            if (n.isActive) {
                                n.isActive = false
                                if (n.element) {
                                    applyColor(n.element, defaultColor, n.pathsAndRects)
                                    if (n.stemElement) applyColor(n.stemElement, defaultColor)
                                    n.element.style.filter = 'none'
                                    n.element.style.transform = 'scale(1) translateY(0)'
                                }
                            }
                        })
                    }
                })
                if (onMeasureChange) onMeasureChange(measure)
            }
            lastMeasureIndexRef.current = currentMeasureIndex

            // ─── Note Effects ────────────────────────
            const notesInMeasure = noteMap.current.get(measure)
            if (notesInMeasure && (!isAdmin || previewEffects)) {
                let globalProgress = progress
                if (isBeatInterpolation && beatXMapRef.current.has(measure)) {
                    // FIX: Math calculation uses correct Time Signature instead of `.size`
                    const timeSigNum = notesInMeasure[0]?.numerator || 4
                    let nextBeat = posData.nextBeat
                    if (posData.nextMeasure !== measure || !nextBeat) {
                        nextBeat = timeSigNum + 1
                    }
                    const exactBeat = beat + (nextBeat - beat) * progress
                    globalProgress = (exactBeat - 1) / timeSigNum
                }

                const defaultColor = darkMode ? '#e0e0e0' : '#000000'
                const highlightColor = '#10B981'; const shadowColor = '#10B981'

                notesInMeasure.forEach(note => {
                    if (!note.element) return
                    if (note.isRest) return  // FIX: Don't pop or highlight rests!

                    const lookahead = 0.08
                    const noteEndThreshold = note.timestamp + 0.06
                    const isActive = (globalProgress <= noteEndThreshold && globalProgress >= note.timestamp - lookahead)

                    if (note.isActive !== isActive) {
                        note.isActive = isActive
                        let tFill = defaultColor, tFilter = 'none', tTransform = 'scale(1) translateY(0)'

                        if (isActive) {
                            if (highlightNote) tFill = highlightColor
                            if (glowEffect) tFilter = `drop-shadow(0 0 6px ${shadowColor})`
                            tTransform = `scale(${popEffect ? 1.4 : 1}) translateY(${jumpEffect ? -10 : 0}px)`
                        }

                        applyColor(note.element, tFill, note.pathsAndRects)
                        if (note.stemElement) applyColor(note.stemElement, tFill)

                        // FIX: Apply transform & filter to the <g> group directly, not its sub-paths
                        note.element.style.filter = tFilter
                        note.element.style.transform = tTransform
                    }
                })
            }

        } catch { /* ignore */ }
    }, [findCurrentPosition, isLoaded, measureXMap, revealMode, popEffect, jumpEffect, glowEffect, darkMode, highlightNote, cursorPosition, isLocked, curtainLookahead, showCursor, isAdmin, onMeasureChange, previewEffects])

    // ─── Animation Loop (unchanged) ────────────────────────────────
    useEffect(() => {
        if (!isLoaded) return
        const animate = () => {
            updateCursorPosition(getPlaybackManager().getVisualTime())
            animationFrameRef.current = requestAnimationFrame(animate)
        }
        animationFrameRef.current = requestAnimationFrame(animate)
        return () => cancelAnimationFrame(animationFrameRef.current)
    }, [isLoaded, updateCursorPosition])

    // ─── Score Click (rewritten for VexFlow maps) ──────────────────
    const handleScoreClick = useCallback((event: React.MouseEvent) => {
        if (!containerRef.current || measureXMap.size === 0) return
        const rect = containerRef.current.getBoundingClientRect()
        const clickX = event.clientX - rect.left

        // Find the clicked measure using measureXMap
        const sortedMeasures = Array.from(measureXMap.entries()).sort((a, b) => a[1] - b[1])
        let clickedMeasure = -1
        for (let i = sortedMeasures.length - 1; i >= 0; i--) {
            if (clickX >= sortedMeasures[i][1]) {
                clickedMeasure = sortedMeasures[i][0]
                break
            }
        }

        if (clickedMeasure !== -1) {
            const sortedAnchors = [...anchors].sort((a, b) => a.measure - b.measure)
            const targetAnchor = sortedAnchors.reverse().find(a => a.measure <= clickedMeasure)
            if (targetAnchor) {
                getPlaybackManager().seek(targetAnchor.time)
            }
        }
    }, [anchors, measureXMap])

    return (
        <div ref={scrollContainerRef} className={`relative w-full h-full overflow-auto overscroll-none ${darkMode ? 'bg-zinc-900' : 'bg-white'}`}>
            <div ref={containerRef} onClick={handleScoreClick} className="relative min-w-full w-fit min-h-[400px]">

                {!isLoaded && xmlUrl && !parseError && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center space-y-2">
                            <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
                            <p className={`text-sm ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>Loading score...</p>
                        </div>
                    </div>
                )}

                {parseError && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <p className="text-red-500 text-sm">Error: {parseError}</p>
                    </div>
                )}

                {/* VexFlow Renderer */}
                <VexFlowRenderer
                    score={intermediateScore}
                    onRenderComplete={handleRenderComplete}
                    darkMode={darkMode}
                    musicFont={musicFont}
                />

                <div ref={cursorRef} className="absolute pointer-events-none z-[1000]" style={{ display: 'none', width: '2px', backgroundColor: '#10B981', borderRadius: '1px', opacity: 0.85, transition: 'transform 0.05s linear' }} />
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
