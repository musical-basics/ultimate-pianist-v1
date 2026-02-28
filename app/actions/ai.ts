'use server'

/**
 * AI Server Action — wraps Gemini anchor prediction behind a server-only boundary.
 * This hides the API key from the client bundle.
 * Audio is fetched server-side by URL to avoid the server action body size limit.
 */

import { GoogleGenAI, Type } from '@google/genai'
import { getConfigsWithCorrections } from '@/lib/services/configService'

const anchorArraySchema = {
    type: Type.ARRAY,
    items: {
        type: Type.OBJECT,
        properties: {
            measure: { type: Type.INTEGER, description: 'Measure number (1-indexed)' },
            time: { type: Type.NUMBER, description: 'Time in seconds when this measure starts' },
        },
        required: ['measure', 'time'],
    },
}

export async function predictAnchors(
    audioUrl: string,
    xmlContent: string,
    totalMeasures: number
): Promise<{ anchors: Array<{ measure: number; time: number }> }> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || ''
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set')

    const ai = new GoogleGenAI({ apiKey })

    // Fetch audio server-side and convert to base64
    const audioRes = await fetch(audioUrl)
    const audioBuffer = await audioRes.arrayBuffer()
    const audioBase64 = Buffer.from(audioBuffer).toString('base64')
    const contentType = audioRes.headers.get('content-type') || 'audio/wav'

    // Dynamic few-shot: get past corrections for learning
    let fewShotText = ''
    try {
        const corrected = await getConfigsWithCorrections()
        if (corrected.length > 0) {
            fewShotText = '\n\nHere are examples of correct mappings from previous songs:\n'
            for (const config of corrected.slice(0, 3)) {
                fewShotText += `\nSong: "${config.title}"\n`
                fewShotText += `Corrected anchors: ${JSON.stringify(config.anchors)}\n`
                if (config.ai_anchors) {
                    fewShotText += `AI predicted: ${JSON.stringify(config.ai_anchors)}\n`
                }
            }
        }
    } catch {
        // Silently skip if corrections unavailable
    }

    const prompt = `You are a music analysis AI. Given an audio recording and the corresponding MusicXML score, determine the exact timestamp (in seconds) when each measure begins.

The piece has ${totalMeasures} measures. Return a JSON array where each object has:
- "measure": the measure number (1-indexed)
- "time": the time in seconds when this measure begins

Listen carefully to the audio and align it with the score structure. The first measure usually starts at or near 0 seconds, but account for any pickup measures or silence at the beginning.

Be precise — errors of more than 0.5 seconds per measure will require manual correction.${fewShotText}

Here is the MusicXML content for reference:
${xmlContent.substring(0, 5000)}${xmlContent.length > 5000 ? '\n... (truncated)' : ''}`

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
            {
                role: 'user',
                parts: [
                    {
                        inlineData: {
                            mimeType: contentType,
                            data: audioBase64,
                        },
                    },
                    { text: prompt },
                ],
            },
        ],
        config: {
            responseMimeType: 'application/json',
            responseSchema: anchorArraySchema,
        },
    })

    const text = response.text || '[]'
    const anchors = JSON.parse(text)

    return { anchors }
}
