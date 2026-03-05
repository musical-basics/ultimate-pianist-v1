'use client'

import * as React from 'react'
import { useRef, useEffect, useCallback, useState } from 'react'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import { Search } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import type { Anchor, BeatAnchor } from '@/lib/types'

interface WaveformTimelineProps {
    audioUrl: string | null
    anchors: Anchor[]
    beatAnchors?: BeatAnchor[]
    isPlaying: boolean
    duration: number
    onSeek: (time: number) => void
    onAnchorDrag?: (measure: number, newTime: number) => void
    onBeatAnchorDrag?: (measure: number, beat: number, newTime: number) => void
    darkMode?: boolean
}

export const WaveformTimeline: React.FC<WaveformTimelineProps> = ({
    audioUrl,
    anchors,
    beatAnchors = [],
    isPlaying,
    duration,
    onSeek,
    onAnchorDrag,
    onBeatAnchorDrag,
    darkMode = false,
}) => {
    const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null)
    const [zoom, setZoom] = useState(100)
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const playbackCursorRef = useRef<HTMLDivElement>(null)
    const rafRef = useRef<number>(0)

    // Load Audio
    useEffect(() => {
        if (!audioUrl) return
        const loadAudio = async () => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const ac = new (window.AudioContext || (window as any).webkitAudioContext)()
                const response = await fetch(audioUrl)
                const buf = await response.arrayBuffer()
                const decoded = await ac.decodeAudioData(buf)
                setAudioBuffer(decoded)
            } catch (err) {
                console.error('[Waveform] Failed to load audio:', err)
            }
        }
        loadAudio()
    }, [audioUrl])

    // Draw Waveform dynamically mapped to zoom level
    const drawWaveform = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas || !audioBuffer) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const width = Math.ceil(audioBuffer.duration * zoom)
        const height = 120

        if (canvas.width !== width) canvas.width = width
        if (canvas.height !== height) canvas.height = height

        ctx.clearRect(0, 0, width, height)
        ctx.fillStyle = darkMode ? '#18181b' : '#f4f4f5'
        ctx.fillRect(0, 0, width, height)

        const data = audioBuffer.getChannelData(0)
        const step = Math.ceil(data.length / width)
        const amp = 45

        ctx.fillStyle = darkMode ? '#52525b' : '#a1a1aa'
        ctx.beginPath()
        for (let i = 0; i < width; i++) {
            let min = 1.0, max = -1.0
            for (let j = 0; j < step; j++) {
                const val = data[(i * step) + j]
                if (val < min) min = val
                if (val > max) max = val
            }
            if (min === 1.0 && max === -1.0) { min = 0; max = 0 }
            ctx.fillRect(i, 60 + (min * amp), 1, Math.max(1, (max - min) * amp))
        }

        // Seconds Grid
        ctx.fillStyle = darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
        ctx.textBaseline = 'top'
        for (let i = 0; i <= audioBuffer.duration; i++) {
            const x = i * zoom
            ctx.fillRect(x, 0, 1, height)
            ctx.fillStyle = darkMode ? '#71717a' : '#a1a1aa'
            ctx.font = '9px monospace'
            ctx.fillText(`${i}s`, x + 3, 2)
            ctx.fillStyle = darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
        }
    }, [audioBuffer, zoom, darkMode])

    useEffect(() => { drawWaveform() }, [drawWaveform])

    // Animation Loop
    useEffect(() => {
        if (!audioBuffer) return
        const animate = () => {
            const pm = getPlaybackManager()
            const time = pm.getTime()

            if (playbackCursorRef.current) {
                const x = time * zoom
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
    }, [isPlaying, zoom, audioBuffer])

    const handleContainerClick = (e: React.PointerEvent) => {
        const container = containerRef.current
        if (!container || !audioBuffer) return
        const rect = container.getBoundingClientRect()
        const clickX = (e.clientX - rect.left) + container.scrollLeft
        onSeek(Math.max(0, Math.min(audioBuffer.duration, clickX / zoom)))
    }

    return (
        <div className={`w-full flex flex-col ${darkMode ? 'bg-zinc-900' : 'bg-zinc-100'} rounded-md overflow-hidden border ${darkMode ? 'border-zinc-800' : 'border-zinc-200'}`}>
            <div className={`flex items-center justify-between px-3 h-8 ${darkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-200 text-zinc-600'} text-xs border-b ${darkMode ? 'border-zinc-700' : 'border-zinc-300'} shrink-0`}>
                <span className="font-bold uppercase tracking-wider">Timeline</span>
                <div className="flex gap-2 items-center">
                    <Search className="w-3.5 h-3.5" />
                    <span>Zoom:</span>
                    <div className="w-32">
                        <Slider value={[zoom]} min={10} max={500} step={1} onValueChange={(val) => setZoom(val[0])} />
                    </div>
                </div>
            </div>

            <div ref={containerRef} className="overflow-x-auto relative" style={{ height: '120px' }}>
                <canvas ref={canvasRef} className="absolute left-0 top-0 cursor-text" onPointerDown={handleContainerClick} />
                <div ref={playbackCursorRef} className="absolute top-0 bottom-0 w-[2px] bg-blue-500 z-30 pointer-events-none transition-none" style={{ left: 0, willChange: 'transform' }} />

                {beatAnchors.map(b => (
                    <div key={`b-${b.measure}-${b.beat}`}
                        className="absolute top-0 h-full w-[2px] bg-yellow-400 hover:bg-white cursor-ew-resize z-10 group"
                        style={{ left: `${b.time * zoom}px` }}
                        onPointerDown={e => {
                            e.stopPropagation()
                            const startX = e.clientX; const startTime = b.time
                            const onMove = (ev: PointerEvent) => onBeatAnchorDrag?.(b.measure, b.beat, Math.max(0, startTime + (ev.clientX - startX) / zoom))
                            const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
                            window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
                        }}
                    >
                        <div className="absolute top-5 left-1/2 -translate-x-1/2 bg-yellow-500 text-black text-[9px] px-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap font-bold shadow-sm pointer-events-none">
                            B{b.beat}
                        </div>
                    </div>
                ))}

                {anchors.map(a => (
                    <div key={`m-${a.measure}`}
                        className="absolute top-0 h-full w-[2px] bg-red-500 hover:bg-white cursor-ew-resize z-20 group"
                        style={{ left: `${a.time * zoom}px` }}
                        onPointerDown={e => {
                            e.stopPropagation()
                            const startX = e.clientX; const startTime = a.time
                            const onMove = (ev: PointerEvent) => onAnchorDrag?.(a.measure, Math.max(0, startTime + (ev.clientX - startX) / zoom))
                            const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
                            window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
                        }}
                    >
                        <div className="absolute top-1 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] px-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap font-bold pointer-events-none">
                            M{a.measure}
                        </div>
                    </div>
                ))}

                {!audioUrl && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <p className={`text-xs ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>No audio loaded</p>
                    </div>
                )}
            </div>
        </div>
    )
}

export default WaveformTimeline
