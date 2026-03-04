# VexFlow Rendering Fixes — Session Notes

> Documenting the challenges, failed approaches, and final solutions for VexFlow music notation rendering.

---

## 1. Tuplet Heuristic — False Positive Detection

**Problem**: The heuristic for detecting triplets was triggering on standard eighth-note passages, creating false tuplet brackets.

**Root Cause**: The heuristic looked for any group of 3 consecutive eighth notes without checking whether the measure actually needed tuplets.

**Fix** ([VexFlowHelpers.ts](file:///Users/lionelyu/Documents/New%20Version/ultimate-pianist-vex/components/score/VexFlowHelpers.ts)):
- Added `calculateVoiceDuration()` that sums all note durations (accounting for dots and existing tuplet modifications)
- `detectHeuristicTuplets()` now only triggers if `totalBeats > measureCapacity` — i.e., the voice overflows the time signature
- Extracted all logic into `VexFlowHelpers.ts` to keep the renderer lean

**Lesson**: Always validate the *need* for a heuristic before applying it. Check the math (total beats vs. measure capacity) first.

---

## 2. Fermata Positioning — Always Above Staff

**Problem**: Fermatas were appearing below the staff when stem direction was up, because the generic articulation positioning code placed them relative to the stem.

**Root Cause**: VexFlow stores articulation types as codes like `a@a` (fermata above), `a@u` (fermata below), etc. The original detection checked for the string `"fermata"` which never matched.

**Fix** ([VexFlowRenderer.tsx](file:///Users/lionelyu/Documents/New%20Version/ultimate-pianist-vex/components/score/VexFlowRenderer.tsx)):
```typescript
const artType = mod.type ?? ''
const isFermata = typeof artType === 'string' && artType.startsWith('a@')
if (isFermata) pos = 3 // always above
```

**Lesson**: VexFlow uses shorthand codes (`a.` for staccato, `a@a` for fermata, `a>` for accent). Always check VexFlow's `tables.js` for the actual code format.

---

## 3. Clef Changes — Staff 2 Treble Clef (M37-40)

**Problem**: When the left hand switches from bass to treble clef (M37), notes rendered in the wrong vertical position as if still in bass clef.

**Root Cause**: `createStaveNote()` hardcoded `staffIndex === 0 ? 'treble' : 'bass'`, ignoring clef changes.

**Fix** ([VexFlowHelpers.ts](file:///Users/lionelyu/Documents/New%20Version/ultimate-pianist-vex/components/score/VexFlowHelpers.ts)):
- Added `clefOverride` parameter to `createStaveNote()`
- Renderer passes the running clef (`currentTrebleClef`/`currentBassClef`) from the parser's clef tracking

**Lesson**: Never hardcode musical properties based on staff index. Always use the running state from the parser.

---

## 4. Slurs (Legato Curves) — New Feature

**Problem**: Slur curves (legato markings) were completely missing from the rendered output.

**Implementation** across 4 files:

| File | Changes |
|------|---------|
| [IntermediateScore.ts](file:///Users/lionelyu/Documents/New%20Version/ultimate-pianist-vex/lib/score/IntermediateScore.ts) | Added `slurStarts?: number[]` and `slurStops?: number[]` |
| [MusicXmlParser.ts](file:///Users/lionelyu/Documents/New%20Version/ultimate-pianist-vex/lib/score/MusicXmlParser.ts) | Parse `<slur type="start/stop" number="N"/>` from `<notations>` |
| [VexFlowHelpers.ts](file:///Users/lionelyu/Documents/New%20Version/ultimate-pianist-vex/components/score/VexFlowHelpers.ts) | `processSlurs()` — tracks active slurs via `ActiveSlurs` map, returns `Curve` objects |
| [VexFlowRenderer.tsx](file:///Users/lionelyu/Documents/New%20Version/ultimate-pianist-vex/components/score/VexFlowRenderer.tsx) | Calls `processSlurs()` per note, draws completed curves after ties |

**Key Design Decision**: Slurs use VexFlow's `Curve` (not `StaveTie`) because slurs are phrasing marks, not pitch-connecting ties. `Curve` renders as a bezier between two notes.

**Lesson**: Slurs can span multiple measures. The `activeSlurs` map persists across the measure loop.

---

## 5. Grace Notes — New Feature

**Problem**: Grace notes were skipped entirely by the parser (`if (child.querySelector('grace')) continue`).

**Implementation**:

| File | Changes |
|------|---------|
| [IntermediateScore.ts](file:///Users/lionelyu/Documents/New%20Version/ultimate-pianist-vex/lib/score/IntermediateScore.ts) | Added `isGrace?: boolean` and `graceNotes?: IntermediateNote[]` |
| [MusicXmlParser.ts](file:///Users/lionelyu/Documents/New%20Version/ultimate-pianist-vex/lib/score/MusicXmlParser.ts) | Collect grace notes in `pendingGraceNotes[]`, attach to next main note |
| [VexFlowHelpers.ts](file:///Users/lionelyu/Documents/New%20Version/ultimate-pianist-vex/components/score/VexFlowHelpers.ts) | `attachGraceNotes()` — creates `GraceNoteGroup` with slashed style |
| [VexFlowRenderer.tsx](file:///Users/lionelyu/Documents/New%20Version/ultimate-pianist-vex/components/score/VexFlowRenderer.tsx) | Calls `attachGraceNotes()` after creating each StaveNote |

**Key Details**:
- Grace notes have `<grace/>` element and **no `<duration>`** — set `durationDivs = 0`
- `pendingGraceNotes` resets per-measure (declared inside the measure loop)
- Grace notes are attached to the **next non-chord, non-grace note** in the same voice
- VexFlow's `GraceNote` constructor takes `slash: true` for acciaccatura style

**Lesson**: Grace notes steal visual space from the main note. This can cause alignment issues (see §6).

---

## 6. Cross-Stave Beat Alignment — The Hardest Bug

**Problem**: Notes at the same beat across treble/bass staves didn't align vertically. Particularly bad in M37 (treble clef on LH stave) and M38 (grace note on LH stave).

### What We Tried (in order):

#### ❌ Attempt 1: `formatter.format(voices, STAVE_WIDTH - 40)`
- Hardcoded width didn't account for clef/keysig decorations
- Notes overflowed past barlines on measures with lots of decorations

#### ❌ Attempt 2: Dynamic width via `getNoteEndX() - getNoteStartX()`
- Better, but didn't fix alignment because each stave had a *different* `noteStartX`
- The stave with more decorations started notes further right

#### ❌ Attempt 3: `formatToStave(voices, stave)` per stave
- Formatted each stave independently — no cross-stave alignment at all!

#### ❌ Attempt 4: Sync `noteStartX` + `Math.max` for width
- `Math.max(actual, STAVE_WIDTH - 60)` overrode the actual width with a too-large value
- Caused beat 3.5 notes to overflow past the barline

#### ✅ Final Fix: Sync `noteStartX` + tight width calculation
```typescript
// 1. Find the stave with the most decorations
const maxNoteStartX = Math.max(...staves.map(s => s.getNoteStartX()))

// 2. Force ALL staves to start notes at the same X
staves.forEach(s => {
    if (s.getNoteStartX() < maxNoteStartX) s.setNoteStartX(maxNoteStartX)
})

// 3. Calculate actual available width with right margin
const noteEndX = Math.min(...staves.map(s => s.getNoteEndX()))
const availableWidth = noteEndX - maxNoteStartX - 10

// 4. Format all voices together
formatter.format(vfVoices, Math.max(availableWidth, 100))
```

**Why This Works**:
- `setNoteStartX()` makes both staves begin their note area at the same X — decorations on one stave don't offset beats
- `format()` with all voices creates shared tick contexts — same beat = same X across staves
- `noteEndX - maxNoteStartX - 10` ensures notes never overflow past the barline

**Key Lesson**: For grand staff piano rendering, cross-stave alignment requires three things:
1. **Synchronized note start positions** across all staves
2. **All voices formatted together** (not per-stave)
3. **Tight width calculation** using actual stave geometry, not hardcoded values
