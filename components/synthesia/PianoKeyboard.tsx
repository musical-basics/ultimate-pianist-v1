'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

const generateKeyboard = () => {
    const keys: Array<{
        noteNumber: number
        isBlack: boolean
        noteName: string
        whiteKeyIndex: number
    }> = []
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    const blackNotes = [1, 3, 6, 8, 10]
    let whiteKeyIndex = 0
    for (let midiNote = 21; midiNote <= 108; midiNote++) {
        const noteInOctave = midiNote % 12
        const octave = Math.floor(midiNote / 12) - 1
        const isBlack = blackNotes.includes(noteInOctave)
        const noteName = noteNames[noteInOctave] + octave
        keys.push({
            noteNumber: midiNote,
            isBlack,
            noteName,
            whiteKeyIndex: isBlack ? whiteKeyIndex - 1 : whiteKeyIndex,
        })
        if (!isBlack) whiteKeyIndex++
    }
    return keys
}

const KEYBOARD_LAYOUT = generateKeyboard()
const WHITE_KEYS = KEYBOARD_LAYOUT.filter(k => !k.isBlack)
const BLACK_KEYS = KEYBOARD_LAYOUT.filter(k => k.isBlack)

const getBlackKeyPosition = (whiteKeyIndex: number, noteInOctave: number): number => {
    const whiteKeyWidth = 100 / 52
    const basePosition = (whiteKeyIndex + 1) * whiteKeyWidth
    const blackKeyWidth = whiteKeyWidth * 0.6
    let offset = 0
    switch (noteInOctave) {
        case 1: offset = -0.15; break
        case 3: offset = 0.15; break
        case 6: offset = -0.1; break
        case 8: offset = 0; break
        case 10: offset = 0.1; break
    }
    return basePosition - (blackKeyWidth / 2) + (offset * whiteKeyWidth)
}

const PianoKeyboardBase = React.forwardRef<HTMLDivElement>((_, ref) => {
    return (
        <div
            ref={ref}
            className="relative w-full h-32 md:h-36 lg:h-40 select-none"
            role="application"
            aria-label="88-key Piano Keyboard"
        >
            <div className="flex flex-row w-full h-full">
                {WHITE_KEYS.map((key) => (
                    <div
                        key={key.noteNumber}
                        id={`key-${key.noteNumber}`}
                        data-note={key.noteName}
                        data-active="false"
                        className={cn(
                            'flex-1 h-full',
                            'bg-white',
                            'border-r border-zinc-300 last:border-r-0',
                            'rounded-b-md',
                            'shadow-sm',
                            'data-[active=true]:bg-purple-500',
                            'hover:bg-zinc-100',
                            'active:bg-zinc-200',
                            'cursor-pointer',
                            'transition-colors duration-75'
                        )}
                        role="button"
                        aria-label={`Piano key ${key.noteName}`}
                    />
                ))}
            </div>
            {BLACK_KEYS.map((key) => {
                const noteInOctave = key.noteNumber % 12
                const leftPercent = getBlackKeyPosition(key.whiteKeyIndex, noteInOctave)
                const blackKeyWidth = (100 / 52) * 0.6
                return (
                    <div
                        key={key.noteNumber}
                        id={`key-${key.noteNumber}`}
                        data-note={key.noteName}
                        data-active="false"
                        className={cn(
                            'absolute top-0',
                            'h-[65%]',
                            'bg-zinc-900',
                            'rounded-b-md',
                            'shadow-md',
                            'z-10',
                            'data-[active=true]:bg-purple-600',
                            'hover:bg-zinc-800',
                            'active:bg-zinc-700',
                            'cursor-pointer',
                            'transition-colors duration-75'
                        )}
                        style={{
                            left: `${leftPercent}%`,
                            width: `${blackKeyWidth}%`,
                        }}
                        role="button"
                        aria-label={`Piano key ${key.noteName}`}
                    />
                )
            })}
        </div>
    )
})

PianoKeyboardBase.displayName = 'PianoKeyboard'
export const PianoKeyboard = React.memo(PianoKeyboardBase)
export default PianoKeyboard
