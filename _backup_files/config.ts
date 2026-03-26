'use server'

/**
 * Server Actions for configuration CRUD — keeps service role key server-side.
 */

import {
    getAllConfigs,
    getPublishedConfigs,
    getConfigById,
    createConfig,
    updateConfig,
    deleteConfig,
    togglePublish,
    saveAnchors,
    uploadAudio,
    uploadXml,
    uploadMidi,
} from '@/lib/services/configService'
import type { SongConfig, Anchor, BeatAnchor } from '@/lib/types'

export async function fetchAllConfigs(): Promise<SongConfig[]> {
    return getAllConfigs()
}

export async function fetchPublishedConfigs(): Promise<SongConfig[]> {
    return getPublishedConfigs()
}

export async function fetchConfigById(id: string): Promise<SongConfig | null> {
    return getConfigById(id)
}

export async function createNewConfig(title?: string): Promise<SongConfig> {
    return createConfig(title)
}

export async function updateConfigAction(
    id: string,
    updates: Partial<Pick<SongConfig, 'title' | 'audio_url' | 'xml_url' | 'midi_url' | 'anchors' | 'beat_anchors' | 'subdivision' | 'is_level2' | 'ai_anchors' | 'is_published' | 'music_font'>>
): Promise<SongConfig> {
    return updateConfig(id, updates)
}

export async function deleteConfigAction(id: string): Promise<void> {
    return deleteConfig(id)
}

export async function togglePublishAction(id: string, published: boolean): Promise<void> {
    return togglePublish(id, published)
}

export async function saveAnchorsAction(
    id: string,
    anchors: Anchor[],
    beatAnchors?: BeatAnchor[]
): Promise<void> {
    return saveAnchors(id, anchors, beatAnchors)
}

export async function uploadAudioAction(formData: FormData, configId: string): Promise<string> {
    const file = formData.get('file') as File
    if (!file) throw new Error('No file provided')
    return uploadAudio(file, configId)
}

export async function uploadXmlAction(formData: FormData, configId: string): Promise<string> {
    const file = formData.get('file') as File
    if (!file) throw new Error('No file provided')
    return uploadXml(file, configId)
}

export async function uploadMidiAction(formData: FormData, configId: string): Promise<string> {
    const file = formData.get('file') as File
    if (!file) throw new Error('No file provided')
    return uploadMidi(file, configId)
}

export async function duplicateConfigAction(
    sourceId: string,
    newTitle: string
): Promise<SongConfig> {
    const source = await getConfigById(sourceId)
    if (!source) throw new Error('Source config not found')

    const newConfig = await createConfig(newTitle)
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
    })
}
