'use client'

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Save, ArrowLeft, Music, FileMusic, FileAudio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SplitScreenLayout } from '@/components/layout/SplitScreenLayout'
import { AnchorSidebar } from '@/components/score/AnchorSidebar'
import { WaveformTimeline } from '@/components/score/WaveformTimeline'
import { ScoreControls } from '@/components/score/ScoreControls'
import { useAppStore } from '@/lib/store'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import { parseMidiFile } from '@/lib/midi/parser'
import type { SongConfig, ParsedMidi, BeatAnchor } from '@/lib/types'
import { fetchConfigById, updateConfigAction } from '@/app/actions/config'
import { autoMapMidiToScore } from '@/lib/engine/AutoMapper'

export default function AdminEditor() {
    const params = useParams()
    const router = useRouter()
    const configId = params?.id as string

    const [config, setConfig] = useState<SongConfig | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [parsedMidi, setParsedMidi] = useState<ParsedMidi | null>(null)
    const [title, setTitle] = useState('')
    const [isRecording, setIsRecording] = useState(false)
    const [nextMeasure, setNextMeasure] = useState(2)
    const [totalMeasures, setTotalMeasures] = useState(0)
    const [noteCounts, setNoteCounts] = useState<Map<number, number>>(new Map())

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

    const audioInputRef = useRef<HTMLInputElement>(null)
    const xmlInputRef = useRef<HTMLInputElement>(null)
    const midiInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        const load = async () => {
            try {
                const data = await fetchConfigById(configId)
                if (data) {
                    setConfig(data)
                    setTitle(data.title)
                    if (data.anchors) setAnchors(data.anchors)
                    if (data.beat_anchors) setBeatAnchors(data.beat_anchors)
                    if (data.is_level2) setIsLevel2Mode(data.is_level2)
                    if (data.subdivision) setSubdivision(data.subdivision)
                }
            } catch (err) {
                console.error('Failed to load config:', err)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [configId, setAnchors, setBeatAnchors, setIsLevel2Mode, setSubdivision])

    useEffect(() => {
        if (!config?.midi_url) return
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
    }, [config?.midi_url, loadMidi])

    const handleSave = async () => {
        try {
            setSaving(true)
            await updateConfigAction(configId, {
                title, anchors, beat_anchors: beatAnchors,
                subdivision, is_level2: isLevel2Mode,
            })
        } catch (err) { console.error('Failed to save:', err) }
        finally { setSaving(false) }
    }

    const handleSaveAs = async () => {
        const newTitle = prompt('Enter a name for the copy:', `${title} (Copy)`)
        if (!newTitle) return
        try {
            setSaving(true)
            await updateConfigAction(configId, {
                title, anchors, beat_anchors: beatAnchors,
                subdivision, is_level2: isLevel2Mode,
            })
            const { duplicateConfigAction } = await import('@/app/actions/config')
            const newConfig = await duplicateConfigAction(configId, newTitle)
            router.push(`/admin/edit/${newConfig.id}`)
        } catch (err) { console.error('Save As failed:', err) }
        finally { setSaving(false) }
    }

    const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return
        try {
            const formData = new FormData()
            formData.append('file', file); formData.append('configId', configId); formData.append('fileType', 'audio')
            const res = await fetch('/api/upload', { method: 'POST', body: formData })
            const { url, error } = await res.json()
            if (error) throw new Error(error)
            await updateConfigAction(configId, { audio_url: url })
            setConfig((prev) => prev ? { ...prev, audio_url: url } : prev)
        } catch (err) { console.error(err) }
        e.target.value = ''
    }

    const handleXmlUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return
        try {
            const formData = new FormData()
            formData.append('file', file); formData.append('configId', configId); formData.append('fileType', 'xml')
            const res = await fetch('/api/upload', { method: 'POST', body: formData })
            const { url, error } = await res.json()
            if (error) throw new Error(error)
            await updateConfigAction(configId, { xml_url: url })
            setConfig((prev) => prev ? { ...prev, xml_url: url } : prev)
        } catch (err) { console.error(err) }
        e.target.value = ''
    }

    const handleMidiUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return
        try {
            const formData = new FormData()
            formData.append('file', file); formData.append('configId', configId); formData.append('fileType', 'midi')
            const res = await fetch('/api/upload', { method: 'POST', body: formData })
            const { url, error } = await res.json()
            if (error) throw new Error(error)
            await updateConfigAction(configId, { midi_url: url })
            setConfig((prev) => prev ? { ...prev, midi_url: url } : prev)

            const buffer = await file.arrayBuffer()
            const parsed = parseMidiFile(buffer, file.name)
            setParsedMidi(parsed); loadMidi(parsed)
            getPlaybackManager().duration = parsed.durationSec
        } catch (err) { console.error(err) }
        e.target.value = ''
    }

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

    const handlePlayPause = async () => {
        const pm = getPlaybackManager()
        if (isPlaying) { pm.pause(); setPlaying(false) }
        else { await pm.play(); setPlaying(true) }
    }

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

    const handleScoreLoaded = useCallback((total: number, counts: Map<number, number>) => {
        setTotalMeasures(total)
        setNoteCounts(counts)
    }, [])

    const handleAutoMap = useCallback(() => {
        if (!parsedMidi) {
            alert('Please load a MIDI file first.')
            return
        }
        if (totalMeasures === 0 || noteCounts.size === 0) {
            alert('Please wait for the MusicXML score to finish processing.')
            return
        }
        if (confirm('Auto-map using MIDI analysis? This will overwrite existing anchors.')) {
            const newAnchors = autoMapMidiToScore(parsedMidi.notes, noteCounts, totalMeasures)
            if (newAnchors.length > 0) {
                setAnchors(newAnchors)
                setBeatAnchors([]) // Clear beats since measure boundaries moved
            } else {
                alert('Could not generate anchors from MIDI.')
            }
        }
    }, [parsedMidi, noteCounts, totalMeasures, setAnchors, setBeatAnchors])

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


    if (loading) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
        )
    }

    return (
        <div className="h-screen flex overflow-hidden bg-zinc-950">
            <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={handleAudioUpload} />
            <input ref={xmlInputRef} type="file" accept=".xml,.musicxml,.mxl" className="hidden" onChange={handleXmlUpload} />
            <input ref={midiInputRef} type="file" accept=".mid,.midi" className="hidden" onChange={handleMidiUpload} />

            <AnchorSidebar
                anchors={anchors}
                beatAnchors={beatAnchors}
                currentMeasure={currentMeasure}
                totalMeasures={100}
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
            />

            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" size="sm" onClick={() => router.push('/admin')} className="text-zinc-400 hover:text-white">
                            <ArrowLeft className="w-4 h-4 mr-1" /> Back
                        </Button>
                        <input
                            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                            placeholder="Song title..."
                            className="bg-transparent border-none text-white text-lg font-medium focus:outline-none placeholder:text-zinc-600 w-64"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => audioInputRef.current?.click()} className={`text-xs ${config?.audio_url ? 'border-green-600 text-green-400' : 'border-zinc-700 text-zinc-400'}`}>
                            <FileAudio className="w-3.5 h-3.5 mr-1" /> WAV
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => xmlInputRef.current?.click()} className={`text-xs ${config?.xml_url ? 'border-green-600 text-green-400' : 'border-zinc-700 text-zinc-400'}`}>
                            <FileMusic className="w-3.5 h-3.5 mr-1" /> XML
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => midiInputRef.current?.click()} className={`text-xs ${config?.midi_url ? 'border-green-600 text-green-400' : 'border-zinc-700 text-zinc-400'}`}>
                            <Music className="w-3.5 h-3.5 mr-1" /> MIDI
                        </Button>

                        <div className="w-px h-6 bg-zinc-700 mx-1" />

                        <Button size="sm" onClick={handlePlayPause} className="bg-purple-600 hover:bg-purple-700 text-white">
                            {isPlaying ? '⏸ Pause' : '▶ Play'}
                        </Button>

                        <Button size="sm" onClick={toggleRecordMode} className={`text-white ${isRecording ? 'bg-red-600 hover:bg-red-700 animate-pulse' : 'bg-zinc-700 hover:bg-zinc-600'}`}>
                            ⏺ {isRecording ? `Rec (M${nextMeasure})` : 'Record'}
                        </Button>

                        <ScoreControls
                            revealMode={revealMode} darkMode={darkMode} highlightNote={highlightNote}
                            glowEffect={glowEffect} popEffect={popEffect} jumpEffect={jumpEffect}
                            isLocked={isLocked} showCursor={showCursor}
                            onRevealModeChange={setRevealMode} onDarkModeToggle={() => setDarkMode(!darkMode)}
                            onHighlightToggle={() => setHighlightNote(!highlightNote)} onGlowToggle={() => setGlowEffect(!glowEffect)}
                            onPopToggle={() => setPopEffect(!popEffect)} onJumpToggle={() => setJumpEffect(!jumpEffect)}
                            onLockToggle={() => setIsLocked(!isLocked)} onCursorToggle={() => setShowCursor(!showCursor)}
                        />

                        <div className="w-px h-6 bg-zinc-700 mx-1" />

                        <Button size="sm" onClick={handleSave} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white">
                            <Save className="w-3.5 h-3.5 mr-1" /> {saving ? 'Saving...' : 'Save'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleSaveAs} disabled={saving} className="border-zinc-600 text-zinc-300 hover:text-white">
                            Save As
                        </Button>
                    </div>
                </div>

                <div className="flex-1 overflow-hidden">
                    <SplitScreenLayout
                        audioUrl={config?.audio_url || null}
                        xmlUrl={config?.xml_url || null}
                        parsedMidi={parsedMidi}
                        isAdmin={true}
                        onUpdateAnchor={handleSetAnchor}
                        onUpdateBeatAnchor={handleSetBeatAnchor}
                        onScoreLoaded={handleScoreLoaded}
                    />
                </div>

                <div className="shrink-0">
                    <WaveformTimeline
                        audioUrl={config?.audio_url || null}
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
