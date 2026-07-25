# Peak Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight note buckets that look like they're actually sounding (naive local-max peak-picking), with an outlined bar and bold label.

**Architecture:** `computePeakMidis(buckets, threshold)` in `src/spectrum-bars.js` — pure, operates on the same bucket array `computeNoteBuckets` already produces. `spectrum.js`'s `render()` calls it once per frame and uses the result to decide which bars get an outline and which labels get bolded.

**Tech Stack:** Same as the rest of the spectrum analyzer — vanilla JS, vitest for the pure module.

## Global Constraints

- Peak = value ≥ threshold (default 40) AND value ≥ both existing neighbors (ties count, no plateau de-duplication). (Spec: Peak definition)
- Naive local-max only — no harmonic suppression, no true pitch detection. Known limitation, not addressed here. (Spec: Known limitation)
- Highlight = outlined bar (`strokeRect`) + bold label text, not a color swap. (Spec: Highlight rendering)
- `spectrum-bars.js` stays pure — no DOM/canvas access. (Spec: File structure)

---

## File Structure

- Modify: `src/spectrum-bars.js` — add `computePeakMidis`.
- Modify: `src/spectrum-bars.test.js` — tests for it.
- Modify: `src/spectrum.js` — `render()` uses it to highlight bars/labels.

---

### Task 1: `spectrum-bars.js` — `computePeakMidis`

**Files:**
- Modify: `src/spectrum-bars.js`
- Modify: `src/spectrum-bars.test.js`

**Interfaces:**
- Consumes: a `buckets` array in the exact shape `computeNoteBuckets` returns (`{ midi, lowFreq, highFreq, value }`, ordered by ascending `midi`).
- Produces: `computePeakMidis(buckets, threshold)` → array of MIDI numbers. Task 2's `spectrum.js` change consumes this directly (wrapped in a `Set`).

- [ ] **Step 1: Write the failing tests**

Add to `src/spectrum-bars.test.js`:

```javascript
import { computeNoteBuckets, computePeakMidis } from './spectrum-bars.js'
```

(replacing the existing `import { computeNoteBuckets } from './spectrum-bars.js'` line with the combined import)

```javascript
function bucket(midi, value) {
  return { midi, lowFreq: 0, highFreq: 0, value }
}

describe('computePeakMidis', () => {
  it('detects an isolated loud bucket as a peak', () => {
    const buckets = [bucket(60, 10), bucket(61, 50), bucket(62, 10)]
    expect(computePeakMidis(buckets, 40)).toEqual([61])
  })

  it('does not detect a locally-highest bucket below the threshold', () => {
    const buckets = [bucket(60, 5), bucket(61, 20), bucket(62, 5)]
    expect(computePeakMidis(buckets, 40)).toEqual([])
  })

  it('does not detect a bucket that is lower than a neighbor', () => {
    const buckets = [bucket(60, 10), bucket(61, 50), bucket(62, 80)]
    expect(computePeakMidis(buckets, 40)).toEqual([62])
  })

  it('handles the first bucket in the array as a potential peak', () => {
    const buckets = [bucket(60, 80), bucket(61, 50), bucket(62, 10)]
    expect(computePeakMidis(buckets, 40)).toEqual([60])
  })

  it('counts a plateau of equal-value adjacent buckets as multiple peaks', () => {
    const buckets = [bucket(60, 10), bucket(61, 50), bucket(62, 50), bucket(63, 10)]
    expect(computePeakMidis(buckets, 40)).toEqual([61, 62])
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/spectrum-bars.test.js`
Expected: FAIL — `computePeakMidis` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Add to `src/spectrum-bars.js`:

```javascript
export function computePeakMidis(buckets, threshold) {
  const peaks = []
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]
    if (b.value < threshold) continue
    const prev = buckets[i - 1]
    const next = buckets[i + 1]
    if (prev && b.value < prev.value) continue
    if (next && b.value < next.value) continue
    peaks.push(b.midi)
  }
  return peaks
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/spectrum-bars.test.js`
Expected: PASS, all 10 tests green (5 existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/spectrum-bars.js src/spectrum-bars.test.js
git commit -m "Add computePeakMidis for naive note-peak detection"
```

---

### Task 2: `spectrum.js` — highlight peak bars and labels

**Files:**
- Modify: `src/spectrum.js`

**Interfaces:**
- Consumes: `computePeakMidis` from `src/spectrum-bars.js` (Task 1); the `buckets` array `render()` already computes.
- Produces: fully working peak highlighting. Last task for this plan.

- [ ] **Step 1: Import `computePeakMidis` and add the threshold/color constants**

Change:

```javascript
import { computeNoteBuckets } from './spectrum-bars.js'
```

to:

```javascript
import { computeNoteBuckets, computePeakMidis } from './spectrum-bars.js'
```

Add near the other color constants:

```javascript
const PEAK_COLOR = '#ffe14f'
const PEAK_THRESHOLD = 40
```

- [ ] **Step 2: Compute peaks once per frame and outline peak bars**

Change:

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

to:

```javascript
    ctx.fillStyle = BAR_COLOR
    const buckets = computeNoteBuckets(freqData, binHz, viewMinFreq, viewMaxFreq)
    const peakMidis = new Set(computePeakMidis(buckets, PEAK_THRESHOLD))
    for (const bucket of buckets) {
      const x1 = xForFreq(bucket.lowFreq)
      const x2 = xForFreq(bucket.highFreq)
      const barHeight = (bucket.value / 255) * canvas.height
      const barWidth = Math.max(0, x2 - x1 - 1)
      ctx.fillRect(x1, canvas.height - barHeight, barWidth, barHeight)
      if (peakMidis.has(bucket.midi)) {
        ctx.strokeStyle = PEAK_COLOR
        ctx.lineWidth = 2
        ctx.strokeRect(x1, canvas.height - barHeight, barWidth, barHeight)
      }
    }
```

- [ ] **Step 3: Bold the label text for peak notes**

Change:

```javascript
    ctx.fillStyle = LABEL_COLOR
    ctx.font = '13px sans-serif'
    ctx.textAlign = 'center'
    const step = labelStep()
    const minMidi = Math.ceil(midiFromFrequency(viewMinFreq))
    const maxMidi = Math.floor(midiFromFrequency(viewMaxFreq))
    for (let midi = minMidi; midi <= maxMidi; midi += step) {
      const freq = 440 * Math.pow(2, (midi - 69) / 12)
      const x = xForFreq(freq)
      ctx.fillText(frequencyToNoteName(freq), x, canvas.height - 2)
    }
```

to:

```javascript
    ctx.fillStyle = LABEL_COLOR
    ctx.textAlign = 'center'
    const step = labelStep()
    const minMidi = Math.ceil(midiFromFrequency(viewMinFreq))
    const maxMidi = Math.floor(midiFromFrequency(viewMaxFreq))
    for (let midi = minMidi; midi <= maxMidi; midi += step) {
      const freq = 440 * Math.pow(2, (midi - 69) / 12)
      const x = xForFreq(freq)
      ctx.font = peakMidis.has(midi) ? 'bold 13px sans-serif' : '13px sans-serif'
      ctx.fillText(frequencyToNoteName(freq), x, canvas.height - 2)
    }
```

(`ctx.font`'s unconditional `'13px sans-serif'` assignment moves inside the
loop, now chosen per-label based on peak status, instead of being set once
before the loop.)

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Verify manually**

Run: `bin/dev`, open the browser, upload a file, play it.

1. Play a single clear, sustained note and confirm its bar gets a colored
   outline and its label (if shown at the current zoom) goes bold.
2. Confirm quiet/background bars are unaffected.
3. Note (expected, not a bug) that strong harmonics/overtones of a played
   note may also get highlighted — this is the accepted limitation of the
   naive approach.

- [ ] **Step 6: Commit**

```bash
git add src/spectrum.js
git commit -m "Highlight naive note peaks with outlined bars and bold labels"
```

---

## Post-plan

If false-positive harmonics prove distracting in practice, a follow-up
could add harmonic suppression (e.g. discount a bucket's value if a much
stronger bucket exists at half its frequency) before peak-picking — not
part of this plan.

## Post-implementation adjustments (from live testing)

Tuned after trying it against real audio:

- `PEAK_THRESHOLD` raised from the planned 40 to 90 — the original value
  flagged too many quiet/background notes as peaks.
- `PEAK_COLOR` changed from yellow (`#ffe14f`) to a darker green
  (`#388e3c`), through an intermediate brighter green (`#4caf50`).
- Highlight style changed from outlined bar + bold bottom-axis label to a
  **fully green-filled bar** with the note name drawn **directly above the
  bar itself** (not the bottom axis). The bottom-axis bold-label approach
  didn't work in practice — at typical zoom levels `labelStep()` skips
  most notes' bottom labels, so a peak's label was frequently not drawn at
  all regardless of bold styling. Drawing the name unconditionally above
  each peak bar guarantees it's visible regardless of label density.
