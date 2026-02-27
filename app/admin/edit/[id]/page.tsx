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
                const { getConfigById } = await import('@/lib/services/configService')
                const data = await getConfigById(configId)
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
            const { updateConfig } = await import('@/lib/services/configService')
            await updateConfig(configId, {
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

    // ─── File Upload Handlers ─────────────────────────────────────
    const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        try {
            const { uploadAudio, updateConfig } = await import('@/lib/services/configService')
            const url = await uploadAudio(file, configId)
            await updateConfig(configId, { audio_url: url })
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
            const { uploadXml, updateConfig } = await import('@/lib/services/configService')
            const url = await uploadXml(file, configId)
            await updateConfig(configId, { xml_url: url })
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
            const { uploadMidi, updateConfig } = await import('@/lib/services/configService')
            const url = await uploadMidi(file, configId)
            await updateConfig(configId, { midi_url: url })
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

    const handleSeek = useCallback((time: number) => {
        const pm = getPlaybackManager()
        pm.seek(time)
    }, [])

    // ─── AI Predict ───────────────────────────────────────────────
    const handleAIPredict = async () => {
        if (!config?.audio_url || !config?.xml_url) {
            alert('Upload both audio and XML files before running AI prediction.')
            return
        }
        try {
            // Fetch audio as base64
            const audioRes = await fetch(config.audio_url)
            const audioBlob = await audioRes.blob()
            const base64 = await blobToBase64(audioBlob)

            // Fetch XML content
            const xmlRes = await fetch(config.xml_url)
            const xmlContent = await xmlRes.text()

            const { predictAnchors } = await import('@/app/actions/ai')
            const result = await predictAnchors(
                base64,
                audioBlob.type || 'audio/wav',
                xmlContent,
                100 // totalMeasures — will be refined
            )

            if (result.anchors.length > 0) {
                setAnchors(result.anchors)
                console.log('[AI] Prediction complete:', result.anchors.length, 'anchors')
            }
        } catch (err) {
            console.error('[AI] Prediction failed:', err)
        }
    }

    const handleTeachAI = async () => {
        try {
            const { updateConfig } = await import('@/lib/services/configService')
            await updateConfig(configId, { ai_anchors: anchors })
            console.log('[AI] Teaching data saved')
        } catch (err) {
            console.error('[AI] Teaching failed:', err)
        }
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

                {/* Bottom: Waveform Timeline */}
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

// Helper: Blob → base64 string
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => {
            const result = reader.result as string
            // Remove the data URL prefix (e.g., "data:audio/wav;base64,")
            const base64 = result.split(',')[1] || result
            resolve(base64)
        }
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
}
