// ============================================================================
// V5: ECHOLOCATION HEURISTIC MAPPER (Step-Through Engine)
// ============================================================================
//
// Pitch-aware, duration-aware, with interactive ghost anchor workflow.
// Does NOT modify V3/V4 code — fully self-contained.

import type { NoteEvent, Anchor, BeatAnchor, XMLEvent, V5MapperState } from '../types'

// Re-export audio offset helper from the shared module
export { getAudioOffset } from './AutoMapper'

// ─── Helpers ───────────────────────────────────────────────────────────

type Outcome = 'match' | 'dead-reckon' | 'stray'

/** Track recent outcomes, keeping only the last 10 */
function pushOutcome(outcomes: Outcome[], outcome: Outcome): Outcome[] {
    const updated = [...outcomes, outcome]
    return updated.length > 10 ? updated.slice(-10) : updated
}

/** Check if 70%+ of last 10 outcomes are non-matches (runaway) */
function isRunaway(outcomes: Outcome[]): boolean {
    if (outcomes.length < 10) return false
    const badCount = outcomes.filter((o: Outcome) => o !== 'match').length
    return badCount >= 7
}

/** Find first MIDI note whose pitch matches any of the expected pitches */
function findFirstPitchMatch(
    expectedPitches: number[],
    midiNotes: NoteEvent[],
    startIndex: number
): { time: number; index: number } | null {
    for (let i = startIndex; i < midiNotes.length; i++) {
        if (expectedPitches.includes(midiNotes[i].pitch)) {
            return { time: midiNotes[i].startTimeSec, index: i }
        }
    }
    return null
}

/** Scan a [minTime, maxTime] window for MIDI notes matching expected pitches */
function scanWindow(
    expectedPitches: number[],
    midiNotes: NoteEvent[],
    startIndex: number,
    minTime: number,
    maxTime: number
): { pitch: number; time: number; index: number }[] {
    const matches: { pitch: number; time: number; index: number }[] = []
    for (let i = startIndex; i < midiNotes.length; i++) {
        const note = midiNotes[i]
        if (note.startTimeSec > maxTime) break // Past scan zone
        if (note.startTimeSec >= minTime && expectedPitches.includes(note.pitch)) {
            matches.push({ pitch: note.pitch, time: note.startTimeSec, index: i })
        }
    }
    return matches.sort((a, b) => a.time - b.time)
}

/** Extract a chord cluster from the first match, removing matched pitches to prevent double-mapping */
function extractChord(
    expectedPitches: number[],
    midiNotes: NoteEvent[],
    startIndex: number,
    anchorTime: number,
    chordThreshold: number
): { notes: { pitch: number; time: number; index: number }[]; lastIndex: number } {
    const remaining = [...expectedPitches]
    const chordNotes: { pitch: number; time: number; index: number }[] = []
    let lastIndex = startIndex

    for (let i = startIndex; i < midiNotes.length; i++) {
        const note = midiNotes[i]
        // If we exceed the chord spread threshold, we've left the physical chord zone
        if (note.startTimeSec - anchorTime > chordThreshold) break

        const pitchIdx = remaining.indexOf(note.pitch)
        if (pitchIdx !== -1) {
            chordNotes.push({ pitch: note.pitch, time: note.startTimeSec, index: i })
            remaining.splice(pitchIdx, 1) // Prevent double-mapping same pitch
            lastIndex = i
        }
    }

    return { notes: chordNotes, lastIndex }
}


// ─── Engine Functions ──────────────────────────────────────────────────

/**
 * Initialise V5 mapper. Applies audio offset, finds first pitch match.
 */
export function initV5(
    midiNotes: NoteEvent[],
    xmlEvents: XMLEvent[],
    _audioOffset: number = 0, // Kept for API compat but NOT used — V5 maps in MIDI time
    chordThresholdFraction: number = 0.0625 // 64th note default
): V5MapperState {
    const state: V5MapperState = {
        status: 'idle',
        currentEventIndex: 0,
        anchors: [],
        beatAnchors: [],
        ghostAnchor: null,
        aqntl: 0.5, // Default 120 BPM = 500ms per quarter note
        midiCursor: 0,
        chordThresholdFraction,
        lastAnchorTime: 0,
        lastAnchorGlobalBeat: 0,
        recentOutcomes: [],
        consecutiveMisses: 0,
    }

    if (midiNotes.length === 0 || xmlEvents.length === 0) {
        state.status = 'done'
        return state
    }

    // Sort MIDI by time
    const sorted = [...midiNotes].sort((a, b) => a.startTimeSec - b.startTimeSec)

    // Find first pitch match in MIDI (no audio offset — V5 works in MIDI time)
    const firstEvent = xmlEvents[0]
    const fermataCount = xmlEvents.filter(e => e.hasFermata).length
    console.log(`[V5 DEBUG] Total XML events: ${xmlEvents.length}, fermatas: ${fermataCount}`)
    if (fermataCount > 0) {
        console.log(`[V5 DEBUG] Fermata events:`, xmlEvents.filter(e => e.hasFermata).map(e => `M${e.measure} B${e.beat}`).join(', '))
    }
    console.log(`[V5 DEBUG] First 5 XML events:`, xmlEvents.slice(0, 5).map(e => `M${e.measure} B${e.beat} pitches=[${e.pitches.join(',')}]`).join(' | '))
    console.log(`[V5 DEBUG] First 10 MIDI notes (pitch):`, sorted.slice(0, 10).map(n => n.pitch).join(','))
    console.log(`[V5 DEBUG] First 10 MIDI notes (time):`, sorted.slice(0, 10).map(n => n.startTimeSec.toFixed(3)).join(','))
    console.log(`[V5 DEBUG] Seeking first match for: M${firstEvent.measure} B${firstEvent.beat} pitches=[${firstEvent.pitches.join(',')}]`)

    const firstMatch = findFirstPitchMatch(firstEvent.pitches, sorted, 0)

    if (!firstMatch) {
        console.warn('[V5] Could not find first pitch match in MIDI. Mapper cannot start.')
        state.status = 'done'
        return state
    }

    // Record first anchor at MIDI-native timestamp (no shift)
    const firstAnchorTime = firstMatch.time
    const chordThreshold = state.aqntl * chordThresholdFraction
    const chord = extractChord(firstEvent.pitches, sorted, firstMatch.index, firstMatch.time, chordThreshold)

    state.anchors.push({ measure: firstEvent.measure, time: firstAnchorTime })
    if (firstEvent.beat > 1.01) {
        state.beatAnchors.push({ measure: firstEvent.measure, beat: firstEvent.beat, time: firstAnchorTime })
    }

    state.lastAnchorTime = firstAnchorTime
    state.lastAnchorGlobalBeat = firstEvent.globalBeat
    state.midiCursor = chord.lastIndex + 1
    state.currentEventIndex = 1 // Move past first event
    state.status = state.currentEventIndex >= xmlEvents.length ? 'done' : 'running'

    console.log(`[V5] Initialised (MIDI time). First anchor at ${firstAnchorTime.toFixed(3)}s (M${firstEvent.measure} B${firstEvent.beat}). AQNTL=${state.aqntl.toFixed(3)}s. Chord threshold=${chordThresholdFraction}`)

    return state
}


/**
 * Process the next xmlEvent. Returns updated state.
 * - Match found → status stays 'running', anchors updated
 * - No match → status = 'paused', ghostAnchor placed
 */
export function stepV5(
    state: V5MapperState,
    midiNotes: NoteEvent[],
    xmlEvents: XMLEvent[]
): V5MapperState {
    if (state.status !== 'running' || state.currentEventIndex >= xmlEvents.length) {
        return { ...state, status: 'done' }
    }

    const sorted = [...midiNotes].sort((a, b) => a.startTimeSec - b.startTimeSec)
    const xmlEvent = xmlEvents[state.currentEventIndex]

    // Calculate scan window using beatsElapsed
    const beatsElapsed = xmlEvent.globalBeat - state.lastAnchorGlobalBeat
    if (beatsElapsed <= 0) {
        // Same beat position — skip (shouldn't happen with well-formed XML)
        console.warn(`[V5] beatsElapsed <= 0 at event ${state.currentEventIndex}, skipping`)
        return {
            ...state,
            currentEventIndex: state.currentEventIndex + 1,
            status: state.currentEventIndex + 1 >= xmlEvents.length ? 'done' : 'running',
        }
    }

    const expectedDelta = beatsElapsed * state.aqntl
    const buffer = expectedDelta * 0.20
    const searchStart = state.lastAnchorTime - buffer * 0.5 // Allow slight early arrival
    const searchEnd = state.lastAnchorTime + expectedDelta + buffer

    // ─── AFTER-FERMATA FRESH SCAN ───
    // If the previous beat had a fermata, the performer held it for an unpredictable duration.
    // Ignore AQNTL window and do a fresh pitch search to re-sync.
    if (state.afterFermata) {
        const freshMatch = findFirstPitchMatch(xmlEvent.pitches, sorted, state.midiCursor)

        if (freshMatch) {
            const chordThreshold = Math.max(0.100, state.aqntl * state.chordThresholdFraction)
            const chord = extractChord(xmlEvent.pitches, sorted, freshMatch.index, freshMatch.time, chordThreshold)

            const newAnchors = [...state.anchors]
            const newBeatAnchors = [...state.beatAnchors]
            const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
            if (isNewMeasure) newAnchors.push({ measure: xmlEvent.measure, time: freshMatch.time })
            if (xmlEvent.beat > 1.01) newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: freshMatch.time })

            const nextIndex = state.currentEventIndex + 1

            console.log(`[V5] 🎵 Post-fermata fresh match M${xmlEvent.measure} B${xmlEvent.beat} → ${freshMatch.time.toFixed(3)}s | pitches=[${chord.notes.map(n => n.pitch)}]`)

            return {
                ...state,
                anchors: newAnchors,
                beatAnchors: newBeatAnchors,
                ghostAnchor: null,
                aqntl: state.aqntl, // Preserve AQNTL — don't let fermata timing corrupt it
                midiCursor: chord.lastIndex + 1,
                currentEventIndex: nextIndex,
                lastAnchorTime: freshMatch.time,
                lastAnchorGlobalBeat: xmlEvent.globalBeat,
                afterFermata: false, // Re-synced
                consecutiveMisses: 0,
                recentOutcomes: pushOutcome(state.recentOutcomes, 'match'),
                status: nextIndex >= xmlEvents.length ? 'done' : 'running',
            }
        } else {
            // No match yet — dead-reckon this beat (held note under fermata)
            const deadReckonTime = state.lastAnchorTime + expectedDelta
            const nextIndex = state.currentEventIndex + 1

            console.log(`[V5] 🎵 Post-fermata dead-reckon M${xmlEvent.measure} B${xmlEvent.beat} → ${deadReckonTime.toFixed(3)}s (no onset, still seeking)`)

            const newAnchors = [...state.anchors]
            const newBeatAnchors = [...state.beatAnchors]
            const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
            if (isNewMeasure) newAnchors.push({ measure: xmlEvent.measure, time: deadReckonTime })
            if (xmlEvent.beat > 1.01) newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: deadReckonTime })

            return {
                ...state,
                anchors: newAnchors,
                beatAnchors: newBeatAnchors,
                ghostAnchor: null,
                currentEventIndex: nextIndex,
                lastAnchorTime: deadReckonTime,
                lastAnchorGlobalBeat: xmlEvent.globalBeat,
                // Keep afterFermata = true until we find a real match
                recentOutcomes: pushOutcome(state.recentOutcomes, 'dead-reckon'),
                status: nextIndex >= xmlEvents.length ? 'done' : 'running',
            }
        }
    }

    // ─── CONSECUTIVE MISS FRESH SCAN ───
    // If 3+ consecutive non-matches (dead-reckons/strays), switch to fresh scanning.
    // This handles fermatas, ritardandos, and any timing disruption dynamically.
    if (state.consecutiveMisses >= 3) {
        console.log(`[V5] 🔍 Fresh scan activated (${state.consecutiveMisses} consecutive misses). Looking for M${xmlEvent.measure} B${xmlEvent.beat} pitches=[${xmlEvent.pitches}] from midiCursor=${state.midiCursor}`)
        const freshMatch = findFirstPitchMatch(xmlEvent.pitches, sorted, state.midiCursor)

        if (freshMatch) {
            // Found a match anywhere ahead — re-sync!
            const chordThreshold = Math.max(0.100, state.aqntl * state.chordThresholdFraction)
            const chord = extractChord(xmlEvent.pitches, sorted, freshMatch.index, freshMatch.time, chordThreshold)

            const newAnchors = [...state.anchors]
            const newBeatAnchors = [...state.beatAnchors]
            const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
            if (isNewMeasure) newAnchors.push({ measure: xmlEvent.measure, time: freshMatch.time })
            if (xmlEvent.beat > 1.01) newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: freshMatch.time })

            const nextIndex = state.currentEventIndex + 1

            console.log(`[V5] 🔄 Fresh-scan re-sync M${xmlEvent.measure} B${xmlEvent.beat} → ${freshMatch.time.toFixed(3)}s | pitches=[${chord.notes.map(n => n.pitch)}] (after ${state.consecutiveMisses} misses)`)

            return {
                ...state,
                anchors: newAnchors,
                beatAnchors: newBeatAnchors,
                ghostAnchor: null,
                aqntl: state.aqntl, // Don't update AQNTL from disrupted timing
                midiCursor: chord.lastIndex + 1,
                currentEventIndex: nextIndex,
                lastAnchorTime: freshMatch.time,
                lastAnchorGlobalBeat: xmlEvent.globalBeat,
                consecutiveMisses: 0, // Re-synced!
                recentOutcomes: pushOutcome(state.recentOutcomes, 'match'),
                status: nextIndex >= xmlEvents.length ? 'done' : 'running',
            }
        } else {
            console.log(`[V5] 🔍 Fresh scan found NO match for pitches=[${xmlEvent.pitches}]. Falling through to normal flow.`)
        }
        // No fresh match either — continue to normal flow (will dead-reckon or pause)
    }

    // Scan for pitch matches in window
    const matches = scanWindow(xmlEvent.pitches, sorted, state.midiCursor, searchStart, searchEnd)

    if (matches.length > 0) {
        // --- MATCH FOUND ---
        const anchorTime = matches[0].time
        // Chord threshold: user-configured fraction of AQNTL, but at least 100ms for rolled chords
        const chordThreshold = Math.max(0.100, state.aqntl * state.chordThresholdFraction)
        const chord = extractChord(xmlEvent.pitches, sorted, matches[0].index, anchorTime, chordThreshold)

        // Match quality check: if we only matched a small fraction of expected pitches,
        // this is likely a stray note from a rolled chord bleeding into the next beat.
        // Skip it and continue scanning from after this stray note.
        const expectedCount = xmlEvent.pitches.length
        const matchedCount = chord.notes.length
        const matchRatio = matchedCount / expectedCount

        if (expectedCount >= 3 && matchRatio < 0.5) {
            console.warn(`[V5] ⚠ Stray note at M${xmlEvent.measure} B${xmlEvent.beat}: only ${matchedCount}/${expectedCount} pitches matched (${chord.notes.map(n => n.pitch).join(',')}). Skipping. [misses=${state.consecutiveMisses + 1}]`)

            // Track outcome and check for runaway
            const outcomes = pushOutcome(state.recentOutcomes, 'stray')
            if (isRunaway(outcomes)) {
                console.warn(`[V5] 🛑 Runaway detected (${outcomes.filter(o => o !== 'match').length}/10 bad). Pausing.`)
                const ghostTime = state.lastAnchorTime + expectedDelta
                return {
                    ...state,
                    recentOutcomes: outcomes,
                    status: 'paused',
                    ghostAnchor: { measure: xmlEvent.measure, beat: xmlEvent.beat, time: ghostTime },
                }
            }

            return {
                ...state,
                recentOutcomes: outcomes,
                consecutiveMisses: state.consecutiveMisses + 1,
                midiCursor: chord.lastIndex + 1,
                // Don't advance currentEventIndex — re-try this same XML event
            }
        }

        // Build new anchors
        const newAnchors = [...state.anchors]
        const newBeatAnchors = [...state.beatAnchors]

        // Measure anchor (only if this is beat 1 of a new measure)
        const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
        if (isNewMeasure) {
            newAnchors.push({ measure: xmlEvent.measure, time: anchorTime })
        }

        // Beat anchor (for fractional beats > 1)
        if (xmlEvent.beat > 1.01) {
            newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: anchorTime })
        }

        // Update AQNTL with exponential moving average (70/30 smoothing)
        const actualDelta = anchorTime - state.lastAnchorTime
        const instantAqntl = actualDelta / beatsElapsed
        const newAqntl = (state.aqntl * 0.7) + (instantAqntl * 0.3)

        const nextIndex = state.currentEventIndex + 1

        console.log(`[V5] ✓ M${xmlEvent.measure} B${xmlEvent.beat} → ${anchorTime.toFixed(3)}s | matched ${matchedCount}/${expectedCount} pitches=[${chord.notes.map(n => n.pitch)}] | AQNTL=${newAqntl.toFixed(3)}s (${(60 / newAqntl).toFixed(1)} BPM)`)

        return {
            ...state,
            anchors: newAnchors,
            beatAnchors: newBeatAnchors,
            ghostAnchor: null,
            aqntl: newAqntl,
            midiCursor: chord.lastIndex + 1,
            currentEventIndex: nextIndex,
            lastAnchorTime: anchorTime,
            lastAnchorGlobalBeat: xmlEvent.globalBeat,
            afterFermata: xmlEvent.hasFermata || false,
            consecutiveMisses: 0, // Reset on successful match
            recentOutcomes: pushOutcome(state.recentOutcomes, 'match'),
            status: nextIndex >= xmlEvents.length ? 'done' : 'running',
        }
    } else {
        // --- NO MATCH ---
        // Before pausing, try a wider scan (±50% buffer instead of 20%)
        const wideBuffer = expectedDelta * 0.50
        const wideStart = state.lastAnchorTime - wideBuffer * 0.5
        const wideEnd = state.lastAnchorTime + expectedDelta + wideBuffer
        const wideMatches = scanWindow(xmlEvent.pitches, sorted, state.midiCursor, wideStart, wideEnd)

        if (wideMatches.length > 0) {
            // Found with wider window — proceed as normal match
            const anchorTime = wideMatches[0].time
            const chordThreshold = state.aqntl * state.chordThresholdFraction
            const chord = extractChord(xmlEvent.pitches, sorted, wideMatches[0].index, anchorTime, chordThreshold)

            const newAnchors = [...state.anchors]
            const newBeatAnchors = [...state.beatAnchors]
            const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
            if (isNewMeasure) newAnchors.push({ measure: xmlEvent.measure, time: anchorTime })
            if (xmlEvent.beat > 1.01) newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: anchorTime })

            const actualDelta = anchorTime - state.lastAnchorTime
            const instantAqntl = actualDelta / beatsElapsed
            const newAqntl = (state.aqntl * 0.7) + (instantAqntl * 0.3)
            const nextIndex = state.currentEventIndex + 1

            console.log(`[V5] ✓ M${xmlEvent.measure} B${xmlEvent.beat} → ${anchorTime.toFixed(3)}s (wide scan) | AQNTL=${newAqntl.toFixed(3)}s`)

            return {
                ...state,
                anchors: newAnchors,
                beatAnchors: newBeatAnchors,
                ghostAnchor: null,
                aqntl: newAqntl,
                midiCursor: chord.lastIndex + 1,
                currentEventIndex: nextIndex,
                lastAnchorTime: anchorTime,
                lastAnchorGlobalBeat: xmlEvent.globalBeat,
                consecutiveMisses: 0, // Reset on match
                recentOutcomes: pushOutcome(state.recentOutcomes, 'match'),
                status: nextIndex >= xmlEvents.length ? 'done' : 'running',
            }
        }

        // Still no match — dead-reckon this beat using AQNTL and skip
        // This handles held notes, rests, or ornamental passages with no new onset
        const deadReckonTime = state.lastAnchorTime + expectedDelta

        // Check: is the NEXT event close enough to try matching instead?
        // If so, dead-reckon this beat and move on (don't pause)
        const nextIndex = state.currentEventIndex + 1
        if (nextIndex < xmlEvents.length) {
            const nextEvent = xmlEvents[nextIndex]
            const nextBeatsElapsed = nextEvent.globalBeat - xmlEvent.globalBeat

            // Only dead-reckon if the gap is small (≤ 2 beats) — otherwise pause for user
            if (nextBeatsElapsed <= 2) {
                console.log(`[V5] ⏩ Dead-reckon M${xmlEvent.measure} B${xmlEvent.beat} → ${deadReckonTime.toFixed(3)}s (no onset, skipping) [misses=${state.consecutiveMisses + 1}]`)

                // Track outcome and check for runaway
                const outcomes = pushOutcome(state.recentOutcomes, 'dead-reckon')
                if (isRunaway(outcomes)) {
                    console.warn(`[V5] 🛑 Runaway detected (${outcomes.filter(o => o !== 'match').length}/10 bad). Pausing.`)
                    return {
                        ...state,
                        recentOutcomes: outcomes,
                        status: 'paused',
                        ghostAnchor: { measure: xmlEvent.measure, beat: xmlEvent.beat, time: deadReckonTime },
                    }
                }

                // Place the anchor via dead reckoning
                const newAnchors = [...state.anchors]
                const newBeatAnchors = [...state.beatAnchors]
                const isNewMeasure = state.anchors.length === 0 || state.anchors[state.anchors.length - 1].measure !== xmlEvent.measure
                if (isNewMeasure) newAnchors.push({ measure: xmlEvent.measure, time: deadReckonTime })
                if (xmlEvent.beat > 1.01) newBeatAnchors.push({ measure: xmlEvent.measure, beat: xmlEvent.beat, time: deadReckonTime })

                return {
                    ...state,
                    anchors: newAnchors,
                    beatAnchors: newBeatAnchors,
                    ghostAnchor: null,
                    recentOutcomes: outcomes,
                    consecutiveMisses: state.consecutiveMisses + 1,
                    currentEventIndex: nextIndex,
                    lastAnchorTime: deadReckonTime,
                    lastAnchorGlobalBeat: xmlEvent.globalBeat,
                    // Don't update AQNTL — dead reckoning doesn't give us new tempo info
                    status: nextIndex >= xmlEvents.length ? 'done' : 'running',
                }
            }
        }

        // Large gap or end of piece — pause for user intervention
        console.warn(`[V5] ✗ No match for M${xmlEvent.measure} B${xmlEvent.beat} (expected [${xmlEvent.pitches}]). Ghost at ${deadReckonTime.toFixed(3)}s`)

        return {
            ...state,
            status: 'paused',
            ghostAnchor: { measure: xmlEvent.measure, beat: xmlEvent.beat, time: deadReckonTime },
        }
    }
}


/**
 * Human confirmed/adjusted the ghost anchor. Lock it in and resume.
 */
export function confirmGhost(
    state: V5MapperState,
    confirmedTime: number
): V5MapperState {
    if (state.status !== 'paused' || !state.ghostAnchor) {
        return state
    }

    const ghost = state.ghostAnchor
    const newAnchors = [...state.anchors]
    const newBeatAnchors = [...state.beatAnchors]

    // Record as real anchor
    const isNewMeasure = newAnchors.length === 0 || newAnchors[newAnchors.length - 1].measure !== ghost.measure
    if (isNewMeasure) {
        newAnchors.push({ measure: ghost.measure, time: confirmedTime })
    }
    if (ghost.beat > 1.01) {
        newBeatAnchors.push({ measure: ghost.measure, beat: ghost.beat, time: confirmedTime })
    }

    // Find corresponding xmlEvent to get globalBeat
    // The ghost corresponds to state.currentEventIndex (it paused before advancing)
    const xmlEventGlobalBeat = state.lastAnchorGlobalBeat // We'll use the ghost's expected position
    // Actually, we need the actual XMLEvent's globalBeat
    // Since we're confirming the ghost, the event at currentEventIndex IS the one that failed
    // We don't have xmlEvents here, but we can compute beatsElapsed from the ghost timing

    // Update AQNTL based on confirmed position
    const actualDelta = confirmedTime - state.lastAnchorTime
    if (actualDelta > 0) {
        // Estimate beatsElapsed from the expected delta vs aqntl
        const estimatedBeats = (state.lastAnchorTime > 0)
            ? Math.max(0.25, actualDelta / state.aqntl)
            : 1
        const instantAqntl = actualDelta / estimatedBeats
        const newAqntl = (state.aqntl * 0.7) + (instantAqntl * 0.3)

        const nextIndex = state.currentEventIndex + 1

        console.log(`[V5] Ghost confirmed at ${confirmedTime.toFixed(3)}s (M${ghost.measure} B${ghost.beat}). AQNTL updated to ${newAqntl.toFixed(3)}s`)

        return {
            ...state,
            anchors: newAnchors,
            beatAnchors: newBeatAnchors,
            ghostAnchor: null,
            aqntl: newAqntl,
            lastAnchorTime: confirmedTime,
            // We still don't advance midiCursor — human-placed anchor, MIDI position stays
            currentEventIndex: nextIndex,
            status: 'running',
        }
    }

    // Edge case: confirmedTime <= lastAnchorTime, just advance without AQNTL update
    return {
        ...state,
        anchors: newAnchors,
        beatAnchors: newBeatAnchors,
        ghostAnchor: null,
        lastAnchorTime: confirmedTime,
        currentEventIndex: state.currentEventIndex + 1,
        status: 'running',
    }
}


/**
 * Auto-run all remaining steps until paused or done.
 * Use this for confident sections where the human doesn't expect mismatches.
 */
export function runV5ToEnd(
    state: V5MapperState,
    midiNotes: NoteEvent[],
    xmlEvents: XMLEvent[]
): V5MapperState {
    let current: V5MapperState = { ...state, status: 'running' }

    while (current.status === 'running' && current.currentEventIndex < xmlEvents.length) {
        const next = stepV5(current, midiNotes, xmlEvents)
        if (next.status === 'paused') {
            // Auto-confirm ghost at expected position (dead reckoning)
            console.warn(`[V5 RunToEnd] Auto-confirming ghost at M${next.ghostAnchor?.measure} B${next.ghostAnchor?.beat}`)
            const confirmed = confirmGhost(next, next.ghostAnchor!.time)
            current = { ...confirmed, status: confirmed.status === 'running' ? 'running' : confirmed.status }
        } else {
            current = next
        }
    }

    console.log(`[V5] Complete. ${current.anchors.length} Measure Anchors, ${current.beatAnchors.length} Beat Anchors.`)
    return { ...current, status: 'done' }
}
