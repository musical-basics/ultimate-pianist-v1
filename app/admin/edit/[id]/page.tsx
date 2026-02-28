'use client'

/**
 * Admin Editor — Full editor with SplitScreenLayout, AnchorSidebar, WaveformTimeline
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
    Save,
    Upload,
    ArrowLeft,
    Music,
    FileMusic,
    FileAudio,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SplitScreenLayout } from '@/components/layout/SplitScreenLayout'
import { AnchorSidebar } from '@/components/score/AnchorSidebar'
import { WaveformTimeline } from '@/components/score/WaveformTimeline'
import { ScoreControls } from '@/components/score/ScoreControls'
import { useAppStore } from '@/lib/store'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import { parseMidiFile } from '@/lib/midi/parser'
import type { SongConfig, Anchor, ParsedMidi } from '@/lib/types'
import {
    fetchConfigById,
    updateConfigAction,
} from '@/app/actions/config'

export default function AdminEditor() {
    const params = useParams()
    const router = useRouter()
    const configId = params?.id as string

    // ─── Local state ──────────────────────────────────────────────
    const [config, setConfig] = useState<SongConfig | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [parsedMidi, setParsedMidi] = useState<ParsedMidi | null>(null)
    const [title, setTitle] = useState('')
    const [isRecording, setIsRecording] = useState(false)
    const [nextMeasure, setNextMeasure] = useState(2) // next measure to map (1 is always at t=0)

    // ─── Store ────────────────────────────────────────────────────
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

    // ─── File Input Refs ──────────────────────────────────────────
    const audioInputRef = useRef<HTMLInputElement>(null)
    const xmlInputRef = useRef<HTMLInputElement>(null)
    const midiInputRef = useRef<HTMLInputElement>(null)

    // ─── Load Config ──────────────────────────────────────────────
    useEffect(() => {
        const load = async () => {
            try {
                const data = await fetchConfigById(configId)
                if (data) {
                    setConfig(data)
                    setTitle(data.title)
                    if (data.anchors) setAnchors(data.anchors)
                    if (data.beat_anchors) setBeatAnchors(data.beat_anchors)
                }
            } catch (err) {
                console.error('Failed to load config:', err)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [configId, setAnchors, setBeatAnchors])

    // ─── Load MIDI from URL ───────────────────────────────────────
    useEffect(() => {
        if (!config?.midi_url) return

        const loadMidiFromUrl = async () => {
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
        loadMidiFromUrl()
    }, [config?.midi_url, loadMidi])

    // ─── Save ─────────────────────────────────────────────────────
    const handleSave = async () => {
        try {
            setSaving(true)
            await updateConfigAction(configId, {
                title,
                anchors,
                beat_anchors: beatAnchors,
                subdivision,
                is_level2: isLevel2Mode,
            })
            console.log('[Admin] Config saved')
        } catch (err) {
            console.error('Failed to save:', err)
        } finally {
            setSaving(false)
        }
    }

    // ─── Save As ──────────────────────────────────────────────────
    const handleSaveAs = async () => {
        const newTitle = prompt('Enter a name for the copy:', `${title} (Copy)`)
        if (!newTitle) return

        try {
            setSaving(true)
            // First save current state
            await updateConfigAction(configId, {
                title,
                anchors,
                beat_anchors: beatAnchors,
                subdivision,
                is_level2: isLevel2Mode,
            })
            // Then duplicate
            const { duplicateConfigAction } = await import('@/app/actions/config')
            const newConfig = await duplicateConfigAction(configId, newTitle)
            console.log('[Admin] Saved as:', newConfig.id)
            router.push(`/admin/edit/${newConfig.id}`)
        } catch (err) {
            console.error('Save As failed:', err)
        } finally {
            setSaving(false)
        }
    }

    // ─── File Upload Handlers ─────────────────────────────────────
    const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        try {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('configId', configId)
            formData.append('fileType', 'audio')
            const res = await fetch('/api/upload', { method: 'POST', body: formData })
            const { url, error } = await res.json()
            if (error) throw new Error(error)
            await updateConfigAction(configId, { audio_url: url })
            setConfig((prev) => prev ? { ...prev, audio_url: url } : prev)
            console.log('[Admin] Audio uploaded:', url)
        } catch (err) {
            console.error('Failed to upload audio:', err)
        }
        e.target.value = ''
    }

    const handleXmlUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        try {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('configId', configId)
            formData.append('fileType', 'xml')
            const res = await fetch('/api/upload', { method: 'POST', body: formData })
            const { url, error } = await res.json()
            if (error) throw new Error(error)
            await updateConfigAction(configId, { xml_url: url })
            setConfig((prev) => prev ? { ...prev, xml_url: url } : prev)
            console.log('[Admin] XML uploaded:', url)
        } catch (err) {
            console.error('Failed to upload XML:', err)
        }
        e.target.value = ''
    }

    const handleMidiUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        try {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('configId', configId)
            formData.append('fileType', 'midi')
            const res = await fetch('/api/upload', { method: 'POST', body: formData })
            const { url, error } = await res.json()
            if (error) throw new Error(error)
            await updateConfigAction(configId, { midi_url: url })
            setConfig((prev) => prev ? { ...prev, midi_url: url } : prev)

            // Also parse the MIDI locally
            const buffer = await file.arrayBuffer()
            const parsed = parseMidiFile(buffer, file.name)
            setParsedMidi(parsed)
            loadMidi(parsed)

            const pm = getPlaybackManager()
            pm.duration = parsed.durationSec

            console.log('[Admin] MIDI uploaded:', url)
        } catch (err) {
            console.error('Failed to upload MIDI:', err)
        }
        e.target.value = ''
    }

    // ─── Anchor Handlers ──────────────────────────────────────────
    const handleSetAnchor = useCallback((measure: number, time: number) => {
        setAnchors(
            anchors.map((a) => (a.measure === measure ? { ...a, time } : a))
        )
    }, [anchors, setAnchors])

    const handleDeleteAnchor = useCallback((measure: number) => {
        if (measure === 1) return // Can't delete measure 1
        setAnchors(anchors.filter((a) => a.measure !== measure))
    }, [anchors, setAnchors])

    // ─── Play/Pause ───────────────────────────────────────────────
    const handlePlayPause = async () => {
        const pm = getPlaybackManager()
        if (isPlaying) {
            pm.pause()
            setPlaying(false)
        } else {
            await pm.play()
            setPlaying(true)
        }
    }

    // ─── Keyboard shortcuts ────────────────────────────────────────
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            // Don't trigger when typing in inputs
            const tag = (e.target as HTMLElement)?.tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

            if (e.code === 'Space') {
                e.preventDefault()
                handlePlayPause()
            }

            // A key — record anchor at current time
            if (e.code === 'KeyA' && isRecording && isPlaying) {
                e.preventDefault()
                const pm = getPlaybackManager()
                const time = pm.getTime()
                const measure = nextMeasure

                // Add or update anchor for this measure
                const existing = anchors.find((a) => a.measure === measure)
                if (existing) {
                    setAnchors(anchors.map((a) => a.measure === measure ? { ...a, time } : a))
                } else {
                    const newAnchors = [...anchors, { measure, time }].sort((a, b) => a.measure - b.measure)
                    setAnchors(newAnchors)
                }
                setNextMeasure(measure + 1)
                console.log(`[Record] Mapped measure ${measure} → ${time.toFixed(2)}s`)
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [isPlaying, isRecording, nextMeasure, anchors, setAnchors])

    const handleSeek = useCallback((time: number) => {
        const pm = getPlaybackManager()
        pm.seek(time)
    }, [])

    // ─── AI Predict ───────────────────────────────────────────────
    const [aiStatus, setAiStatus] = useState<string | null>(null)

    const handleAIPredict = async () => {
        if (!config?.audio_url || !config?.xml_url) {
            alert('Upload both audio and XML files before running AI prediction.')
            return
        }
        try {
            setAiStatus('Downloading XML...')
            const xmlRes = await fetch(config.xml_url)
            const xmlContent = await xmlRes.text()

            setAiStatus('AI is analyzing audio — this may take a minute...')
            const { predictAnchors } = await import('@/app/actions/ai')
            const result = await predictAnchors(
                config.audio_url,
                xmlContent,
                100
            )

            if (result.anchors.length > 0) {
                // Sort by measure number
                const sorted = [...result.anchors].sort((a, b) => a.measure - b.measure)

                // Find which measures are already manually mapped
                const existingMeasures = new Set(anchors.map((a) => a.measure))
                const newOnly = sorted.filter((a) => !existingMeasures.has(a.measure))
                const keepExisting = [...anchors] // preserve manual mappings

                if (newOnly.length === 0) {
                    setAiStatus(`All ${sorted.length} measures already mapped — nothing to add.`)
                    setTimeout(() => setAiStatus(null), 3000)
                } else {
                    setAiStatus(`Keeping ${existingMeasures.size} manual anchors, adding ${newOnly.length} AI anchors...`)
                    await new Promise((r) => setTimeout(r, 500))

                    // Progressive reveal: add new AI anchors one at a time
                    let merged = [...keepExisting]
                    for (let i = 0; i < newOnly.length; i++) {
                        merged = [...merged, newOnly[i]].sort((a, b) => a.measure - b.measure)
                        setAnchors(merged)
                        setAiStatus(`AI → measure ${newOnly[i].measure} → ${newOnly[i].time.toFixed(2)}s  (${i + 1}/${newOnly.length} new)`)
                        await new Promise((r) => setTimeout(r, 120))
                    }

                    console.log('[AI] Prediction complete:', newOnly.length, 'new anchors added,', existingMeasures.size, 'kept')
                    setAiStatus(`Done! ${newOnly.length} new anchors added (${existingMeasures.size} manual kept).`)
                    setTimeout(() => setAiStatus(null), 3000)
                }
            } else {
                setAiStatus('AI returned no anchors — try again or map manually.')
                setTimeout(() => setAiStatus(null), 4000)
            }
        } catch (err) {
            console.error('[AI] Prediction failed:', err)
            setAiStatus(`Error: ${err instanceof Error ? err.message : 'Prediction failed'}`)
            setTimeout(() => setAiStatus(null), 5000)
        }
    }

    const handleTeachAI = async () => {
        try {
            await updateConfigAction(configId, { ai_anchors: anchors })
            console.log('[AI] Teaching data saved')
        } catch (err) {
            console.error('[AI] Teaching failed:', err)
        }
    }

    // ─── Record Mode Toggle ──────────────────────────────────────
    const toggleRecordMode = () => {
        if (!isRecording) {
            // Find the next unmapped measure
            const maxMeasure = anchors.length > 0 ? Math.max(...anchors.map((a) => a.measure)) : 1
            setNextMeasure(maxMeasure + 1)
        }
        setIsRecording(!isRecording)
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            </div>
        )
    }

    return (
        <div className="h-screen flex overflow-hidden bg-zinc-950">
            {/* Hidden file inputs */}
            <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={handleAudioUpload} />
            <input ref={xmlInputRef} type="file" accept=".xml,.musicxml,.mxl" className="hidden" onChange={handleXmlUpload} />
            <input ref={midiInputRef} type="file" accept=".mid,.midi" className="hidden" onChange={handleMidiUpload} />

            {/* Left Sidebar: Anchor Editor */}
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
                onToggleLevel2={setIsLevel2Mode}
                onSetSubdivision={setSubdivision}
                onAIPredict={handleAIPredict}
                onTeachAI={handleTeachAI}
            />

            {/* Main content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Top toolbar */}
                <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push('/admin')}
                            className="text-zinc-400 hover:text-white"
                        >
                            <ArrowLeft className="w-4 h-4 mr-1" />
                            Back
                        </Button>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Song title..."
                            className="bg-transparent border-none text-white text-lg font-medium focus:outline-none placeholder:text-zinc-600 w-64"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Upload buttons */}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => audioInputRef.current?.click()}
                            className={`text-xs ${config?.audio_url ? 'border-green-600 text-green-400' : 'border-zinc-700 text-zinc-400'}`}
                        >
                            <FileAudio className="w-3.5 h-3.5 mr-1" />
                            WAV
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => xmlInputRef.current?.click()}
                            className={`text-xs ${config?.xml_url ? 'border-green-600 text-green-400' : 'border-zinc-700 text-zinc-400'}`}
                        >
                            <FileMusic className="w-3.5 h-3.5 mr-1" />
                            XML
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => midiInputRef.current?.click()}
                            className={`text-xs ${config?.midi_url ? 'border-green-600 text-green-400' : 'border-zinc-700 text-zinc-400'}`}
                        >
                            <Music className="w-3.5 h-3.5 mr-1" />
                            MIDI
                        </Button>

                        <div className="w-px h-6 bg-zinc-700 mx-1" />

                        {/* Play/Pause */}
                        <Button
                            size="sm"
                            onClick={handlePlayPause}
                            className="bg-purple-600 hover:bg-purple-700 text-white"
                        >
                            {isPlaying ? '⏸ Pause' : '▶ Play'}
                        </Button>

                        {/* Record Mode */}
                        <Button
                            size="sm"
                            onClick={toggleRecordMode}
                            className={`text-white ${isRecording ? 'bg-red-600 hover:bg-red-700 animate-pulse' : 'bg-zinc-700 hover:bg-zinc-600'}`}
                        >
                            ⏺ {isRecording ? `Rec (M${nextMeasure})` : 'Record'}
                        </Button>

                        {/* Score Controls */}
                        <ScoreControls
                            revealMode={revealMode}
                            darkMode={darkMode}
                            highlightNote={highlightNote}
                            glowEffect={glowEffect}
                            popEffect={popEffect}
                            jumpEffect={jumpEffect}
                            isLocked={isLocked}
                            showCursor={showCursor}
                            onRevealModeChange={setRevealMode}
                            onDarkModeToggle={() => setDarkMode(!darkMode)}
                            onHighlightToggle={() => setHighlightNote(!highlightNote)}
                            onGlowToggle={() => setGlowEffect(!glowEffect)}
                            onPopToggle={() => setPopEffect(!popEffect)}
                            onJumpToggle={() => setJumpEffect(!jumpEffect)}
                            onLockToggle={() => setIsLocked(!isLocked)}
                            onCursorToggle={() => setShowCursor(!showCursor)}
                        />

                        <div className="w-px h-6 bg-zinc-700 mx-1" />

                        {/* Save */}
                        <Button
                            size="sm"
                            onClick={handleSave}
                            disabled={saving}
                            className="bg-green-600 hover:bg-green-700 text-white"
                        >
                            <Save className="w-3.5 h-3.5 mr-1" />
                            {saving ? 'Saving...' : 'Save'}
                        </Button>

                        {/* Save As */}
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleSaveAs}
                            disabled={saving}
                            className="border-zinc-600 text-zinc-300 hover:text-white"
                        >
                            Save As
                        </Button>
                    </div>
                </div>

                {/* SplitScreenLayout */}
                <div className="flex-1 overflow-hidden">
                    <SplitScreenLayout
                        audioUrl={config?.audio_url || null}
                        xmlUrl={config?.xml_url || null}
                        parsedMidi={parsedMidi}
                        isAdmin={true}
                    />
                </div>

                {/* Bottom: AI Status + Waveform Timeline */}
                {aiStatus && (
                    <div className="px-4 py-1.5 bg-purple-900/30 border-t border-purple-800/50 shrink-0">
                        <p className="text-xs text-purple-300 font-mono animate-pulse">
                            🤖 {aiStatus}
                        </p>
                    </div>
                )}
                <div className="px-4 py-2 bg-zinc-900 border-t border-zinc-800 shrink-0">
                    <WaveformTimeline
                        audioUrl={config?.audio_url || null}
                        anchors={anchors}
                        beatAnchors={beatAnchors}
                        isPlaying={isPlaying}
                        duration={duration}
                        onSeek={handleSeek}
                        darkMode={darkMode}
                    />
                </div>
            </div>
        </div>
    )
}
