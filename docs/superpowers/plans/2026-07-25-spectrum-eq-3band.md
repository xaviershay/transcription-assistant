# 3-Band Spectrum EQ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing single-band spectrum EQ to 3 independently draggable bands, with a combined response curve and a reset-all button.

**Architecture:** `eq.js` gains one new pure helper, `defaultEqBands()` — everything else in `eq.js` (per-band math) is reused unchanged, once per band. `spectrum.js`'s single `filter`/`qAccumulator`/`draggingEq` become arrays of 3, cascaded in series in the audio graph; hit-testing checks all 3 dots; the rendered curve sums all 3 bands' responses (correct for filters in series). `persistence.js` migrates old single-band and pre-EQ data to the new 3-band shape. `main.js` and `index.html` wire up the reset button.

**Tech Stack:** Same as the single-band EQ — vanilla JS, Web Audio (`BiquadFilterNode`), Canvas 2D, vitest.

## Global Constraints

- 3 bands, defaults: 200 Hz / 1000 Hz / 3000 Hz, all 0 dB, Q 1. Single source of truth: `defaultEqBands()` in `eq.js`, returns a fresh array each call. (Spec: Defaults)
- Filters cascaded in series; combined curve = sum of each band's `peakingResponseDb()` (correct because dB is log-magnitude and the bands are in series). One curve line, 3 colored dots. (Spec: Combined response curve)
- One reset button (`#reset-eq`), resets all 3 bands at once, no confirmation. (Spec: Reset button)
- Persisted shape is `eqBands: [{freq,gain,q}, ×3]`, replacing the single-band `eqFreq`/`eqGain`/`eqQ` fields. `loadSettings` migrates both older shapes (single-band, and pre-EQ with no EQ fields at all). (Spec: Persistence)
- 8px hit-radius, existing accumulator-based Q math, existing drag/zoom/pan mechanics — all reused per-band, unchanged in kind. (Spec: Interaction)

---

## File Structure

- Modify: `src/eq.js` — add `defaultEqBands()`.
- Modify: `src/eq.test.js` — tests for `defaultEqBands()`.
- Modify: `src/spectrum.js` — audio graph, state accessors, render, drag, wheel all migrate from one band to an array of 3.
- Modify: `src/persistence.js` — shape + migration logic.
- Modify: `src/persistence.test.js` — updated/new tests for the 3-band shape and both migration paths.
- Modify: `index.html` — add `#reset-eq` button.
- Modify: `src/main.js` — `DEFAULT_SETTINGS`/`applySettings`/`saveCurrentSettings` switch to `eqBands`; wire the reset button.

---

### Task 1: `eq.js` — `defaultEqBands()`

**Files:**
- Modify: `src/eq.js`
- Modify: `src/eq.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `defaultEqBands()` — returns `[{freq:200,gain:0,q:1}, {freq:1000,gain:0,q:1}, {freq:3000,gain:0,q:1}]`, a fresh array (and fresh objects) on every call. `spectrum.js` (Task 2) and `persistence.js`/`main.js` (Tasks 3-4) all call this instead of hardcoding defaults.

- [ ] **Step 1: Write the failing tests**

Add to `src/eq.test.js`:

```javascript
import { defaultEqBands } from './eq.js'

describe('defaultEqBands', () => {
  it('returns 3 bands with the documented defaults', () => {
    expect(defaultEqBands()).toEqual([
      { freq: 200, gain: 0, q: 1 },
      { freq: 1000, gain: 0, q: 1 },
      { freq: 3000, gain: 0, q: 1 },
    ])
  })

  it('returns a fresh array each call, safe to mutate', () => {
    const a = defaultEqBands()
    const b = defaultEqBands()
    expect(a).not.toBe(b)
    expect(a[0]).not.toBe(b[0])
    a[0].gain = 12
    expect(b[0].gain).toBe(0)
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/eq.test.js`
Expected: FAIL — `defaultEqBands` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Add to `src/eq.js`:

```javascript
export function defaultEqBands() {
  return [
    { freq: 200, gain: 0, q: 1 },
    { freq: 1000, gain: 0, q: 1 },
    { freq: 3000, gain: 0, q: 1 },
  ]
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/eq.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/eq.js src/eq.test.js
git commit -m "Add defaultEqBands() for 3-band spectrum EQ"
```

---

### Task 2: `spectrum.js` — migrate to 3 bands

**Files:**
- Modify: `src/spectrum.js`

**Interfaces:**
- Consumes: `defaultEqBands` from `eq.js` (Task 1).
- Produces: `getEqState()` now returns an array of 3 `{freq,gain,q}`; `setEqState(bands)` now takes an array of 3. This is a breaking change to both functions' shapes — Tasks 3-4 (persistence, main.js) are written against the new array shape, not the old single-object shape.

This task replaces every place in `spectrum.js` that currently references the single `filter`, `draggingEq`, `qAccumulator`, or the single-dot render/hit-test logic. Apply all steps together — the file won't be internally consistent (or syntactically meaningful) until all of them are in, since they all touch the same renamed state.

- [ ] **Step 1: Import `defaultEqBands`**

Change:

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

to:

```javascript
import {
  gainToY,
  yToGain,
  peakingResponseDb,
  isNearDot,
  qForAccumulator,
  updateQAccumulator,
  accumulatorForQ,
  defaultEqBands,
} from './eq.js'
```

(`DEFAULT_Q` is no longer needed directly — `defaultEqBands()` supplies each band's starting Q.)

- [ ] **Step 2: Add a band-color constant**

Change:

```javascript
const EQ_COLOR = '#f5a64f'
const EQ_HIT_RADIUS = 8
```

to:

```javascript
const EQ_COLOR = '#f5a64f'
const EQ_BAND_COLORS = ['#f5a64f', '#4fc3f5', '#f54f8c']
const EQ_HIT_RADIUS = 8
```

- [ ] **Step 3: Replace the single filter with 3 cascaded filters**

Change:

```javascript
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

to:

```javascript
  const filters = defaultEqBands().map(({ freq, gain, q }) => {
    const node = audioCtx.createBiquadFilter()
    node.type = 'peaking'
    node.frequency.value = freq
    node.gain.value = gain
    node.Q.value = q
    return node
  })
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 8192
  source.connect(filters[0])
  filters[0].connect(filters[1])
  filters[1].connect(filters[2])
  filters[2].connect(analyser)
  analyser.connect(audioCtx.destination)
```

- [ ] **Step 4: Replace drag/hit-test state and helpers**

Change:

```javascript
  let draggingEq = false
  let qAccumulator = accumulatorForQ(DEFAULT_Q)

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

to:

```javascript
  let draggingBandIndex = null
  let qAccumulators = filters.map((f) => accumulatorForQ(f.Q.value))

  function dotPosition(index) {
    return { x: xForFreq(filters[index].frequency.value), y: gainToY(filters[index].gain.value, canvas.height) }
  }

  function findNearDotIndex(x, y) {
    for (let i = 0; i < filters.length; i++) {
      const dot = dotPosition(i)
      if (isNearDot(x, y, dot.x, dot.y, EQ_HIT_RADIUS)) return i
    }
    return null
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
    draggingBandIndex = findNearDotIndex(x, y)
  })

  window.addEventListener('mousemove', (e) => {
    if (draggingBandIndex === null) return
    const { x, y } = eventCanvasPos(e)
    const clampedX = Math.min(canvas.width, Math.max(0, x))
    filters[draggingBandIndex].frequency.value = freqForX(clampedX)
    filters[draggingBandIndex].gain.value = yToGain(y, canvas.height)
    onEqChange?.()
    if (!animationFrame) render()
  })

  window.addEventListener('mouseup', () => {
    draggingBandIndex = null
  })
```

- [ ] **Step 5: Replace the wheel handler**

Change:

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

to:

```javascript
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const { x: cursorX, y: cursorY } = eventCanvasPos(e)
      const hoveredIndex = findNearDotIndex(cursorX, cursorY)
      if (hoveredIndex !== null) {
        qAccumulators[hoveredIndex] = updateQAccumulator(qAccumulators[hoveredIndex], e.deltaY)
        filters[hoveredIndex].Q.value = qForAccumulator(qAccumulators[hoveredIndex])
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

- [ ] **Step 6: Replace the curve+dot rendering**

Change:

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
  }
```

to:

```javascript
    ctx.strokeStyle = EQ_COLOR
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let x = 0; x <= canvas.width; x += 2) {
      const freq = freqForX(x)
      const responseDb = filters.reduce(
        (sum, f) => sum + peakingResponseDb(freq, f.frequency.value, f.gain.value, f.Q.value, audioCtx.sampleRate),
        0,
      )
      const y = gainToY(responseDb, canvas.height)
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    filters.forEach((f, i) => {
      const dotX = xForFreq(f.frequency.value)
      const dotY = gainToY(f.gain.value, canvas.height)
      ctx.fillStyle = EQ_BAND_COLORS[i]
      ctx.beginPath()
      ctx.arc(dotX, dotY, 5, 0, 2 * Math.PI)
      ctx.fill()
    })
  }
```

- [ ] **Step 7: Replace `getEqState`/`setEqState`**

Change:

```javascript
  function getEqState() {
    return { freq: filter.frequency.value, gain: filter.gain.value, q: filter.Q.value }
  }

  function setEqState({ freq, gain, q }) {
    filter.frequency.value = freq
    filter.gain.value = gain
    filter.Q.value = q
    qAccumulator = accumulatorForQ(q)
  }
```

to:

```javascript
  function getEqState() {
    return filters.map((f) => ({ freq: f.frequency.value, gain: f.gain.value, q: f.Q.value }))
  }

  function setEqState(bands) {
    bands.forEach((band, i) => {
      filters[i].frequency.value = band.freq
      filters[i].gain.value = band.gain
      filters[i].Q.value = band.q
      qAccumulators[i] = accumulatorForQ(band.q)
    })
  }
```

- [ ] **Step 8: Syntax-check and confirm the dev server still transforms cleanly**

Run: `node --check src/spectrum.js`
Expected: no output (valid syntax).

Run: `bin/dev` (if not already running), then `curl -s http://localhost:5173/src/spectrum.js | grep -c filters`
Expected: a positive count, confirming Vite serves the updated file without a transform error.

- [ ] **Step 9: Verify manually**

Open the dev server in a browser, upload a file, play it.
Expected: 3 colored dots visible (orange/cyan/pink) at 200 Hz, 1000 Hz, and 3000 Hz, all at the vertical center (0 dB). Drag each one independently — confirm only the grabbed dot moves and the curve updates to reflect all 3 bands combined (e.g. boost two overlapping bands and see the curve add up higher than either alone). Scroll on each dot independently and confirm only that band's width changes. Confirm audio still plays and reflects all 3 bands' settings.

- [ ] **Step 10: Commit**

```bash
git add src/spectrum.js
git commit -m "Migrate spectrum EQ from 1 band to 3 cascaded bands"
```

---

### Task 3: `persistence.js` — 3-band shape with migration

**Files:**
- Modify: `src/persistence.js`
- Modify: `src/persistence.test.js`

**Interfaces:**
- Consumes: `defaultEqBands` from `eq.js` (Task 1).
- Produces: `loadSettings` now returns `eqBands` (array of 3) instead of `eqFreq`/`eqGain`/`eqQ`. Handles 3 input shapes: fresh 3-band data, single-band legacy data (`eqFreq`/`eqGain`/`eqQ` numbers), and pre-EQ legacy data (none of the above).

- [ ] **Step 1: Replace the persistence tests for the new shape and migrations**

In `src/persistence.test.js`, replace the `describe('loadSettings / saveSettings', ...)` block's contents (keep the `describe`/`createMemoryStorage` wrapper) with:

```javascript
describe('loadSettings / saveSettings', () => {
  it('round-trips settings through storage', () => {
    const storage = createMemoryStorage()
    const settings = {
      bpm: 140,
      subdivisions: 3,
      offset: 1.25,
      volume: 0.8,
      eqBands: [
        { freq: 100, gain: 3, q: 1.5 },
        { freq: 900, gain: -2, q: 2 },
        { freq: 5000, gain: 6, q: 0.8 },
      ],
    }
    saveSettings(storage, 'abc123', settings)
    expect(loadSettings(storage, 'abc123')).toEqual(settings)
  })

  it('returns null for a hash with no saved settings', () => {
    const storage = createMemoryStorage()
    expect(loadSettings(storage, 'nope')).toBeNull()
  })

  it('returns null for malformed JSON rather than throwing', () => {
    const storage = createMemoryStorage()
    storage.setItem('ear-transcriber:settings:bad', 'not json{{{')
    expect(loadSettings(storage, 'bad')).toBeNull()
  })

  it('returns null for JSON missing expected fields', () => {
    const storage = createMemoryStorage()
    storage.setItem('ear-transcriber:settings:partial', JSON.stringify({ bpm: 120 }))
    expect(loadSettings(storage, 'partial')).toBeNull()
  })

  it('defaults all 3 EQ bands for settings saved before the EQ feature existed', () => {
    const storage = createMemoryStorage()
    storage.setItem(
      'ear-transcriber:settings:pre-eq',
      JSON.stringify({ bpm: 100, subdivisions: 4, offset: 0, volume: 1 }),
    )
    expect(loadSettings(storage, 'pre-eq')).toEqual({
      bpm: 100,
      subdivisions: 4,
      offset: 0,
      volume: 1,
      eqBands: [
        { freq: 200, gain: 0, q: 1 },
        { freq: 1000, gain: 0, q: 1 },
        { freq: 3000, gain: 0, q: 1 },
      ],
    })
  })

  it('migrates single-band legacy EQ data into band 0, defaulting bands 1 and 2', () => {
    const storage = createMemoryStorage()
    storage.setItem(
      'ear-transcriber:settings:single-band',
      JSON.stringify({ bpm: 100, subdivisions: 4, offset: 0, volume: 1, eqFreq: 500, eqGain: -6, eqQ: 3 }),
    )
    expect(loadSettings(storage, 'single-band')).toEqual({
      bpm: 100,
      subdivisions: 4,
      offset: 0,
      volume: 1,
      eqBands: [
        { freq: 500, gain: -6, q: 3 },
        { freq: 1000, gain: 0, q: 1 },
        { freq: 3000, gain: 0, q: 1 },
      ],
    })
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/persistence.test.js`
Expected: FAIL — `loadSettings` doesn't produce `eqBands` yet.

- [ ] **Step 3: Update `loadSettings`**

Change:

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

to:

```javascript
import { defaultEqBands } from './eq.js'

function isValidBand(band) {
  return (
    band !== null &&
    typeof band === 'object' &&
    typeof band.freq === 'number' &&
    typeof band.gain === 'number' &&
    typeof band.q === 'number'
  )
}

function normalizeEqBands(parsed) {
  if (Array.isArray(parsed.eqBands) && parsed.eqBands.length === 3 && parsed.eqBands.every(isValidBand)) {
    return parsed.eqBands
  }
  if (typeof parsed.eqFreq === 'number' && typeof parsed.eqGain === 'number' && typeof parsed.eqQ === 'number') {
    const [, band1, band2] = defaultEqBands()
    return [{ freq: parsed.eqFreq, gain: parsed.eqGain, q: parsed.eqQ }, band1, band2]
  }
  return defaultEqBands()
}

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
      bpm: parsed.bpm,
      subdivisions: parsed.subdivisions,
      offset: parsed.offset,
      volume: parsed.volume,
      eqBands: normalizeEqBands(parsed),
    }
  } catch {
    return null
  }
}
```

(Note the explicit return shape — this drops any stray `eqFreq`/`eqGain`/`eqQ`/`eqBands`-adjacent keys from old data rather than spreading `...parsed`, so `loadSettings` always returns exactly the 5 documented fields.)

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/persistence.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/persistence.js src/persistence.test.js
git commit -m "Migrate persisted EQ settings to 3-band shape"
```

---

### Task 4: `index.html` + `main.js` — reset button and wiring

**Files:**
- Modify: `index.html`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `getEqState`/`setEqState` (array shape, Task 2), `eqBands` (Task 3), `defaultEqBands` (Task 1).
- Produces: fully working 3-band EQ with reset. Last task — nothing depends on it.

- [ ] **Step 1: Add the reset button**

In `index.html`, change:

```html
      <section id="spectrum-section">
        <canvas id="spectrum" height="200"></canvas>
      </section>
```

to:

```html
      <section id="spectrum-section">
        <canvas id="spectrum" height="200"></canvas>
        <button id="reset-eq">Reset EQ</button>
      </section>
```

- [ ] **Step 2: Import `defaultEqBands` and update `DEFAULT_SETTINGS`/`pendingEqSettings`**

In `src/main.js`, add to the imports (alongside the existing `createSpectrumAnalyser` import):

```javascript
import { defaultEqBands } from './eq.js'
```

Change:

```javascript
const DEFAULT_SETTINGS = { bpm: 120, subdivisions: 4, offset: 0, volume: 1, eqFreq: 1000, eqGain: 0, eqQ: 1 }

let currentFileHash = null
let pendingEqSettings = { freq: DEFAULT_SETTINGS.eqFreq, gain: DEFAULT_SETTINGS.eqGain, q: DEFAULT_SETTINGS.eqQ }
```

to:

```javascript
const DEFAULT_SETTINGS = { bpm: 120, subdivisions: 4, offset: 0, volume: 1, eqBands: defaultEqBands() }

let currentFileHash = null
let pendingEqSettings = DEFAULT_SETTINGS.eqBands
```

- [ ] **Step 3: Update `applySettings` and `saveCurrentSettings`**

Change:

```javascript
  pendingEqSettings = { freq: settings.eqFreq, gain: settings.eqGain, q: settings.eqQ }
```

to:

```javascript
  pendingEqSettings = settings.eqBands
```

Change:

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

to:

```javascript
function saveCurrentSettings() {
  if (!currentFileHash) return
  const eqBands = spectrumAnalyser ? spectrumAnalyser.getEqState() : pendingEqSettings
  saveSettings(localStorage, currentFileHash, {
    bpm: beatBpm,
    subdivisions: beatSubdivisions,
    offset: beatOffset,
    volume: Number(volumeInput.value),
    eqBands,
  })
}
```

- [ ] **Step 4: Wire the reset button**

Add near the other button wiring (e.g. next to `deleteAllBtn.addEventListener(...)`):

```javascript
const resetEqBtn = document.getElementById('reset-eq')

resetEqBtn.addEventListener('click', () => {
  spectrumAnalyser?.setEqState(defaultEqBands())
  saveCurrentSettings()
})
```

- [ ] **Step 5: Full manual verification pass, per spec**

Run: `bin/dev`, open the browser.

1. Upload a file. Confirm 3 dots appear at 200/1000/3000 Hz, all flat.
2. Drag each dot independently — confirm only the grabbed one moves.
3. Scroll on each dot — confirm only that band's width changes.
4. Boost two bands so their curves overlap — confirm the combined curve visibly adds the two boosts together (higher than either alone).
5. Click "Reset EQ" — confirm all 3 dots snap back to defaults and the sound returns to unfiltered.
6. Reload the page and re-upload the same file — confirm the 3-band state you left it in (not reset) is restored.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add index.html src/main.js
git commit -m "Add reset-all button and wire 3-band EQ into main.js"
```

---

## Post-plan

None — this plan fully implements the spec.
