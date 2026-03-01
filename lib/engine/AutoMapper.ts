// lib/engine/AutoMapper.ts
import type { NoteEvent, Anchor } from '../types'

export function autoMapMidiToScore(
    midiNotes: NoteEvent[],
    expectedCounts: Map<number, number>,
    totalMeasures: number
): Anchor[] {
    const anchors: Anchor[] = []
    if (midiNotes.length === 0 || totalMeasures === 0) {
        return anchors
    }

    // Ensure MIDI is sorted chronologically
    const sortedMidi = [...midiNotes].sort((a, b) => a.startTimeSec - b.startTimeSec)

    console.log(`[AutoMapper] Starting auto-map. Total Measures: ${totalMeasures}, Total MIDI Notes: ${sortedMidi.length}`)
    console.log('[AutoMapper] Expected Counts:', Object.fromEntries(expectedCounts))

    let currentMidiIdx = 0
    let amd = 2.0 // Fallback Average Measure Duration

    // Guess initial AMD based on total duration and measures
    if (sortedMidi.length > 0) {
        const totalDuration = sortedMidi[sortedMidi.length - 1].endTimeSec - sortedMidi[0].startTimeSec
        amd = totalDuration / totalMeasures
    }

    let currentTime = sortedMidi[0].startTimeSec
    let firstNoteOfMeasureTime = currentTime

    for (let m = 1; m <= totalMeasures; m++) {
        // Fast-forward cursor if it's stranded behind the current MIDI index
        if (currentMidiIdx < sortedMidi.length && currentTime < sortedMidi[currentMidiIdx].startTimeSec) {
            currentTime = sortedMidi[currentMidiIdx].startTimeSec
        }

        // Grab the actual start time of the first note in this measure
        if (currentMidiIdx < sortedMidi.length) {
            firstNoteOfMeasureTime = sortedMidi[currentMidiIdx].startTimeSec
        } else if (sortedMidi.length > 0) {
            firstNoteOfMeasureTime = sortedMidi[sortedMidi.length - 1].endTimeSec
        } else {
            firstNoteOfMeasureTime = currentTime
        }

        // Drop anchor at exact start of the first note of this measure
        anchors.push({ measure: m, time: firstNoteOfMeasureTime })

        const expectedCount = expectedCounts.get(m) || 0

        console.log(`--- [M${m}] ---`)
        console.log(`Expected: ${expectedCount}, Starting MIDI Idx: ${currentMidiIdx} (Time: ${firstNoteOfMeasureTime.toFixed(2)}s), Current AMD: ${amd.toFixed(2)}s`)

        // Empty measure (e.g. rests)
        if (expectedCount === 0) {
            currentTime += amd
            while (currentMidiIdx < sortedMidi.length && sortedMidi[currentMidiIdx].startTimeSec < currentTime) {
                currentMidiIdx++
            }
            continue
        }

        let matchedCount = 0
        let tempIdx = currentMidiIdx
        // Initialize windowEnd accurately
        let windowEnd = firstNoteOfMeasureTime + amd
        let lastMatchedTime = firstNoteOfMeasureTime

        let extensions = 0
        const MAX_EXTENSIONS = 6 // Up to 2x AMD extension
        const FEELER_STEP = amd / 3

        // --- Layer 1: The Echolocation / Feeler Loop ---
        while (extensions <= MAX_EXTENSIONS) {
            tempIdx = currentMidiIdx
            matchedCount = 0
            let windowLastTime = firstNoteOfMeasureTime

            // Gather notes within the current "feeler" window
            while (tempIdx < sortedMidi.length && sortedMidi[tempIdx].startTimeSec <= windowEnd) {
                windowLastTime = sortedMidi[tempIdx].endTimeSec
                matchedCount++
                tempIdx++
            }

            const ratio = matchedCount / expectedCount

            if (ratio >= 0.8 && ratio <= 1.2) {
                // Good match (allows slight dirty/missed notes)
                lastMatchedTime = windowLastTime
                break
            } else if (ratio > 1.2) {
                // Accelerando or extra notes. Clamp to exactly the expected count.
                matchedCount = 0
                tempIdx = currentMidiIdx
                while (tempIdx < sortedMidi.length && matchedCount < expectedCount) {
                    lastMatchedTime = sortedMidi[tempIdx].endTimeSec
                    matchedCount++
                    tempIdx++
                }
                break
            } else {
                // Ritardando: Not enough notes yet. Send another feeler.
                extensions++
                windowEnd += FEELER_STEP
            }
        }

        // If we completely exhausted feelers, just use the extended window
        if (extensions > MAX_EXTENSIONS) {
            lastMatchedTime = windowEnd
        }

        // --- Layer 2: The Chord Buffer Concept ---
        // Ensure we don't split a chord across a measure boundary.
        // If the next note is within 15ms of our last matched note, consume it too.
        while (
            tempIdx < sortedMidi.length &&
            tempIdx > currentMidiIdx &&
            (sortedMidi[tempIdx].startTimeSec - sortedMidi[tempIdx - 1].startTimeSec) <= 0.015
        ) {
            lastMatchedTime = Math.max(lastMatchedTime, sortedMidi[tempIdx].endTimeSec)
            tempIdx++
        }

        const notesConsumed = tempIdx - currentMidiIdx
        currentMidiIdx = tempIdx
        const measureDuration = Math.max(0.1, lastMatchedTime - firstNoteOfMeasureTime)

        console.log(`Matched: ${matchedCount}/${expectedCount} (Ratio: ${(matchedCount / expectedCount).toFixed(2)}), Extensions: ${extensions}, Ended at Idx: ${currentMidiIdx}`)
        console.log(`Measure Duration: ${measureDuration.toFixed(2)}s`)

        // --- Layer 3: Multilayered AMD Tracking (Exponential Moving Average) ---
        if (extensions > 0) {
            // Tagged as ritardando. Weight it lightly so it doesn't wreck future baseline tempo
            amd = (amd * 0.9) + (measureDuration * 0.1)
        } else {
            // If the measure duration is insanely short (like a pickup measure), don't let it crush the AMD
            if (measureDuration < amd * 0.3) {
                // Do not update AMD for extremely short pickup-like measures
                console.log(`Skipping AMD update because measure duration (${measureDuration.toFixed(2)}s) is extremely short`)
            } else if (m === 1) {
                amd = measureDuration
            } else {
                // Normal rolling average tracking
                amd = (amd * 0.7) + (measureDuration * 0.3)
            }
        }

        // Update currentTime to be exactly where this measure ended
        currentTime = lastMatchedTime + 0.01

        console.log(`Matched: ${matchedCount}/${expectedCount} (Ratio: ${(matchedCount / expectedCount).toFixed(2)}), Consumed ${notesConsumed} notes. Extensions: ${extensions}, Ended at Idx: ${currentMidiIdx}`)
        console.log(`Measure Duration: ${measureDuration.toFixed(2)}s`)
    }

    console.log('[AutoMapper] Finished generated anchors:', anchors)
    return anchors
}
