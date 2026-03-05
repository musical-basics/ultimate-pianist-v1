'use client'

/**
 * User Playback View — Locked SplitScreenLayout for learning
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Play, Pause, Square, SkipBack, Music2, Palette, Sparkles, BookOpen, Piano } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { SplitScreenLayout } from '@/components/layout/SplitScreenLayout'
import { useAppStore } from '@/lib/store'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import { parseMidiFile } from '@/lib/midi/parser'
import { AudioSynth } from '@/lib/engine/AudioSynth'
import type { SongConfig, ParsedMidi } from '@/lib/types'

export default function LearnPlayback() {
    const params = useParams()
    const router = useRouter()
    const configId = params?.id as string

    const [config, setConfig] = useState<SongConfig | null>(null)
    const [parsedMidi, setParsedMidi] = useState<ParsedMidi | null>(null)
    const [loading, setLoading] = useState(true)
    const [initialLoading, setInitialLoading] = useState(true)
    const [musicFont, setMusicFont] = useState('')
    const [displayTime, setDisplayTime] = useState(0)
    const [volume, setVolumeLocal] = useState(100)
    const [tempo, setTempoLocal] = useState(100)

    const audioSynthRef = useRef<AudioSynth | null>(null)
    const displayRafRef = useRef<number>(0)
    const schedulerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const savedFontRef = useRef('')

    const isPlaying = useAppStore((s) => s.isPlaying)
    const setPlaying = useAppStore((s) => s.setPlaying)
    const setAnchors = useAppStore((s) => s.setAnchors)
    const setBeatAnchors = useAppStore((s) => s.setBeatAnchors)
    const loadMidi = useAppStore((s) => s.loadMidi)
    const duration = useAppStore((s) => s.duration)
    const leftHandActive = useAppStore((s) => s.leftHandActive)
    const rightHandActive = useAppStore((s) => s.rightHandActive)
    const toggleLeftHand = useAppStore((s) => s.toggleLeftHand)
    const toggleRightHand = useAppStore((s) => s.toggleRightHand)
    const velocityKeyColor = useAppStore((s) => s.velocityKeyColor)
    const setVelocityKeyColor = useAppStore((s) => s.setVelocityKeyColor)
    const noteGlow = useAppStore((s) => s.noteGlow)
    const setNoteGlow = useAppStore((s) => s.setNoteGlow)
    const showScore = useAppStore((s) => s.showScore)
    const setShowScore = useAppStore((s) => s.setShowScore)
    const showWaterfall = useAppStore((s) => s.showWaterfall)
    const setShowWaterfall = useAppStore((s) => s.setShowWaterfall)

    // ─── 2s loading overlay: fires on mount AND every tab-switch-back ──
    useEffect(() => {
        const triggerFontReload = () => {
            // Reset font to blank so VexFlow uses its default during the overlay
            setMusicFont('')
            setInitialLoading(true)
            // Re-apply saved font after 1s
            if (savedFontRef.current) {
                setTimeout(() => setMusicFont(savedFontRef.current), 1000)
            }
            // Hide overlay after 2s
            setTimeout(() => setInitialLoading(false), 1500)
        }

        // Fire on mount
        triggerFontReload()

        // Fire when user switches back to this tab
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                triggerFontReload()
            }
        }
        document.addEventListener('visibilitychange', onVisibilityChange)
        return () => document.removeEventListener('visibilitychange', onVisibilityChange)
    }, [])

    // ─── Load config ──────────────────────────────────────────────
    useEffect(() => {
        const load = async () => {
            try {
                const { fetchConfigById } = await import('@/app/actions/config')
                const data = await fetchConfigById(configId)
                if (data) {
                    setConfig(data)
                    if (data.anchors) setAnchors(data.anchors)
                    if (data.beat_anchors) setBeatAnchors(data.beat_anchors)
                    if (data.music_font) {
                        savedFontRef.current = data.music_font
                        setTimeout(() => setMusicFont(data.music_font!), 1000)
                    }
                }
            } catch (err) {
                console.error('Failed to load config:', err)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [configId, setAnchors, setBeatAnchors])

    // ─── Load MIDI ────────────────────────────────────────────────
    useEffect(() => {
        if (!config?.midi_url) return

        const loadMidiFile = async () => {
            try {
                const response = await fetch(config.midi_url!)
                const buffer = await response.arrayBuffer()
                const parsed = parseMidiFile(buffer)
                setParsedMidi(parsed)
                loadMidi(parsed)
                const pm = getPlaybackManager()
                pm.duration = parsed.durationSec
            } catch (err) {
                console.error('Failed to load MIDI:', err)
            }
        }
        loadMidiFile()
    }, [config?.midi_url, loadMidi])

    // ─── Display time loop (throttled to ~15fps to avoid React re-render storms) ──
    useEffect(() => {
        let lastUpdate = 0
        const tick = (ts: number) => {
            const pm = getPlaybackManager()
            if (!pm.isPlaying && isPlaying) setPlaying(false)
            // Only update React state at ~15fps — the slider doesn't need 60fps
            if (ts - lastUpdate > 66) {
                setDisplayTime(pm.getTime())
                lastUpdate = ts
            }
            displayRafRef.current = requestAnimationFrame(tick)
        }
        if (isPlaying) displayRafRef.current = requestAnimationFrame(tick)
        return () => { if (displayRafRef.current) cancelAnimationFrame(displayRafRef.current) }
    }, [isPlaying, setPlaying])

    // ─── Audio scheduler ──────────────────────────────────────────
    useEffect(() => {
        if (!isPlaying || !parsedMidi) return
        const schedule = () => {
            const pm = getPlaybackManager()
            const synth = audioSynthRef.current
            if (!synth?.loaded || !pm.isPlaying) return
            const muted = new Set<number>()
            if (!rightHandActive && parsedMidi.trackCount > 0) muted.add(0)
            if (!leftHandActive && parsedMidi.trackCount > 1) muted.add(1)
            synth.scheduleNotes(parsedMidi.notes, pm.getAudioContext().currentTime, pm.getTime(), tempo / 100, muted)
        }
        schedule()
        schedulerRef.current = setInterval(schedule, 1500)
        return () => { if (schedulerRef.current) clearInterval(schedulerRef.current) }
    }, [isPlaying, parsedMidi, tempo, leftHandActive, rightHandActive])

    // ─── Cleanup ──────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            audioSynthRef.current?.destroy()
            audioSynthRef.current = null
        }
    }, [])

    // ─── Transport handlers ───────────────────────────────────────
    const handlePlayPause = async () => {
        const pm = getPlaybackManager()
        if (isPlaying) {
            pm.pause()
            audioSynthRef.current?.stopAll()
            setPlaying(false)
        } else {
            // Initialize synth on first play (if no WAV master)
            if (!audioSynthRef.current && !config?.audio_url) {
                await pm.ensureResumed()
                const synth = new AudioSynth(pm.getAudioContext())
                await synth.load()
                synth.setVolume(volume)
                audioSynthRef.current = synth
            } else if (audioSynthRef.current && config?.audio_url) {
                audioSynthRef.current.masterAudioActive = true
            }
            pm.setPlaybackRate(tempo / 100)
            await pm.play()
            setPlaying(true)
        }
    }

    const handleStop = () => {
        const pm = getPlaybackManager()
        pm.stop()
        audioSynthRef.current?.stopAll()
        setPlaying(false)
        setDisplayTime(0)
    }

    const handleSeek = (time: number) => {
        const pm = getPlaybackManager()
        audioSynthRef.current?.stopAll()
        pm.seek(time)
        setDisplayTime(time)
    }

    // ─── Spacebar → play/pause ───────────────────────────────────
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
            if (e.code === 'Space') { e.preventDefault(); handlePlayPause() }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [isPlaying, handlePlayPause])

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60)
        const sec = Math.floor(s % 60)
        return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
        )
    }

    return (
        <div className="h-screen flex flex-col overflow-hidden bg-zinc-950 relative">
            {/* Hardcoded 2s loading overlay — hides font swap from students */}
            {initialLoading && (
                <div className="absolute inset-0 z-[100] bg-zinc-950/80 backdrop-blur-md flex items-center justify-center">
                    <div className="flex flex-col items-center gap-4">
                        <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-lg font-semibold text-white tracking-wide">LOADING</span>
                    </div>
                </div>
            )}
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/80 backdrop-blur-lg border-b border-zinc-800 shrink-0 z-50">
                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => router.push('/learn')}
                        className="text-zinc-400 hover:text-white"
                    >
                        <ArrowLeft className="w-4 h-4 mr-1" />
                        Library
                    </Button>
                    <div className="flex items-center gap-2">
                        <Music2 className="w-4 h-4 text-purple-400" />
                        <h1 className="font-medium text-white truncate max-w-xs">
                            {config?.title || 'Untitled'}
                        </h1>
                    </div>
                </div>

                {/* Transport */}
                <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-zinc-400 w-12 text-right tabular-nums">
                        {formatTime(displayTime)}
                    </span>
                    <div className="w-48">
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

                    <Button variant="ghost" size="sm" onClick={() => handleSeek(Math.max(0, displayTime - 5))} className="text-zinc-400 h-8">
                        <SkipBack className="w-4 h-4" />
                    </Button>
                    <Button size="sm" onClick={handlePlayPause} className="bg-purple-600 hover:bg-purple-700 text-white rounded-full w-10 h-10">
                        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleStop} className="text-zinc-400 h-8">
                        <Square className="w-4 h-4" />
                    </Button>
                </div>

                {/* View toggles + Hand toggles + tempo */}
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { if (showWaterfall) setShowScore(!showScore) }}
                        title={showScore ? 'Hide sheet music' : 'Show sheet music'}
                        className={`text-xs rounded-full px-3 h-7 ${showScore ? 'bg-purple-600 border-purple-600 text-white' : 'border-zinc-700 text-zinc-400'}`}
                    >
                        <BookOpen className="w-3 h-3" />
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { if (showScore) setShowWaterfall(!showWaterfall) }}
                        title={showWaterfall ? 'Hide waterfall' : 'Show waterfall'}
                        className={`text-xs rounded-full px-3 h-7 ${showWaterfall ? 'bg-purple-600 border-purple-600 text-white' : 'border-zinc-700 text-zinc-400'}`}
                    >
                        <Piano className="w-3 h-3" />
                    </Button>
                    <div className="w-px h-4 bg-zinc-700" />
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={toggleLeftHand}
                        className={`text-xs rounded-full px-3 h-7 ${leftHandActive ? 'bg-blue-600 border-blue-600 text-white' : 'border-zinc-700 text-zinc-400'}`}
                    >
                        L
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={toggleRightHand}
                        className={`text-xs rounded-full px-3 h-7 ${rightHandActive ? 'bg-green-600 border-green-600 text-white' : 'border-zinc-700 text-zinc-400'}`}
                    >
                        R
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setVelocityKeyColor(!velocityKeyColor)}
                        title={velocityKeyColor ? 'Key color: Velocity' : 'Key color: Purple'}
                        className={`text-xs rounded-full px-3 h-7 ${velocityKeyColor ? 'bg-orange-600 border-orange-600 text-white' : 'border-zinc-700 text-zinc-400'}`}
                    >
                        <Palette className="w-3 h-3" />
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setNoteGlow(!noteGlow)}
                        title={noteGlow ? 'Note glow: On' : 'Note glow: Off'}
                        className={`text-xs rounded-full px-3 h-7 ${noteGlow ? 'bg-orange-600 border-orange-600 text-white' : 'border-zinc-700 text-zinc-400'}`}
                    >
                        <Sparkles className="w-3 h-3" />
                    </Button>
                    <div className="flex items-center gap-1">
                        <span className="text-xs text-zinc-500">Tempo</span>
                        <Slider
                            value={[tempo]}
                            min={50}
                            max={200}
                            step={5}
                            onValueChange={(v) => {
                                setTempoLocal(v[0])
                                getPlaybackManager().setPlaybackRate(v[0] / 100)
                            }}
                            className="w-20 [&_[data-slot=slider-track]]:bg-zinc-700 [&_[data-slot=slider-range]]:bg-zinc-500"
                        />
                        <span className="font-mono text-xs text-zinc-400 w-9 tabular-nums">{tempo}%</span>
                    </div>
                </div>
            </div>

            {/* Main content */}
            <div className="flex-1 overflow-hidden">
                <SplitScreenLayout
                    audioUrl={config?.audio_url || null}
                    xmlUrl={config?.xml_url || null}
                    parsedMidi={parsedMidi}
                    isAdmin={false}
                    musicFont={musicFont}
                />
            </div>
        </div>
    )
}
