# Echolocation V5 — Heuristic MIDI-to-Score Mapping Algorithm

> **File**: `lib/engine/AutoMapperV5.ts`  
> **Purpose**: Map a live MIDI performance to MusicXML beat positions by walking through both streams simultaneously, producing time-stamped anchors for score-following playback.

---

## 1. Design Philosophy

Echolocation V5 approaches MIDI-to-score alignment the way a **real musician sight-reads**:

1. **Look at the score** — know which pitches to expect next.
2. **Listen to the performance** — scan the MIDI stream for those pitches.
3. **Mark the timestamp** — lock in an anchor when found.
4. **Adapt tempo** — continuously update your internal sense of speed (AQNTL).
5. **Ask for help** — when lost, pause and surface a "ghost anchor" for human confirmation.

This replaces the V3/V4 approach of counting chords per measure. V5 is **pitch-aware**, **duration-aware**, and human-interactive via a step-through state machine.

---

## 2. Data Structures

### Inputs

| Type | Description |
|------|-------------|
| `NoteEvent[]` | Flat array of MIDI notes, each with `pitch`, `startTimeSec`, `endTimeSec`, `velocity` |
| `XMLEvent[]` | Beat-level events extracted from MusicXML, each with `measure`, `beat`, `globalBeat`, `pitches[]`, `smallestDuration`, `hasFermata` |

### Outputs (Anchors)

| Type | Description |
|------|-------------|
| `Anchor` | `{ measure, time }` — the timestamp of beat 1 for each measure |
| `BeatAnchor` | `{ measure, beat, time }` — sub-beat timestamps for beats > 1 |

### State Machine (`V5MapperState`)

```
status: 'idle' | 'running' | 'paused' | 'done'

currentEventIndex   — cursor into xmlEvents[]
midiCursor          — cursor into sorted MIDI notes
anchors[]           — confirmed measure anchors
beatAnchors[]       — confirmed beat anchors
ghostAnchor         — proposed anchor awaiting human confirmation (or null)
aqntl               — average quarter-note time length (seconds); starts at 0.5s (120 BPM)
chordThresholdFraction — max spread for notes in same chord (default 1/16 of AQNTL)
lastAnchorTime      — timestamp of last confirmed anchor
lastAnchorGlobalBeat — global beat position of last anchor
recentOutcomes[]    — sliding window of last 10 outcomes for runaway detection
consecutiveMisses   — counter for triggering fresh-scan mode
afterFermata        — flag set after mapping a fermata beat
```

---

## 3. Algorithm Overview

```
┌─────────────┐
│   initV5()  │  Find first pitch match in MIDI, create seed anchor
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────────┐
│   stepV5()  │────▶│  Match found?    │
│  (per beat) │     └──────┬───────────┘
└─────────────┘            │
                    ┌──────┴──────┐
                    │ YES         │ NO
                    ▼             ▼
             Lock anchor    Try wider window (±50%)
             Update AQNTL          │
             Advance cursors  ┌────┴────┐
                              │ YES     │ NO
                              ▼         ▼
                         Lock anchor  Fresh pitch scan
                         Update AQNTL  (anywhere ahead)
                                          │
                                    ┌─────┴─────┐
                                    │ YES       │ NO
                                    ▼           ▼
                               Lock anchor  Dead-reckon
                               (preserve     (extrapolate
                                AQNTL)        from AQNTL)
                                                 │
                                          ┌──────┴──────┐
                                          │ ≤2 beats    │ >2 beats
                                          ▼             ▼
                                    Auto-advance    PAUSE
                                    (count miss)   (ghost anchor)
                                          │
                                    ┌─────┴─────┐
                                    │ Runaway?  │
                                    │ (7/10 bad)│
                                    ▼           ▼
                                  PAUSE      Continue
                                (ghost)      stepping
```

---

## 4. Core Functions

### `initV5(midiNotes, xmlEvents, audioOffset, chordThresholdFraction)`

**Purpose**: Bootstrap the mapper.

1. Sort MIDI notes by `startTimeSec`.
2. Read the first `XMLEvent`'s expected pitches.
3. Linearly scan MIDI for the **first pitch match** → this becomes the **seed anchor**.
4. Extract any chord cluster around the match (notes within `chordThreshold` of each other).
5. Initialize AQNTL to 0.5s (120 BPM default).
6. Return state with `status: 'running'`, `currentEventIndex: 1`.

> V5 operates entirely in **MIDI time** — no audio offset shifting.

---

### `stepV5(state, midiNotes, xmlEvents)`

**Purpose**: Process the next `XMLEvent`. The heart of the algorithm.

**Step-by-step**:

#### A. Calculate Scan Window

```
beatsElapsed    = xmlEvent.globalBeat − lastAnchorGlobalBeat
expectedDelta   = beatsElapsed × AQNTL
buffer          = expectedDelta × 20%
searchStart     = lastAnchorTime − (buffer × 0.5)    // allow early arrival
searchEnd       = lastAnchorTime + expectedDelta + buffer
```

#### B. Special Modes (checked first)

1. **After Fermata** (`afterFermata === true`):  
   Fermatas have unpredictable duration. Skip the AQNTL window entirely and do a **fresh pitch scan** from `midiCursor` forward. If found → re-sync. If not → dead-reckon this beat but keep scanning.

2. **Consecutive Miss Mode** (`consecutiveMisses ≥ 3`):  
   Three or more non-matches trigger a **fresh pitch search** (unbounded forward scan). This handles ritardandos, tempo changes, or any timing disruption. If re-synced → reset miss counter.

#### C. Window Scan (normal path)

Scan `[searchStart, searchEnd]` for MIDI notes matching expected pitches.

- **Match found**:
  - Extract **chord cluster** — notes within `max(100ms, AQNTL × chordThresholdFraction)` of the first match. Matched pitches are removed from the expected set to prevent double-mapping.
  - **Stray note filter**: if expected ≥ 3 pitches but matched < 50%, this is likely a bleed-through from a rolled chord. Skip it, increment miss counter, but **don't advance** the XML cursor (re-try this beat).
  - If good match: lock the anchor, update AQNTL via **exponential moving average**:
    ```
    instantAqntl = actualDelta / beatsElapsed
    newAqntl     = (AQNTL × 0.7) + (instantAqntl × 0.3)
    ```
  - Set `afterFermata = true` if this beat has a fermata marking.

- **No match** in standard window:
  1. **Wide scan** (±50% buffer) — if found, treat as normal match.
  2. **Fresh pitch scan** (unbounded forward) — if found, lock anchor but **preserve AQNTL** (out-of-window timing shouldn't corrupt tempo estimate).
  3. **Dead-reckon** — extrapolate: `deadReckonTime = lastAnchorTime + expectedDelta`. Only if the next beat is ≤ 2 beats away. Increment `consecutiveMisses`.
  4. **Pause** — for large gaps or end-of-piece. Place **ghost anchor** at the dead-reckoned position.

#### D. Runaway Detection

A sliding window tracks the last 10 outcomes (`match`, `dead-reckon`, `stray`). If **7 out of 10** are non-matches → the mapper is "runaway" and **pauses** with a ghost anchor for human intervention.

---

### `confirmGhost(state, confirmedTime)`

**Purpose**: Human reviewed the ghost anchor and confirmed/adjusted its time.

1. Lock the ghost as a real anchor at the confirmed time.
2. Update AQNTL from the new timing.
3. Resume with `status: 'running'`.
4. MIDI cursor is **not** advanced (the human placed this anchor manually).

---

### `runV5ToEnd(state, midiNotes, xmlEvents)`

**Purpose**: Auto-run all remaining steps for "confident" sections.

Calls `stepV5()` in a loop. When a pause occurs (ghost anchor), it **auto-confirms** the ghost at its dead-reckoned position and continues. Used for batch processing where human review isn't needed.

---

## 5. Helper Functions

| Function | Description |
|----------|-------------|
| `findFirstPitchMatch(pitches, midi, startIdx)` | Linear scan from `startIdx` for any note matching one of the expected pitches. Returns `{time, index}` or `null`. |
| `scanWindow(pitches, midi, startIdx, minTime, maxTime)` | Scan a time window for pitch matches. Returns sorted array of `{pitch, time, index}`. |
| `extractChord(pitches, midi, startIdx, anchorTime, threshold)` | From a match point, collect all notes within `threshold` seconds that match remaining expected pitches. Prevents double-mapping by removing matched pitches from the candidate set. |
| `pushOutcome(outcomes, outcome)` | Append to sliding window, cap at 10 entries. |
| `isRunaway(outcomes)` | Returns `true` if ≥ 7 of the last 10 outcomes are non-matches. |

---

## 6. Key Constants & Tuning Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| Initial AQNTL | `0.5s` (120 BPM) | Starting tempo assumption |
| AQNTL smoothing | `70/30` EMA | `new = 0.7 × old + 0.3 × instant` |
| Standard scan buffer | `±20%` of expected delta | Tolerance for human tempo variation |
| Wide scan buffer | `±50%` of expected delta | Fallback when standard window misses |
| Chord threshold | `max(100ms, AQNTL × chordThresholdFraction)` | Max spread for chord cluster |
| `chordThresholdFraction` | `0.0625` (1/16 of AQNTL) | User-configurable |
| Stray note ratio | `< 50%` of expected pitches | Triggers skip-and-retry when chord ≥ 3 notes |
| Runaway threshold | `7/10` bad outcomes | Triggers pause |
| Consecutive miss threshold | `3` | Triggers fresh-scan mode |
| Dead-reckon max gap | `2 beats` | Beyond this, pauses for human |

---

## 7. State Machine Diagram

```
                    ┌─────┐
                    │IDLE │
                    └──┬──┘
                       │ initV5()
                       ▼
                 ┌──────────┐
            ┌───▶│ RUNNING  │◀───┐
            │    └────┬─────┘    │
            │         │          │
            │    stepV5()        │ confirmGhost()
            │         │          │
            │    ┌────┴─────┐   │
            │    │ PAUSED   │───┘
            │    │(ghost)   │
            │    └──────────┘
            │
            │    No more events
            ▼
       ┌─────────┐
       │  DONE   │
       └─────────┘
```

---

## 8. Evolution from V3/V4

| Version | Approach | Granularity | Pitch-Aware | Interactive |
|---------|----------|-------------|-------------|-------------|
| **V3** | Count notes per measure, match via "echolocation feeler" window | Measure-level only | ❌ | ❌ |
| **V4** | Group MIDI into chord clusters, distribute XML events to chords | Beat-level (1:1 chord mapping) | ❌ | ❌ |
| **V5** | Pitch-matching with AQNTL tempo tracking, ghost anchor workflow | Beat-level (pitch-verified) | ✅ | ✅ (step-through + ghost anchors) |

**Key V5 innovations**:
- **Pitch verification** — matches MIDI notes by actual pitch, not just count.
- **Adaptive tempo** — exponential moving average tracks the performer's live BPM.
- **Ghost anchors** — when the mapper gets lost, it surfaces a proposed anchor for human confirmation instead of silently accumulating errors.
- **Fermata handling** — after a fermata, bypasses the AQNTL window and does an unbounded forward scan to re-sync.
- **Runaway detection** — auto-pauses when confidence drops below threshold.
- **Fresh-scan mode** — after 3+ consecutive misses, switches to unbounded forward scanning to recover from any timing disruption.
