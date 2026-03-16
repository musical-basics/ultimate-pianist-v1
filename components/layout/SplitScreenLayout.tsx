'use client'

import * as React from 'react'
import { useRef, useEffect, useState, useCallback } from 'react'
import { ScrollView } from '@/components/score/ScrollView'
import { PianoKeyboard } from '@/components/synthesia/PianoKeyboard'
import { useAppStore } from '@/lib/store'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import { AudioSynth } from '@/lib/engine/AudioSynth'
import type { WaterfallRenderer } from '@/lib/engine/WaterfallRenderer'
import type { ParsedMidi, XMLEvent } from '@/lib/types'

interface SplitScreenLayoutProps {
    audioUrl: string | null
    xmlUrl: string | null
    parsedMidi: ParsedMidi | null
    isAdmin?: boolean
    isStudioMode?: boolean
    onUpdateAnchor?: (measure: number, time: number) => void
    onUpdateBeatAnchor?: (measure: number, beat: number, time: number) => void
    onScoreLoaded?: (totalMeasures: number, noteCounts: Map<number, number>, xmlEvents?: XMLEvent[]) => void
    onRendererReady?: () => void
    musicFont?: string
    children?: React.ReactNode
}

export const SplitScreenLayout: React.FC<SplitScreenLayoutProps> = ({
    audioUrl,
    xmlUrl,
    parsedMidi,
    isAdmin = false,
    isStudioMode = false,
    musicFont,
    onUpdateAnchor,
    onUpdateBeatAnchor,
    onScoreLoaded,
    onRendererReady,
    children,
}) => {
    // ─── Store Connections ──────────────────────────────────────────
    const isPlaying = useAppStore((s) => s.isPlaying)
    const anchors = useAppStore((s) => s.anchors)
    const beatAnchors = useAppStore((s) => s.beatAnchors)
    const darkMode = useAppStore((s) => s.darkMode)
    const revealMode = useAppStore((s) => s.revealMode)
    const highlightNote = useAppStore((s) => s.highlightNote)
    const glowEffect = useAppStore((s) => s.glowEffect)
    const popEffect = useAppStore((s) => s.popEffect)
    const jumpEffect = useAppStore((s) => s.jumpEffect)
    const isLocked = useAppStore((s) => s.isLocked)
    const cursorPosition = useAppStore((s) => s.cursorPosition)
    const curtainLookahead = useAppStore((s) => s.curtainLookahead)
    const showCursor = useAppStore((s) => s.showCursor)
    const setCurrentMeasure = useAppStore((s) => s.setCurrentMeasure)
    const duration = useAppStore((s) => s.duration)
    const showScore = useAppStore((s) => s.showScore)
    const showWaterfall = useAppStore((s) => s.showWaterfall)

    const waterfallContainerRef = useRef<HTMLDivElement>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const audioSynthRef = useRef<AudioSynth | null>(null)
    const rendererRef = useRef<WaterfallRenderer | null>(null)
    const [rendererReady, setRendererReady] = useState(false)

    useEffect(() => {
        // Step 14: In studio mode, skip audio element entirely
        if (isStudioMode || !audioUrl) return

        const audio = new Audio(audioUrl)
        audio.crossOrigin = 'anonymous'
        audioRef.current = audio

        const pm = getPlaybackManager()
        pm.setAudioElement(audio)
        audio.addEventListener('loadedmetadata', () => { pm.duration = audio.duration })

        return () => {
            audio.pause()
            pm.setAudioElement(null)
            audioRef.current = null
        }
    }, [audioUrl, isStudioMode])

    useEffect(() => {
        let isCancelled = false
        let localRenderer: WaterfallRenderer | null = null

        const init = async () => {
            const container = waterfallContainerRef.current
            if (!container) return

            try {
                const { WaterfallRenderer: WR } = await import('@/lib/engine/WaterfallRenderer')
                if (isCancelled) return

                const pm = getPlaybackManager()
                localRenderer = new WR(container, pm)
                await localRenderer.init()

                if (isCancelled) {
                    localRenderer.destroy()
                    return
                }

                rendererRef.current = localRenderer
                setRendererReady(true)

                // Expose waterfall globals for both studio mode and local export
                const renderer = localRenderer;
                (window as any).__WATERFALL_CANVAS__ = renderer.app?.canvas || null;
                (window as any).__EXPORT_CONTAINER__ = containerFullRef.current;
                (window as any).__RENDER_WATERFALL = () => {
                    renderer.renderFrame()
                    if (renderer.app) {
                        renderer.app.renderer.render({ container: renderer.app.stage })
                    }
                }

                // Studio mode: also expose __ADVANCE_FRAME__ for Puppeteer
                if (isStudioMode && localRenderer) {
                    (window as any).__ADVANCE_FRAME__ = (timeSec: number) => {
                        // 1. Update the master clock
                        pm.setManualTime(timeSec);

                        // 2. Synchronously force the DOM to move the sheet music cursor
                        if ((window as any).__UPDATE_SCORE__) {
                            (window as any).__UPDATE_SCORE__();
                        }

                        // 3. Synchronously force PixiJS to paint the falling notes
                        (window as any).__RENDER_WATERFALL();
                    }
                }
                console.log('[SplitScreen] Globals exposed: __WATERFALL_CANVAS__, __RENDER_WATERFALL' + (isStudioMode ? ', __ADVANCE_FRAME__, __UPDATE_SCORE__' : ''))

                if (onRendererReady) onRendererReady()
            } catch (err) {
                console.error('[SplitScreen] Renderer init failed:', err)
            }
        }

        init()

        return () => {
            isCancelled = true
            if (rendererRef.current) {
                rendererRef.current.destroy()
                rendererRef.current = null
            } else if (localRenderer) {
                localRenderer.destroy()
            }
            setRendererReady(false)
        }
    }, [])

    useEffect(() => {
        if (parsedMidi && rendererRef.current) {
            rendererRef.current.loadNotes(parsedMidi)
        }
    }, [parsedMidi, rendererReady])

    useEffect(() => {
        if (audioSynthRef.current) {
            audioSynthRef.current.masterAudioActive = !!audioUrl
        }
    }, [audioUrl])

    useEffect(() => {
        return () => {
            audioSynthRef.current?.destroy()
            audioSynthRef.current = null
        }
    }, [])

    const handleMeasureChange = useCallback((measure: number) => {
        setCurrentMeasure(measure)
    }, [setCurrentMeasure])

    const [topPercent, setTopPercent] = useState(45)
    const isDraggingRef = useRef(false)
    const containerFullRef = useRef<HTMLDivElement>(null)

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault()
        isDraggingRef.current = true

        const onMouseMove = (ev: PointerEvent) => {
            if (!isDraggingRef.current || !containerFullRef.current) return
            const rect = containerFullRef.current.getBoundingClientRect()
            const pct = ((ev.clientY - rect.top) / rect.height) * 100
            setTopPercent(Math.max(15, Math.min(85, pct)))
        }

        const onMouseUp = () => {
            isDraggingRef.current = false
            document.removeEventListener('pointermove', onMouseMove)
            document.removeEventListener('pointerup', onMouseUp)
        }

        document.addEventListener('pointermove', onMouseMove)
        document.addEventListener('pointerup', onMouseUp)
    }, [])

    return (
        <div ref={containerFullRef} className="flex flex-col h-full w-full overflow-hidden bg-zinc-950">
            {children}

            {/* Always mounted — use CSS display to hide (preserves refs + renderer) */}
            <div
                style={{ height: !showScore ? '0px' : showWaterfall ? `${topPercent}%` : '100%' }}
                className={`relative overflow-hidden shrink-0 ${!showScore ? 'hidden' : ''}`}
            >
                <ScrollView
                    xmlUrl={xmlUrl}
                    anchors={anchors}
                    beatAnchors={beatAnchors}
                    isPlaying={isPlaying}
                    isAdmin={isAdmin}
                    darkMode={darkMode}
                    revealMode={revealMode}
                    highlightNote={highlightNote}
                    glowEffect={glowEffect}
                    popEffect={popEffect}
                    jumpEffect={jumpEffect}
                    isLocked={isLocked}
                    cursorPosition={cursorPosition}
                    curtainLookahead={curtainLookahead}
                    showCursor={showCursor}
                    duration={duration}
                    onMeasureChange={handleMeasureChange}
                    onUpdateAnchor={isAdmin ? onUpdateAnchor : undefined}
                    onUpdateBeatAnchor={isAdmin ? onUpdateBeatAnchor : undefined}
                    onScoreLoaded={onScoreLoaded}
                    musicFont={musicFont}
                />
            </div>

            <div
                onPointerDown={onPointerDown}
                className={`h-2 bg-zinc-700 hover:bg-purple-500 active:bg-purple-500 cursor-row-resize flex items-center justify-center transition-colors shrink-0 select-none ${(!showScore || !showWaterfall) ? 'hidden' : ''}`}
            >
                <div className="w-10 h-1 rounded-full bg-zinc-500" />
            </div>

            <div className={`flex-1 flex flex-col overflow-hidden min-h-0 ${!showWaterfall ? 'hidden' : ''}`}>
                <div className="flex-1 relative bg-black/50 min-h-0">
                    <div ref={waterfallContainerRef} className="relative w-full h-full">
                        {!rendererReady && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="text-center space-y-2 opacity-30">
                                    <div className="w-10 h-10 mx-auto rounded-full border-2 border-dashed border-zinc-600 flex items-center justify-center">
                                        <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                                    </div>
                                    <p className="text-zinc-600 text-xs">Initializing...</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <PianoKeyboard />
            </div>
        </div>
    )
}

export default SplitScreenLayout
