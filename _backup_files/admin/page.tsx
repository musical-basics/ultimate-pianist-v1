'use client'

/**
 * Admin Dashboard — Configuration data table
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Pencil, Trash2, Globe, GlobeLock, Music, FileMusic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fetchAllConfigs, createNewConfig, deleteConfigAction, togglePublishAction } from '@/app/actions/config'
import type { SongConfig } from '@/lib/types'

export default function AdminDashboard() {
    const [configs, setConfigs] = useState<SongConfig[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const loadConfigs = async () => {
        try {
            setLoading(true)
            const data = await fetchAllConfigs()
            setConfigs(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load configs')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadConfigs()
    }, [])

    const handleCreate = async () => {
        try {
            const config = await createNewConfig()
            window.location.href = `/admin/edit/${config.id}`
        } catch (err) {
            console.error('Failed to create config:', err)
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this configuration? This cannot be undone.')) return

        try {
            await deleteConfigAction(id)
            setConfigs((prev) => prev.filter((c) => c.id !== id))
        } catch (err) {
            console.error('Failed to delete config:', err)
        }
    }

    const handleTogglePublish = async (id: string, currentState: boolean) => {
        try {
            await togglePublishAction(id, !currentState)
            setConfigs((prev) =>
                prev.map((c) => (c.id === id ? { ...c, is_published: !currentState } : c))
            )
        } catch (err) {
            console.error('Failed to toggle publish:', err)
        }
    }

    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
            })
        } catch {
            return dateStr
        }
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-white">
            {/* Header */}
            <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-lg sticky top-0 z-50">
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                            <Music className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold">Admin Dashboard</h1>
                            <p className="text-xs text-zinc-400">Manage song configurations</p>
                        </div>
                    </div>
                    <Button
                        onClick={handleCreate}
                        className="bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-600/20"
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        New Configuration
                    </Button>
                </div>
            </header>

            {/* Content */}
            <main className="max-w-6xl mx-auto px-6 py-8">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : error ? (
                    <div className="text-center py-20">
                        <p className="text-red-400">{error}</p>
                        <p className="text-zinc-500 text-sm mt-2">Make sure your Supabase environment variables are set.</p>
                    </div>
                ) : configs.length === 0 ? (
                    <div className="text-center py-20 space-y-4">
                        <FileMusic className="w-16 h-16 mx-auto text-zinc-700" />
                        <p className="text-zinc-400 text-lg">No configurations yet</p>
                        <p className="text-zinc-500 text-sm">Create your first song configuration to get started.</p>
                        <Button
                            onClick={handleCreate}
                            className="bg-purple-600 hover:bg-purple-700 text-white"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            Create First Configuration
                        </Button>
                    </div>
                ) : (
                    <div className="grid gap-4">
                        {/* Table header */}
                        <div className="grid grid-cols-[1fr_120px_120px_100px_80px] gap-4 px-4 py-2 text-xs text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                            <span>Title</span>
                            <span>Media</span>
                            <span>Updated</span>
                            <span>Status</span>
                            <span className="text-right">Actions</span>
                        </div>

                        {/* Rows */}
                        {configs.map((config) => (
                            <div
                                key={config.id}
                                className="grid grid-cols-[1fr_120px_120px_100px_80px] gap-4 items-center px-4 py-3 rounded-lg bg-zinc-900/50 hover:bg-zinc-800/50 border border-zinc-800/50 transition-colors"
                            >
                                {/* Title */}
                                <div>
                                    <Link
                                        href={`/admin/edit/${config.id}`}
                                        className="font-medium text-white hover:text-purple-300 transition-colors"
                                    >
                                        {config.title || 'Untitled'}
                                    </Link>
                                    <p className="text-xs text-zinc-500 mt-0.5">
                                        {config.anchors?.length || 0} anchors
                                    </p>
                                </div>

                                {/* Media indicators */}
                                <div className="flex items-center gap-2 text-xs">
                                    <span className={config.audio_url ? 'text-green-400' : 'text-zinc-600'}>WAV</span>
                                    <span className={config.xml_url ? 'text-green-400' : 'text-zinc-600'}>XML</span>
                                    <span className={config.midi_url ? 'text-green-400' : 'text-zinc-600'}>MIDI</span>
                                </div>

                                {/* Updated */}
                                <span className="text-sm text-zinc-400">
                                    {formatDate(config.updated_at)}
                                </span>

                                {/* Publish status */}
                                <button
                                    onClick={() => handleTogglePublish(config.id, !!config.is_published)}
                                    className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full w-fit transition-colors ${config.is_published
                                        ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
                                        : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
                                        }`}
                                >
                                    {config.is_published ? <Globe className="w-3 h-3" /> : <GlobeLock className="w-3 h-3" />}
                                    {config.is_published ? 'Live' : 'Draft'}
                                </button>

                                {/* Actions */}
                                <div className="flex items-center justify-end gap-1">
                                    <Link href={`/admin/edit/${config.id}`}>
                                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-400 hover:text-white">
                                            <Pencil className="w-3.5 h-3.5" />
                                        </Button>
                                    </Link>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0 text-zinc-400 hover:text-red-400"
                                        onClick={() => handleDelete(config.id)}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    )
}
