/**
 * POST /api/export
 *
 * Dispatches a video export job to the BullMQ queue.
 * Inserts a 'queued' row into Supabase video_exports,
 * then adds the job to Redis for the Railway worker to pick up.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getVideoExportQueue } from '@/lib/queue'
import { wakeRailwayWorker } from '@/lib/railway'
import type { RenderJobPayload } from '@/lib/types/renderJob'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { configId, audioUrl, durationSec } = await req.json()

    if (!configId || !audioUrl || !durationSec) {
      return NextResponse.json(
        { error: 'Missing required fields: configId, audioUrl, durationSec' },
        { status: 400 }
      )
    }

    // Step 7a: Insert queued row into Supabase
    const { data: row, error: dbError } = await supabase
      .from('video_exports')
      .insert({
        config_id: configId,
        status: 'queued',
        progress: 0,
      })
      .select('id')
      .single()

    if (dbError || !row) {
      console.error('[Export API] Supabase insert failed:', dbError)
      return NextResponse.json(
        { error: 'Failed to create export record' },
        { status: 500 }
      )
    }

    // Step 7b: Dispatch to BullMQ
    const queue = getVideoExportQueue()
    await queue.add('render-video', {
      exportId: row.id,
      configId,
      audioUrl,
      durationSec,
    } satisfies RenderJobPayload)

    console.log(`[Export API] Job queued: exportId=${row.id}, configId=${configId}`)

    // Wake the Railway worker (it may be shut down to save Redis commands)
    await wakeRailwayWorker()

    return NextResponse.json({ exportId: row.id, status: 'queued' })
  } catch (err) {
    console.error('[Export API] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/export
 *
 * Kill switch: drains all BullMQ jobs and marks active Supabase rows as cancelled.
 */
export async function DELETE() {
  try {
    // 1. Drain all pending jobs from the queue
    const queue = getVideoExportQueue()
    await queue.drain()
    
    // 2. Also obliterate any stuck/completed jobs
    try {
      await queue.obliterate({ force: true })
    } catch (e) {
      console.warn('[Export API] Obliterate warning:', e)
    }

    // 3. Mark any in-progress Supabase rows as cancelled
    const { data: activeJobs } = await supabase
      .from('video_exports')
      .select('id')
      .in('status', ['queued', 'rendering'])
    
    if (activeJobs && activeJobs.length > 0) {
      await supabase
        .from('video_exports')
        .update({ status: 'cancelled', error_message: 'Killed by admin' })
        .in('status', ['queued', 'rendering'])
      
      console.log(`[Export API] Cancelled ${activeJobs.length} active jobs`)
    }

    console.log('[Export API] Kill switch activated — all jobs drained')
    return NextResponse.json({ status: 'killed', jobsCancelled: activeJobs?.length || 0 })
  } catch (err) {
    console.error('[Export API] Kill error:', err)
    return NextResponse.json(
      { error: 'Failed to kill exports' },
      { status: 500 }
    )
  }
}
