# Export Animation Smoothness Fix

> **Status:** ✅ Fixed — animations are smooth in cloud export
> **Date:** 2026-03-16

---

## Problem

Note pop/jump animations in server-side (cloud) exports appeared as instant "teleportation" instead of smooth motion, even at 60fps. The browser version looked smooth; the export did not.

## Root Cause

In the browser, CSS `transition: transform 0.1s ease-out` handles smooth interpolation — the browser engine computes intermediate transform values between frames automatically. In export mode, `body.studio-mode * { transition: none !important }` kills all transitions to prevent inter-frame ghosting during Puppeteer screenshots. This meant transforms snapped from `scale(1) translateY(0)` → `scale(1.4) translateY(-10px)` in **one frame** and back in **one frame** — no interpolation.

## Failed Approaches

### 1. Reduced transform magnitudes at 30fps
- **Idea:** Use smaller values (`scale(1.25)`, `translateY(-6px)`) so the snap is less jarring
- **Result:** Still looked like teleportation, just with a smaller jump

### 2. Bumped to 60fps
- **Idea:** More frames = smoother animation
- **Result:** Marginally better but still snappy — the issue was binary on/off, not frame count

### 3. CSS transition re-enablement on `.vf-stavenote`
- **Idea:** Selectively re-enable `transition: transform 0.1s ease-out` on note elements while keeping everything else (cursor, scroll) transition-free
- **Result:** Marginally better, but Puppeteer screenshots don't wait for CSS transitions to reach intermediate states — the screenshot captures whatever the DOM looks like at that instant, and CSS transitions happen asynchronously via the compositor

## Solution: JS Cubic Ease-Out Interpolation

Instead of relying on CSS transitions (which are asynchronous and compositor-driven), we compute the exact transform value **mathematically in JavaScript** on every single frame.

### How it works

1. **State tracking:** Each `NoteData` now has:
   - `activeSince` — timestamp when note became active
   - `deactivatedAt` — timestamp when note became inactive
   - `animProgress` — current interpolation progress (0→1)
   - `currentTransform` — cached transform string to avoid redundant DOM writes

2. **Per-frame interpolation:** On every `__ADVANCE_FRAME__` call:
   - Compute elapsed time since state change: `elapsed = audioTime - activeSince`
   - Convert to linear progress: `t = elapsed / 0.1` (100ms animation duration)
   - Apply cubic ease-out curve: `ease = 1 - (1 - t)³`
   - Calculate intermediate values: `scale = 1 + (1.4 - 1) * ease`, `translateY = -10 * ease`

3. **Release animation:** When a note deactivates, the same interpolation runs in reverse using `deactivatedAt`, producing a smooth ramp-down over 100ms.

4. **All-measure iteration:** The loop now iterates ALL measures (not just the current one) to catch notes in previous measures that are still mid-release-animation.

### Why this works

CSS transitions delegate interpolation to the browser's compositor, which runs asynchronously from JavaScript. Puppeteer's `page.screenshot()` captures the DOM state but doesn't trigger the compositor to advance transitions to a specific time.

By computing exact transform values in JS and setting them synchronously via `element.style.transform`, the DOM contains the **perfectly interpolated state** at the exact moment Puppeteer takes the screenshot. No compositor involvement, no timing ambiguity.

### Files changed

| File | Change |
|------|--------|
| `VexFlowHelpers.ts` | Added `activeSince`, `deactivatedAt`, `animProgress`, `currentTransform` to `NoteData` |
| `globals.css` | Removed CSS transition re-enablement on `.vf-stavenote` |
| `VexFlowRenderer.tsx` | Removed `transform` from inline CSS transition (kept `filter` only) |
| `ScrollView.tsx` | Replaced binary note effects with cubic ease-out interpolation engine |

### Key code (cubic ease-out)

```typescript
const ease = 1 - Math.pow(1 - note.animProgress, 3);
const scale = 1 + (popScale - 1) * ease;
const translateY = jumpPx * ease;
tTransform = `scale(${scale.toFixed(4)}) translateY(${translateY.toFixed(2)}px)`
```
