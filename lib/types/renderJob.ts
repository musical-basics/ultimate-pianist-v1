/**
 * Shared types for the video export pipeline.
 * Used by both the Next.js frontend (queue producer) and the Railway worker (consumer).
 */

export interface RenderJobPayload {
  /** UUID from the video_exports Supabase row */
  exportId: string
  /** Song config ID (maps to the render-view route param) */
  configId: string
  /** Full URL to the audio file (WAV or MP3) */
  audioUrl: string
  /** Total song duration in seconds */
  durationSec: number
}

export type ExportStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface VideoExportRow {
  id: string
  config_id: string
  status: ExportStatus
  progress: number
  mp4_url: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}
