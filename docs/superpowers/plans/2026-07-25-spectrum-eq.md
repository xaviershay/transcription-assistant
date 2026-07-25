# Draggable Spectrum EQ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single draggable peaking-EQ point to the spectrum analyzer — x = frequency, y = gain, mouse wheel while hovering it = Q (width) — that actually filters playback, not just a visual marker.

**Architecture:** A new pure-math module `src/eq.js` (unit tested) provides the dB/pixel mapping, Q's accumulator-based wheel mapping, the peaking filter's analytic response curve, and dot hit-testing. `src/spectrum.js` wires a `BiquadFilterNode` into its existing audio graph and uses `eq.js` for drag/wheel handling and canvas rendering. `src/persistence.js` and `src/main.js` extend the existing per-file settings save/restore to include the EQ's three parameters.

**Tech Stack:** Vanilla JS, Web Audio API (`BiquadFilterNode`), Canvas 2D, vitest.

## Global Constraints

- One band, always active — no enable/disable toggle. (Spec: Scope)
- Filter type: `BiquadFilterNode` type `'peaking'`. (Spec: Filter choice)
- Frequency range: 27.5 Hz–4186 Hz (spectrum view's existing `MIN_FREQ`/`MAX_FREQ`). Gain range: ±24 dB. Q range: 0.1–24. (Spec: Parameters and ranges)
- Defaults: 1000 Hz, 0 dB, Q = 1. (Spec: Parameters and ranges)
- Dot hit-radius: 8px. (Spec: Interaction)
- EQ settings persist per-file-hash alongside the existing `bpm`/`subdivisions`/`offset`/`volume`, debounced at 60ms on change. (Spec: Persistence)
- `eq.js` stays pure (no DOM/canvas/AudioContext access) so it's unit-testable; `spectrum.js` keeps owning all DOM/audio wiring, consistent with the existing split in this codebase (`notes.js`/`selections.js`/`onsets.js`/`normalize.js` are pure+tested, `spectrum.js`/`waveform.js` are DOM-wiring+untested). (Spec: File structure)

---

## File Structure

- Create: `src/eq.js` — pure functions: gain↔pixel mapping, Q accumulator mapping, peaking response formula, hit-testing.
- Create: `src/eq.test.js` — vitest coverage for everything in `eq.js`.
- Modify: `src/spectrum.js` — audio graph, drag/wheel handlers, dot+curve rendering.
- Modify: `src/persistence.js` — extend settings validation/shape with `eqFreq`/`eqGain`/`eqQ`.
- Modify: `src/persistence.test.js` — update/add tests for the extended shape.
- Modify: `src/main.js` — `DEFAULT_SETTINGS`, `applySettings`, `saveCurrentSettings`, debounced save wiring.

---

### Task 1: `eq.js` — gain/dB ↔ canvas-y mapping

**Files:**
- Create: `src/eq.js`
- Create: `src/eq.test.js`

**Interfaces:**
- Produces: `MIN_GAIN = -24`, `MAX_GAIN = 24`; `clampGain(gainDb)`; `gainToY(gainDb, canvasHeight)`; `yToGain(y, canvasHeight)` (already clamps its output via `clampGain`). Later tasks (`spectrum.js` rendering and drag handling) call these directly.

- [ ] **Step 1: Write the failing tests**

```javascript
import { describe, it, expect } from 'vitest'
import { MIN_GAIN, MAX_GAIN, clampGain, gainToY, yToGain } from './eq.js'

describe('clampGain', () => {
  it('passes through values within range', () => {
    expect(clampGain(5)).toBe(5)
  })

  it('clamps above MAX_GAIN', () => {
    expect(clampGain(30)).toBe(MAX_GAIN)
  })

  it('clamps below MIN_GAIN', () => {
    expect(clampGain(-30)).toBe(MIN_GAIN)
  })
})

describe('gainToY', () => {
  it('maps 0 dB to vertical center', () => {
    expect(gainToY(0, 200)).toBe(100)
  })

  it('maps MAX_GAIN to the top (y=0)', () => {
    expect(gainToY(MAX_GAIN, 200)).toBe(0)
  })

  it('maps MIN_GAIN to the bottom', () => {
    expect(gainToY(MIN_GAIN, 200)).toBe(200)
  })
})

describe('yToGain', () => {
  it('maps vertical center to 0 dB', () => {
    expect(yToGain(100, 200)).toBeCloseTo(0, 5)
  })

  it('maps the top to MAX_GAIN', () => {
    expect(yToGain(0, 200)).toBeCloseTo(MAX_GAIN, 5)
  })

  it('maps the bottom to MIN_GAIN', () => {
    expect(yToGain(200, 200)).toBeCloseTo(MIN_GAIN, 5)
  })

  it('clamps y values beyond the canvas', () => {
    expect(yToGain(-50, 200)).toBe(MAX_GAIN)
    expect(yToGain(250, 200)).toBe(MIN_GAIN)
  })

  it('round-trips with gainToY', () => {
    expect(yToGain(gainToY(12, 200), 200)).toBeCloseTo(12, 5)
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/eq.test.js`
Expected: FAIL — `src/eq.js` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```javascript
export const MIN_GAIN = -24
export const MAX_GAIN = 24

export function clampGain(gainDb) {
  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, gainDb))
}

export function gainToY(gainDb, canvasHeight) {
  const half = canvasHeight / 2
  return half - (clampGain(gainDb) / MAX_GAIN) * half
}

export function yToGain(y, canvasHeight) {
  const half = canvasHeight / 2
  return clampGain(((half - y) / half) * MAX_GAIN)
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/eq.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/eq.js src/eq.test.js
git commit -m "Add gain/dB <-> canvas-y mapping for spectrum EQ"
```

---

### Task 2: `eq.js` — Q accumulator mapping

**Files:**
- Modify: `src/eq.js`
- Modify: `src/eq.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `MIN_Q = 0.1`, `MAX_Q = 24`, `DEFAULT_Q = 1`; `accumulatorForQ(q)`; `qForAccumulator(accumulator)`; `updateQAccumulator(accumulator, deltaY)`. Later tasks (`spectrum.js` wheel-on-dot handling) call these to convert between a persisted Q value and the running wheel accumulator, mirroring the existing zoom-accumulator pattern in `spectrum.js:44-51`.

- [ ] **Step 1: Write the failing tests**

```javascript
import { MIN_Q, MAX_Q, DEFAULT_Q, accumulatorForQ, qForAccumulator, updateQAccumulator } from './eq.js'

describe('accumulatorForQ / qForAccumulator', () => {
  it('round-trips a mid-range Q', () => {
    const acc = accumulatorForQ(2)
    expect(qForAccumulator(acc)).toBeCloseTo(2, 5)
  })

  it('maps MIN_Q to accumulator 0', () => {
    expect(accumulatorForQ(MIN_Q)).toBeCloseTo(0, 5)
  })

  it('qForAccumulator(0) returns MIN_Q', () => {
    expect(qForAccumulator(0)).toBeCloseTo(MIN_Q, 5)
  })

  it('clamps Q above MAX_Q when converting to accumulator', () => {
    const acc = accumulatorForQ(1000)
    expect(qForAccumulator(acc)).toBeCloseTo(MAX_Q, 5)
  })

  it('clamps Q below MIN_Q when converting to accumulator', () => {
    const acc = accumulatorForQ(0.001)
    expect(qForAccumulator(acc)).toBeCloseTo(MIN_Q, 5)
  })
})

describe('updateQAccumulator', () => {
  it('increases the accumulator for a negative deltaY (scroll up)', () => {
    const acc = accumulatorForQ(DEFAULT_Q)
    const updated = updateQAccumulator(acc, -10)
    expect(updated).toBeGreaterThan(acc)
  })

  it('decreases the accumulator for a positive deltaY (scroll down)', () => {
    const acc = accumulatorForQ(DEFAULT_Q)
    const updated = updateQAccumulator(acc, 10)
    expect(updated).toBeLessThan(acc)
  })

  it('is path-independent: a zero-sum sequence of deltas returns to the same Q', () => {
    let acc = accumulatorForQ(DEFAULT_Q)
    acc = updateQAccumulator(acc, -5)
    acc = updateQAccumulator(acc, -3)
    acc = updateQAccumulator(acc, 8)
    expect(qForAccumulator(acc)).toBeCloseTo(DEFAULT_Q, 5)
  })

  it('does not push the accumulator below 0', () => {
    const updated = updateQAccumulator(0, 100)
    expect(updated).toBe(0)
    expect(qForAccumulator(updated)).toBeCloseTo(MIN_Q, 5)
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/eq.test.js`
Expected: FAIL — the new exports don't exist yet.

- [ ] **Step 3: Write the implementation**

Add to `src/eq.js`:

```javascript
export const MIN_Q = 0.1
export const MAX_Q = 24
export const DEFAULT_Q = 1
const Q_ZOOM_FACTOR = 1.15
const MAX_Q_ACCUMULATOR = (100 * Math.log(MAX_Q / MIN_Q)) / Math.log(Q_ZOOM_FACTOR)

export function accumulatorForQ(q) {
  const clamped = Math.min(MAX_Q, Math.max(MIN_Q, q))
  return (100 * Math.log(clamped / MIN_Q)) / Math.log(Q_ZOOM_FACTOR)
}

export function qForAccumulator(accumulator) {
  const clamped = Math.min(MAX_Q_ACCUMULATOR, Math.max(0, accumulator))
  return MIN_Q * Math.pow(Q_ZOOM_FACTOR, clamped / 100)
}

export function updateQAccumulator(accumulator, deltaY) {
  return Math.min(MAX_Q_ACCUMULATOR, Math.max(0, accumulator - deltaY))
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/eq.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/eq.js src/eq.test.js
git commit -m "Add Q accumulator mapping for spectrum EQ wheel control"
```

---

### Task 3: `eq.js` — peaking filter analytic response curve

**Files:**
- Modify: `src/eq.js`
- Modify: `src/eq.test.js`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: `peakingResponseDb(freq, centerFreq, gainDb, q, sampleRate)`. Later tasks (`spectrum.js` curve rendering) call this once per x-pixel across the visible frequency range.

- [ ] **Step 1: Write the failing tests**

```javascript
import { peakingResponseDb } from './eq.js'

describe('peakingResponseDb', () => {
  it('returns the set gain exactly at the center frequency', () => {
    expect(peakingResponseDb(1000, 1000, 6, 1, 44100)).toBeCloseTo(6, 1)
  })

  it('returns the set (negative) gain exactly at the center frequency', () => {
    expect(peakingResponseDb(1000, 1000, -9, 2, 44100)).toBeCloseTo(-9, 1)
  })

  it('approaches 0 dB far below the center frequency', () => {
    expect(Math.abs(peakingResponseDb(50, 1000, 6, 1, 44100))).toBeLessThan(1.5)
  })

  it('approaches 0 dB far above the center frequency', () => {
    expect(Math.abs(peakingResponseDb(8000, 1000, 6, 1, 44100))).toBeLessThan(1.5)
  })

  it('is symmetric in dB around the center for a given Q (boost vs matching cut have opposite sign at center)', () => {
    const boost = peakingResponseDb(1000, 1000, 6, 1, 44100)
    const cut = peakingResponseDb(1000, 1000, -6, 1, 44100)
    expect(boost).toBeCloseTo(-cut, 1)
  })

  it('a higher Q narrows the response (less boost one octave away)', () => {
    const narrow = peakingResponseDb(2000, 1000, 12, 8, 44100)
    const wide = peakingResponseDb(2000, 1000, 12, 1, 44100)
    expect(narrow).toBeLessThan(wide)
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/eq.test.js`
Expected: FAIL — `peakingResponseDb` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Add to `src/eq.js` (standard RBJ Audio EQ Cookbook peaking-filter coefficients, evaluated analytically at a single frequency rather than via `AudioParam.getFrequencyResponse()`):

```javascript
export function peakingResponseDb(freq, centerFreq, gainDb, q, sampleRate) {
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * centerFreq) / sampleRate
  const alpha = Math.sin(w0) / (2 * q)
  const cosw0 = Math.cos(w0)

  const b0 = 1 + alpha * A
  const b1 = -2 * cosw0
  const b2 = 1 - alpha * A
  const a0 = 1 + alpha / A
  const a1 = -2 * cosw0
  const a2 = 1 - alpha / A

  const w = (2 * Math.PI * freq) / sampleRate
  const cosW = Math.cos(w)
  const sinW = Math.sin(w)
  const cos2W = Math.cos(2 * w)
  const sin2W = Math.sin(2 * w)

  const numRe = b0 + b1 * cosW + b2 * cos2W
  const numIm = -(b1 * sinW + b2 * sin2W)
  const denRe = a0 + a1 * cosW + a2 * cos2W
  const denIm = -(a1 * sinW + a2 * sin2W)

  const numMag = Math.sqrt(numRe * numRe + numIm * numIm)
  const denMag = Math.sqrt(denRe * denRe + denIm * denIm)

  return 20 * Math.log10(numMag / denMag)
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/eq.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/eq.js src/eq.test.js
git commit -m "Add analytic peaking-filter response curve for spectrum EQ"
```

---

### Task 4: `eq.js` — dot hit-testing

**Files:**
- Modify: `src/eq.js`
- Modify: `src/eq.test.js`

**Interfaces:**
- Consumes: nothing from Tasks 1-3.
- Produces: `isNearDot(cursorX, cursorY, dotX, dotY, hitRadius)`. Later tasks (`spectrum.js` drag start and wheel-on-dot) call this to decide whether a mouse event targets the EQ dot.

- [ ] **Step 1: Write the failing tests**

```javascript
import { isNearDot } from './eq.js'

describe('isNearDot', () => {
  it('is true exactly at the dot', () => {
    expect(isNearDot(100, 50, 100, 50, 8)).toBe(true)
  })

  it('is true within the hit radius', () => {
    expect(isNearDot(105, 50, 100, 50, 8)).toBe(true)
  })

  it('is true exactly on the hit radius boundary', () => {
    expect(isNearDot(108, 50, 100, 50, 8)).toBe(true)
  })

  it('is false outside the hit radius', () => {
    expect(isNearDot(120, 50, 100, 50, 8)).toBe(false)
  })

  it('accounts for both x and y distance', () => {
    expect(isNearDot(106, 106, 100, 100, 8)).toBe(false)
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/eq.test.js`
Expected: FAIL — `isNearDot` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Add to `src/eq.js`:

```javascript
export function isNearDot(cursorX, cursorY, dotX, dotY, hitRadius) {
  const dx = cursorX - dotX
  const dy = cursorY - dotY
  return dx * dx + dy * dy <= hitRadius * hitRadius
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/eq.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/eq.js src/eq.test.js
git commit -m "Add EQ dot hit-testing"
```

---

### Task 5: `spectrum.js` — insert filter into the audio graph, expose get/set EQ state

**Files:**
- Modify: `src/spectrum.js`

**Interfaces:**
- Consumes: nothing from `eq.js` yet (this task only touches the Web Audio graph).
- Produces: `createSpectrumAnalyser(wavesurfer, canvas, { onEqChange } = {})` — the third parameter is new and unused until Tasks 7-8 call it; accept and store it now so the signature is stable. The returned object gains `getEqState()` and `setEqState({ freq, gain, q })` alongside the existing `start`/`stop`. Later tasks (rendering, drag, wheel, and `main.js`'s persistence wiring) all depend on this pair.

- [ ] **Step 1: Add the filter node to the audio graph**

In `src/spectrum.js`, change:

```javascript
export function createSpectrumAnalyser(wavesurfer, canvas) {
```

to:

```javascript
export function createSpectrumAnalyser(wavesurfer, canvas, { onEqChange } = {}) {
```

Change:

```javascript
  const audioCtx = new AudioContext()
  const source = audioCtx.createMediaElementSource(wavesurfer.getMediaElement())
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 8192
  source.connect(analyser)
  analyser.connect(audioCtx.destination)
```

to:

```javascript
  const audioCtx = new AudioContext()
  const source = audioCtx.createMediaElementSource(wavesurfer.getMediaElement())
  const filter = audioCtx.createBiquadFilter()
  filter.type = 'peaking'
  filter.frequency.value = 1000
  filter.gain.value = 0
  filter.Q.value = 1
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 8192
  source.connect(filter)
  filter.connect(analyser)
  analyser.connect(audioCtx.destination)
```

- [ ] **Step 2: Add `getEqState`/`setEqState` and return them**

Add near the other function definitions (before the `return { start, stop }` line):

```javascript
  function getEqState() {
    return { freq: filter.frequency.value, gain: filter.gain.value, q: filter.Q.value }
  }

  function setEqState({ freq, gain, q }) {
    filter.frequency.value = freq
    filter.gain.value = gain
    filter.Q.value = q
  }
```

Change the final `return { start, stop }` to:

```javascript
  return { start, stop, getEqState, setEqState }
```

- [ ] **Step 3: Verify manually**

Run: `bin/dev`, open the printed local URL in a browser, upload an audio file, press play.
Expected: audio still plays normally (filter at default 0 dB gain is inaudible), spectrum bars still render. Open the browser devtools console and confirm no errors were logged on load or play.

- [ ] **Step 4: Commit**

```bash
git add src/spectrum.js
git commit -m "Insert BiquadFilterNode into spectrum audio graph, expose EQ state accessors"
```

---

### Task 6: `spectrum.js` — draw the EQ dot and response curve

**Files:**
- Modify: `src/spectrum.js`

**Interfaces:**
- Consumes: `gainToY`, `peakingResponseDb` from `eq.js`; `filter`, `getEqState` from Task 5.
- Produces: dot+curve drawing inside the existing `render()`, visible on every frame once a file is loaded. No new exports — later tasks (drag, wheel) read the same `filter` node this draws from, so moving the filter always moves what's drawn.

- [ ] **Step 1: Import `eq.js` and draw the curve + dot in `render()`**

Add to the top imports:

```javascript
import { gainToY, peakingResponseDb } from './eq.js'
```

Add a color constant near the other color constants:

```javascript
const EQ_COLOR = '#f5a64f'
```

At the end of `render()` (after the existing label-drawing loop), add:

```javascript
    ctx.strokeStyle = EQ_COLOR
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let x = 0; x <= canvas.width; x += 2) {
      const freq = freqForX(x)
      const responseDb = peakingResponseDb(freq, filter.frequency.value, filter.gain.value, filter.Q.value, audioCtx.sampleRate)
      const y = gainToY(responseDb, canvas.height)
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    const dotX = xForFreq(filter.frequency.value)
    const dotY = gainToY(filter.gain.value, canvas.height)
    ctx.fillStyle = EQ_COLOR
    ctx.beginPath()
    ctx.arc(dotX, dotY, 5, 0, 2 * Math.PI)
    ctx.fill()
```

- [ ] **Step 2: Verify manually**

Run: `bin/dev`, open the browser, upload a file.
Expected: an orange dot sits at (1000 Hz, 0 dB) — visually at the horizontal center of the canvas height — with a flat orange line across the full width (0 dB gain means the curve is flat). This confirms the curve math and mapping agree with the dot's position even before any interaction is wired up.

- [ ] **Step 3: Commit**

```bash
git add src/spectrum.js
git commit -m "Draw EQ dot and response curve on spectrum canvas"
```

---

### Task 7: `spectrum.js` — drag the dot to set frequency and gain

**Files:**
- Modify: `src/spectrum.js`

**Interfaces:**
- Consumes: `yToGain` from `eq.js`; `isNearDot` from `eq.js`; `filter`, `xForFreq`, `freqForX` from Tasks 5-6.
- Produces: mousedown/mousemove/mouseup drag handling. Calls `onEqChange?.()` on every drag move (Task 5 already threads this parameter through) — Task 10 debounces and persists on the other end.

- [ ] **Step 1: Import `isNearDot` and `yToGain`, add drag state and handlers**

Change the `eq.js` import to:

```javascript
import { gainToY, yToGain, peakingResponseDb, isNearDot } from './eq.js'
```

Add a constant near the other constants:

```javascript
const EQ_HIT_RADIUS = 8
```

Add, near the wheel listener (after `syncCanvasWidth`/before or after the existing `canvas.addEventListener('wheel', ...)` block — exact position doesn't matter, they're independent listeners):

```javascript
  let draggingEq = false

  function dotPosition() {
    return { x: xForFreq(filter.frequency.value), y: gainToY(filter.gain.value, canvas.height) }
  }

  function eventCanvasPos(e) {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  canvas.addEventListener('mousedown', (e) => {
    const { x, y } = eventCanvasPos(e)
    const dot = dotPosition()
    if (isNearDot(x, y, dot.x, dot.y, EQ_HIT_RADIUS)) {
      draggingEq = true
    }
  })

  window.addEventListener('mousemove', (e) => {
    if (!draggingEq) return
    const { x, y } = eventCanvasPos(e)
    const clampedX = Math.min(canvas.width, Math.max(0, x))
    filter.frequency.value = freqForX(clampedX)
    filter.gain.value = yToGain(y, canvas.height)
    onEqChange?.()
    if (!animationFrame) render()
  })

  window.addEventListener('mouseup', () => {
    draggingEq = false
  })
```

- [ ] **Step 2: Verify manually**

Run: `bin/dev`, open the browser, upload a file, play it.
Expected: dragging the orange dot moves it under the cursor, the response curve follows, and the audible sound changes as you drag (boosting/cutting the frequency band you drag through). Releasing the mouse and dragging elsewhere on the canvas (not near the dot) does nothing to the EQ (existing zoom/pan on the canvas still works there).

- [ ] **Step 3: Commit**

```bash
git add src/spectrum.js
git commit -m "Add drag interaction to set EQ frequency and gain"
```

---

### Task 8: `spectrum.js` — wheel-on-dot sets Q, preserves existing zoom/pan elsewhere

**Files:**
- Modify: `src/spectrum.js`

**Interfaces:**
- Consumes: `qForAccumulator`, `updateQAccumulator`, `accumulatorForQ`, `DEFAULT_Q` from `eq.js`; `isNearDot`, `dotPosition`, `eventCanvasPos` from Task 7.
- Produces: Q control via wheel. Calls `onEqChange?.()` on every Q change, same as Task 7's drag.

- [ ] **Step 1: Import the Q helpers and branch the existing wheel handler**

Change the `eq.js` import to:

```javascript
import {
  gainToY,
  yToGain,
  peakingResponseDb,
  isNearDot,
  qForAccumulator,
  updateQAccumulator,
  accumulatorForQ,
  DEFAULT_Q,
} from './eq.js'
```

Add, near the other top-level `let` state (e.g. next to `draggingEq`):

```javascript
  let qAccumulator = accumulatorForQ(DEFAULT_Q)
```

Change the existing wheel listener from:

```javascript
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      if (e.shiftKey) {
        pan(e.deltaY > 0 ? 1 : -1)
      } else {
        const rect = canvas.getBoundingClientRect()
        const cursorX = ((e.clientX - rect.left) / rect.width) * canvas.width
        zoomAt(cursorX, e.deltaY)
      }
      if (!animationFrame) render()
    },
    { passive: false },
  )
```

to:

```javascript
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const { x: cursorX, y: cursorY } = eventCanvasPos(e)
      const dot = dotPosition()
      if (isNearDot(cursorX, cursorY, dot.x, dot.y, EQ_HIT_RADIUS)) {
        qAccumulator = updateQAccumulator(qAccumulator, e.deltaY)
        filter.Q.value = qForAccumulator(qAccumulator)
        onEqChange?.()
      } else if (e.shiftKey) {
        pan(e.deltaY > 0 ? 1 : -1)
      } else {
        zoomAt(cursorX, e.deltaY)
      }
      if (!animationFrame) render()
    },
    { passive: false },
  )
```

(This replaces the old inline `rect`/`cursorX` computation with the `eventCanvasPos` helper added in Task 7. `dotPosition`/`eventCanvasPos` are `function` declarations, so they're hoisted — this listener can reference them regardless of where in the file it's placed relative to Task 7's additions.)

Also update `setEqState` (from Task 5) so restoring a persisted Q keeps the accumulator in sync:

```javascript
  function setEqState({ freq, gain, q }) {
    filter.frequency.value = freq
    filter.gain.value = gain
    filter.Q.value = q
    qAccumulator = accumulatorForQ(q)
  }
```

- [ ] **Step 2: Verify manually**

Run: `bin/dev`, open the browser, upload a file, play it.
Expected: scrolling while hovering the dot narrows/widens the response curve (and audibly changes the sound) without zooming the spectrum view. Scrolling anywhere else on the canvas still zooms/pans as before.

- [ ] **Step 3: Commit**

```bash
git add src/spectrum.js
git commit -m "Add wheel-on-dot Q control to spectrum EQ"
```

---

### Task 9: `persistence.js` — extend settings shape with EQ fields, backward-compatible

**Files:**
- Modify: `src/persistence.js`
- Modify: `src/persistence.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `loadSettings` now returns `eqFreq`/`eqGain`/`eqQ` on every successful load, defaulting them to `1000`/`0`/`1` when a stored blob predates this feature (so existing saved settings for a file don't get wiped just because they lack the new fields). `saveSettings` is unchanged (still just serializes whatever object it's given) — Task 10 is responsible for including the EQ fields when it calls `saveSettings`.

- [ ] **Step 1: Update the existing round-trip test and add new ones**

In `src/persistence.test.js`, replace:

```javascript
  it('round-trips settings through storage', () => {
    const storage = createMemoryStorage()
    const settings = { bpm: 140, subdivisions: 3, offset: 1.25, volume: 0.8 }
    saveSettings(storage, 'abc123', settings)
    expect(loadSettings(storage, 'abc123')).toEqual(settings)
  })
```

with:

```javascript
  it('round-trips settings through storage', () => {
    const storage = createMemoryStorage()
    const settings = { bpm: 140, subdivisions: 3, offset: 1.25, volume: 0.8, eqFreq: 500, eqGain: -3, eqQ: 2 }
    saveSettings(storage, 'abc123', settings)
    expect(loadSettings(storage, 'abc123')).toEqual(settings)
  })

  it('defaults EQ fields for settings saved before the EQ feature existed', () => {
    const storage = createMemoryStorage()
    storage.setItem(
      'ear-transcriber:settings:legacy',
      JSON.stringify({ bpm: 100, subdivisions: 4, offset: 0, volume: 1 }),
    )
    expect(loadSettings(storage, 'legacy')).toEqual({
      bpm: 100,
      subdivisions: 4,
      offset: 0,
      volume: 1,
      eqFreq: 1000,
      eqGain: 0,
      eqQ: 1,
    })
  })
```

Leave the other existing tests (`returns null for a hash with no saved settings`, malformed JSON, missing required fields) unchanged — they must still pass.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/persistence.test.js`
Expected: FAIL — the new test's expectation includes `eqFreq`/`eqGain`/`eqQ`, which `loadSettings` doesn't yet produce.

- [ ] **Step 3: Update `loadSettings`**

In `src/persistence.js`, replace:

```javascript
export function loadSettings(storage, hash) {
  const raw = storage.getItem(storageKey(hash))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (
      typeof parsed.bpm !== 'number' ||
      typeof parsed.subdivisions !== 'number' ||
      typeof parsed.offset !== 'number' ||
      typeof parsed.volume !== 'number'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}
```

with:

```javascript
const DEFAULT_EQ = { eqFreq: 1000, eqGain: 0, eqQ: 1 }

export function loadSettings(storage, hash) {
  const raw = storage.getItem(storageKey(hash))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (
      typeof parsed.bpm !== 'number' ||
      typeof parsed.subdivisions !== 'number' ||
      typeof parsed.offset !== 'number' ||
      typeof parsed.volume !== 'number'
    ) {
      return null
    }
    return {
      ...parsed,
      eqFreq: typeof parsed.eqFreq === 'number' ? parsed.eqFreq : DEFAULT_EQ.eqFreq,
      eqGain: typeof parsed.eqGain === 'number' ? parsed.eqGain : DEFAULT_EQ.eqGain,
      eqQ: typeof parsed.eqQ === 'number' ? parsed.eqQ : DEFAULT_EQ.eqQ,
    }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/persistence.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/persistence.js src/persistence.test.js
git commit -m "Extend persisted settings with EQ fields, defaulting for legacy data"
```

---

### Task 10: `main.js` — wire EQ defaults, restore-on-load, and debounced save

**Files:**
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `getEqState`/`setEqState` from `spectrum.js` (Task 5); `eqFreq`/`eqGain`/`eqQ` from `persistence.js` (Task 9); `onEqChange` parameter accepted by `createSpectrumAnalyser` since Task 5, invoked by Tasks 7-8.
- Produces: fully working end-to-end feature. This is the last task — no later task depends on it.

- [ ] **Step 1: Extend `DEFAULT_SETTINGS`**

Change:

```javascript
const DEFAULT_SETTINGS = { bpm: 120, subdivisions: 4, offset: 0, volume: 1 }
```

to:

```javascript
const DEFAULT_SETTINGS = { bpm: 120, subdivisions: 4, offset: 0, volume: 1, eqFreq: 1000, eqGain: 0, eqQ: 1 }
```

- [ ] **Step 2: Track pending EQ settings and apply them once the analyser exists**

Add near `let currentFileHash = null`:

```javascript
let pendingEqSettings = { freq: DEFAULT_SETTINGS.eqFreq, gain: DEFAULT_SETTINGS.eqGain, q: DEFAULT_SETTINGS.eqQ }
```

In `applySettings`, add at the end of the function body:

```javascript
  pendingEqSettings = { freq: settings.eqFreq, gain: settings.eqGain, q: settings.eqQ }
```

Change the `wavesurfer.on('ready', ...)` handler from:

```javascript
wavesurfer.on('ready', () => {
  uploadError.hidden = true
  playPauseBtn.disabled = false
  if (!spectrumAnalyser) {
    spectrumAnalyser = createSpectrumAnalyser(wavesurfer, spectrumCanvas)
  }
})
```

to:

```javascript
wavesurfer.on('ready', () => {
  uploadError.hidden = true
  playPauseBtn.disabled = false
  if (!spectrumAnalyser) {
    spectrumAnalyser = createSpectrumAnalyser(wavesurfer, spectrumCanvas, { onEqChange: scheduleEqSave })
  }
  spectrumAnalyser.setEqState(pendingEqSettings)
})
```

- [ ] **Step 3: Add debounced EQ save and include EQ fields in `saveCurrentSettings`**

Add near `saveCurrentSettings`:

```javascript
let eqSaveDebounceTimer = null

function scheduleEqSave() {
  clearTimeout(eqSaveDebounceTimer)
  eqSaveDebounceTimer = setTimeout(saveCurrentSettings, 60)
}
```

Change `saveCurrentSettings` from:

```javascript
function saveCurrentSettings() {
  if (!currentFileHash) return
  saveSettings(localStorage, currentFileHash, {
    bpm: beatBpm,
    subdivisions: beatSubdivisions,
    offset: beatOffset,
    volume: Number(volumeInput.value),
  })
}
```

to:

```javascript
function saveCurrentSettings() {
  if (!currentFileHash) return
  const eq = spectrumAnalyser ? spectrumAnalyser.getEqState() : pendingEqSettings
  saveSettings(localStorage, currentFileHash, {
    bpm: beatBpm,
    subdivisions: beatSubdivisions,
    offset: beatOffset,
    volume: Number(volumeInput.value),
    eqFreq: eq.freq,
    eqGain: eq.gain,
    eqQ: eq.q,
  })
}
```

- [ ] **Step 4: Full manual verification pass, per spec**

Run: `bin/dev`, open the browser.

1. Upload a file, drag the EQ dot to a new frequency/gain → confirm both the audible playback and the spectrum bars change, and the curve follows the dot.
2. Scroll while hovering the dot → confirm the curve narrows/widens.
3. Scroll away from the dot → confirm existing zoom/pan still works.
4. Reload the page and re-upload the *same* file → confirm the EQ dot restores to the position you left it at (not the 1000 Hz/0 dB default).
5. Upload a *different* file → confirm it starts at the default 1000 Hz/0 dB position (or wherever you last left that file, if you'd used it before).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass (`eq.test.js`, `persistence.test.js`, and the existing suites all green).

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "Wire EQ defaults, restore-on-load, and debounced persistence"
```

---

## Post-plan

None — this plan fully implements the spec.
