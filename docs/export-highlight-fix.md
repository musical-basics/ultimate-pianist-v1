# Export Highlight Fix — Root Cause & Workarounds

> **Status:** Workaround applied in ultimate-pianist-v1. Upstream DreamFlow fix still needed.
> **Date:** 2026-03-16

---

## Root Cause

DreamFlow (our VexFlow fork) renders noteheads, accidentals, dots, and other music glyphs as **SVG `<text>` elements** using the Bravura music font — NOT as SVG `<path>` elements.

```
notehead.js:   this.renderText(ctx, 0, 0)   // → creates <text> with Bravura glyph
accidental.js: this.renderText(ctx, 0, 0)   // → creates <text>
dot.js:        this.renderText(ctx, 0, 0)   // → creates <text>
```

The highlight/coloring system in `ScrollView.tsx` used `applyColor()` which set `fill` and `stroke` on elements cached via:

```typescript
pathsAndRects = Array.from(group.querySelectorAll('path, rect')) as HTMLElement[]
```

This selector **completely missed `<text>` elements**, so `applyColor` was coloring stems and ledger lines (`<path>`) but never touching the actual noteheads (`<text>` font glyphs).

**Result:** Pop/jump transforms applied to the parent `<g>` group worked fine (visible scaling/translation), but fill colors only hit stems/lines — noteheads stayed black.

---

## Failed Attempts Before Root Cause Discovery

### Attempt 1: Remove `!isStudio` guard on transforms
- **Hypothesis:** Pop/jump were blocked by `if (!note.hasGrace && !isStudio)`
- **Result:** Fixed pop/jump animations ✅, but highlight still missing ❌

### Attempt 2: Force DOM reflow after `__ADVANCE_FRAME__`
- **Hypothesis:** DOM style mutations (fill changes) weren't flushing before Puppeteer screenshot
- **Fix:** Added `void document.body.offsetHeight` at end of `__ADVANCE_FRAME__`
- **Result:** Reflow didn't help — the fills were being set, just on the wrong elements ❌

### Attempt 3: Verbose diagnostics
- Added `[HIGHLIGHT DIAG]` logging to track active notes, fill values, and path state
- Added browser console forwarding from Puppeteer to Railway worker stdout
- **Key finding:** Logs confirmed `pathAfter="style=rgb(43, 238, 238) attr=hsl(180, 85%, 55%)"` — fills WERE being applied correctly to `<path>` elements, proving the code logic was correct but targeting the wrong SVG elements

---

## Current Workaround (in ultimate-pianist-v1)

### Files Changed

1. **`components/score/VexFlowRenderer.tsx`** (line 331)
   ```diff
   - pathsAndRects = Array.from(group.querySelectorAll('path, rect')) as HTMLElement[]
   + pathsAndRects = Array.from(group.querySelectorAll('path, rect, text')) as HTMLElement[]
   ```

2. **`components/score/ScrollView.tsx`** — `applyColor()` function (line ~317)
   ```diff
     Array.from(element.getElementsByTagName('path')).forEach(...)
     Array.from(element.getElementsByTagName('rect')).forEach(...)
   + Array.from(element.getElementsByTagName('text')).forEach(t => {
   +     t.style.fill = color; t.setAttribute('fill', color)
   + })
   ```

3. **`components/score/ScrollView.tsx`** — Studio mode pop/jump (line ~558)
   ```diff
   - if (!note.hasGrace && !isStudio) {
   -     tTransform = `scale(${popEffect ? 1.4 : 1}) translateY(${jumpEffect ? -10 : 0}px)`
   - }
   + if (!note.hasGrace) {
   +     const popScale = popEffect ? (isStudio ? 1.25 : 1.4) : 1
   +     const jumpPx = jumpEffect ? (isStudio ? -6 : -10) : 0
   +     tTransform = `scale(${popScale}) translateY(${jumpPx}px)`
   + }
   ```

4. **`app/render-view/[id]/page.tsx`** — Enable pop/jump for export
   ```diff
   + const setPopEffect = useAppStore((s) => s.setPopEffect)
   + const setJumpEffect = useAppStore((s) => s.setJumpEffect)
     // ...
   + setPopEffect(true)
   + setJumpEffect(true)
   ```

5. **`components/layout/SplitScreenLayout.tsx`** — Force reflow after ADVANCE_FRAME
   ```diff
   + // Force DOM reflow before Puppeteer screenshot
   + void document.body.offsetHeight;
   ```

### Other Export Fixes (same session)

6. **`worker/src/upload.ts`** — R2 upload hang fix
   - Replaced `@aws-sdk/lib-storage` `Upload` (multipart, promise never resolves) with `PutObjectCommand` + `Buffer`
   - Added `AbortController` with 25s timeout
   - Fresh `S3Client` per upload + `s3.destroy()` after

7. **`worker/src/renderJob.ts`** — Browser console forwarding
   - Added `page.on('console', ...)` to forward `[HIGHLIGHT DIAG]` logs to Railway stdout
   - R2 upload timeout reduced from 120s → 30s

---

## Upstream DreamFlow Fix (1-Shot Plan)

If we fix DreamFlow upstream, we can **revert workarounds #1 and #2** above (the `text` selector additions). The other fixes (#3-7) stay.

### What to change in DreamFlow

DreamFlow's `Element` base class has a `renderText()` method that creates SVG `<text>` elements. These elements need a way to be targeted for color changes. Two options:

#### Option A: Add CSS class to glyph text elements
In DreamFlow's `svgcontext.ts` or the `Element.renderText()` method, add a CSS class like `vf-glyph` to all music font `<text>` elements. This lets consumers target them easily.

#### Option B: Render noteheads as `<path>` instead of `<text>`
VexFlow has a `Glyph.renderOutline()` method that draws glyphs as SVG `<path>` data instead of font characters. If noteheads used this approach, `querySelectorAll('path')` would naturally capture them. However, this would mean the Bravura font isn't needed for noteheads (only for other glyphs), and the paths would be larger in the DOM.

#### Recommended: Option A
Adding a CSS class is minimally invasive and doesn't change the rendering approach. The consumer-side code in `VexFlowRenderer.tsx` and `ScrollView.tsx` can then use `.vf-glyph` or just keep using `'path, rect, text'`.

### Revert Checklist (after upstream fix)
- [ ] Revert `VexFlowRenderer.tsx` querySelectorAll back to `'path, rect'` (if using Option B)
- [ ] Revert `ScrollView.tsx` applyColor `text` fallback (if using Option B)
- [ ] Remove `[HIGHLIGHT DIAG]` diagnostic logging from `ScrollView.tsx`
- [ ] Remove `page.on('console', ...)` browser forwarding from `renderJob.ts` (or keep for future debugging)
- [ ] Keep pop/jump studio mode fix (#3) — always needed
- [ ] Keep render-view setPopEffect/setJumpEffect (#4) — always needed
- [ ] Keep R2 upload PutObjectCommand fix (#6) — always needed

---

## Diagnostic Logging (to remove later)

The following diagnostic code should be removed once the fix is confirmed working:

1. `ScrollView.tsx` — `[HIGHLIGHT DIAG]` console.log block (~lines 536-600)
2. `renderJob.ts` — `page.on('console', ...)` browser log forwarding (~line 155-160)
