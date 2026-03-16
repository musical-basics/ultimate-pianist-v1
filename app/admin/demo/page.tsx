'use client'

/**
 * Admin Demo Editor — Offline-first, no Supabase needed.
 * Read-only version of the admin edit page using hardcoded DEMO_CONFIG.
 * Save/upload are disabled, but all visualization and playback works.
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Music, FileMusic, FileAudio, SkipBack, Play, Pause, Square, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { SplitScreenLayout } from '@/components/layout/SplitScreenLayout'
import { AnchorSidebar } from '@/components/score/AnchorSidebar'
import { WaveformTimeline } from '@/components/score/WaveformTimeline'
import { MidiTimeline } from '@/components/score/MidiTimeline'
import { ScoreControls } from '@/components/score/ScoreControls'
import { useAppStore } from '@/lib/store'
import { useMusicFont } from '@/hooks/useMusicFont'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import { parseMidiFile } from '@/lib/midi/parser'
import { DEMO_CONFIG } from '@/lib/demoConfig'
import type { ParsedMidi, BeatAnchor, XMLEvent, V5MapperState } from '@/lib/types'

export default function AdminDemoEditor() {
    const router = useRouter()
    const config = DEMO_CONFIG

    const [parsedMidi, setParsedMidi] = useState<ParsedMidi | null>(null)
    const [title] = useState(config.title)
    const [isRecording, setIsRecording] = useState(false)
    const [isAiMapping, setIsAiMapping] = useState(false)
    const [nextMeasure, setNextMeasure] = useState(2)
    const [totalMeasures, setTotalMeasures] = useState(0)
    const [noteCounts, setNoteCounts] = useState<Map<number, number>>(new Map())
    const [xmlEvents, setXmlEvents] = useState<XMLEvent[]>([])
    const xmlEventsRef = useRef<XMLEvent[]>([])
    const [v5State, setV5State] = useState<V5MapperState | null>(null)
    const { musicFont, setFont } = useMusicFont()
    const [displayTime, setDisplayTime] = useState(0)
    const displayRafRef = useRef<number>(0)

    const anchors = useAppStore((s) => s.anchors)
    const beatAnchors = useAppStore((s) => s.beatAnchors)
    const setAnchors = useAppStore((s) => s.setAnchors)
    const setBeatAnchors = useAppStore((s) => s.setBeatAnchors)
    const isPlaying = useAppStore((s) => s.isPlaying)
    const setPlaying = useAppStore((s) => s.setPlaying)
    const darkMode = useAppStore((s) => s.darkMode)
    const setDarkMode = useAppStore((s) => s.setDarkMode)
    const revealMode = useAppStore((s) => s.revealMode)
    const setRevealMode = useAppStore((s) => s.setRevealMode)
    const highlightNote = useAppStore((s) => s.highlightNote)
    const setHighlightNote = useAppStore((s) => s.setHighlightNote)
    const glowEffect = useAppStore((s) => s.glowEffect)
    const setGlowEffect = useAppStore((s) => s.setGlowEffect)
    const popEffect = useAppStore((s) => s.popEffect)
    const setPopEffect = useAppStore((s) => s.setPopEffect)
    const jumpEffect = useAppStore((s) => s.jumpEffect)
    const setJumpEffect = useAppStore((s) => s.setJumpEffect)
    const isLocked = useAppStore((s) => s.isLocked)
    const setIsLocked = useAppStore((s) => s.setIsLocked)
    const showCursor = useAppStore((s) => s.showCursor)
    const setShowCursor = useAppStore((s) => s.setShowCursor)
    const isLevel2Mode = useAppStore((s) => s.isLevel2Mode)
    const setIsLevel2Mode = useAppStore((s) => s.setIsLevel2Mode)
    const subdivision = useAppStore((s) => s.subdivision)
    const setSubdivision = useAppStore((s) => s.setSubdivision)
    const currentMeasure = useAppStore((s) => s.currentMeasure)
    const duration = useAppStore((s) => s.duration)
    const loadMidi = useAppStore((s) => s.loadMidi)

    // ─── Load config (sync from hardcoded data) ───────────────────
    useEffect(() => {
        if (config.anchors) setAnchors(config.anchors)
        if (config.beat_anchors) setBeatAnchors(config.beat_anchors)
        if (config.is_level2) setIsLevel2Mode(config.is_level2)
        if (config.subdivision) setSubdivision(config.subdivision)
        if (config.music_font) setFont(config.music_font)
    }, [config, setAnchors, setBeatAnchors, setIsLevel2Mode, setSubdivision, setFont])

    // ─── Load MIDI ────────────────────────────────────────────────
    useEffect(() => {
        if (!config.midi_url) return
        const loadMidiFromUrl = async () => {
            try {
                const response = await fetch(config.midi_url!)
                const buffer = await response.arrayBuffer()
                const parsed = parseMidiFile(buffer)
                setParsedMidi(parsed)
                loadMidi(parsed)
                getPlaybackManager().duration = parsed.durationSec
            } catch (err) {
                console.error('Failed to load MIDI:', err)
            }
        }
        loadMidiFromUrl()
    }, [config.midi_url, loadMidi])

    // ─── Anchor handlers ──────────────────────────────────────────
    const handleSetAnchor = useCallback((measure: number, time: number) => {
        setAnchors(anchors.map((a) => (a.measure === measure ? { ...a, time } : a)))
    }, [anchors, setAnchors])

    const handleDeleteAnchor = useCallback((measure: number) => {
        if (measure === 1) return
        setAnchors(anchors.filter((a) => a.measure !== measure))
    }, [anchors, setAnchors])

    const handleSetBeatAnchor = useCallback((measure: number, beat: number, time: number) => {
        setBeatAnchors((prev) => {
            const filtered = prev.filter(b => !(b.measure === measure && b.beat === beat))
            const newBeats = [...filtered, { measure, beat, time }]
            return newBeats.sort((a, b) => {
                if (a.measure !== b.measure) return a.measure - b.measure
                return a.beat - b.beat
            })
        })
    }, [setBeatAnchors])

    const handleRegenerateBeats = useCallback(() => {
        if (anchors.length < 2) return
        const newBeats: BeatAnchor[] = []
        const sortedAnchors = [...anchors].sort((a, b) => a.measure - b.measure)

        for (let i = 0; i < sortedAnchors.length; i++) {
            const currentA = sortedAnchors[i]
            const nextA = (i + 1 < sortedAnchors.length) ? sortedAnchors[i + 1] : null
            const beatsToGenerate = subdivision || 4

            if (nextA) {
                const dur = nextA.time - currentA.time
                const timePerBeat = dur / beatsToGenerate
                for (let b = 2; b <= beatsToGenerate; b++) {
                    newBeats.push({ measure: currentA.measure, beat: b, time: currentA.time + (timePerBeat * (b - 1)) })
                }
            }
        }
        setBeatAnchors(newBeats)
    }, [anchors, subdivision, setBeatAnchors])

    // ─── Playback ─────────────────────────────────────────────────
    const handlePlayPause = async () => {
        const pm = getPlaybackManager()
        if (isPlaying) { pm.pause(); setPlaying(false) }
        else { await pm.play(); setPlaying(true) }
    }

    const handleStop = useCallback(() => {
        const pm = getPlaybackManager()
        pm.pause()
        pm.seek(0)
        setPlaying(false)
        setDisplayTime(0)
    }, [setPlaying])

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60)
        const sec = Math.floor(s % 60)
        return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
    }

    // rAF loop for transport slider
    useEffect(() => {
        const tick = () => {
            setDisplayTime(getPlaybackManager().getTime())
            displayRafRef.current = requestAnimationFrame(tick)
        }
        displayRafRef.current = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(displayRafRef.current)
    }, [])

    const handleSeek = useCallback((time: number) => {
        getPlaybackManager().seek(time)
    }, [])

    const toggleRecordMode = () => {
        if (!isRecording) {
            const maxMeasure = anchors.length > 0 ? Math.max(...anchors.map((a) => a.measure)) : 1
            setNextMeasure(maxMeasure + 1)
        }
        setIsRecording(!isRecording)
    }

    const handleTap = useCallback(() => {
        if (!isRecording) return
        const time = getPlaybackManager().getTime()
        const measure = nextMeasure

        const existing = anchors.find(a => a.measure === measure)
        if (existing) {
            setAnchors(anchors.map(a => a.measure === measure ? { ...a, time } : a))
        } else {
            setAnchors([...anchors, { measure, time }].sort((a, b) => a.measure - b.measure))
        }
        setNextMeasure(measure + 1)
    }, [isRecording, nextMeasure, anchors, setAnchors])

    const handleClearAll = useCallback(() => {
        if (confirm("Are you sure you want to clear all mappings?")) {
            setAnchors([{ measure: 1, time: 0 }])
            setBeatAnchors([])
            setNextMeasure(2)
        }
    }, [setAnchors, setBeatAnchors])

    const handleScoreLoaded = useCallback((total: number, counts: Map<number, number>, events?: XMLEvent[]) => {
        setTotalMeasures(total)
        setNoteCounts(counts)
        if (events && events.length > 0 && xmlEventsRef.current.length === 0) {
            xmlEventsRef.current = events
            setXmlEvents(events)
        }
    }, [])

    // ─── Auto-mapping handlers ────────────────────────────────────
    const handleAutoMap = useCallback(async () => {
        if (!parsedMidi) { alert('Please load a MIDI file first.'); return }
        if (totalMeasures === 0 || noteCounts.size === 0) { alert('Please wait for score to process.'); return }

        if (confirm('Run AI-assisted Auto-Map?\n\nThis uses the local heuristic algorithm to establish a baseline, then sends it to Gemini to intelligently adjust for ritardandos/rubatos.')) {
            setIsAiMapping(true)
            try {
                const { autoMapMidiToScore } = await import('@/lib/engine/AutoMapper')
                const baseline = autoMapMidiToScore(parsedMidi.notes, noteCounts, totalMeasures)
                setAnchors(baseline)
                setBeatAnchors([])
            } catch (err) {
                console.error('[Auto Map Error]', err)
                alert('Auto-mapping failed.')
            } finally {
                setIsAiMapping(false)
            }
        }
    }, [parsedMidi, noteCounts, totalMeasures, setAnchors, setBeatAnchors])

    const handleAutoMapV4 = useCallback(async () => {
        if (!parsedMidi) { alert('Please load a MIDI file first.'); return }
        if (totalMeasures === 0 || xmlEvents.length === 0) { alert('Please wait for score to process.'); return }

        if (confirm('Run V4 Note-By-Note Auto-Map?')) {
            setIsAiMapping(true)
            try {
                const { autoMapByNoteV4, getAudioOffset } = await import('@/lib/engine/AutoMapper')
                const audioOffset = await getAudioOffset(config.audio_url || null)

                const { anchors: newAnchors, beatAnchors: newBeatAnchors } = autoMapByNoteV4(
                    parsedMidi.notes, xmlEvents, totalMeasures, audioOffset
                )

                if (newAnchors.length > 0) {
                    setAnchors(newAnchors)
                    setBeatAnchors(newBeatAnchors)
                    setIsLevel2Mode(true)
                }
            } catch (err) {
                console.error(err)
                alert('V4 mapping failed.')
            } finally {
                setIsAiMapping(false)
            }
        }
    }, [parsedMidi, xmlEvents, totalMeasures, config.audio_url, setAnchors, setBeatAnchors, setIsLevel2Mode])

    const handleStartV5 = useCallback(async (chordThresholdFraction: number) => {
        if (!parsedMidi) { alert('Please load a MIDI file first.'); return }
        if (totalMeasures === 0 || xmlEventsRef.current.length === 0) { alert('Please wait for score to process.'); return }

        setIsAiMapping(true)
        try {
            const { initV5, stepV5 } = await import('@/lib/engine/AutoMapperV5')

            let state = initV5(parsedMidi.notes, xmlEventsRef.current, 0, chordThresholdFraction)

            while (state.status === 'running') {
                state = stepV5(state, parsedMidi.notes, xmlEventsRef.current)
            }

            setV5State(state)

            if (state.status === 'done') {
                setAnchors(state.anchors)
                setBeatAnchors(state.beatAnchors)
                setIsLevel2Mode(true)
            } else if (state.status === 'paused') {
                setAnchors(state.anchors)
                setBeatAnchors(state.beatAnchors)
                setIsLevel2Mode(true)
            }
        } catch (err) {
            console.error('[V5 Error]', err)
            alert('V5 mapping failed.')
        } finally {
            setIsAiMapping(false)
        }
    }, [parsedMidi, totalMeasures, setAnchors, setBeatAnchors, setIsLevel2Mode])

    const handleConfirmGhost = useCallback(async () => {
        if (!v5State || v5State.status !== 'paused' || !v5State.ghostAnchor || !parsedMidi) return

        const { confirmGhost, stepV5 } = await import('@/lib/engine/AutoMapperV5')
        let state = confirmGhost(v5State, v5State.ghostAnchor.time)

        while (state.status === 'running') {
            state = stepV5(state, parsedMidi.notes, xmlEventsRef.current)
        }

        setV5State(state)
        setAnchors(state.anchors)
        setBeatAnchors(state.beatAnchors)
    }, [v5State, parsedMidi, setAnchors, setBeatAnchors])

    const handleProceedMapping = useCallback(async () => {
        await handleConfirmGhost()
    }, [handleConfirmGhost])

    const handleRunV5ToEnd = useCallback(async () => {
        if (!v5State || !parsedMidi) return

        const { runV5ToEnd } = await import('@/lib/engine/AutoMapperV5')
        const finalState = runV5ToEnd(v5State, parsedMidi.notes, xmlEventsRef.current)

        setV5State(finalState)
        setAnchors(finalState.anchors)
        setBeatAnchors(finalState.beatAnchors)
        setIsLevel2Mode(true)
    }, [v5State, parsedMidi, setAnchors, setBeatAnchors, setIsLevel2Mode])

    const handleUpdateGhostTime = useCallback((time: number) => {
        if (!v5State || !v5State.ghostAnchor) return
        setV5State({
            ...v5State,
            ghostAnchor: { ...v5State.ghostAnchor, time },
        })
    }, [v5State])

    // ─── Keyboard shortcuts ───────────────────────────────────────
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

            if (e.code === 'Space') { e.preventDefault(); handlePlayPause() }
            if (e.code === 'KeyA' && isRecording && isPlaying) {
                e.preventDefault()
                handleTap()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [isPlaying, isRecording, handlePlayPause, handleTap])

    return (
        <div className="h-screen flex overflow-hidden bg-zinc-950">
            <AnchorSidebar
                anchors={anchors}
                beatAnchors={beatAnchors}
                currentMeasure={currentMeasure}
                totalMeasures={totalMeasures || 100}
                isLevel2Mode={isLevel2Mode}
                subdivision={subdivision}
                darkMode={darkMode}
                onSetAnchor={handleSetAnchor}
                onDeleteAnchor={handleDeleteAnchor}
                onSetBeatAnchor={handleSetBeatAnchor}
                onToggleLevel2={setIsLevel2Mode}
                onSetSubdivision={setSubdivision}
                onRegenerateBeats={handleRegenerateBeats}
                onTap={handleTap}
                onClearAll={handleClearAll}
                onAutoMap={handleAutoMap}
                onAutoMapV4={handleAutoMapV4}
                onAutoMapV5={handleStartV5}
                onConfirmGhost={handleConfirmGhost}
                onProceedMapping={handleProceedMapping}
                onRunV5ToEnd={handleRunV5ToEnd}
                onUpdateGhostTime={handleUpdateGhostTime}
                v5State={v5State}
                isAiMapping={isAiMapping}
            />

            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex flex-col bg-zinc-900 border-b border-zinc-800 shrink-0">
                    {/* Row 1: Navigation, Title, Media indicators, Transport, Record */}
                    <div className="flex items-center justify-between px-4 py-2">
                        <div className="flex items-center gap-3">
                            <Button variant="ghost" size="sm" onClick={() => router.push('/demo')} className="text-zinc-400 hover:text-white">
                                <ArrowLeft className="w-4 h-4 mr-1" /> Back
                            </Button>
                            <span className="text-white text-lg font-medium">{title}</span>
                            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30">
                                <span className="text-xs text-amber-400 font-medium">DEMO MODE</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* Media indicators (read-only) */}
                            <Button variant="outline" size="sm" disabled className={`text-xs ${config.audio_url ? 'border-green-600 text-green-400' : 'border-zinc-700 text-zinc-400'}`}>
                                <FileAudio className="w-3.5 h-3.5 mr-1" /> WAV
                            </Button>
                            <Button variant="outline" size="sm" disabled className={`text-xs ${config.xml_url ? 'border-green-600 text-green-400' : 'border-zinc-700 text-zinc-400'}`}>
                                <FileMusic className="w-3.5 h-3.5 mr-1" /> XML
                            </Button>
                            <Button variant="outline" size="sm" disabled className={`text-xs ${config.midi_url ? 'border-green-600 text-green-400' : 'border-zinc-700 text-zinc-400'}`}>
                                <Music className="w-3.5 h-3.5 mr-1" /> MIDI
                            </Button>

                            <div className="w-px h-6 bg-zinc-700 mx-1" />

                            {/* Transport */}
                            <span className="font-mono text-xs text-zinc-400 w-12 text-right tabular-nums">
                                {formatTime(displayTime)}
                            </span>
                            <div className="w-36">
                                <Slider
                                    value={[displayTime]}
                                    min={0}
                                    max={duration || 100}
                                    step={0.1}
                                    onValueChange={(v) => handleSeek(v[0])}
                                    className="[&_[data-slot=slider-track]]:bg-zinc-700 [&_[data-slot=slider-range]]:bg-purple-500"
                                />
                            </div>
                            <span className="font-mono text-xs text-zinc-400 w-12 tabular-nums">
                                {formatTime(duration)}
                            </span>

                            <Button variant="ghost" size="sm" onClick={() => handleSeek(Math.max(0, displayTime - 5))} className="text-zinc-400 h-8 px-1" title="Skip back 5s">
                                <SkipBack className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleSeek(Math.max(0, displayTime - 0.05))} className="text-zinc-400 h-8 px-1" title="Back 1 frame">
                                <ChevronLeft className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" onClick={handlePlayPause} className="bg-purple-600 hover:bg-purple-700 text-white rounded-full w-8 h-8 p-0">
                                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleSeek(Math.min(duration, displayTime + 0.05))} className="text-zinc-400 h-8 px-1" title="Forward 1 frame">
                                <ChevronRight className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleStop} className="text-zinc-400 h-8 px-1">
                                <Square className="w-3.5 h-3.5" />
                            </Button>

                            <div className="w-px h-6 bg-zinc-700 mx-1" />

                            <Button size="sm" onClick={toggleRecordMode} className={`text-white ${isRecording ? 'bg-red-600 hover:bg-red-700 animate-pulse' : 'bg-zinc-700 hover:bg-zinc-600'}`}>
                                ⏺ {isRecording ? `Rec (M${nextMeasure})` : 'Record'}
                            </Button>
                        </div>
                    </div>

                    {/* Row 2: Font, ScoreControls */}
                    <div className="flex items-center justify-between px-4 py-1.5 border-t border-zinc-800/50">
                        <div className="flex items-center gap-2">
                            <select
                                value={musicFont}
                                onChange={(e) => setFont(e.target.value)}
                                className="text-xs px-2 py-1.5 rounded border bg-zinc-800 border-zinc-600 text-zinc-300 cursor-pointer hover:border-zinc-500"
                            >
                                <option value="Bravura">♪ Bravura</option>
                                <option value="Gonville">♪ Gonville</option>
                                <option value="Petaluma">♪ Petaluma</option>
                                <option value="Academico">♪ Academico</option>
                            </select>

                            <ScoreControls
                                revealMode={revealMode} darkMode={darkMode} highlightNote={highlightNote}
                                glowEffect={glowEffect} popEffect={popEffect} jumpEffect={jumpEffect}
                                isLocked={isLocked} showCursor={showCursor} isAdmin={true}
                                onRevealModeChange={setRevealMode} onDarkModeToggle={() => setDarkMode(!darkMode)}
                                onHighlightToggle={() => setHighlightNote(!highlightNote)} onGlowToggle={() => setGlowEffect(!glowEffect)}
                                onPopToggle={() => setPopEffect(!popEffect)} onJumpToggle={() => setJumpEffect(!jumpEffect)}
                                onLockToggle={() => setIsLocked(!isLocked)} onCursorToggle={() => setShowCursor(!showCursor)}
                            />
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-hidden">
                    <SplitScreenLayout
                        audioUrl={config.audio_url || null}
                        xmlUrl={config.xml_url || null}
                        parsedMidi={parsedMidi}
                        isAdmin={true}
                        musicFont={musicFont}
                        onUpdateAnchor={handleSetAnchor}
                        onUpdateBeatAnchor={handleSetBeatAnchor}
                        onScoreLoaded={handleScoreLoaded}
                    />
                </div>

                <div className="shrink-0 flex flex-col gap-0.5">
                    <MidiTimeline
                        parsedMidi={parsedMidi}
                        anchors={anchors}
                        beatAnchors={beatAnchors}
                        ghostAnchor={v5State?.ghostAnchor}
                        isPlaying={isPlaying}
                        duration={duration}
                        onSeek={handleSeek}
                        onAnchorDrag={handleSetAnchor}
                        onBeatAnchorDrag={handleSetBeatAnchor}
                        darkMode={darkMode}
                    />
                    <WaveformTimeline
                        audioUrl={config.audio_url || null}
                        anchors={anchors}
                        beatAnchors={beatAnchors}
                        isPlaying={isPlaying}
                        duration={duration}
                        onSeek={handleSeek}
                        onAnchorDrag={handleSetAnchor}
                        onBeatAnchorDrag={handleSetBeatAnchor}
                        darkMode={darkMode}
                    />
                </div>
            </div>
        </div>
    )
}
