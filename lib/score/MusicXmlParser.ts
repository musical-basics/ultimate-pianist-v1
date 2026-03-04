// lib/score/MusicXmlParser.ts
//
// Parses MusicXML directly via DOMParser — no OSMD intermediary.
// Produces IntermediateScore with exact note names, octaves, and accidentals.
// This eliminates the fragile OSMD-enum-to-VexFlow translation.

import type {
    IntermediateScore,
    IntermediateMeasure,
    IntermediateStaff,
    IntermediateVoice,
    IntermediateNote,
} from './IntermediateScore'

// ─── Public API ────────────────────────────────────────────────────

/**
 * Fetch + parse a MusicXML URL into an IntermediateScore.
 * Uses DOMParser — no OSMD, no hidden DOM, pure XML processing.
 */
export async function parseMusicXml(xmlUrl: string): Promise<IntermediateScore> {
    const response = await fetch(xmlUrl)
    const xmlText = await response.text()
    return parseMusicXmlString(xmlText)
}

/**
 * Parse a MusicXML string into an IntermediateScore.
 */
export function parseMusicXmlString(xmlText: string): IntermediateScore {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, 'application/xml')

    const parserErrors = doc.getElementsByTagName('parsererror')
    if (parserErrors.length > 0) {
        throw new Error(`MusicXML parse error: ${parserErrors[0].textContent}`)
    }

    // Get title
    const titleEl = doc.querySelector('work-title') || doc.querySelector('movement-title')
    const title = titleEl?.textContent?.trim() || undefined

    // Find all parts — for piano, usually one part with 2 staves
    const parts = doc.querySelectorAll('part')
    if (parts.length === 0) {
        return { title, measures: [] }
    }

    // Use first part (piano grand staff)
    const part = parts[0]
    const measureEls = part.querySelectorAll(':scope > measure')

    const measures: IntermediateMeasure[] = []
    let currentDivisions = 1
    let currentNumerator = 4
    let currentDenominator = 4
    let currentFifths = 0
    let currentStaffCount = 2

    let prevNumerator: number | undefined
    let prevDenominator: number | undefined
    let prevFifths: number | undefined
    const prevClefs = new Map<number, string>()

    for (let mIdx = 0; mIdx < measureEls.length; mIdx++) {
        const measureEl = measureEls[mIdx]
        const measureNumber = mIdx + 1

        // Parse <attributes>
        const attrs = measureEl.querySelector('attributes')
        if (attrs) {
            const divEl = attrs.querySelector('divisions')
            if (divEl) currentDivisions = parseInt(divEl.textContent || '1')

            const stavesEl = attrs.querySelector('staves')
            if (stavesEl) currentStaffCount = parseInt(stavesEl.textContent || '2')

            const timeEl = attrs.querySelector('time')
            if (timeEl) {
                const beatsEl = timeEl.querySelector('beats')
                const btEl = timeEl.querySelector('beat-type')
                if (beatsEl) currentNumerator = parseInt(beatsEl.textContent || '4')
                if (btEl) currentDenominator = parseInt(btEl.textContent || '4')
            }

            const keyEl = attrs.querySelector('key')
            if (keyEl) {
                const fifthsEl = keyEl.querySelector('fifths')
                if (fifthsEl) currentFifths = parseInt(fifthsEl.textContent || '0')
            }

            // Parse clefs
            const clefEls = attrs.querySelectorAll('clef')
            clefEls.forEach(clefEl => {
                const num = parseInt(clefEl.getAttribute('number') || '1')
                const sign = clefEl.querySelector('sign')?.textContent || 'G'
                prevClefs.set(num, sign === 'F' ? 'bass' : 'treble')
            })
        }

        // Emit time sig only when changed
        let tsNum: number | undefined
        let tsDen: number | undefined
        if (currentNumerator !== prevNumerator || currentDenominator !== prevDenominator) {
            tsNum = currentNumerator
            tsDen = currentDenominator
            prevNumerator = currentNumerator
            prevDenominator = currentDenominator
        }

        // Emit key sig only when changed
        let keySig: string | undefined
        if (currentFifths !== prevFifths) {
            keySig = fifthsToKeySignature(currentFifths)
            prevFifths = currentFifths
        }

        // ── Parse notes ──
        // Group notes by staff and voice
        const staffVoiceNotes = new Map<string, { staffNum: number; voiceNum: number; notes: IntermediateNote[] }>()
        let currentPosition = 0  // in divisions
        let lastStaffNum = 1
        let lastVoiceNum = 1

        const children = measureEl.children
        for (let ci = 0; ci < children.length; ci++) {
            const child = children[ci]
            const tagName = child.tagName

            if (tagName === 'forward') {
                const dur = parseInt(child.querySelector('duration')?.textContent || '0')
                currentPosition += dur
                continue
            }

            if (tagName === 'backup') {
                const dur = parseInt(child.querySelector('duration')?.textContent || '0')
                currentPosition -= dur
                continue
            }

            if (tagName !== 'note') continue

            // Skip grace notes for now (they don't count for timing)
            if (child.querySelector('grace')) continue

            const isChord = child.querySelector('chord') !== null
            const isRest = child.querySelector('rest') !== null
            const durationDivs = parseInt(child.querySelector('duration')?.textContent || '0')

            // If chord, don't advance position
            if (!isChord && durationDivs > 0) {
                // Position was already advanced by previous non-chord note
                // We'll set the position AFTER processing this note
            }

            // Staff and voice — chord notes often omit <voice>, inherit from previous note
            const staffEl = child.querySelector('staff')
            const voiceEl = child.querySelector('voice')
            const staffNum = staffEl ? parseInt(staffEl.textContent || '1') : (isChord ? lastStaffNum : 1)
            const voiceNum = voiceEl ? parseInt(voiceEl.textContent || '1') : (isChord ? lastVoiceNum : 1)

            // Update tracking for next chord note
            if (!isChord) {
                lastStaffNum = staffNum
                lastVoiceNum = voiceNum
            }

            const svKey = `${staffNum}-${voiceNum}`

            // Beat calculation: currentPosition in divisions → beat number (1-based)
            const beatVal = 1 + (currentPosition / currentDivisions) * (currentDenominator / 4)
            const roundedBeat = Math.round(beatVal * 1000) / 1000

            // Build key string
            let key: string
            let accStr: string | null = null
            if (isRest) {
                key = staffNum === 2 ? 'd/3' : 'b/4'
            } else {
                const pitchEl = child.querySelector('pitch')
                if (!pitchEl) {
                    key = 'b/4'
                } else {
                    const step = pitchEl.querySelector('step')?.textContent || 'C'
                    const octave = parseInt(pitchEl.querySelector('octave')?.textContent || '4')
                    const alterEl = pitchEl.querySelector('alter')
                    const alter = alterEl ? parseFloat(alterEl.textContent || '0') : 0

                    // Build VexFlow key: "c#/4"
                    const letter = step.toLowerCase()
                    const accidental = alterToVexFlowAccidental(alter)
                    key = `${letter}${accidental}/${octave}`

                    // Only show accidental if MusicXML has explicit <accidental> tag
                    const accidentalEl = child.querySelector('accidental')
                    if (accidentalEl) {
                        accStr = accidentalTextToVexFlow(accidentalEl.textContent || '')
                    }
                }
            }

            // Duration
            const typeStr = child.querySelector('type')?.textContent || 'quarter'
            const dotCount = child.querySelectorAll('dot').length
            let vfDuration = musicXmlTypeToVexFlow(typeStr)
            if (isRest) vfDuration += 'r'
            if (dotCount > 0) vfDuration += 'd'

            // Ties
            const tieEls = child.querySelectorAll('tie')
            let hasTieStart = false
            tieEls.forEach(t => {
                if (t.getAttribute('type') === 'start') hasTieStart = true
            })

            // Articulations
            const articulations: string[] = []
            const notationsEl = child.querySelector('notations')
            let tupletStart = false
            let tupletStop = false
            if (notationsEl) {
                const articulationsEl = notationsEl.querySelector('articulations')
                if (articulationsEl) {
                    if (articulationsEl.querySelector('staccato')) articulations.push('a.')
                    if (articulationsEl.querySelector('tenuto')) articulations.push('a-')
                    if (articulationsEl.querySelector('accent')) articulations.push('a>')
                    if (articulationsEl.querySelector('strong-accent')) articulations.push('a^')
                }
                if (notationsEl.querySelector('fermata')) articulations.push('a@a')

                // Tuplet start/stop markers
                const tupletEls = notationsEl.querySelectorAll('tuplet')
                tupletEls.forEach(t => {
                    if (t.getAttribute('type') === 'start') tupletStart = true
                    if (t.getAttribute('type') === 'stop') tupletStop = true
                })
            }

            // Time modification (tuplets)
            let tupletActual: number | undefined
            let tupletNormal: number | undefined
            const timeMod = child.querySelector('time-modification')
            if (timeMod) {
                const actual = timeMod.querySelector('actual-notes')?.textContent
                const normal = timeMod.querySelector('normal-notes')?.textContent
                if (actual) tupletActual = parseInt(actual)
                if (normal) tupletNormal = parseInt(normal)
            }

            const vfId = `vf-M${measureNumber}-S${staffNum - 1}-V${voiceNum}-B${roundedBeat}`

            if (!staffVoiceNotes.has(svKey)) {
                staffVoiceNotes.set(svKey, { staffNum, voiceNum, notes: [] })
            }

            const group = staffVoiceNotes.get(svKey)!

            if (isChord && group.notes.length > 0) {
                // Add to the last note as a chord (merge keys)
                const lastNote = group.notes[group.notes.length - 1]
                lastNote.keys.push(key)
                lastNote.accidentals.push(accStr)
                lastNote.tiesToNext.push(hasTieStart)
            } else {
                // New note/rest
                group.notes.push({
                    keys: [key],
                    duration: vfDuration,
                    dots: dotCount,
                    isRest,
                    accidentals: [accStr],
                    tiesToNext: [hasTieStart],
                    articulations,
                    beat: roundedBeat,
                    vfId,
                    tupletActual,
                    tupletNormal,
                    tupletStart,
                    tupletStop,
                })
            }

            // Advance position (only for non-chord notes)
            if (!isChord) {
                currentPosition += durationDivs
            }
        }

        // ── Build staves ──
        const staves: IntermediateStaff[] = []

        for (let sIdx = 0; sIdx < currentStaffCount; sIdx++) {
            const staffNumber = sIdx + 1

            // Clef — only emit if set in attributes for this measure
            let clef: 'treble' | 'bass' | undefined
            if (mIdx === 0 || (attrs && attrs.querySelector(`clef[number="${staffNumber}"]`))) {
                clef = (prevClefs.get(staffNumber) as 'treble' | 'bass') || (sIdx === 0 ? 'treble' : 'bass')
            }

            // Collect voices for this staff
            const voices: IntermediateVoice[] = []
            staffVoiceNotes.forEach((group, _key) => {
                if (group.staffNum !== staffNumber) return

                // Sort notes by beat
                group.notes.sort((a, b) => a.beat - b.beat)
                voices.push({
                    voiceIndex: group.voiceNum,
                    notes: group.notes,
                })
            })

            // If no voices, create a padded rest
            if (voices.length === 0) {
                const restKey = sIdx === 1 ? 'd/3' : 'b/4'
                let restDur = 'wr'
                let restDots = 0

                if (currentNumerator === 3 && currentDenominator === 4) { restDur = 'hr'; restDots = 1 }
                else if (currentNumerator === 2 && currentDenominator === 4) { restDur = 'hr' }
                else if (currentNumerator === 6 && currentDenominator === 8) { restDur = 'hr'; restDots = 1 }

                voices.push({
                    voiceIndex: 0,
                    notes: [{
                        keys: [restKey],
                        duration: restDur + (restDots ? 'd' : ''),
                        dots: restDots,
                        isRest: true,
                        accidentals: [null],
                        tiesToNext: [false],
                        articulations: [],
                        beat: 1,
                        vfId: `vf-M${measureNumber}-S${sIdx}-V0-Brest`,
                    }],
                })
            }

            staves.push({ staffIndex: sIdx, clef, voices })
        }

        measures.push({
            measureNumber,
            timeSignatureNumerator: tsNum,
            timeSignatureDenominator: tsDen,
            keySignature: keySig,
            staves,
        })
    }

    console.log(`[MusicXmlParser] Parsed ${measures.length} measures directly from MusicXML`)
    return { title, measures }
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Convert MusicXML <fifths> value to VexFlow key signature string */
function fifthsToKeySignature(fifths: number): string {
    const map: Record<number, string> = {
        [-7]: 'Cb', [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F',
        0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
    }
    return map[fifths] || 'C'
}

/** Convert MusicXML <alter> numeric value to VexFlow key string suffix */
function alterToVexFlowAccidental(alter: number): string {
    if (alter === 0) return ''
    if (alter === 1) return '#'
    if (alter === -1) return 'b'
    if (alter === 2) return '##'
    if (alter === -2) return 'bb'
    if (alter === 0.5) return '+' // quarter tone sharp (rare)
    if (alter === -0.5) return 'd' // quarter tone flat (rare)
    return ''
}

/** Convert MusicXML <accidental> text to VexFlow accidental modifier string */
function accidentalTextToVexFlow(text: string): string | null {
    const map: Record<string, string> = {
        'sharp': '#',
        'flat': 'b',
        'natural': 'n',
        'double-sharp': '##',
        'sharp-sharp': '##',
        'flat-flat': 'bb',
        'double-flat': 'bb',
        'natural-sharp': '#',
        'natural-flat': 'b',
    }
    return map[text] || null
}

/** Convert MusicXML <type> to VexFlow duration string */
function musicXmlTypeToVexFlow(type: string): string {
    const map: Record<string, string> = {
        'whole': 'w',
        'half': 'h',
        'quarter': 'q',
        'eighth': '8',
        '16th': '16',
        '32nd': '32',
        '64th': '64',
        '128th': '128',
    }
    return map[type] || 'q'
}
