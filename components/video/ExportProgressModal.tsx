'use client'

/**
 * ExportProgressModal — Real-time video export progress UI
 * 
 * Subscribes to Supabase Realtime for the specific exportId row,
 * reactively updating a progress bar. On completion, shows a download link.
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'
import { X, Download, Loader2, CheckCircle, AlertCircle, Film } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ExportStatus } from '@/lib/types/renderJob'

// Lazy-init: only create Supabase client at runtime (not during Next.js prerender)
function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

interface ExportProgressModalProps {
  exportId: string
  onClose: () => void
}

export function ExportProgressModal({ exportId, onClose }: ExportProgressModalProps) {
  const [status, setStatus] = useState<ExportStatus>('queued')
  const [progress, setProgress] = useState(0)
  const [mp4Url, setMp4Url] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Fetch initial state
  useEffect(() => {
    const supabase = getSupabaseClient()
    const fetchInitial = async () => {
      const { data } = await supabase
        .from('video_exports')
        .select('status, progress, mp4_url, error_message')
        .eq('id', exportId)
        .single()

      if (data) {
        setStatus(data.status as ExportStatus)
        setProgress(data.progress)
        setMp4Url(data.mp4_url)
        setErrorMessage(data.error_message)
      }
    }
    fetchInitial()
  }, [exportId])

  // Subscribe to Realtime updates
  useEffect(() => {
    const supabase = getSupabaseClient()
    const channel = supabase
      .channel(`export-${exportId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'video_exports',
          filter: `id=eq.${exportId}`,
        },
        (payload) => {
          const row = payload.new as {
            status: ExportStatus
            progress: number
            mp4_url: string | null
            error_message: string | null
          }
          setStatus(row.status)
          setProgress(row.progress)
          if (row.mp4_url) setMp4Url(row.mp4_url)
          if (row.error_message) setErrorMessage(row.error_message)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [exportId])

  const handleRetry = useCallback(async () => {
    // Re-queue by calling the export API (would need configId — simplified here)
    setStatus('queued')
    setProgress(0)
    setErrorMessage(null)
  }, [])

  const statusConfig = {
    queued: {
      icon: <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />,
      label: 'In queue…',
      color: 'bg-zinc-600',
    },
    processing: {
      icon: <Film className="w-5 h-5 text-purple-400 animate-pulse" />,
      label: 'Rendering…',
      color: 'bg-purple-600',
    },
    completed: {
      icon: <CheckCircle className="w-5 h-5 text-green-400" />,
      label: 'Complete!',
      color: 'bg-green-600',
    },
    failed: {
      icon: <AlertCircle className="w-5 h-5 text-red-400" />,
      label: 'Failed',
      color: 'bg-red-600',
    },
  }

  const config = statusConfig[status]

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {config.icon}
            <h3 className="text-white font-semibold">{config.label}</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-zinc-400 hover:text-white h-8 w-8 p-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Progress bar */}
        {(status === 'queued' || status === 'processing') && (
          <div className="space-y-2">
            <div className="w-full h-3 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full ${config.color} rounded-full transition-all duration-500 ease-out`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-zinc-400">
              <span>{progress}%</span>
              <span>
                {status === 'queued' ? 'Waiting for worker…' : 'Encoding frames…'}
              </span>
            </div>
          </div>
        )}

        {/* Completed: Download button */}
        {status === 'completed' && mp4Url && (
          <div className="space-y-3">
            <div className="w-full h-3 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-green-600 rounded-full w-full" />
            </div>
            <a
              href={mp4Url}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              Download Video
            </a>
          </div>
        )}

        {/* Failed: Error + Retry */}
        {status === 'failed' && (
          <div className="space-y-3">
            <div className="p-3 bg-red-950/50 border border-red-800/50 rounded-lg">
              <p className="text-sm text-red-400">
                {errorMessage || 'An unknown error occurred during rendering.'}
              </p>
            </div>
            <Button
              onClick={handleRetry}
              className="w-full bg-zinc-700 hover:bg-zinc-600 text-white"
            >
              Retry Export
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
