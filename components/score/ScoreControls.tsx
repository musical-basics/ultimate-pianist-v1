'use client'

/**
 * ScoreControls — Toolbar for visual display modes and effects
 */

import * as React from 'react'
import {
    Eye,
    EyeOff,
    Moon,
    Sun,
    Lock,
    Unlock,
    Sparkles,
    Zap,
    ArrowUpFromDot,
    Monitor,
    Crosshair,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ScoreControlsProps {
    revealMode: 'OFF' | 'NOTE' | 'CURTAIN'
    darkMode: boolean
    highlightNote: boolean
    glowEffect: boolean
    popEffect: boolean
    jumpEffect: boolean
    isLocked: boolean
    showCursor: boolean
    onRevealModeChange: (mode: 'OFF' | 'NOTE' | 'CURTAIN') => void
    onDarkModeToggle: () => void
    onHighlightToggle: () => void
    onGlowToggle: () => void
    onPopToggle: () => void
    onJumpToggle: () => void
    onLockToggle: () => void
    onCursorToggle: () => void
    onDetach?: () => void
}

export const ScoreControls: React.FC<ScoreControlsProps> = ({
    revealMode,
    darkMode,
    highlightNote,
    glowEffect,
    popEffect,
    jumpEffect,
    isLocked,
    showCursor,
    onRevealModeChange,
    onDarkModeToggle,
    onHighlightToggle,
    onGlowToggle,
    onPopToggle,
    onJumpToggle,
    onLockToggle,
    onCursorToggle,
    onDetach,
}) => {
    const bg = darkMode ? 'bg-zinc-800/80 border-zinc-700' : 'bg-white/80 border-zinc-200'

    return (
        <div className={`flex items-center gap-1 px-3 py-2 rounded-lg border backdrop-blur-sm ${bg}`}>
            {/* Reveal Mode Group */}
            <div className="flex items-center gap-0.5 mr-2">
                {(['OFF', 'NOTE', 'CURTAIN'] as const).map((mode) => (
                    <Button
                        key={mode}
                        variant="ghost"
                        size="sm"
                        onClick={() => onRevealModeChange(mode)}
                        className={cn(
                            'text-xs px-2 h-7',
                            revealMode === mode
                                ? 'bg-purple-600 text-white hover:bg-purple-700 hover:text-white'
                                : darkMode
                                    ? 'text-zinc-400 hover:text-white'
                                    : 'text-zinc-600 hover:text-zinc-900'
                        )}
                    >
                        {mode === 'OFF' ? <Eye className="w-3 h-3" /> : mode === 'NOTE' ? <EyeOff className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
                        <span className="ml-1 hidden sm:inline">{mode}</span>
                    </Button>
                ))}
            </div>

            {/* Separator */}
            <div className={`w-px h-5 ${darkMode ? 'bg-zinc-600' : 'bg-zinc-300'} mx-1`} />

            {/* Effects */}
            <Button variant="ghost" size="sm" onClick={onHighlightToggle} title="Highlight active note"
                className={cn('h-7 px-2', highlightNote ? 'text-amber-400' : darkMode ? 'text-zinc-500' : 'text-zinc-400')}>
                <Crosshair className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onGlowToggle} title="Glow effect"
                className={cn('h-7 px-2', glowEffect ? 'text-blue-400' : darkMode ? 'text-zinc-500' : 'text-zinc-400')}>
                <Sparkles className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onPopToggle} title="Pop effect (scale up)"
                className={cn('h-7 px-2', popEffect ? 'text-green-400' : darkMode ? 'text-zinc-500' : 'text-zinc-400')}>
                <Zap className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onJumpToggle} title="Jump effect (bounce up)"
                className={cn('h-7 px-2', jumpEffect ? 'text-pink-400' : darkMode ? 'text-zinc-500' : 'text-zinc-400')}>
                <ArrowUpFromDot className="w-3.5 h-3.5" />
            </Button>

            <div className={`w-px h-5 ${darkMode ? 'bg-zinc-600' : 'bg-zinc-300'} mx-1`} />

            {/* View controls */}
            <Button variant="ghost" size="sm" onClick={onDarkModeToggle} title={darkMode ? 'Light mode' : 'Dark mode'}
                className={cn('h-7 px-2', darkMode ? 'text-yellow-400' : 'text-zinc-500')}>
                {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={onLockToggle} title={isLocked ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
                className={cn('h-7 px-2', isLocked ? 'text-purple-400' : darkMode ? 'text-zinc-500' : 'text-zinc-400')}>
                {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCursorToggle} title="Show/hide cursor"
                className={cn('h-7 px-2', showCursor ? 'text-blue-400' : darkMode ? 'text-zinc-500' : 'text-zinc-400')}>
                <Crosshair className="w-3.5 h-3.5" />
            </Button>
        </div>
    )
}

export default ScoreControls
