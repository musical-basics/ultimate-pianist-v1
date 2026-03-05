# Waterfall Renderer — Big Chord Lag Fix

**Date:** 2026-03-05  
**Symptom:** Waterfall view stutters/lags noticeably when large chords (10+ simultaneous notes) are played. Sheet music playback remains perfectly smooth.

---

## Background

The learn page runs multiple concurrent animation loops:
- **PixiJS ticker** (`WaterfallRenderer.renderFrame()`) — renders falling note sprites at 60fps
- **Display time RAF** (`page.tsx`) — updates the time slider/transport UI
- **ScrollView RAF** (`ScrollView.tsx`) — drives the cursor, note effects, and curtain reveal

All three compete for the main thread. When a big chord hits, the waterfall renderer toggles `dataset.active` and `style.backgroundColor` on up to 15 piano key DOM elements in rapid succession. If the main thread is already busy with React re-renders or CSS transitions, the browser freezes to process them synchronously.

---

## Fix Attempt #1: Remove `getBoundingClientRect()` from Render Loop ❌

### Theory (Cross-Frame Layout Thrashing)
The `renderFrame()` loop called `getBoundingClientRect()` on the canvas container every frame to detect layout changes (e.g. toggling sheet music off). The theory was that this forced the browser to synchronously recalculate layout ("forced synchronous layout") before it could return pixel dimensions — especially painful when CSS transitions on piano keys were still in-flight.

### Changes Made
1. Added `this.app.renderer.resize()` to the `ResizeObserver`-driven `recalculateLayout()` method so it explicitly resizes PixiJS when the container changes.
2. Deleted the `getBoundingClientRect()` polling block from `renderFrame()`.

### Result
**No noticeable improvement.** The lag on big chords persisted identically. We reverted this change, then re-applied it since it's still a correct optimization (just not the bottleneck). The `ResizeObserver` is the proper mechanism for detecting layout changes — polling every frame was wasteful even if it wasn't the primary cause of the visible lag.

---

## Fix Attempt #2 (FINAL): Throttle React State Updates + Remove CSS Transitions ✅

### Root Cause: React Re-Render Storms at 60fps
The **real** bottleneck was in `app/learn/[id]/page.tsx`, line 133:

```typescript
// BEFORE — called EVERY animation frame (60fps)
const tick = (ts: number) => {
    const pm = getPlaybackManager()
    setDisplayTime(pm.getTime())  // ← triggers full React re-render!
    ...
    displayRafRef.current = requestAnimationFrame(tick)
}
```

`setDisplayTime()` is a React state setter. Calling it 60 times per second forces React to re-reconcile the entire `LearnPlayback` component tree — including the header, sliders, buttons, and all child components — **on every single frame**. This consumed a massive chunk of the main thread budget, leaving PixiJS starved for CPU time exactly when it needed to render 10+ note sprites simultaneously.

### Root Cause: CSS Transition Storms on Piano Keys
Every piano key had `transition-colors duration-75` applied via Tailwind:

```tsx
// BEFORE — 88 keys, each with CSS transitions
className={cn(
    'cursor-pointer',
    'transition-colors duration-75'  // ← creates CSS transitions per key
)}
```

When a 10-note chord hits, the renderer sets `dataset.active = 'true'` on 10 keys simultaneously. The browser creates 10 independent CSS color transitions, each requiring style recalculation and compositor work — compounding the main thread pressure from the React re-renders.

### Changes Made

**1. Throttled `setDisplayTime()` to ~15fps** (`app/learn/[id]/page.tsx`):
```typescript
// AFTER — only update React state every ~66ms
useEffect(() => {
    let lastUpdate = 0
    const tick = (ts: number) => {
        const pm = getPlaybackManager()
        if (!pm.isPlaying && isPlaying) setPlaying(false)
        if (ts - lastUpdate > 66) {
            setDisplayTime(pm.getTime())
            lastUpdate = ts
        }
        displayRafRef.current = requestAnimationFrame(tick)
    }
    if (isPlaying) displayRafRef.current = requestAnimationFrame(tick)
    return () => { if (displayRafRef.current) cancelAnimationFrame(displayRafRef.current) }
}, [isPlaying, setPlaying])
```

**2. Removed CSS transitions from piano keys** (`components/synthesia/PianoKeyboard.tsx`):
```diff
-'cursor-pointer',
-'transition-colors duration-75'
+'cursor-pointer'
```

### Result
**Lag completely eliminated.** The waterfall now renders smoothly even on the densest chord passages. The time slider updates at ~15fps which is visually indistinguishable from 60fps for a numeric display / slider position.

---

## Key Takeaway

The performance killer was **not** in the WebGL render loop — it was React and CSS fighting for the main thread simultaneously. The PixiJS `renderFrame()` is pure math and sprite property updates (very fast), but it runs on the same main thread as React reconciliation. When React was re-rendering the entire page 60 times per second AND the browser was processing CSS transitions on 10+ piano keys, the PixiJS ticker couldn't get enough CPU time to maintain smooth 60fps on dense passages.

**Rule of thumb:** Never call React state setters inside `requestAnimationFrame` at full framerate unless the updated component is extremely lightweight. For UI elements like sliders and timers, 10-15fps updates are visually sufficient and reduce React overhead by 75-85%.
