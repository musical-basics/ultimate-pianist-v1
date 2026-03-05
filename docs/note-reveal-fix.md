# Note Reveal Fix — VexFlow Element Lookup Bug

## Bug
NOTE reveal mode did nothing — all notes remained visible regardless of cursor position.

## Root Cause Chain (4 cascading issues)

### 1. `setAttribute('id')` Corrupted VexFlow's Internal ID
**File:** `VexFlowRenderer.tsx` line 254  
**Symptom:** `querySelector('[id="vf-M1-S0-V0-B1"]')` found nothing  
**Cause:** VexFlow v5's `Element.newID()` generates IDs like `auto1623`. The SVG renderer creates DOM elements with `prefix(attrs.id)` → `vf-auto1623`. Our `staveNote.setAttribute('id', 'vf-M1-...')` overwrote `attrs.id`, so `getSVGElement()` looked for `prefix('vf-M1-...')` → `vf-vf-M1-...` (double-prefixed — doesn't exist).  
**Fix:** Removed `setAttribute('id')` call entirely. Use VexFlow's native `getSVGElement()` method which correctly resolves `prefix('auto1623')` → finds `vf-auto1623` in the DOM.

### 2. `handleRenderComplete` Had Duplicate DOM Setup
**File:** `ScrollView.tsx` lines 162-179  
**Symptom:** CSS transforms applied to individual `<path>` children instead of `<g>` group  
**Cause:** `handleRenderComplete` re-queried all paths/rects and set `transformOrigin: 'center'` on each path, conflicting with VexFlowRenderer's group-level `transformOrigin: 'center bottom'`.  
**Fix:** Removed duplicate DOM setup entirely — VexFlowRenderer's coordinate extractor now populates `element` and `pathsAndRects` directly. ScrollView's `handleRenderComplete` only caches `absoluteX`.

### 3. Reveal Mode `useEffect` Fired Before Elements Existed
**File:** `ScrollView.tsx` lines 257-285  
**Symptom:** Entering NOTE mode didn't hide notes on page load  
**Cause:** React's `useEffect([revealMode])` fires synchronously during mount, before VexFlowRenderer's `requestAnimationFrame` populates `note.element`. Setting `opacity='0'` on `null` elements was a no-op.  
**Fix:** Added `revealModeRef` to track current value. After `handleRenderComplete` runs (when elements exist), re-hide all notes if `revealModeRef.current === 'NOTE'`.

### 4. `isRevealed` State Not Reset on Mode Toggle
**File:** `ScrollView.tsx`  
**Symptom:** Toggling NOTE mode off and back on didn't re-hide notes  
**Cause:** `isRevealed` remained `true` from previous reveal pass  
**Fix:** Set `isRevealed = undefined` when leaving NOTE mode (forces re-eval), `isRevealed = false` when entering.

## Failed Fixes (tried before finding root cause)

1. **`staveNote.el` property** — doesn't exist in VexFlow v5
2. **`attrs.id` fallback** — contained our corrupted custom ID, not the auto-generated one
3. **`staveNote.attrs.el`** — doesn't exist either
4. **Removing `scrollLeft` inflation** — was a real math bug but unrelated to the element lookup failure

## What Worked
Reading VexFlow v5's `element.js` source directly to understand the `getSVGElement()` → `prefix(attrs.id)` → `document.getElementById()` chain. This revealed the double-prefix corruption.

## Remaining Issue: Orphaned Stems
Stems/beams show ahead of the cursor even though noteheads are hidden. VexFlow renders stems as separate SVG groups that are not always children of the `.vf-stavenote` `<g>` element we're hiding. **Fix in progress.**
