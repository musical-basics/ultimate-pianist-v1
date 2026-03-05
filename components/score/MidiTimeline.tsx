'use client'

import * as React from 'react'
import { useRef, useEffect, useCallback, useState } from 'react'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import { Search } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import type { Anchor, BeatAnchor, ParsedMidi } from '@/lib/types'

// ─── Helpers ───────────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function midiToName(midi: number): string {
    const octave = Math.floor(midi / 12) - 1
    return `${NOTE_NAMES[midi % 12]}${octave}`
}

// ─── Component ─────────────────────────────────────────────────────────

interface MidiTimelineProps {
    parsedMidi: ParsedMidi | null
    anchors: Anchor[]
    beatAnchors?: BeatAnchor[]
    ghostAnchor?: { measure: number; beat: number; time: number } | null
    isPlaying: boolean
    duration: number
    onSeek: (time: number) => void
    onAnchorDrag?: (measure: number, newTime: number) => void
    onBeatAnchorDrag?: (measure: number, beat: number, newTime: number) => void
    darkMode?: boolean
}

export const MidiTimeline: React.FC<MidiTimelineProps> = ({
    parsedMidi,
    anchors,
    beatAnchors = [],
    ghostAnchor,
    isPlaying,
    duration,
    onSeek,
    onAnchorDrag,
    onBeatAnchorDrag,
    darkMode = false,
}) => {
    const [zoom, setZoom] = useState(100) // pixels per second
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const playbackCursorRef = useRef<HTMLDivElement>(null)
    const rafRef = useRef<number>(0)

    // Auto-compress: compute used pitch range
    const pitchRange = React.useMemo(() => {
        if (!parsedMidi || parsedMidi.notes.length === 0) return { min: 48, max: 84, count: 37 }
        let min = 127, max = 0
        for (const n of parsedMidi.notes) {
            if (n.pitch < min) min = n.pitch
            if (n.pitch > max) max = n.pitch
        }
        // Add 2 semitone padding on each side
        min = Math.max(0, min - 2)
        max = Math.min(127, max + 2)
        return { min, max, count: max - min + 1 }
    }, [parsedMidi])

    const LABEL_WIDTH = 36 // space for note labels on left
    const ROW_HEIGHT = Math.max(3, Math.min(8, Math.floor(160 / pitchRange.count))) // Scale rows to fit ~160px height
    const CANVAS_HEIGHT = pitchRange.count * ROW_HEIGHT
    const totalDuration = parsedMidi?.durationSec || duration || 60

    // Draw the piano roll
    const drawPianoRoll = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas || !parsedMidi) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const width = Math.ceil(totalDuration * zoom) + LABEL_WIDTH
        const height = CANVAS_HEIGHT

        if (canvas.width !== width) canvas.width = width
        if (canvas.height !== height) canvas.height = height

        ctx.clearRect(0, 0, width, height)

        // Background
        ctx.fillStyle = darkMode ? '#0f0f12' : '#fafafa'
        ctx.fillRect(0, 0, width, height)

        // Pitch rows (alternating for black/white keys)
        for (let p = pitchRange.min; p <= pitchRange.max; p++) {
            const y = (pitchRange.max - p) * ROW_HEIGHT
            const isBlack = [1, 3, 6, 8, 10].includes(p % 12)
            ctx.fillStyle = isBlack
                ? (darkMode ? '#16161d' : '#f0f0f0')
                : (darkMode ? '#1a1a22' : '#fafafa')
            ctx.fillRect(LABEL_WIDTH, y, width - LABEL_WIDTH, ROW_HEIGHT)

            // Row border
            ctx.fillStyle = darkMode ? '#222230' : '#e4e4e7'
            ctx.fillRect(LABEL_WIDTH, y + ROW_HEIGHT - 1, width - LABEL_WIDTH, 1)
        }

        // Pitch labels (left gutter)
        ctx.fillStyle = darkMode ? '#1c1c24' : '#f4f4f5'
        ctx.fillRect(0, 0, LABEL_WIDTH, height)
        ctx.fillStyle = darkMode ? '#52525b' : '#a1a1aa'
        ctx.font = '8px monospace'
        ctx.textBaseline = 'middle'
        for (let p = pitchRange.min; p <= pitchRange.max; p++) {
            const y = (pitchRange.max - p) * ROW_HEIGHT
            // Only label C notes and first/last for clarity
            if (p % 12 === 0 || p === pitchRange.min || p === pitchRange.max) {
                ctx.fillStyle = darkMode ? '#71717a' : '#71717a'
                ctx.fillText(midiToName(p), 2, y + ROW_HEIGHT / 2)
            }
        }

        // Time grid (seconds)
        ctx.textBaseline = 'top'
        for (let t = 0; t <= totalDuration; t++) {
            const x = LABEL_WIDTH + (t * zoom)
            ctx.fillStyle = darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
            ctx.fillRect(x, 0, 1, height)
            if (t % Math.max(1, Math.floor(20 / zoom * 10)) === 0) {
                ctx.fillStyle = darkMode ? '#52525b' : '#a1a1aa'
                ctx.font = '8px monospace'
                ctx.fillText(`${t}s`, x + 2, 1)
            }
        }

        // Draw MIDI notes as horizontal bars
        for (const note of parsedMidi.notes) {
            if (note.pitch < pitchRange.min || note.pitch > pitchRange.max) continue
            const x = LABEL_WIDTH + (note.startTimeSec * zoom)
            const w = Math.max(2, note.durationSec * zoom)
            const y = (pitchRange.max - note.pitch) * ROW_HEIGHT

            // Note color based on velocity — smooth rainbow spectrum
            const v = Math.max(0, Math.min(127, note.velocity))
            let hue: number
            if (v <= 20) hue = 270          // purple
            else if (v >= 100) hue = 0      // red
            else hue = 270 * (1 - (v - 20) / 80) // smooth rainbow
            const alpha = 0.6 + (note.velocity / 127) * 0.4
            ctx.fillStyle = `hsla(${hue}, 85%, 55%, ${alpha})`
            ctx.beginPath()
            ctx.roundRect(x, y + 1, w, ROW_HEIGHT - 2, 1)
            ctx.fill()

            // Note border
            ctx.strokeStyle = `hsla(${hue}, 85%, 45%, 0.6)`
            ctx.lineWidth = 0.5
            ctx.stroke()
        }
    }, [parsedMidi, zoom, darkMode, pitchRange, ROW_HEIGHT, CANVAS_HEIGHT, totalDuration])

    useEffect(() => { drawPianoRoll() }, [drawPianoRoll])

    // Animation loop for playback cursor
    useEffect(() => {
        if (!parsedMidi) return
        const animate = () => {
            const pm = getPlaybackManager()
            const time = pm.getTime()

            if (playbackCursorRef.current) {
                const x = LABEL_WIDTH + (time * zoom)
                playbackCursorRef.current.style.transform = `translateX(${x}px)`

                if (isPlaying && containerRef.current) {
                    const c = containerRef.current
                    if (x > c.scrollLeft + c.clientWidth * 0.8) {
                        c.scrollLeft = x - c.clientWidth * 0.2
                    } else if (x < c.scrollLeft) {
                        c.scrollLeft = Math.max(0, x - 50)
                    }
                }
            }
            rafRef.current = requestAnimationFrame(animate)
        }
        rafRef.current = requestAnimationFrame(animate)
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
    }, [isPlaying, zoom, parsedMidi])

    const handleClick = (e: React.PointerEvent) => {
        const container = containerRef.current
        if (!container || !parsedMidi) return
        const rect = container.getBoundingClientRect()
        const clickX = (e.clientX - rect.left) + container.scrollLeft - LABEL_WIDTH
        if (clickX < 0) return
        onSeek(Math.max(0, Math.min(totalDuration, clickX / zoom)))
    }

    if (!parsedMidi) {
        return (
            <div className={`w-full flex items-center justify-center h-20 text-xs ${darkMode ? 'bg-zinc-900 text-zinc-500 border-zinc-800' : 'bg-zinc-100 text-zinc-400 border-zinc-200'} border rounded-md`}>
                No MIDI loaded — upload a .mid file to see the piano roll
            </div>
        )
    }

    return (
        <div className={`w-full flex flex-col ${darkMode ? 'bg-zinc-900' : 'bg-zinc-100'} rounded-md overflow-hidden border ${darkMode ? 'border-zinc-800' : 'border-zinc-200'}`}>
            {/* Header */}
            <div className={`flex items-center justify-between px-3 h-7 ${darkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-200 text-zinc-600'} text-xs border-b ${darkMode ? 'border-zinc-700' : 'border-zinc-300'} shrink-0`}>
                <span className="font-bold uppercase tracking-wider text-[10px]">MIDI Piano Roll</span>
                <div className="flex gap-2 items-center">
                    <span className="text-[10px] text-zinc-500">
                        {parsedMidi.notes.length} notes · {midiToName(pitchRange.min)}–{midiToName(pitchRange.max)}
                    </span>
                    <Search className="w-3 h-3" />
                    <span className="text-[10px]">Zoom:</span>
                    <div className="w-24">
                        <Slider value={[zoom]} min={10} max={500} step={1} onValueChange={(val) => setZoom(val[0])} />
                    </div>
                </div>
            </div>

            {/* Canvas + overlays */}
            <div ref={containerRef} className="overflow-x-auto overflow-y-hidden relative" style={{ height: `${Math.min(160, CANVAS_HEIGHT)}px` }}>
                <canvas ref={canvasRef} className="absolute left-0 top-0 cursor-text" onPointerDown={handleClick} />

                {/* Playback cursor */}
                <div ref={playbackCursorRef} className="absolute top-0 bottom-0 w-[2px] bg-blue-500 z-30 pointer-events-none transition-none" style={{ left: 0, willChange: 'transform' }} />

                {/* Ghost anchor (V5 paused) */}
                {ghostAnchor && (
                    <div
                        className="absolute top-0 h-full w-[2px] z-25 pointer-events-none"
                        style={{
                            left: `${LABEL_WIDTH + ghostAnchor.time * zoom}px`,
                            borderLeft: '2px dashed #f97316',
                        }}
                    >
                        <div className="absolute top-0 left-1 bg-orange-500 text-white text-[8px] px-1 rounded whitespace-nowrap font-bold">
                            Ghost M{ghostAnchor.measure} B{ghostAnchor.beat}
                        </div>
                    </div>
                )}

                {/* Beat anchors */}
                {beatAnchors.map(b => (
                    <div key={`mb-${b.measure}-${b.beat}`}
                        className="absolute top-0 h-full w-[2px] bg-yellow-400 hover:bg-white cursor-ew-resize z-10 group"
                        style={{ left: `${LABEL_WIDTH + b.time * zoom}px` }}
                        onPointerDown={e => {
                            e.stopPropagation()
                            const startX = e.clientX; const startTime = b.time
                            const onMove = (ev: PointerEvent) => onBeatAnchorDrag?.(b.measure, b.beat, Math.max(0, startTime + (ev.clientX - startX) / zoom))
                            const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
                            window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
                        }}
                    >
                        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 bg-yellow-500 text-black text-[8px] px-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap font-bold pointer-events-none">
                            B{b.beat}
                        </div>
                    </div>
                ))}

                {/* Measure anchors */}
                {anchors.map(a => (
                    <div key={`mm-${a.measure}`}
                        className="absolute top-0 h-full w-[2px] bg-red-500 hover:bg-white cursor-ew-resize z-20 group"
                        style={{ left: `${LABEL_WIDTH + a.time * zoom}px` }}
                        onPointerDown={e => {
                            e.stopPropagation()
                            const startX = e.clientX; const startTime = a.time
                            const onMove = (ev: PointerEvent) => onAnchorDrag?.(a.measure, Math.max(0, startTime + (ev.clientX - startX) / zoom))
                            const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
                            window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
                        }}
                    >
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[9px] px-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap font-bold pointer-events-none">
                            M{a.measure}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default MidiTimeline
