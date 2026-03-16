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

    return NextResponse.json({ exportId: row.id, status: 'queued' })
  } catch (err) {
    console.error('[Export API] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
