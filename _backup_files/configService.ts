/**
 * Configuration Service — Supabase CRUD + R2 Media Uploads
 * Uses service role key (server-side) per user rules.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import type { SongConfig, Anchor, BeatAnchor } from '@/lib/types'

// ─── Supabase Client (Service Role) ──────────────────────────────

function getSupabase(): SupabaseClient {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_KEY || ''
    return createClient(url, key)
}

// ─── R2 Client ───────────────────────────────────────────────────

function getR2Client(): S3Client {
    const accountId = process.env.R2_ACCOUNT_ID || process.env.VITE_R2_ACCOUNT_ID || ''
    const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.VITE_R2_ACCESS_KEY_ID || ''
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.VITE_R2_SECRET_ACCESS_KEY || ''

    return new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
    })
}

function getR2Bucket(): string {
    return process.env.R2_BUCKET_NAME || process.env.VITE_R2_BUCKET_NAME || ''
}

function getR2PublicDomain(): string {
    return process.env.R2_PUBLIC_DOMAIN || process.env.VITE_R2_PUBLIC_DOMAIN || ''
}

// ─── File Upload ─────────────────────────────────────────────────

export async function uploadFile(
    file: File | Blob,
    path: string,
    contentType: string
): Promise<string> {
    const r2 = getR2Client()
    const bucket = getR2Bucket()
    const domain = getR2PublicDomain()

    const buffer = Buffer.from(await (file as Blob).arrayBuffer())

    await r2.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: path,
            Body: buffer,
            ContentType: contentType,
        })
    )

    return `${domain}/${path}`
}

export async function uploadAudio(file: File, configId: string): Promise<string> {
    const ext = file.name.split('.').pop() || 'wav'
    const path = `configs/${configId}/audio.${ext}`
    return uploadFile(file, path, file.type || 'audio/wav')
}

export async function uploadXml(file: File, configId: string): Promise<string> {
    const path = `configs/${configId}/score.xml`
    return uploadFile(file, path, 'application/xml')
}

export async function uploadMidi(file: File, configId: string): Promise<string> {
    const ext = file.name.split('.').pop() || 'mid'
    const path = `configs/${configId}/midi.${ext}`
    return uploadFile(file, path, 'audio/midi')
}

// ─── CRUD Operations ─────────────────────────────────────────────

export async function createConfig(title: string = 'Untitled'): Promise<SongConfig> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('configurations')
        .insert({ title })
        .select()
        .single()

    if (error) throw new Error(`Failed to create config: ${error.message}`)
    return data as SongConfig
}

export async function getConfigById(id: string): Promise<SongConfig | null> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('configurations')
        .select('*')
        .eq('id', id)
        .single()

    if (error) {
        console.error('Failed to get config:', error.message)
        return null
    }
    return data as SongConfig
}

export async function getAllConfigs(): Promise<SongConfig[]> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('configurations')
        .select('*')
        .order('updated_at', { ascending: false })

    if (error) throw new Error(`Failed to list configs: ${error.message}`)
    return (data || []) as SongConfig[]
}

export async function getPublishedConfigs(): Promise<SongConfig[]> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('configurations')
        .select('*')
        .eq('is_published', true)
        .order('updated_at', { ascending: false })

    if (error) throw new Error(`Failed to list published configs: ${error.message}`)
    return (data || []) as SongConfig[]
}

export async function updateConfig(
    id: string,
    updates: Partial<Pick<SongConfig, 'title' | 'audio_url' | 'xml_url' | 'midi_url' | 'anchors' | 'beat_anchors' | 'subdivision' | 'is_level2' | 'ai_anchors' | 'is_published'>>
): Promise<SongConfig> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('configurations')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

    if (error) throw new Error(`Failed to update config: ${error.message}`)
    return data as SongConfig
}

export async function deleteConfig(id: string): Promise<void> {
    const sb = getSupabase()
    const { error } = await sb
        .from('configurations')
        .delete()
        .eq('id', id)

    if (error) throw new Error(`Failed to delete config: ${error.message}`)
}

export async function saveAnchors(
    id: string,
    anchors: Anchor[],
    beatAnchors?: BeatAnchor[]
): Promise<void> {
    const updates: Record<string, unknown> = { anchors }
    if (beatAnchors) updates.beat_anchors = beatAnchors
    await updateConfig(id, updates as Partial<SongConfig>)
}

export async function togglePublish(id: string, published: boolean): Promise<void> {
    await updateConfig(id, { is_published: published })
}

// ─── Corrections for AI Learning ─────────────────────────────────

export async function getConfigsWithCorrections(): Promise<SongConfig[]> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('configurations')
        .select('*')
        .not('ai_anchors', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(10)

    if (error) throw new Error(`Failed to get configs with corrections: ${error.message}`)
    return (data || []) as SongConfig[]
}
