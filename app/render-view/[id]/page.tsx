'use client'

/**
 * Render View — Hidden route for headless Puppeteer capture.
 *
 * Steps 11-15: This page renders ONLY the SplitScreenLayout + PianoKeyboard
 * in a fixed 1920×1080 viewport with no UI chrome. CSS transitions are
 * disabled via body.studio-mode. Audio is completely silenced.
 *
 * Puppeteer navigates here, waits for window.__RENDER_READY__,
 * then calls window.__ADVANCE_FRAME__(timeSec) for each frame.
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { SplitScreenLayout } from '@/components/layout/SplitScreenLayout'
import { useAppStore } from '@/lib/store'
import { useMusicFont } from '@/hooks/useMusicFont'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import { parseMidiFile } from '@/lib/midi/parser'
import { DEMO_CONFIG } from '@/lib/demoConfig'
import type { ParsedMidi } from '@/lib/types'

// Extend Window for studio mode globals
declare global {
  interface Window {
    __RENDER_READY__: boolean
    __STUDIO_MODE__: boolean
    __ADVANCE_FRAME__: (timeSec: number) => void
    __RENDER_WATERFALL__: () => void
  }
}

export default function RenderView() {
  const [parsedMidi, setParsedMidi] = useState<ParsedMidi | null>(null)
  const { musicFont, setFont } = useMusicFont()
  const [rendererReady, setRendererReady] = useState(false)
  const [scoreLoaded, setScoreLoaded] = useState(false)

  const setAnchors = useAppStore((s) => s.setAnchors)
  const setBeatAnchors = useAppStore((s) => s.setBeatAnchors)
  const setIsLevel2Mode = useAppStore((s) => s.setIsLevel2Mode)
  const setSubdivision = useAppStore((s) => s.setSubdivision)
  const loadMidi = useAppStore((s) => s.loadMidi)
  const setShowScore = useAppStore((s) => s.setShowScore)
  const setShowWaterfall = useAppStore((s) => s.setShowWaterfall)
  const setNoteGlow = useAppStore((s) => s.setNoteGlow)
  const setVelocityKeyColor = useAppStore((s) => s.setVelocityKeyColor)
  const setPreviewEffects = useAppStore((s) => s.setPreviewEffects)
  const setHighlightNote = useAppStore((s) => s.setHighlightNote)
  const setGlowEffect = useAppStore((s) => s.setGlowEffect)
  const setPopEffect = useAppStore((s) => s.setPopEffect)
  const setJumpEffect = useAppStore((s) => s.setJumpEffect)

  // TODO: In production, fetch config by [id] param from Supabase.
  // For now, uses the hardcoded DEMO_CONFIG.
  const config = DEMO_CONFIG

  // ─── Step 12: Enforce fixed 1920×1080 viewport ───────────────────
  useEffect(() => {
    // Signal studio mode globally BEFORE any renderer init
    window.__STUDIO_MODE__ = true

    document.body.classList.add('studio-mode')
    document.body.style.width = '1920px'
    document.body.style.height = '1080px'
    document.body.style.overflow = 'hidden'
    document.body.style.margin = '0'
    document.body.style.padding = '0'

    // Enable ALL visual effects for export
    setNoteGlow(true)
    setVelocityKeyColor(true)
    setShowScore(true)
    setShowWaterfall(true)
    setPreviewEffects(true)   // Critical: enables note coloring/animation
    setHighlightNote(true)    // Critical: enables note highlighting
    setGlowEffect(true)       // Critical: enables glow on active notes
    setPopEffect(true)        // Critical: enables pop scale on active notes
    setJumpEffect(true)       // Critical: enables jump translateY on active notes

    return () => {
      document.body.classList.remove('studio-mode')
      window.__STUDIO_MODE__ = false
    }
  }, [setNoteGlow, setVelocityKeyColor, setShowScore, setShowWaterfall, setPreviewEffects, setHighlightNote, setGlowEffect, setPopEffect, setJumpEffect])

  // ─── Load config ─────────────────────────────────────────────────
  useEffect(() => {
    if (config.anchors) setAnchors(config.anchors)
    if (config.beat_anchors) setBeatAnchors(config.beat_anchors)
    if (config.is_level2) setIsLevel2Mode(config.is_level2)
    if (config.subdivision) setSubdivision(config.subdivision)
    if (config.music_font) setFont(config.music_font)
  }, [config, setAnchors, setBeatAnchors, setIsLevel2Mode, setSubdivision, setFont])

  // ─── Load MIDI ───────────────────────────────────────────────────
  useEffect(() => {
    if (!config.midi_url) return
    const loadMidiFromUrl = async () => {
      try {
        const response = await fetch(config.midi_url!)
        const buffer = await response.arrayBuffer()
        const parsed = parseMidiFile(buffer)
        setParsedMidi(parsed)
        loadMidi(parsed)
        const pm = getPlaybackManager()
        pm.duration = parsed.durationSec
        pm.setStudioMode(true)
      } catch (err) {
        console.error('[RenderView] Failed to load MIDI:', err)
      }
    }
    loadMidiFromUrl()
  }, [config.midi_url, loadMidi])

  // ─── Step 15: Signal hydration readiness ──────────────────────────
  useEffect(() => {
    if (rendererReady && scoreLoaded && parsedMidi) {
      window.__RENDER_READY__ = true
      console.log('[RenderView] Hydration complete — renderer, score, and MIDI all ready for frame capture')
    }
  }, [rendererReady, scoreLoaded, parsedMidi])

  // ─── Track renderer readiness from SplitScreenLayout ──────────────
  const handleRendererReady = useCallback(() => {
    setRendererReady(true)
  }, [])

  const handleScoreLoaded = useCallback(() => {
    setScoreLoaded(true)
  }, [])

  return (
    <div
      style={{ width: '1920px', height: '1080px', overflow: 'hidden' }}
      className="bg-zinc-950"
    >
      <SplitScreenLayout
        audioUrl={null}  /* Step 14: No audio in studio mode */
        xmlUrl={config.xml_url || null}
        parsedMidi={parsedMidi}
        isAdmin={false}
        musicFont={musicFont}
        isStudioMode={true}
        onRendererReady={handleRendererReady}
        onScoreLoaded={handleScoreLoaded}
      />
    </div>
  )
}
