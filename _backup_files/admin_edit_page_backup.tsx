'use client'

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Save, ArrowLeft, Music, FileMusic, FileAudio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SplitScreenLayout } from '@/components/layout/SplitScreenLayout'
import { AnchorSidebar } from '@/components/score/AnchorSidebar'
import { WaveformTimeline } from '@/components/score/WaveformTimeline'
import { MidiTimeline } from '@/components/score/MidiTimeline'
import { ScoreControls } from '@/components/score/ScoreControls'
import { useAppStore } from '@/lib/store'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import { parseMidiFile } from '@/lib/midi/parser'
import type { SongConfig, ParsedMidi, BeatAnchor, XMLEvent, V5MapperState } from '@/lib/types'
import { fetchConfigById, updateConfigAction } from '@/app/actions/config'

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
    const [isAiMapping, setIsAiMapping] = useState(false)
    const [nextMeasure, setNextMeasure] = useState(2)
    const [totalMeasures, setTotalMeasures] = useState(0)
    const [noteCounts, setNoteCounts] = useState<Map<number, number>>(new Map())
    const [xmlEvents, setXmlEvents] = useState<XMLEvent[]>([])
    const xmlEventsRef = useRef<XMLEvent[]>([]) // Persists fermata data across OSMD re-renders
    const [v5State, setV5State] = useState<V5MapperState | null>(null)
    const [musicFont, setMusicFont] = useState('')
    const savedFontRef = useRef('')

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
    const previewEffects = useAppStore((s) => s.previewEffects)
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

    // ─── Font reload on tab switch (same pattern as learn page) ──
    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible' && savedFontRef.current) {
                setMusicFont('')
                setTimeout(() => setMusicFont(savedFontRef.current), 1000)
            }
        }
        document.addEventListener('visibilitychange', onVisibilityChange)
        return () => document.removeEventListener('visibilitychange', onVisibilityChange)
    }, [])

    // ─── Font re-apply when toggles cause VexFlow re-render ──
    const prevTogglesRef = useRef({ previewEffects, revealMode, darkMode, popEffect, jumpEffect, glowEffect, highlightNote })
    useEffect(() => {
        const prev = prevTogglesRef.current
        const changed = prev.previewEffects !== previewEffects
            || prev.revealMode !== revealMode
            || prev.darkMode !== darkMode
            || prev.popEffect !== popEffect
            || prev.jumpEffect !== jumpEffect
            || prev.glowEffect !== glowEffect
            || prev.highlightNote !== highlightNote
        prevTogglesRef.current = { previewEffects, revealMode, darkMode, popEffect, jumpEffect, glowEffect, highlightNote }
        if (changed && savedFontRef.current) {
            setMusicFont('')
            setTimeout(() => setMusicFont(savedFontRef.current), 1000)
        }
    }, [previewEffects, revealMode, darkMode, popEffect, jumpEffect, glowEffect, highlightNote])

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
                    console.log('[FONT DEBUG] DB returned music_font:', JSON.stringify(data.music_font), 'type:', typeof data.music_font)
                    if (data.music_font) {
                        savedFontRef.current = data.music_font
                        // Delay applying saved font to let VexFlow fonts finish downloading first
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
            console.log('[FONT DEBUG] Saving music_font:', JSON.stringify(musicFont))
            await updateConfigAction(configId, {
                title, anchors, beat_anchors: beatAnchors,
                subdivision, is_level2: isLevel2Mode,
                music_font: musicFont,
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

    const handleScoreLoaded = useCallback((total: number, counts: Map<number, number>, events?: XMLEvent[]) => {
        setTotalMeasures(total)
        setNoteCounts(counts)
        // Persist xmlEvents in ref on FIRST load — ref survives OSMD re-renders
        if (events && events.length > 0 && xmlEventsRef.current.length === 0) {
            xmlEventsRef.current = events
            setXmlEvents(events)
            const fermataCount = events.filter(e => e.hasFermata).length
            console.log(`[EditPage] Locked ${events.length} xmlEvents into ref (${fermataCount} fermatas)`)
        }
    }, [])

    const handleAutoMap = useCallback(async () => {
        if (!parsedMidi) {
            alert('Please load a MIDI file first.')
            return
        }
        if (totalMeasures === 0 || noteCounts.size === 0) {
            alert('Please wait for the MusicXML score to finish processing.')
            return
        }

        if (confirm('Run AI-assisted Auto-Map?\n\nThis uses the local heuristic algorithm to establish a baseline, then sends it to Gemini to intelligently adjust for ritardandos/rubatos.')) {
            setIsAiMapping(true)
            try {
                // 1. Calculate Mathematical Baseline Heuristic (Locally)
                const { autoMapMidiToScore } = await import('@/lib/engine/AutoMapper')
                const baseline = autoMapMidiToScore(parsedMidi.notes, noteCounts, totalMeasures)

                // 2. Compress MIDI into clusters (saves tokens, makes AI reasoning easier)
                const simplifiedMidi = parsedMidi.notes.map(n => ({
                    t: Number(n.startTimeSec.toFixed(3)),
                    p: n.pitch
                }))

                // Convert ES6 Map to plain object for JSON transmission
                const expectedCountsObj: Record<number, number> = {}
                noteCounts.forEach((count, measure) => {
                    expectedCountsObj[measure] = count
                })

                // 3. Send to Gemini for intelligent correction
                const { generateAiAnchors } = await import('@/app/actions/ai')
                const aiAnchors = await generateAiAnchors(totalMeasures, expectedCountsObj, baseline, simplifiedMidi)

                if (aiAnchors && aiAnchors.length > 0) {
                    setAnchors(aiAnchors)
                    setBeatAnchors([]) // Clear beats since measure boundaries shifted
                } else {
                    alert('AI returned an empty mapping. Falling back to heuristic.')
                    setAnchors(baseline)
                    setBeatAnchors([])
                }
            } catch (err) {
                console.error('[AI Map Error]', err)
                alert('AI mapping failed (check console/API key). Falling back to pure heuristic baseline.')
                // 4. Graceful Fallback to pure heuristic
                const { autoMapMidiToScore } = await import('@/lib/engine/AutoMapper')
                const heuristicAnchors = autoMapMidiToScore(parsedMidi.notes, noteCounts, totalMeasures)
                setAnchors(heuristicAnchors)
                setBeatAnchors([])
            } finally {
                setIsAiMapping(false)
            }
        }
    }, [parsedMidi, noteCounts, totalMeasures, setAnchors, setBeatAnchors])

    // V4: Note-by-Note Explicit Rhythmic Mapping
    const handleAutoMapV4 = useCallback(async () => {
        if (!parsedMidi) { alert('Please load a MIDI file first.'); return; }
        if (totalMeasures === 0 || xmlEvents.length === 0) { alert('Please wait for score to process.'); return; }

        if (confirm('Run V4 Note-By-Note Auto-Map?\n\nThis will detect the audio offset, extract rhythmic chords from both MIDI and XML, and map them 1:1.')) {
            setIsAiMapping(true);
            try {
                const { autoMapByNoteV4, getAudioOffset } = await import('@/lib/engine/AutoMapper');
                const audioOffset = await getAudioOffset(config?.audio_url || null);

                const { anchors: newAnchors, beatAnchors: newBeatAnchors } = autoMapByNoteV4(
                    parsedMidi.notes, xmlEvents, totalMeasures, audioOffset
                );

                if (newAnchors.length > 0) {
                    setAnchors(newAnchors);
                    setBeatAnchors(newBeatAnchors);
                    setIsLevel2Mode(true); // Force Level 2 mode ON so the fractional beat anchors are used!
                }
            } catch (err) {
                console.error(err);
                alert('V4 mapping failed.');
            } finally {
                setIsAiMapping(false);
            }
        }
    }, [parsedMidi, xmlEvents, totalMeasures, config?.audio_url, setAnchors, setBeatAnchors, setIsLevel2Mode]);

    // V5: Echolocation Interactive Mapper
    const handleStartV5 = useCallback(async (chordThresholdFraction: number) => {
        if (!parsedMidi) { alert('Please load a MIDI file first.'); return; }
        if (totalMeasures === 0 || xmlEventsRef.current.length === 0) { alert('Please wait for score to process.'); return; }

        setIsAiMapping(true);
        try {
            const { initV5, stepV5 } = await import('@/lib/engine/AutoMapperV5');

            let state = initV5(parsedMidi.notes, xmlEventsRef.current, 0, chordThresholdFraction);

            // Auto-run steps until paused or done
            while (state.status === 'running') {
                state = stepV5(state, parsedMidi.notes, xmlEventsRef.current);
            }

            setV5State(state);

            if (state.status === 'done') {
                setAnchors(state.anchors);
                setBeatAnchors(state.beatAnchors);
                setIsLevel2Mode(true);
            } else if (state.status === 'paused') {
                // Apply partial results so user sees progress on the score
                setAnchors(state.anchors);
                setBeatAnchors(state.beatAnchors);
                setIsLevel2Mode(true);
            }
        } catch (err) {
            console.error('[V5 Error]', err);
            alert('V5 mapping failed (check console).');
        } finally {
            setIsAiMapping(false);
        }
    }, [parsedMidi, totalMeasures, config?.audio_url, setAnchors, setBeatAnchors, setIsLevel2Mode]);

    const handleConfirmGhost = useCallback(async () => {
        if (!v5State || v5State.status !== 'paused' || !v5State.ghostAnchor || !parsedMidi) return;

        const { confirmGhost, stepV5 } = await import('@/lib/engine/AutoMapperV5');
        let state = confirmGhost(v5State, v5State.ghostAnchor.time);

        // Continue stepping after confirm
        while (state.status === 'running') {
            state = stepV5(state, parsedMidi.notes, xmlEventsRef.current);
        }

        setV5State(state);
        setAnchors(state.anchors);
        setBeatAnchors(state.beatAnchors);
    }, [v5State, parsedMidi, setAnchors, setBeatAnchors]);

    const handleProceedMapping = useCallback(async () => {
        // Same as confirm — confirm at current ghost time, then continue
        await handleConfirmGhost();
    }, [handleConfirmGhost]);

    const handleRunV5ToEnd = useCallback(async () => {
        if (!v5State || !parsedMidi) return;

        const { runV5ToEnd } = await import('@/lib/engine/AutoMapperV5');
        const finalState = runV5ToEnd(v5State, parsedMidi.notes, xmlEventsRef.current);

        setV5State(finalState);
        setAnchors(finalState.anchors);
        setBeatAnchors(finalState.beatAnchors);
        setIsLevel2Mode(true);
    }, [v5State, parsedMidi, setAnchors, setBeatAnchors, setIsLevel2Mode]);

    const handleUpdateGhostTime = useCallback((time: number) => {
        if (!v5State || !v5State.ghostAnchor) return;
        setV5State({
            ...v5State,
            ghostAnchor: { ...v5State.ghostAnchor, time },
        });
    }, [v5State]);

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

                        <select
                            value={musicFont}
                            onChange={(e) => { setMusicFont(e.target.value); savedFontRef.current = e.target.value }}
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
