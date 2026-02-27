'use client'

/**
 * User Library — Browse published song configurations
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Music2, Clock, Play, Library } from 'lucide-react'
import type { SongConfig } from '@/lib/types'

export default function LearnPage() {
    const [configs, setConfigs] = useState<SongConfig[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const load = async () => {
            try {
                const { getPublishedConfigs } = await import('@/lib/services/configService')
                const data = await getPublishedConfigs()
                setConfigs(data)
            } catch (err) {
                console.error('Failed to load published configs:', err)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [])

    return (
        <div className="min-h-screen bg-zinc-950 text-white">
            {/* Header */}
            <header className="border-b border-zinc-800/50">
                <div className="max-w-6xl mx-auto px-6 py-8">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-600/20">
                            <Music2 className="w-7 h-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                                Ultimate Pianist
                            </h1>
                            <p className="text-zinc-400 text-sm mt-1">
                                Learn your favorite pieces with synchronized sheet music & falling notes
                            </p>
                        </div>
                    </div>
                </div>
            </header>

            {/* Content */}
            <main className="max-w-6xl mx-auto px-6 py-8">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : configs.length === 0 ? (
                    <div className="text-center py-20 space-y-4">
                        <Library className="w-16 h-16 mx-auto text-zinc-700" />
                        <p className="text-zinc-400 text-lg">No songs available yet</p>
                        <p className="text-zinc-500 text-sm">
                            Check back soon — the admin will publish songs for you to learn.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {configs.map((config) => (
                            <Link
                                key={config.id}
                                href={`/learn/${config.id}`}
                                className="group relative bg-zinc-900/50 border border-zinc-800/50 rounded-2xl overflow-hidden hover:border-purple-500/30 transition-all hover:shadow-lg hover:shadow-purple-500/5"
                            >
                                {/* Gradient header */}
                                <div className="h-32 bg-gradient-to-br from-purple-600/20 to-pink-600/20 flex items-center justify-center relative">
                                    <Music2 className="w-12 h-12 text-zinc-600 group-hover:text-purple-400 transition-colors" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/80 to-transparent" />
                                    <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <div className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center shadow-lg">
                                            <Play className="w-5 h-5 text-white ml-0.5" />
                                        </div>
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="p-4">
                                    <h2 className="font-semibold text-white group-hover:text-purple-300 transition-colors truncate">
                                        {config.title || 'Untitled'}
                                    </h2>
                                    <div className="flex items-center gap-3 mt-2 text-xs text-zinc-500">
                                        <span className="flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {config.anchors?.length || 0} measures
                                        </span>
                                        <span>•</span>
                                        <span className="flex items-center gap-1">
                                            {config.midi_url ? 'MIDI' : ''}{' '}
                                            {config.audio_url ? '+ Audio' : ''}
                                        </span>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </main>
        </div>
    )
}
