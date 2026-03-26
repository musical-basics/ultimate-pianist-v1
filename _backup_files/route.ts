/**
 * API Route: File Upload to R2
 * Avoids server action body size limits — handles large WAV files.
 */

import { NextRequest, NextResponse } from 'next/server'
import { uploadAudio, uploadXml, uploadMidi } from '@/lib/services/configService'

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData()
        const file = formData.get('file') as File
        const configId = formData.get('configId') as string
        const fileType = formData.get('fileType') as string // 'audio' | 'xml' | 'midi'

        if (!file || !configId || !fileType) {
            return NextResponse.json(
                { error: 'Missing file, configId, or fileType' },
                { status: 400 }
            )
        }

        let url: string

        switch (fileType) {
            case 'audio':
                url = await uploadAudio(file, configId)
                break
            case 'xml':
                url = await uploadXml(file, configId)
                break
            case 'midi':
                url = await uploadMidi(file, configId)
                break
            default:
                return NextResponse.json(
                    { error: `Invalid fileType: ${fileType}` },
                    { status: 400 }
                )
        }

        return NextResponse.json({ url })
    } catch (err) {
        console.error('[Upload API] Error:', err)
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Upload failed' },
            { status: 500 }
        )
    }
}
