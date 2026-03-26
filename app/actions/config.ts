'use server'

/**
 * Server Actions for configuration CRUD — keeps service role key server-side.
 */

import { createClient } from '@/lib/supabase/server'
import {
    getAllConfigs,
    getPublishedConfigs,
    getConfigById,
    getPublicConfigById,
    createConfig,
    updateConfig,
    deleteConfig,
    togglePublish,
    saveAnchors,
    generateUploadUrl,
} from '@/lib/services/configService'
import type { SongConfig, Anchor, BeatAnchor } from '@/lib/types'

async function getAuthUser() {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) throw new Error('Unauthorized')
    return user
}

export async function fetchAllConfigs(): Promise<SongConfig[]> {
    const user = await getAuthUser()
    return getAllConfigs(user.id)
}

export async function fetchPublishedConfigs(): Promise<SongConfig[]> {
    return getPublishedConfigs()
}

export async function fetchConfigById(id: string): Promise<SongConfig | null> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
        return getConfigById(id, user.id)
    }
    return getPublicConfigById(id)
}

export async function createNewConfig(title?: string): Promise<SongConfig> {
    const user = await getAuthUser()
    return createConfig(title, user.id)
}

export async function updateConfigAction(
    id: string,
    updates: Partial<Pick<SongConfig, 'title' | 'audio_url' | 'xml_url' | 'midi_url' | 'anchors' | 'beat_anchors' | 'subdivision' | 'is_level2' | 'ai_anchors' | 'is_published' | 'music_font'>>
): Promise<SongConfig> {
    const user = await getAuthUser()
    return updateConfig(id, updates, user.id)
}

export async function deleteConfigAction(id: string): Promise<void> {
    const user = await getAuthUser()
    return deleteConfig(id, user.id)
}

export async function togglePublishAction(id: string, published: boolean): Promise<void> {
    const user = await getAuthUser()
    return togglePublish(id, published, user.id)
}

export async function saveAnchorsAction(
    id: string,
    anchors: Anchor[],
    beatAnchors?: BeatAnchor[]
): Promise<void> {
    const user = await getAuthUser()
    return saveAnchors(id, anchors, beatAnchors, user.id)
}

export async function generateUploadUrlAction(
    configId: string,
    fileType: 'audio' | 'xml' | 'midi',
    fileName: string,
    contentType: string
): Promise<{ uploadUrl: string; finalFileUrl: string }> {
    const user = await getAuthUser()
    return generateUploadUrl(configId, fileType, fileName, contentType, user.id)
}

export async function duplicateConfigAction(
    sourceId: string,
    newTitle: string
): Promise<SongConfig> {
    const user = await getAuthUser()
    const source = await getConfigById(sourceId, user.id)
    if (!source) throw new Error('Source config not found')

    const newConfig = await createConfig(newTitle, user.id)
    // Copy over all relevant fields
    return updateConfig(newConfig.id, {
        audio_url: source.audio_url,
        xml_url: source.xml_url,
        midi_url: source.midi_url,
        anchors: source.anchors,
        beat_anchors: source.beat_anchors,
        subdivision: source.subdivision,
        is_level2: source.is_level2,
        ai_anchors: source.ai_anchors,
    }, user.id)
}
