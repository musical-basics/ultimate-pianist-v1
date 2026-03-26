/**
 * Configuration Service — Supabase CRUD + R2 Media Uploads
 * Uses service role key (server-side) per user rules.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
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

// ─── File Upload (Presigned URL) ─────────────────────────────────

export async function generateUploadUrl(
    configId: string,
    fileType: 'audio' | 'xml' | 'midi',
    fileName: string,
    contentType: string,
    userId: string
): Promise<{ uploadUrl: string; finalFileUrl: string }> {
    const r2 = getR2Client()
    const bucket = getR2Bucket()
    const domain = getR2PublicDomain()

    const ext = fileName.split('.').pop() || 'bin'
    let fileKey = ''

    if (fileType === 'audio') {
        fileKey = `audio.${ext}`
    } else if (fileType === 'xml') {
        fileKey = `score.xml`
    } else if (fileType === 'midi') {
        fileKey = `midi.${ext}`
    } else {
        throw new Error('Invalid file type')
    }

    const path = `users/${userId}/configs/${configId}/${fileKey}`

    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: path,
        ContentType: contentType,
    })

    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 3600 })
    const finalFileUrl = `${domain}/${path}`

    return { uploadUrl, finalFileUrl }
}

// ─── CRUD Operations ─────────────────────────────────────────────

export async function createConfig(title: string = 'Untitled', userId: string): Promise<SongConfig> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('configurations')
        .insert({ title, user_id: userId })
        .select()
        .single()

    if (error) throw new Error(`Failed to create config: ${error.message}`)
    return data as SongConfig
}

export async function getConfigById(id: string, userId: string): Promise<SongConfig | null> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('configurations')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single()

    if (error) {
        console.error('Failed to get config:', error.message)
        return null
    }
    return data as SongConfig
}

export async function getPublicConfigById(id: string): Promise<SongConfig | null> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('configurations')
        .select('*')
        .eq('id', id)
        .eq('is_published', true)
        .single()

    if (error) {
        console.error('Failed to get public config:', error.message)
        return null
    }
    return data as SongConfig
}

export async function getAllConfigs(userId: string): Promise<SongConfig[]> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('configurations')
        .select('*')
        .eq('user_id', userId)
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
    updates: Partial<Pick<SongConfig, 'title' | 'audio_url' | 'xml_url' | 'midi_url' | 'anchors' | 'beat_anchors' | 'subdivision' | 'is_level2' | 'ai_anchors' | 'is_published'>>,
    userId: string
): Promise<SongConfig> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('configurations')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single()

    if (error) throw new Error(`Failed to update config: ${error.message}`)
    return data as SongConfig
}

export async function deleteConfig(id: string, userId: string): Promise<void> {
    const sb = getSupabase()
    const { error } = await sb
        .from('configurations')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)

    if (error) throw new Error(`Failed to delete config: ${error.message}`)
}

export async function saveAnchors(
    id: string,
    anchors: Anchor[],
    beatAnchors: BeatAnchor[] | undefined,
    userId: string
): Promise<void> {
    const updates: Record<string, unknown> = { anchors }
    if (beatAnchors) updates.beat_anchors = beatAnchors
    await updateConfig(id, updates as Partial<SongConfig>, userId)
}

export async function togglePublish(id: string, published: boolean, userId: string): Promise<void> {
    await updateConfig(id, { is_published: published }, userId)
}

// ─── Corrections for AI Learning ─────────────────────────────────

export async function getConfigsWithCorrections(userId: string): Promise<SongConfig[]> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('configurations')
        .select('*')
        .eq('user_id', userId)
        .not('ai_anchors', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(10)

    if (error) throw new Error(`Failed to get configs with corrections: ${error.message}`)
    return (data || []) as SongConfig[]
}
