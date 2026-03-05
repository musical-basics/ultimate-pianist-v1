'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore } from '@/lib/store'

/**
 * useMusicFont — Centralizes all VexFlow music font lifecycle logic.
 *
 * VexFlow v5 requires fonts to be loaded before rendering. When React
 * re-renders cause VexFlow to re-render the SVG, the default font
 * briefly appears. This hook handles:
 *
 * 1. Initial delayed font application (from DB value)
 * 2. Tab-visibility font reload (visibilitychange)
 * 3. Toggle-triggered font re-apply (any store toggle that causes re-render)
 * 4. Manual font changes (dropdown)
 * 5. Debouncing concurrent resets (only one timer active at a time)
 *
 * Usage:
 *   const { musicFont, setFont, initialLoading } = useMusicFont({ delay: 1000 })
 *   // Pass musicFont to <VexFlowRenderer musicFont={musicFont} />
 *   // Use initialLoading for overlay on learn page
 *   // Call setFont('Bravura') for dropdown / DB load
 */

interface UseMusicFontOptions {
    /** Delay in ms before applying font after reset (default: 1000) */
    delay?: number
    /** Show loading overlay on initial mount (learn page uses this) */
    showInitialOverlay?: boolean
    /** Initial overlay duration in ms (default: 1500) */
    overlayDuration?: number
}

interface UseMusicFontReturn {
    /** Current font name to pass to VexFlowRenderer. '' means use VexFlow default. */
    musicFont: string
    /** Set the saved font. Applies after delay. Use for DB load and dropdown changes. */
    setFont: (font: string) => void
    /** Whether the initial loading overlay should be shown (learn page pattern) */
    initialLoading: boolean
}

export function useMusicFont(options: UseMusicFontOptions = {}): UseMusicFontReturn {
    const { delay = 1000, showInitialOverlay = false, overlayDuration = 1500 } = options

    const [musicFont, setMusicFont] = useState('')
    const [initialLoading, setInitialLoading] = useState(showInitialOverlay)
    const savedFontRef = useRef('')
    const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // ─── Store toggles that cause VexFlow re-renders ──
    const previewEffects = useAppStore((s) => s.previewEffects)
    const revealMode = useAppStore((s) => s.revealMode)
    const darkMode = useAppStore((s) => s.darkMode)
    const popEffect = useAppStore((s) => s.popEffect)
    const jumpEffect = useAppStore((s) => s.jumpEffect)
    const glowEffect = useAppStore((s) => s.glowEffect)
    const highlightNote = useAppStore((s) => s.highlightNote)

    // ─── Core: debounced font reset + re-apply ──
    const triggerFontReload = useCallback(() => {
        if (!savedFontRef.current) return

        // Cancel any pending timer to prevent races
        if (resetTimerRef.current) {
            clearTimeout(resetTimerRef.current)
            resetTimerRef.current = null
        }

        // Reset to blank (forces VexFlow to use default temporarily)
        setMusicFont('')

        // Re-apply saved font after delay
        resetTimerRef.current = setTimeout(() => {
            setMusicFont(savedFontRef.current)
            resetTimerRef.current = null
        }, delay)
    }, [delay])

    // ─── Public: set the saved font (from DB or dropdown) ──
    const setFont = useCallback((font: string) => {
        savedFontRef.current = font
        if (!font) {
            setMusicFont('')
            return
        }
        // Cancel any pending timer
        if (resetTimerRef.current) {
            clearTimeout(resetTimerRef.current)
            resetTimerRef.current = null
        }
        // Apply after delay
        resetTimerRef.current = setTimeout(() => {
            setMusicFont(font)
            resetTimerRef.current = null
        }, delay)
    }, [delay])

    // ─── Tab visibility: reload font when switching back ──
    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                triggerFontReload()
            }
        }
        document.addEventListener('visibilitychange', onVisibilityChange)
        return () => document.removeEventListener('visibilitychange', onVisibilityChange)
    }, [triggerFontReload])

    // ─── Initial overlay (learn page pattern) ──
    useEffect(() => {
        if (showInitialOverlay) {
            triggerFontReload()
            const timer = setTimeout(() => setInitialLoading(false), overlayDuration)
            return () => clearTimeout(timer)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []) // Only on mount

    // ─── Toggle changes: re-apply font when any store toggle flips ──
    const prevTogglesRef = useRef({
        previewEffects, revealMode, darkMode, popEffect, jumpEffect, glowEffect, highlightNote
    })
    useEffect(() => {
        const prev = prevTogglesRef.current
        const changed = prev.previewEffects !== previewEffects
            || prev.revealMode !== revealMode
            || prev.darkMode !== darkMode
            || prev.popEffect !== popEffect
            || prev.jumpEffect !== jumpEffect
            || prev.glowEffect !== glowEffect
            || prev.highlightNote !== highlightNote
        prevTogglesRef.current = {
            previewEffects, revealMode, darkMode, popEffect, jumpEffect, glowEffect, highlightNote
        }
        if (changed) {
            triggerFontReload()
        }
    }, [previewEffects, revealMode, darkMode, popEffect, jumpEffect, glowEffect, highlightNote, triggerFontReload])

    // ─── Cleanup pending timer on unmount ──
    useEffect(() => {
        return () => {
            if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
        }
    }, [])

    return { musicFont, setFont, initialLoading }
}
