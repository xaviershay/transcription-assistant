# Low/High Shelf EQ Bands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 3-band EQ's outer bands (0 and 2) low-shelf/high-shelf filters instead of peaking, keeping the middle band (1) as peaking.

**Architecture:** `eq.js` gains two new pure response-curve functions (`lowShelfResponseDb`, `highShelfResponseDb`, RBJ cookbook formulas) and its existing Q-accumulator functions become parameterized over min/max instead of using fixed module constants, so shelf bands can use a tighter, numerically-safe Q range. `spectrum.js` sets each filter's `type` by position at creation and picks the matching response formula per band when drawing the combined curve.

**Tech Stack:** Same as the rest of the EQ — vanilla JS, Web Audio (`BiquadFilterNode` `lowshelf`/`highshelf` types), vitest for the pure module.

## Global Constraints

- Band types by position, fixed at creation, never changed afterward: band 0 = `'lowshelf'`, band 1 = `'peaking'` (unchanged), band 2 = `'highshelf'`. (Spec: Filter types)
- Shelf response functions verified: at `freq === cornerFreq`, response equals exactly half the set gain (for both boost and cut); far on the shelved side approaches full gain; far on the flat side approaches 0dB. (Spec: Response curve math — already numerically confirmed before this plan was written)
- Shelf bands (0, 2) get Q range `[0.1, 1.8]` — tighter than band 1's `[0.1, 24]` — because the shelf formula's `alpha` term goes NaN above `Q ≈ 1.896` at ±24dB gain (exact threshold computed and confirmed; 1.8 has margin and stays stable across the full Q range crossed with the full ±24dB gain range). This is a real-audio safety constraint, not just a drawing one — `BiquadFilterNode`'s internal shelf implementation uses the same coefficient family. (Spec: Q range safety constraint)
- Drag mechanics, reset button, persistence shape, dot colors — all unchanged. (Spec: Unchanged)

---

## File Structure

- Modify: `src/eq.js` — parameterize accumulator functions; add `MIN_SHELF_Q`/`MAX_SHELF_Q`; add `lowShelfResponseDb`/`highShelfResponseDb`.
- Modify: `src/eq.test.js` — tests for all of the above.
- Modify: `src/spectrum.js` — filter types by position, per-band Q ranges, per-band response formula selection in the combined curve.

---

### Task 1: `eq.js` — parameterize the Q accumulator functions

**Files:**
- Modify: `src/eq.js`
- Modify: `src/eq.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `accumulatorForQ(q, minQ = MIN_Q, maxQ = MAX_Q)`, `qForAccumulator(accumulator, minQ = MIN_Q, maxQ = MAX_Q)`, `updateQAccumulator(accumulator, deltaY, minQ = MIN_Q, maxQ = MAX_Q)` — same names, now accepting optional range overrides. `MIN_SHELF_Q = 0.1`, `MAX_SHELF_Q = 1.8` — new exported constants. Existing callers (band 1, and anywhere calling with no extra args) get identical behavior to before. Task 3's `spectrum.js` change calls these with `MIN_SHELF_Q`/`MAX_SHELF_Q` for bands 0 and 2.

- [ ] **Step 1: Write the failing tests**

Add to `src/eq.test.js`, in the existing `describe('accumulatorForQ / qForAccumulator', ...)` and `describe('updateQAccumulator', ...)` blocks (or alongside them) — add these new `it`s without removing the existing ones (the existing ones prove the default-range behavior is unchanged):

```javascript
import { MIN_SHELF_Q, MAX_SHELF_Q } from './eq.js'
```

(add to the existing `import { MIN_Q, MAX_Q, DEFAULT_Q, accumulatorForQ, qForAccumulator, updateQAccumulator } from './eq.js'` line, or as a separate import line — either is fine)

```javascript
describe('accumulatorForQ / qForAccumulator with a custom range', () => {
  it('round-trips a Q within the custom range', () => {
    const acc = accumulatorForQ(1, MIN_SHELF_Q, MAX_SHELF_Q)
    expect(qForAccumulator(acc, MIN_SHELF_Q, MAX_SHELF_Q)).toBeCloseTo(1, 5)
  })

  it('clamps above the custom max', () => {
    const acc = accumulatorForQ(5, MIN_SHELF_Q, MAX_SHELF_Q)
    expect(qForAccumulator(acc, MIN_SHELF_Q, MAX_SHELF_Q)).toBeCloseTo(MAX_SHELF_Q, 5)
  })

  it('clamps below the custom min', () => {
    const acc = accumulatorForQ(0.001, MIN_SHELF_Q, MAX_SHELF_Q)
    expect(qForAccumulator(acc, MIN_SHELF_Q, MAX_SHELF_Q)).toBeCloseTo(MIN_SHELF_Q, 5)
  })

  it('is path-independent with a custom range: a zero-sum sequence of deltas returns to the same Q', () => {
    let acc = accumulatorForQ(1, MIN_SHELF_Q, MAX_SHELF_Q)
    acc = updateQAccumulator(acc, -5, MIN_SHELF_Q, MAX_SHELF_Q)
    acc = updateQAccumulator(acc, 5, MIN_SHELF_Q, MAX_SHELF_Q)
    expect(qForAccumulator(acc, MIN_SHELF_Q, MAX_SHELF_Q)).toBeCloseTo(1, 5)
  })

  it('omitting the range still behaves exactly as the default MIN_Q/MAX_Q range', () => {
    const acc = accumulatorForQ(1000)
    expect(qForAccumulator(acc)).toBeCloseTo(MAX_Q, 5)
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/eq.test.js`
Expected: FAIL — `MIN_SHELF_Q`/`MAX_SHELF_Q` don't exist yet, and the current functions don't accept extra args (calling them with extra args is harmless in JS, but the custom-range clamping behavior won't be correct since the functions ignore the extra params today).

- [ ] **Step 3: Write the implementation**

Replace:

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

with:

```javascript
export const MIN_Q = 0.1
export const MAX_Q = 24
export const MIN_SHELF_Q = 0.1
export const MAX_SHELF_Q = 1.8
export const DEFAULT_Q = 1
const Q_ZOOM_FACTOR = 1.15

function maxAccumulatorFor(minQ, maxQ) {
  return (100 * Math.log(maxQ / minQ)) / Math.log(Q_ZOOM_FACTOR)
}

export function accumulatorForQ(q, minQ = MIN_Q, maxQ = MAX_Q) {
  const clamped = Math.min(maxQ, Math.max(minQ, q))
  return (100 * Math.log(clamped / minQ)) / Math.log(Q_ZOOM_FACTOR)
}

export function qForAccumulator(accumulator, minQ = MIN_Q, maxQ = MAX_Q) {
  const maxAccumulator = maxAccumulatorFor(minQ, maxQ)
  const clamped = Math.min(maxAccumulator, Math.max(0, accumulator))
  return minQ * Math.pow(Q_ZOOM_FACTOR, clamped / 100)
}

export function updateQAccumulator(accumulator, deltaY, minQ = MIN_Q, maxQ = MAX_Q) {
  const maxAccumulator = maxAccumulatorFor(minQ, maxQ)
  return Math.min(maxAccumulator, Math.max(0, accumulator - deltaY))
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/eq.test.js`
Expected: PASS, all tests green (existing default-range tests still pass unchanged, new custom-range tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/eq.js src/eq.test.js
git commit -m "Parameterize Q accumulator functions over a min/max range"
```

---

### Task 2: `eq.js` — low/high shelf response curve formulas

**Files:**
- Modify: `src/eq.js`
- Modify: `src/eq.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `lowShelfResponseDb(freq, cornerFreq, gainDb, q, sampleRate)`, `highShelfResponseDb(freq, cornerFreq, gainDb, q, sampleRate)`. Task 3's `spectrum.js` change calls these for bands 0 and 2's curve segments.

- [ ] **Step 1: Write the failing tests**

Add to `src/eq.test.js`:

```javascript
import { lowShelfResponseDb, highShelfResponseDb } from './eq.js'
```

```javascript
describe('lowShelfResponseDb', () => {
  it('returns exactly half the set gain at the corner frequency (boost)', () => {
    expect(lowShelfResponseDb(200, 200, 12, 1, 44100)).toBeCloseTo(6, 1)
  })

  it('returns exactly half the set gain at the corner frequency (cut)', () => {
    expect(lowShelfResponseDb(200, 200, -12, 1, 44100)).toBeCloseTo(-6, 1)
  })

  it('approaches the full set gain deep below the corner frequency', () => {
    expect(lowShelfResponseDb(10, 200, 12, 1, 44100)).toBeCloseTo(12, 1)
  })

  it('approaches 0 dB well above the corner frequency', () => {
    expect(lowShelfResponseDb(5000, 200, 12, 1, 44100)).toBeCloseTo(0, 1)
  })

  it('produces finite values across the full Q range crossed with the full gain range', () => {
    for (const q of [0.1, 0.5, 1, 1.5, MAX_SHELF_Q]) {
      for (const gain of [-24, -12, 0, 12, 24]) {
        expect(Number.isFinite(lowShelfResponseDb(200, 200, gain, q, 44100))).toBe(true)
      }
    }
  })
})

describe('highShelfResponseDb', () => {
  it('returns exactly half the set gain at the corner frequency (boost)', () => {
    expect(highShelfResponseDb(3000, 3000, 12, 1, 44100)).toBeCloseTo(6, 1)
  })

  it('returns exactly half the set gain at the corner frequency (cut)', () => {
    expect(highShelfResponseDb(3000, 3000, -12, 1, 44100)).toBeCloseTo(-6, 1)
  })

  it('approaches the full set gain well above the corner frequency', () => {
    expect(highShelfResponseDb(20000, 3000, 12, 1, 44100)).toBeCloseTo(12, 1)
  })

  it('approaches 0 dB deep below the corner frequency', () => {
    expect(highShelfResponseDb(50, 3000, 12, 1, 44100)).toBeCloseTo(0, 1)
  })

  it('produces finite values across the full Q range crossed with the full gain range', () => {
    for (const q of [0.1, 0.5, 1, 1.5, MAX_SHELF_Q]) {
      for (const gain of [-24, -12, 0, 12, 24]) {
        expect(Number.isFinite(highShelfResponseDb(3000, 3000, gain, q, 44100))).toBe(true)
      }
    }
  })
})
```

(`MAX_SHELF_Q` is already imported from Task 1's changes to this test file.)

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/eq.test.js`
Expected: FAIL — `lowShelfResponseDb`/`highShelfResponseDb` don't exist yet.

- [ ] **Step 3: Write the implementation**

Add to `src/eq.js` (standard RBJ Audio EQ Cookbook shelf-filter coefficients, evaluated analytically the same way `peakingResponseDb` already does):

```javascript
export function lowShelfResponseDb(freq, cornerFreq, gainDb, q, sampleRate) {
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * cornerFreq) / sampleRate
  const sqrtA = Math.sqrt(A)
  const alpha = (Math.sin(w0) / 2) * Math.sqrt((A + 1 / A) * (1 / q - 1) + 2)
  const cosw0 = Math.cos(w0)

  const b0 = A * (A + 1 - (A - 1) * cosw0 + 2 * sqrtA * alpha)
  const b1 = 2 * A * (A - 1 - (A + 1) * cosw0)
  const b2 = A * (A + 1 - (A - 1) * cosw0 - 2 * sqrtA * alpha)
  const a0 = A + 1 + (A - 1) * cosw0 + 2 * sqrtA * alpha
  const a1 = -2 * (A - 1 + (A + 1) * cosw0)
  const a2 = A + 1 + (A - 1) * cosw0 - 2 * sqrtA * alpha

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

export function highShelfResponseDb(freq, cornerFreq, gainDb, q, sampleRate) {
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * cornerFreq) / sampleRate
  const sqrtA = Math.sqrt(A)
  const alpha = (Math.sin(w0) / 2) * Math.sqrt((A + 1 / A) * (1 / q - 1) + 2)
  const cosw0 = Math.cos(w0)

  const b0 = A * (A + 1 + (A - 1) * cosw0 + 2 * sqrtA * alpha)
  const b1 = -2 * A * (A - 1 + (A + 1) * cosw0)
  const b2 = A * (A + 1 + (A - 1) * cosw0 - 2 * sqrtA * alpha)
  const a0 = A + 1 - (A - 1) * cosw0 + 2 * sqrtA * alpha
  const a1 = 2 * (A - 1 - (A + 1) * cosw0)
  const a2 = A + 1 - (A - 1) * cosw0 - 2 * sqrtA * alpha

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
git commit -m "Add low/high shelf response curve formulas"
```

---

### Task 3: `spectrum.js` — wire shelf types into the audio graph and rendering

**Files:**
- Modify: `src/spectrum.js`

**Interfaces:**
- Consumes: `MIN_SHELF_Q`, `MAX_SHELF_Q` (Task 1), `lowShelfResponseDb`, `highShelfResponseDb` (Task 2).
- Produces: fully working shelf bands. Last task for this plan.

- [ ] **Step 1: Import the new exports and add band-type/range constants**

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
  defaultEqBands,
} from './eq.js'
```

to:

```javascript
import {
  gainToY,
  yToGain,
  peakingResponseDb,
  lowShelfResponseDb,
  highShelfResponseDb,
  isNearDot,
  qForAccumulator,
  updateQAccumulator,
  accumulatorForQ,
  defaultEqBands,
  MIN_Q,
  MAX_Q,
  MIN_SHELF_Q,
  MAX_SHELF_Q,
} from './eq.js'
```

Add near the other constants:

```javascript
const BAND_TYPES = ['lowshelf', 'peaking', 'highshelf']
const BAND_Q_RANGES = [
  [MIN_SHELF_Q, MAX_SHELF_Q],
  [MIN_Q, MAX_Q],
  [MIN_SHELF_Q, MAX_SHELF_Q],
]

function responseDbForBand(index, freq, filter, sampleRate) {
  if (BAND_TYPES[index] === 'lowshelf') {
    return lowShelfResponseDb(freq, filter.frequency.value, filter.gain.value, filter.Q.value, sampleRate)
  }
  if (BAND_TYPES[index] === 'highshelf') {
    return highShelfResponseDb(freq, filter.frequency.value, filter.gain.value, filter.Q.value, sampleRate)
  }
  return peakingResponseDb(freq, filter.frequency.value, filter.gain.value, filter.Q.value, sampleRate)
}
```

- [ ] **Step 2: Set filter type by position**

Change:

```javascript
  const filters = defaultEqBands().map(({ freq, gain, q }) => {
    const node = audioCtx.createBiquadFilter()
    node.type = 'peaking'
    node.frequency.value = freq
    node.gain.value = gain
    node.Q.value = q
    return node
  })
```

to:

```javascript
  const filters = defaultEqBands().map(({ freq, gain, q }, i) => {
    const node = audioCtx.createBiquadFilter()
    node.type = BAND_TYPES[i]
    node.frequency.value = freq
    node.gain.value = gain
    node.Q.value = q
    return node
  })
```

- [ ] **Step 3: Use per-band Q range for the initial accumulators**

Change:

```javascript
  let qAccumulators = filters.map((f) => accumulatorForQ(f.Q.value))
```

to:

```javascript
  let qAccumulators = filters.map((f, i) => accumulatorForQ(f.Q.value, ...BAND_Q_RANGES[i]))
```

- [ ] **Step 4: Use per-band Q range in the wheel handler**

Change:

```javascript
      if (hoveredIndex !== null) {
        qAccumulators[hoveredIndex] = updateQAccumulator(qAccumulators[hoveredIndex], e.deltaY)
        filters[hoveredIndex].Q.value = qForAccumulator(qAccumulators[hoveredIndex])
        onEqChange?.()
```

to:

```javascript
      if (hoveredIndex !== null) {
        const [minQ, maxQ] = BAND_Q_RANGES[hoveredIndex]
        qAccumulators[hoveredIndex] = updateQAccumulator(qAccumulators[hoveredIndex], e.deltaY, minQ, maxQ)
        filters[hoveredIndex].Q.value = qForAccumulator(qAccumulators[hoveredIndex], minQ, maxQ)
        onEqChange?.()
```

- [ ] **Step 5: Use per-band Q range in `setEqState`**

Change:

```javascript
  function setEqState(bands) {
    bands.forEach((band, i) => {
      filters[i].frequency.value = band.freq
      filters[i].gain.value = band.gain
      filters[i].Q.value = band.q
      qAccumulators[i] = accumulatorForQ(band.q)
    })
  }
```

to:

```javascript
  function setEqState(bands) {
    bands.forEach((band, i) => {
      filters[i].frequency.value = band.freq
      filters[i].gain.value = band.gain
      filters[i].Q.value = band.q
      qAccumulators[i] = accumulatorForQ(band.q, ...BAND_Q_RANGES[i])
    })
  }
```

- [ ] **Step 6: Use per-band response formula in the combined curve**

Change:

```javascript
      const responseDb = filters.reduce(
        (sum, f) => sum + peakingResponseDb(freq, f.frequency.value, f.gain.value, f.Q.value, audioCtx.sampleRate),
        0,
      )
```

to:

```javascript
      const responseDb = filters.reduce(
        (sum, f, i) => sum + responseDbForBand(i, freq, f, audioCtx.sampleRate),
        0,
      )
```

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 8: Verify manually**

Run: `bin/dev`, open the browser, upload a file, play it.

1. Confirm band 0's dot/curve now looks like a shelf (flat below its frequency, rolling toward 0dB above it) rather than a symmetric bell.
2. Confirm band 2's curve is a mirrored shelf (flat above its frequency, rolling toward 0dB below it).
3. Confirm band 1 (middle) is still a bell, unchanged.
4. Drag each band and confirm audio changes accordingly (bands 0/2 now audibly cut/boost everything on one side of their frequency, not just a narrow region).
5. Scroll on band 0 or 2 to adjust Q — confirm it stops widening/narrowing further once it hits the tighter ceiling (rather than continuing to look like band 1's range).
6. Click "Reset EQ" — confirm all three bands return to their defaults and shapes (shelf/bell/shelf) are still correct after reset.
7. Reload the page, re-upload the same file — confirm persisted shelf-band settings restore correctly.

- [ ] **Step 9: Commit**

```bash
git add src/spectrum.js
git commit -m "Make outer EQ bands low/high shelf filters instead of peaking"
```

---

## Post-plan

None planned — but see the correction below, found by final review after
all 3 tasks were implemented and individually approved.

## Correction: shelf bands have no adjustable Q (found in final review)

The final whole-branch review — and an independent check against MDN's
`BiquadFilterNode` docs — found that Web Audio ignores `Q` entirely for
`lowshelf`/`highshelf` filter types (fixed shelf slope, `S = 1`,
regardless of the `Q` value set). This invalidated the premise behind
Task 1 (the min/max-range parameterization) and part of Task 3 (per-band
Q ranges, wheel-adjust-Q on shelf bands): the drawn curve was using `Q`
while the real audio never did, diverging by up to ~9dB or going
off-canvas at extremes. A related bug: `setEqState` wrote persisted `Q`
to the filter node unclamped, so a value saved back when band 0 was still
peaking (scrollable to 24) produced `NaN` in the shelf formula on load and
silently blanked the entire curve.

Fixed in one follow-up commit after the final review:

- `responseDbForBand` in `spectrum.js` now always evaluates shelf bands'
  curves at a fixed `q = 1`, matching real filter behavior, never
  `filter.Q.value`.
- The wheel handler only adjusts Q when hovering the peaking band (band
  1); hovering a shelf band's dot now falls through to zoom/pan instead
  of silently doing nothing.
- Task 1's accumulator-function parameterization (`minQ`/`maxQ` params)
  is reverted — `accumulatorForQ`/`qForAccumulator`/`updateQAccumulator`
  are back to their pre-Task-1 unparameterized form, and
  `MIN_SHELF_Q`/`MAX_SHELF_Q`/`BAND_Q_RANGES` are removed entirely, since
  there's no longer a second Q range to parameterize for.
- `setEqState` now derives `filters[i].Q.value` from the clamped
  accumulator round-trip instead of writing raw persisted `band.q`, and
  clamps `gain` via the existing `clampGain()` — for all three bands, not
  just the shelf ones, closing the unclamped-persisted-data class of bug
  generally.

See `docs/superpowers/specs/2026-07-26-eq-shelf-bands-design.md`'s
matching "Correction" section for the full writeup.
