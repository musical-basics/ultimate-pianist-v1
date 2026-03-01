'use client'

import * as React from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Anchor, BeatAnchor } from '@/lib/types'

interface AnchorSidebarProps {
    anchors: Anchor[]
    beatAnchors?: BeatAnchor[]
    currentMeasure: number
    totalMeasures: number
    isLevel2Mode: boolean
    subdivision: number
    darkMode?: boolean
    onSetAnchor: (measure: number, time: number) => void
    onDeleteAnchor: (measure: number) => void
    onToggleLevel2: (enabled: boolean) => void
    onSetSubdivision: (sub: number) => void
    onSetBeatAnchor?: (measure: number, beat: number, time: number) => void
    onRegenerateBeats?: () => void
    onTap?: () => void
    onClearAll?: () => void
    onAutoMap?: () => void
}

export const AnchorSidebar: React.FC<AnchorSidebarProps> = ({
    anchors,
    beatAnchors = [],
    currentMeasure,
    totalMeasures,
    isLevel2Mode,
    subdivision,
    darkMode = false,
    onSetAnchor,
    onDeleteAnchor,
    onToggleLevel2,
    onSetSubdivision,
    onSetBeatAnchor,
    onRegenerateBeats,
    onTap,
    onClearAll,
    onAutoMap,
}) => {
    const bg = darkMode ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-900'
    const border = darkMode ? 'border-zinc-700' : 'border-zinc-200'

    const sortedAnchors = [...anchors].sort((a, b) => a.measure - b.measure)
    const maxMeasure = anchors.length > 0 ? Math.max(...anchors.map(a => a.measure)) : 0
    const rows = []

    for (let m = 1; m <= maxMeasure + 1; m++) {
        const anchor = anchors.find(a => a.measure === m)
        const isCurrent = m === currentMeasure

        if (anchor) {
            const beats = isLevel2Mode && beatAnchors.length > 0
                ? beatAnchors.filter(b => b.measure === m).sort((a, b) => a.beat - b.beat)
                : []

            rows.push(
                <React.Fragment key={m}>
                    <div className={`flex items-center gap-2 p-2 rounded text-xs mt-1 ${isCurrent
                        ? darkMode ? 'bg-purple-900/30 border border-purple-500/30' : 'bg-purple-50 border border-purple-200'
                        : darkMode ? 'hover:bg-zinc-800' : 'hover:bg-zinc-50'
                        }`}>
                        <span className="font-mono font-medium w-8">M{m}</span>
                        <input
                            type="number"
                            value={anchor.time.toFixed(2)}
                            step={0.01}
                            onChange={(e) => onSetAnchor(m, parseFloat(e.target.value) || 0)}
                            className={`flex-1 px-2 py-1 rounded font-mono text-xs ${darkMode ? 'bg-zinc-800 border-zinc-600 text-emerald-400' : 'bg-zinc-100 border-zinc-300 text-emerald-600'} border`}
                        />
                        <span className="text-zinc-500">s</span>
                        {m !== 1 && (
                            <button onClick={() => onDeleteAnchor(m)} className="text-red-400 hover:text-red-500 p-0.5">
                                <Trash2 className="w-3 h-3" />
                            </button>
                        )}
                    </div>

                    {beats.length > 0 && (
                        <div className={`pl-8 pr-2 pb-2 text-xs border-b ${darkMode ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-100 bg-zinc-50/50'}`}>
                            <div className="grid grid-cols-2 gap-2 mt-1">
                                {beats.map(b => (
                                    <div key={`${m}-${b.beat}`} className="flex items-center justify-end gap-1">
                                        <span className={`text-[9px] font-bold ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>B{b.beat}</span>
                                        <input
                                            type="number" step="0.01" value={b.time.toFixed(2)}
                                            onChange={(e) => onSetBeatAnchor && onSetBeatAnchor(m, b.beat, parseFloat(e.target.value) || 0)}
                                            className={`w-14 text-right text-[10px] border rounded px-1 font-mono focus:outline-none focus:ring-1 ${darkMode
                                                ? 'bg-zinc-800 border-zinc-600 text-yellow-500 focus:ring-yellow-500'
                                                : 'bg-yellow-50 border-yellow-200 text-zinc-700 focus:bg-white focus:ring-yellow-400'
                                                }`}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </React.Fragment>
            )
        } else {
            rows.push(
                <div key={m} className={`flex items-center justify-between mt-1 p-2 rounded text-xs border border-dashed opacity-60 ${darkMode ? 'border-red-800 bg-red-900/20' : 'border-red-200 bg-red-50'}`}>
                    <span className={`font-mono ${darkMode ? 'text-red-400' : 'text-red-400'}`}>M{m} (Ghost)</span>
                </div>
            )
        }
    }

    return (
        <div className={`w-64 ${bg} border-r ${border} flex flex-col h-full overflow-hidden shrink-0`}>
            <div className={`p-3 border-b ${border} flex items-center justify-between`}>
                <h2 className="text-sm font-semibold">Anchors</h2>
                <span className={`text-xs ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    {anchors.length} / {totalMeasures} measures
                </span>
            </div>

            <div className={`p-3 border-b ${border} space-y-2`}>
                <label className="flex items-center gap-2 text-xs">
                    <input
                        type="checkbox"
                        checked={isLevel2Mode}
                        onChange={(e) => onToggleLevel2(e.target.checked)}
                        className="rounded"
                    />
                    Beat-level mapping (L2)
                </label>
                {isLevel2Mode && (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-xs">Subdivision:</span>
                            <select
                                value={subdivision}
                                onChange={(e) => onSetSubdivision(Number(e.target.value))}
                                className={`text-xs px-2 py-1 rounded ${darkMode ? 'bg-zinc-800 border-zinc-600' : 'bg-zinc-100 border-zinc-300'} border`}
                            >
                                {[2, 3, 4, 6, 8, 12, 16].map((n) => (
                                    <option key={n} value={n}>{n}</option>
                                ))}
                            </select>
                        </div>
                        {onRegenerateBeats && (
                            <button
                                onClick={onRegenerateBeats}
                                className={`w-full text-xs font-bold py-1.5 rounded border transition-colors shadow-sm ${darkMode
                                    ? 'bg-emerald-900/40 border-emerald-700 text-emerald-400 hover:bg-emerald-800 hover:text-white'
                                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                                    }`}
                            >
                                {beatAnchors.length > 0 ? '↻ Regenerate Beats' : '▶ Generate Beats'}
                            </button>
                        )}
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-2">
                {rows}
            </div>

            <div className={`p-3 border-t ${border} flex flex-col gap-3`}>
                <div className="text-center">
                    <span className={`text-xs ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        Current: Measure {currentMeasure}
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" onClick={onClearAll} className={`text-xs h-8 ${darkMode ? 'border-zinc-700 hover:bg-zinc-800 text-zinc-300' : ''}`}>
                        Clear All
                    </Button>
                    <Button size="sm" onClick={onTap} className="bg-purple-600 hover:bg-purple-700 text-white text-xs h-8 shadow-lg shadow-purple-500/20">
                        TAP (A)
                    </Button>
                    {onAutoMap && (
                        <Button size="sm" onClick={onAutoMap} className="col-span-2 bg-indigo-600 hover:bg-indigo-700 text-white shadow-[0_0_10px_rgba(79,70,229,0.3)] text-xs h-8">
                            ✨ Auto-Map (v2)
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}

export default AnchorSidebar
