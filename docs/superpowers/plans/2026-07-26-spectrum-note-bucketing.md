# Note-Bucketed Spectrum Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the spectrum analyzer's per-FFT-bin bars with one bar per note, so bars line up exactly with the note labels already drawn along the bottom.

**Architecture:** A new pure module, `src/spectrum-bars.js`, computes note buckets (frequency range + max aggregated value per semitone) from raw FFT data — no DOM/canvas access, fully unit-testable. `src/spectrum.js`'s `render()` calls it and converts each bucket's frequency range to pixels using its own existing `xForFreq`, keeping the log-frequency-to-pixel mapping in one place.

**Tech Stack:** Vanilla JS, vitest (for the new pure module); no changes to Web Audio usage.

## Global Constraints

- Bucket range per note: MIDI `[midi - 0.5, midi + 0.5)`, converted to Hz via `notes.js`'s existing `frequencyFromMidi()`. (Spec: Bucket boundaries)
- Aggregation: max byte value across bins in the bucket, not sum or average. (Spec: Aggregation)
- Bucket range covered per render: `floor(midiFromFrequency(minFreq) - 0.5)` through `ceil(midiFromFrequency(maxFreq) + 0.5)` — one note wider than the view on each side. (Spec: Rendering)
- `spectrum-bars.js` stays pure (no DOM/canvas/AudioContext) — `spectrum.js` owns all pixel conversion. (Spec: File structure)
- Note labels and their density-skipping (`labelStep()`) are unchanged — only the bars change. (Spec: Rendering)

---

## File Structure

- Create: `src/spectrum-bars.js` — `computeNoteBuckets(freqData, binHz, minFreq, maxFreq)`.
- Create: `src/spectrum-bars.test.js` — unit tests for the above.
- Modify: `src/spectrum.js` — `render()`'s bar-drawing loop switches from per-bin to per-bucket.

---

### Task 1: `spectrum-bars.js` — `computeNoteBuckets`

**Files:**
- Create: `src/spectrum-bars.js`
- Create: `src/spectrum-bars.test.js`

**Interfaces:**
- Consumes: `midiFromFrequency`, `frequencyFromMidi` from `./notes.js` (already exist, unchanged).
- Produces: `computeNoteBuckets(freqData, binHz, minFreq, maxFreq)` → `[{ midi, lowFreq, highFreq, value }, ...]`, one entry per MIDI note whose bucket overlaps `[minFreq, maxFreq]`, ordered by ascending `midi`. Task 2's `spectrum.js` change consumes this array directly.

- [ ] **Step 1: Write the failing tests**

```javascript
import { describe, it, expect } from 'vitest'
import { computeNoteBuckets } from './spectrum-bars.js'
import { frequencyFromMidi } from './notes.js'

const SAMPLE_RATE = 44100
const FFT_SIZE = 8192
const BIN_HZ = SAMPLE_RATE / FFT_SIZE

describe('computeNoteBuckets', () => {
  it('attributes a single loud bin to its nearest note, leaving neighbors at 0', () => {
    const freqData = new Uint8Array(4096)
    const binIndexNear440 = Math.round(440 / BIN_HZ)
    freqData[binIndexNear440] = 200

    const buckets = computeNoteBuckets(freqData, BIN_HZ, 27.5, 4186)
    const a4 = buckets.find((b) => b.midi === 69)
    const gSharp4 = buckets.find((b) => b.midi === 68)
    const aSharp4 = buckets.find((b) => b.midi === 70)

    expect(a4.value).toBe(200)
    expect(gSharp4.value).toBe(0)
    expect(aSharp4.value).toBe(0)
  })

  it('computes bucket boundaries from frequencyFromMidi(midi +/- 0.5)', () => {
    const freqData = new Uint8Array(4096)
    const buckets = computeNoteBuckets(freqData, BIN_HZ, 27.5, 4186)
    const a4 = buckets.find((b) => b.midi === 69)

    expect(a4.lowFreq).toBeCloseTo(frequencyFromMidi(68.5), 5)
    expect(a4.highFreq).toBeCloseTo(frequencyFromMidi(69.5), 5)
  })

  it('takes the max across multiple bins in one bucket, not sum or average', () => {
    const freqData = new Uint8Array(4096)
    const lowC5 = frequencyFromMidi(71.5)
    const highC5 = frequencyFromMidi(72.5)
    const startBin = Math.ceil(lowC5 / BIN_HZ)
    freqData[startBin] = 50
    freqData[startBin + 1] = 180
    freqData[Math.floor(highC5 / BIN_HZ)] = 90

    const buckets = computeNoteBuckets(freqData, BIN_HZ, 27.5, 4186)
    expect(buckets.find((b) => b.midi === 72).value).toBe(180)
  })

  it('only returns buckets overlapping the given frequency range', () => {
    const freqData = new Uint8Array(4096)
    const buckets = computeNoteBuckets(freqData, BIN_HZ, 440, 440)
    const midis = buckets.map((b) => b.midi)

    expect(Math.min(...midis)).toBe(Math.floor(69 - 0.5))
    expect(Math.max(...midis)).toBe(Math.ceil(69 + 0.5))
  })

  it('returns buckets ordered by ascending midi', () => {
    const freqData = new Uint8Array(4096)
    const buckets = computeNoteBuckets(freqData, BIN_HZ, 220, 880)
    const midis = buckets.map((b) => b.midi)
    const sorted = [...midis].sort((a, b) => a - b)
    expect(midis).toEqual(sorted)
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/spectrum-bars.test.js`
Expected: FAIL — `src/spectrum-bars.js` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```javascript
import { midiFromFrequency, frequencyFromMidi } from './notes.js'

export function computeNoteBuckets(freqData, binHz, minFreq, maxFreq) {
  const minMidi = Math.floor(midiFromFrequency(minFreq) - 0.5)
  const maxMidi = Math.ceil(midiFromFrequency(maxFreq) + 0.5)
  const buckets = []

  for (let midi = minMidi; midi <= maxMidi; midi++) {
    const lowFreq = frequencyFromMidi(midi - 0.5)
    const highFreq = frequencyFromMidi(midi + 0.5)
    const startBin = Math.max(0, Math.ceil(lowFreq / binHz))
    const endBin = Math.min(freqData.length - 1, Math.floor(highFreq / binHz))

    let value = 0
    for (let i = startBin; i <= endBin; i++) {
      if (freqData[i] > value) value = freqData[i]
    }

    buckets.push({ midi, lowFreq, highFreq, value })
  }

  return buckets
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/spectrum-bars.test.js`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/spectrum-bars.js src/spectrum-bars.test.js
git commit -m "Add computeNoteBuckets for note-aligned spectrum bars"
```

---

### Task 2: `spectrum.js` — draw bucketed bars instead of per-bin bars

**Files:**
- Modify: `src/spectrum.js`

**Interfaces:**
- Consumes: `computeNoteBuckets` from `src/spectrum-bars.js` (Task 1); `xForFreq`, `viewMinFreq`, `viewMaxFreq`, `binHz` (all already exist in `spectrum.js`).
- Produces: fully working note-bucketed bar rendering. Last task — nothing depends on it.

- [ ] **Step 1: Import `computeNoteBuckets`**

Change:

```javascript
import { frequencyToNoteName, midiFromFrequency } from './notes.js'
```

to:

```javascript
import { frequencyToNoteName, midiFromFrequency } from './notes.js'
import { computeNoteBuckets } from './spectrum-bars.js'
```

- [ ] **Step 2: Replace the per-bin bar loop in `render()`**

Change:

```javascript
    ctx.fillStyle = BAR_COLOR
    for (let i = 0; i < freqData.length; i++) {
      const freq = i * binHz
      if (freq < viewMinFreq || freq > viewMaxFreq) continue
      const x = xForFreq(freq)
      const barHeight = (freqData[i] / 255) * canvas.height
      ctx.fillRect(x, canvas.height - barHeight, 2, barHeight)
    }
```

to:

```javascript
    ctx.fillStyle = BAR_COLOR
    const buckets = computeNoteBuckets(freqData, binHz, viewMinFreq, viewMaxFreq)
    for (const bucket of buckets) {
      const x1 = xForFreq(bucket.lowFreq)
      const x2 = xForFreq(bucket.highFreq)
      const barHeight = (bucket.value / 255) * canvas.height
      ctx.fillRect(x1, canvas.height - barHeight, Math.max(0, x2 - x1 - 1), barHeight)
    }
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `spectrum-bars.test.js`.

- [ ] **Step 4: Verify manually**

Run: `bin/dev`, open the browser, upload a file, play it.

1. Confirm bars now appear as one bar per note, aligned under the note
   labels along the bottom, rather than a dense cluster of thin bars.
2. Play a single sustained note and confirm exactly one bar (at the
   correct note) lights up rather than several adjacent bars.
3. Zoom in/out and pan — confirm bars stay aligned with labels at every
   zoom level, and confirm the existing EQ dots/curve (drawn after the
   bars in `render()`) still work unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/spectrum.js
git commit -m "Draw note-bucketed spectrum bars instead of per-bin bars"
```

---

## Post-plan

None — this plan fully implements the spec.
