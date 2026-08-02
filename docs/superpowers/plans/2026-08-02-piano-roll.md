# Piano Roll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wavesurfer-plugin-based spectrogram with a hand-built piano-roll view: frequency horizontal (quantized to semitone columns, C2–C7), time vertical, synced to the waveform's visible time window, with peak-note highlighting instead of a raw heatmap.

**Architecture:** A new generator in `onsets.js` yields per-frame FFT magnitude spectra, reusing the existing private `fft`/`hannWindow`. A new module, `pianoRoll.js`, buckets each frame into semitones (reusing `spectrum-bars.js`'s existing `computeNoteBuckets`/`computePeakMidis` unmodified — both already operate generically on any indexable numeric array), normalizes every bucket to a byte value relative to the track's own peak (fixing the previous plugin's fixed-gain saturation problem), and renders whichever time-slice is currently visible. `main.js` computes the whole track's data once on load and redraws only the visible slice on every `wavesurfer` `scroll`/`redraw` event — no per-interaction recomputation.

**Tech Stack:** Vanilla JS, Canvas 2D, vitest for the pure modules. No new dependencies — this removes the `wavesurfer.js/plugins/spectrogram` dependency usage (the plugin's own code stays in `node_modules` since `wavesurfer.js` itself is still used, but nothing in this app's source calls into the Spectrogram plugin anymore after this plan).

## Global Constraints

- Frequency range is C2–C7, MIDI 36–96, expressed as constants (`PIANO_ROLL_MIN_MIDI`/`PIANO_ROLL_MAX_MIDI`) that are the single source of truth — frequencies (`PIANO_ROLL_MIN_FREQ`/`PIANO_ROLL_MAX_FREQ`) are derived from them via `frequencyFromMidi`, never hardcoded separately. (Spec: Range)
- `computeNoteBuckets`/`computePeakMidis` (in `spectrum-bars.js`) are **not modified** — both already work generically on any indexable numeric array (plain `[]` access), so they're reused as-is on raw `Float32Array` magnitudes first, then again on byte-converted values after normalization. (Spec: Semitone bucketing)
- `computeSpectralFlux` (in `onsets.js`) is **not modified or refactored** to share the new generator — it has its own inlined per-bin accumulation in the same loop, and touching an already-shipped, tested function for a marginal DRY gain isn't worth the risk. The small duplication between it and the new generator is a deliberate, accepted tradeoff. (Spec: Per-frame magnitude spectra)
- The whole track is computed exactly once (on `wavesurfer`'s `ready` event) — every `scroll`/`redraw` event only re-slices and redraws already-computed data, never recomputes the FFT. (Spec: Sync behavior)
- No per-cell text labels on peak highlights — the horizontal note-name axis is always visible and tells you which note a highlighted cell is; repeating that as text on every row of a sustained note would be clutter. (Spec: Rendering)
- No new test infrastructure. `iterateMagnitudeFrames`, `magnitudeToByte`, `computeSpectrogramFrames`, and `frameRangeForTime` get real unit tests; `drawPianoRollSlice`/`drawPianoRollLabels` and all `main.js`/markup/CSS wiring stay untested, matching this codebase's existing canvas/DOM convention. (Spec: Testing)

---

## File Structure

- Modify: `src/onsets.js` / `src/onsets.test.js` — new `iterateMagnitudeFrames` generator, export `HOP_SIZE`.
- Create: `src/pianoRoll.js` / `src/pianoRoll.test.js` — computation (`computeSpectrogramFrames`, `magnitudeToByte`) and rendering (`frameRangeForTime`, `drawPianoRollSlice`, `drawPianoRollLabels`) plus the `PIANO_ROLL_MIN_MIDI`/`MAX_MIDI`/`MIN_FREQ`/`MAX_FREQ` constants.
- Delete: `src/spectrogramLabels.js`, `src/spectrogramLabels.test.js` — superseded, nothing reused.
- Modify: `src/waveform.js` — remove `SpectrogramPlugin` entirely, revert to pre-spectrogram signature.
- Modify: `index.html` — remove `#spectrogram-section`; add `#piano-roll-section`.
- Modify: `src/style.css` — remove old spectrogram rules; add new piano-roll rules.
- Modify: `src/main.js` — remove all spectrogram-plugin wiring; add piano-roll compute-once + redraw-on-scroll/redraw wiring.

---

### Task 1: `onsets.js` — per-frame magnitude spectra generator

**Files:**
- Modify: `src/onsets.js`
- Modify: `src/onsets.test.js`

**Interfaces:**
- Consumes: nothing new (reuses existing private `fft`/`hannWindow`/`FFT_SIZE`/`HOP_SIZE`).
- Produces: `export function* iterateMagnitudeFrames(samples, { fftSize = FFT_SIZE, hopSize = HOP_SIZE } = {})` — yields one `Float32Array` (length `fftSize / 2`) per STFT frame. Also exports `HOP_SIZE` (previously private) for Task 2 to bundle into its return value. Task 2's `computeSpectrogramFrames` consumes both.

- [ ] **Step 1: Write the failing tests**

Add to `src/onsets.test.js` (this file already has a local `tone(freq, seconds, amplitude)` helper and `SAMPLE_RATE` constant at the top — reuse them, don't redefine):

```javascript
import { mixToMono, computeSpectralFlux, pickOnsets, detectOnsets, iterateMagnitudeFrames } from './onsets.js'
```

```javascript
describe('iterateMagnitudeFrames', () => {
  it('yields one Float32Array per frame, each of length fftSize/2', () => {
    const signal = tone(440, 0.2)
    const frames = [...iterateMagnitudeFrames(signal)]
    expect(frames.length).toBeGreaterThan(0)
    for (const frame of frames) {
      expect(frame).toBeInstanceOf(Float32Array)
      expect(frame.length).toBe(1024) // default FFT_SIZE (2048) / 2
    }
  })

  it('places the loudest bin near the expected frequency for a pure tone', () => {
    const freq = 440
    const signal = tone(freq, 0.2)
    const frames = [...iterateMagnitudeFrames(signal)]
    const midFrame = frames[Math.floor(frames.length / 2)]
    let peakBin = 0
    for (let i = 1; i < midFrame.length; i++) {
      if (midFrame[i] > midFrame[peakBin]) peakBin = i
    }
    const binHz = SAMPLE_RATE / 2048 // default fftSize
    expect(Math.abs(peakBin * binHz - freq)).toBeLessThan(binHz)
  })

  it('respects a custom fftSize/hopSize', () => {
    const signal = tone(440, 0.2)
    const frames = [...iterateMagnitudeFrames(signal, { fftSize: 512, hopSize: 256 })]
    expect(frames[0].length).toBe(256)
  })

  it('yields zero frames for a signal shorter than one fftSize window', () => {
    const frames = [...iterateMagnitudeFrames(new Float32Array(100))]
    expect(frames).toEqual([])
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/onsets.test.js`
Expected: FAIL — `iterateMagnitudeFrames` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Change:

```javascript
const FFT_SIZE = 2048
const HOP_SIZE = 512
```

to:

```javascript
export const FFT_SIZE = 2048
export const HOP_SIZE = 512
```

Add, anywhere after the private `fft`/`hannWindow` function definitions (e.g. right before `computeSpectralFlux`):

```javascript
export function* iterateMagnitudeFrames(samples, { fftSize = FFT_SIZE, hopSize = HOP_SIZE } = {}) {
  const window = hannWindow(fftSize)
  const numFrames = Math.max(0, Math.floor((samples.length - fftSize) / hopSize) + 1)
  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * hopSize
    const real = new Float64Array(fftSize)
    const imag = new Float64Array(fftSize)
    for (let i = 0; i < fftSize; i++) {
      real[i] = samples[offset + i] * window[i]
    }
    fft(real, imag)
    const magnitudes = new Float32Array(fftSize / 2)
    for (let bin = 0; bin < fftSize / 2; bin++) {
      magnitudes[bin] = Math.hypot(real[bin], imag[bin])
    }
    yield magnitudes
  }
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/onsets.test.js`
Expected: PASS, all tests green (including the pre-existing ones — this is a pure addition, nothing existing was changed).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/onsets.js src/onsets.test.js
git commit -m "Add iterateMagnitudeFrames generator for per-frame FFT magnitude spectra"
```

---

### Task 2: `pianoRoll.js` — whole-track computation

**Files:**
- Create: `src/pianoRoll.js`
- Create: `src/pianoRoll.test.js`

**Interfaces:**
- Consumes: `iterateMagnitudeFrames`, `HOP_SIZE` (Task 1, from `onsets.js`); `computeNoteBuckets`, `computePeakMidis` (from `spectrum-bars.js`, unmodified); `frequencyFromMidi` (from `notes.js`).
- Produces: `PIANO_ROLL_MIN_MIDI`, `PIANO_ROLL_MAX_MIDI`, `PIANO_ROLL_MIN_FREQ`, `PIANO_ROLL_MAX_FREQ`, `magnitudeToByte(magnitude, peakMagnitude)`, `computeSpectrogramFrames(samples, sampleRate, minFreq, maxFreq)` → `{ frames, hopSize, sampleRate }` where each entry in `frames` is `{ buckets, peakMidis }` (`buckets` is `computeNoteBuckets`'s array shape with byte-scaled `.value`; `peakMidis` is a `Set`). Task 3 adds rendering functions to this same file; Task 5's `main.js` consumes all of the above.

- [ ] **Step 1: Write the failing tests**

Create `src/pianoRoll.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { magnitudeToByte, computeSpectrogramFrames, PIANO_ROLL_MIN_FREQ, PIANO_ROLL_MAX_FREQ } from './pianoRoll.js'

const SAMPLE_RATE = 44100

function tone(freq, seconds) {
  const n = Math.round(seconds * SAMPLE_RATE)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE)
  }
  return out
}

describe('magnitudeToByte', () => {
  it('maps the peak magnitude itself to 255', () => {
    expect(magnitudeToByte(10, 10)).toBe(255)
  })

  it('maps digital silence (0) to 0', () => {
    expect(magnitudeToByte(0, 10)).toBe(0)
  })

  it('maps a magnitude at the -80dB floor to 0', () => {
    const peak = 1
    const atFloor = peak * Math.pow(10, -80 / 20)
    expect(magnitudeToByte(atFloor, peak)).toBe(0)
  })

  it('maps -40dB (half the default floor) to roughly half scale', () => {
    const peak = 1
    const midpoint = peak * Math.pow(10, -40 / 20)
    expect(magnitudeToByte(midpoint, peak)).toBeCloseTo(127.5, 0)
  })

  it('returns 0 when peakMagnitude is 0, rather than NaN/-Infinity from log(0)', () => {
    expect(magnitudeToByte(5, 0)).toBe(0)
  })
})

describe('computeSpectrogramFrames', () => {
  it('returns frames/hopSize/sampleRate', () => {
    const signal = tone(261.63, 0.3)
    const result = computeSpectrogramFrames(signal, SAMPLE_RATE, PIANO_ROLL_MIN_FREQ, PIANO_ROLL_MAX_FREQ)
    expect(result.hopSize).toBeGreaterThan(0)
    expect(result.sampleRate).toBe(SAMPLE_RATE)
    expect(result.frames.length).toBeGreaterThan(0)
  })

  it('every frame has a buckets array and a peakMidis Set', () => {
    const signal = tone(261.63, 0.3)
    const { frames } = computeSpectrogramFrames(signal, SAMPLE_RATE, PIANO_ROLL_MIN_FREQ, PIANO_ROLL_MAX_FREQ)
    for (const frame of frames) {
      expect(Array.isArray(frame.buckets)).toBe(true)
      expect(frame.peakMidis).toBeInstanceOf(Set)
    }
  })

  it('registers strong energy at C4 (midi 60) for a pure 261.63Hz tone', () => {
    const signal = tone(261.63, 0.3)
    const { frames } = computeSpectrogramFrames(signal, SAMPLE_RATE, PIANO_ROLL_MIN_FREQ, PIANO_ROLL_MAX_FREQ)
    const midFrame = frames[Math.floor(frames.length / 2)]
    const c4Bucket = midFrame.buckets.find((b) => b.midi === 60)
    expect(c4Bucket).toBeDefined()
    expect(c4Bucket.value).toBeGreaterThan(200) // near the peak byte value (255), since this tone dominates the track
  })
})
```

(If the third `computeSpectrogramFrames` test is flaky due to FFT spectral leakage landing the loudest single bucket on an adjacent semitone rather than exactly midi 60, that's a real signal to loosen the assertion — e.g. check the value is high rather than requiring it be the strict local-maximum `peakMidis` member — not a sign the implementation is wrong. Adjust if needed after actually running it.)

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/pianoRoll.test.js`
Expected: FAIL — `src/pianoRoll.js` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/pianoRoll.js`:

```javascript
import { computeNoteBuckets, computePeakMidis } from './spectrum-bars.js'
import { iterateMagnitudeFrames, HOP_SIZE } from './onsets.js'
import { frequencyFromMidi } from './notes.js'

export const PIANO_ROLL_MIN_MIDI = 36 // C2
export const PIANO_ROLL_MAX_MIDI = 96 // C7
export const PIANO_ROLL_MIN_FREQ = frequencyFromMidi(PIANO_ROLL_MIN_MIDI)
export const PIANO_ROLL_MAX_FREQ = frequencyFromMidi(PIANO_ROLL_MAX_MIDI)

const PEAK_THRESHOLD = 90
const DB_FLOOR = -80 // dB below the track's single loudest bucket; quieter maps to 0

export function magnitudeToByte(magnitude, peakMagnitude) {
  if (peakMagnitude <= 0 || magnitude <= 0) return 0
  const db = 20 * Math.log10(magnitude / peakMagnitude)
  return Math.round(255 * Math.max(0, (db - DB_FLOOR) / -DB_FLOOR))
}

export function computeSpectrogramFrames(samples, sampleRate, minFreq, maxFreq) {
  const rawFrames = []
  let peakMagnitude = 0

  for (const magnitudes of iterateMagnitudeFrames(samples)) {
    const binHz = sampleRate / (magnitudes.length * 2)
    const buckets = computeNoteBuckets(magnitudes, binHz, minFreq, maxFreq)
    for (const bucket of buckets) {
      if (bucket.value > peakMagnitude) peakMagnitude = bucket.value
    }
    rawFrames.push(buckets)
  }

  const frames = rawFrames.map((buckets) => {
    const scaledBuckets = buckets.map((bucket) => ({
      ...bucket,
      value: magnitudeToByte(bucket.value, peakMagnitude),
    }))
    return { buckets: scaledBuckets, peakMidis: new Set(computePeakMidis(scaledBuckets, PEAK_THRESHOLD)) }
  })

  return { frames, hopSize: HOP_SIZE, sampleRate }
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/pianoRoll.test.js`
Expected: PASS, all tests green. If the "strong energy at C4" test needs loosening per the note in Step 1, do that now and re-run until green.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/pianoRoll.js src/pianoRoll.test.js
git commit -m "Add pianoRoll.js: whole-track semitone bucketing with peak-relative normalization"
```

---

### Task 3: `pianoRoll.js` — rendering and time-to-frame mapping

**Files:**
- Modify: `src/pianoRoll.js`
- Modify: `src/pianoRoll.test.js`

**Interfaces:**
- Consumes: `noteNameFromMidi`, `labelStep` (from `notes.js`); `PIANO_ROLL_MIN_MIDI`/`MAX_MIDI` (Task 2, same file).
- Produces: `frameRangeForTime(startTime, endTime, hopSize, sampleRate, totalFrames)` → `{ startFrame, endFrame }`; `drawPianoRollSlice(canvas, frames, startFrame, endFrame, minMidi, maxMidi)`; `drawPianoRollLabels(canvas, minMidi, maxMidi)`. Task 5's `main.js` calls all three.

- [ ] **Step 1: Write the failing tests**

Add to `src/pianoRoll.test.js`:

```javascript
import { frameRangeForTime } from './pianoRoll.js'
```

```javascript
describe('frameRangeForTime', () => {
  it('maps a time range to the corresponding frame index range', () => {
    const { startFrame, endFrame } = frameRangeForTime(1, 2, 512, 44100, 1000)
    expect(startFrame).toBe(Math.floor((1 * 44100) / 512))
    expect(endFrame).toBe(Math.ceil((2 * 44100) / 512))
  })

  it('clamps startFrame to 0 for a negative start time', () => {
    const { startFrame } = frameRangeForTime(-5, 1, 512, 44100, 1000)
    expect(startFrame).toBe(0)
  })

  it('clamps endFrame to totalFrames - 1', () => {
    const { endFrame } = frameRangeForTime(0, 9999, 512, 44100, 100)
    expect(endFrame).toBe(99)
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/pianoRoll.test.js`
Expected: FAIL — `frameRangeForTime` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Add to `src/pianoRoll.js` — first, add the two new imports to the existing import line:

```javascript
import { computeNoteBuckets, computePeakMidis } from './spectrum-bars.js'
import { iterateMagnitudeFrames, HOP_SIZE } from './onsets.js'
import { frequencyFromMidi, noteNameFromMidi, labelStep } from './notes.js'
```

Then append:

```javascript
const BACKGROUND_COLOR = '#121212'
const PEAK_COLOR = '#388e3c'
const BAR_COLOR_RGB = '79, 109, 245' // #4f6df5
const LABEL_COLOR = '#f0f0f0'

export function frameRangeForTime(startTime, endTime, hopSize, sampleRate, totalFrames) {
  const startFrame = Math.max(0, Math.floor((startTime * sampleRate) / hopSize))
  const endFrame = Math.min(totalFrames - 1, Math.ceil((endTime * sampleRate) / hopSize))
  return { startFrame, endFrame }
}

export function drawPianoRollSlice(canvas, frames, startFrame, endFrame, minMidi, maxMidi) {
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = BACKGROUND_COLOR
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const numColumns = maxMidi - minMidi + 1
  const colWidth = canvas.width / numColumns
  const numRows = endFrame - startFrame + 1
  const rowHeight = canvas.height / numRows

  for (let f = startFrame; f <= endFrame; f++) {
    const frame = frames[f]
    if (!frame) continue
    const y = (f - startFrame) * rowHeight
    for (const bucket of frame.buckets) {
      if (bucket.midi < minMidi || bucket.midi > maxMidi) continue
      const x = (bucket.midi - minMidi) * colWidth
      ctx.fillStyle = frame.peakMidis.has(bucket.midi) ? PEAK_COLOR : `rgba(${BAR_COLOR_RGB}, ${bucket.value / 255})`
      ctx.fillRect(x, y, colWidth, rowHeight)
    }
  }
}

export function drawPianoRollLabels(canvas, minMidi, maxMidi) {
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = BACKGROUND_COLOR
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = LABEL_COLOR
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const numColumns = maxMidi - minMidi + 1
  const colWidth = canvas.width / numColumns
  const step = labelStep(numColumns, canvas.width)
  for (let midi = minMidi; midi <= maxMidi; midi += step) {
    const x = (midi - minMidi + 0.5) * colWidth
    ctx.fillText(noteNameFromMidi(midi), x, canvas.height / 2)
  }
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/pianoRoll.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/pianoRoll.js src/pianoRoll.test.js
git commit -m "Add piano roll rendering and time-to-frame mapping"
```

---

### Task 4: Remove the old plugin-based spectrogram

**Files:**
- Delete: `src/spectrogramLabels.js`
- Delete: `src/spectrogramLabels.test.js`
- Modify: `src/waveform.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `createWaveSurfer(container)` reverted to its pre-spectrogram signature, returning `{ wavesurfer, regions }`. Task 5's `main.js` updates its call site to match.

- [ ] **Step 1: Delete the superseded files**

```bash
git rm src/spectrogramLabels.js src/spectrogramLabels.test.js
```

- [ ] **Step 2: Revert `waveform.js`**

Change:

```javascript
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import SpectrogramPlugin from 'wavesurfer.js/plugins/spectrogram'
import { frequencyFromMidi } from './notes.js'

export const SPECTROGRAM_MIN_FREQ = frequencyFromMidi(36) // C2
export const SPECTROGRAM_MAX_FREQ = frequencyFromMidi(72) // C5

export function createWaveSurfer(container, spectrogramContainer) {
  const regions = RegionsPlugin.create()
  const spectrogram = SpectrogramPlugin.create({
    container: spectrogramContainer,
    height: 400,
    labels: false,
    scale: 'logarithmic',
    frequencyMin: SPECTROGRAM_MIN_FREQ,
    frequencyMax: SPECTROGRAM_MAX_FREQ,
    colorMap: 'roseus',
    useWebWorker: true,
    // useWebWorker's whole point is to avoid blocking the main thread on long
    // tracks - the plugin's default fallbackToMainThread (true) would silently
    // redo the FFT on the main thread (with just a console.warn) if the worker
    // fails or times out, defeating that and swallowing the failure so the
    // 'error' handler below never fires for it.
    fallbackToMainThread: false,
  })

  const wavesurfer = WaveSurfer.create({
    container,
    waveColor: '#4f6df5',
    progressColor: '#8ea0ff',
    cursorColor: 'currentColor',
    height: 120,
    minPxPerSec: 50,
    sampleRate: 44100,
    plugins: [regions, spectrogram],
  })

  return { wavesurfer, regions, spectrogram }
}
```

to:

```javascript
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'

export function createWaveSurfer(container) {
  const regions = RegionsPlugin.create()

  const wavesurfer = WaveSurfer.create({
    container,
    waveColor: '#4f6df5',
    progressColor: '#8ea0ff',
    cursorColor: 'currentColor',
    height: 120,
    minPxPerSec: 50,
    sampleRate: 44100,
    plugins: [regions],
  })

  return { wavesurfer, regions }
}
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: FAIL at this point — `main.js` still imports `SPECTROGRAM_MIN_FREQ`/`SPECTROGRAM_MAX_FREQ` from `waveform.js` and `drawSpectrogramLabels` from the now-deleted `spectrogramLabels.js`, and still calls `createWaveSurfer(waveformContainer, spectrogramContainer)` with two arguments. This is expected and will be fixed in Task 5 — do not attempt to fix `main.js` in this task; it's a separate task specifically so `main.js`'s large diff is reviewed on its own.

Note: since `npm test` (vitest) doesn't execute `main.js` directly (it has no test file and isn't imported by any test), this failure won't actually show up as a vitest failure — `npm test` should still pass. The broken state is real but only surfaces at runtime (`bin/dev`) or at build time (`vite build`). Run `npm test` anyway to confirm the parts that ARE covered (all the modules touched by Tasks 1-3) still pass.

- [ ] **Step 4: Commit**

```bash
git add -u src/waveform.js
git commit -m "Remove wavesurfer Spectrogram plugin and its note-label canvas"
```

---

### Task 5: Wire up the piano roll in `main.js`, `index.html`, and `style.css`

**Files:**
- Modify: `index.html`
- Modify: `src/style.css`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `computeSpectrogramFrames`, `frameRangeForTime`, `drawPianoRollSlice`, `drawPianoRollLabels`, `PIANO_ROLL_MIN_MIDI`, `PIANO_ROLL_MAX_MIDI`, `PIANO_ROLL_MIN_FREQ`, `PIANO_ROLL_MAX_FREQ` (Tasks 2-3, `pianoRoll.js`); `createWaveSurfer(container)` (Task 4, `waveform.js`).
- Produces: fully working piano roll. Last task for this plan.

- [ ] **Step 1: Update the markup**

In `index.html`, change:

```html
      <section id="spectrogram-section">
        <canvas id="spectrogram-labels" width="55" height="400"></canvas>
        <div id="spectrogram"></div>
      </section>
```

to:

```html
      <section id="piano-roll-section">
        <canvas id="piano-roll" height="400"></canvas>
        <canvas id="piano-roll-labels" height="24"></canvas>
      </section>
```

- [ ] **Step 2: Update the CSS**

In `src/style.css`, change:

```css
#spectrogram-section {
  display: flex;
  align-items: stretch;
  margin-block: 0.5rem;
}

#spectrogram-labels {
  flex-shrink: 0;
  display: block;
  align-self: flex-start;
  margin-block: 1px;
}

#spectrogram {
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  overflow: hidden;
  flex: 1;
  min-width: 0;
}
```

to:

```css
#piano-roll-section {
  margin-block: 0.5rem;
}

#piano-roll {
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  display: block;
  width: 100%;
  box-sizing: border-box;
}

#piano-roll-labels {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin-block-start: 0.25rem;
}
```

- [ ] **Step 3: Update `main.js`'s imports and DOM handles**

Change:

```javascript
import './style.css'
import { createWaveSurfer, SPECTROGRAM_MIN_FREQ, SPECTROGRAM_MAX_FREQ } from './waveform.js'
import { drawSpectrogramLabels } from './spectrogramLabels.js'
import TimelinePlugin from 'wavesurfer.js/plugins/timeline'
import { createSpectrumAnalyser } from './spectrum.js'
import { sortRegionsByStart, getAdjacentRegionId } from './selections.js'
import { renderSelectionsList } from './selectionsList.js'
import { mixToMono, computeSpectralFlux, pickOnsets } from './onsets.js'
import { computePeakGain, applyGain, encodeWav } from './normalize.js'
```

to:

```javascript
import './style.css'
import { createWaveSurfer } from './waveform.js'
import TimelinePlugin from 'wavesurfer.js/plugins/timeline'
import { createSpectrumAnalyser } from './spectrum.js'
import { sortRegionsByStart, getAdjacentRegionId } from './selections.js'
import { renderSelectionsList } from './selectionsList.js'
import { mixToMono, computeSpectralFlux, pickOnsets } from './onsets.js'
import { computePeakGain, applyGain, encodeWav } from './normalize.js'
import {
  computeSpectrogramFrames,
  frameRangeForTime,
  drawPianoRollSlice,
  drawPianoRollLabels,
  PIANO_ROLL_MIN_MIDI,
  PIANO_ROLL_MAX_MIDI,
  PIANO_ROLL_MIN_FREQ,
  PIANO_ROLL_MAX_FREQ,
} from './pianoRoll.js'
```

Change:

```javascript
const uploadInput = document.getElementById('upload')
const uploadFilename = document.getElementById('upload-filename')
const waveformContainer = document.getElementById('waveform')
const spectrogramContainer = document.getElementById('spectrogram')
const playPauseBtn = document.getElementById('play-pause')
const spectrumCanvas = document.getElementById('spectrum')
let spectrumAnalyser = null

const { wavesurfer, regions, spectrogram } = createWaveSurfer(waveformContainer, spectrogramContainer)

drawSpectrogramLabels(document.getElementById('spectrogram-labels'), SPECTROGRAM_MIN_FREQ, SPECTROGRAM_MAX_FREQ)

spectrogram.on('error', (error) => {
  showToast(`Could not render spectrogram: ${error.message}`)
})

// SpectrogramPlugin (and the newer WindowedSpectrogramPlugin) only stay in
// sync with the waveform on zoom - pan and playback's auto-follow-the-playhead
// scrolling leave it frozen on whatever was rendered at the last zoom change,
// even though wavesurfer's own 'scroll' event fires correctly. Verified this
// is a real gap in both plugin variants (not a config issue) via direct
// browser testing - see docs/superpowers/specs/2026-08-02-spectrogram-view-design.md's
// "Correction" section. Driving the plugin's container position manually
// from wavesurfer's own scroll state is the confirmed fix.
//
// The moving element is memoized on first lookup - the plugin builds this DOM
// once and never rebuilds it, so re-walking it on every 'scroll' event (which
// fires at animation-frame rate while playback is following the playhead)
// is wasted work. Resolved structurally rather than by comparing canvas.width
// (a devicePixelRatio-scaled bitmap width for some canvases) to clientWidth
// (CSS pixels): per SpectrogramPlugin's source, it appends a wrapper div to
// this container, then a canvasContainer div to the wrapper, then each content
// canvas segment to canvasContainer - so content canvases sit three levels
// below spectrogramContainer. (The plugin can also append its own frequency-labels
// canvas two levels below, directly on the wrapper, but only when its `labels`
// option is true - this app sets `labels: false` and draws its own label canvas
// instead, so that node doesn't exist here and this depth check only ever
// matches a content canvas, whose parent (canvasContainer) is what actually
// needs to move.)
let spectrogramCanvasContainer = null

function syncSpectrogramScroll() {
  if (!spectrogramCanvasContainer) {
    const canvas = [...spectrogramContainer.querySelectorAll('canvas')].find(
      (c) => c.parentElement?.parentElement?.parentElement === spectrogramContainer,
    )
    spectrogramCanvasContainer = canvas ? canvas.parentElement : null
  }
  if (spectrogramCanvasContainer) {
    spectrogramCanvasContainer.style.transform = `translateX(${-wavesurfer.getScroll()}px)`
  }
}
wavesurfer.on('scroll', syncSpectrogramScroll)
wavesurfer.on('redraw', syncSpectrogramScroll)
```

to:

```javascript
const uploadInput = document.getElementById('upload')
const uploadFilename = document.getElementById('upload-filename')
const waveformContainer = document.getElementById('waveform')
const playPauseBtn = document.getElementById('play-pause')
const spectrumCanvas = document.getElementById('spectrum')
let spectrumAnalyser = null

const { wavesurfer, regions } = createWaveSurfer(waveformContainer)

const pianoRollCanvas = document.getElementById('piano-roll')
const pianoRollLabelsCanvas = document.getElementById('piano-roll-labels')
let pianoRollData = null
let visibleFrameRange = { startFrame: 0, endFrame: 0 }

function redrawPianoRollSlice() {
  if (!pianoRollData) return
  drawPianoRollSlice(
    pianoRollCanvas,
    pianoRollData.frames,
    visibleFrameRange.startFrame,
    visibleFrameRange.endFrame,
    PIANO_ROLL_MIN_MIDI,
    PIANO_ROLL_MAX_MIDI,
  )
}

function updatePianoRollView(startTime, endTime) {
  if (!pianoRollData) return
  visibleFrameRange = frameRangeForTime(
    startTime,
    endTime,
    pianoRollData.hopSize,
    pianoRollData.sampleRate,
    pianoRollData.frames.length,
  )
  redrawPianoRollSlice()
}

function getVisibleTimeRange() {
  const scrollLeft = wavesurfer.getScroll()
  const viewportWidth = waveformContainer.clientWidth
  const startTime = scrollLeft / currentPxPerSec
  const endTime = startTime + viewportWidth / currentPxPerSec
  return { startTime, endTime }
}

function syncPianoRollCanvasWidth() {
  const width = Math.round(pianoRollCanvas.getBoundingClientRect().width)
  if (width > 0 && pianoRollCanvas.width !== width) {
    pianoRollCanvas.width = width
    pianoRollLabelsCanvas.width = width
    drawPianoRollLabels(pianoRollLabelsCanvas, PIANO_ROLL_MIN_MIDI, PIANO_ROLL_MAX_MIDI)
    redrawPianoRollSlice()
  }
}
syncPianoRollCanvasWidth()
window.addEventListener('resize', syncPianoRollCanvasWidth)

wavesurfer.on('scroll', (startTime, endTime) => updatePianoRollView(startTime, endTime))
wavesurfer.on('redraw', () => {
  const { startTime, endTime } = getVisibleTimeRange()
  updatePianoRollView(startTime, endTime)
})
```

Note: `getVisibleTimeRange` reads `currentPxPerSec`, a `let` declared further down in this same file (in the zoom-handling section). This is safe — the function's *body* only runs later, inside an event callback fired after the whole module has finished executing top-to-bottom, by which point `currentPxPerSec` is already initialized. Only reading it synchronously *during* this early section would be a problem; this doesn't do that.

- [ ] **Step 4: Wire the whole-track computation into the `ready` handler**

Change:

```javascript
wavesurfer.on('ready', () => {
  playPauseBtn.disabled = false
  if (!spectrumAnalyser) {
    spectrumAnalyser = createSpectrumAnalyser(wavesurfer, spectrumCanvas, { onEqChange: scheduleEqSave })
  }
  spectrumAnalyser.setEqState(pendingEqSettings)
})
```

to:

```javascript
wavesurfer.on('ready', () => {
  playPauseBtn.disabled = false
  if (!spectrumAnalyser) {
    spectrumAnalyser = createSpectrumAnalyser(wavesurfer, spectrumCanvas, { onEqChange: scheduleEqSave })
  }
  spectrumAnalyser.setEqState(pendingEqSettings)

  const audioBuffer = wavesurfer.getDecodedData()
  if (audioBuffer) {
    const channelData = []
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      channelData.push(audioBuffer.getChannelData(ch))
    }
    const mono = mixToMono(channelData)
    pianoRollData = computeSpectrogramFrames(mono, audioBuffer.sampleRate, PIANO_ROLL_MIN_FREQ, PIANO_ROLL_MAX_FREQ)
    const { startTime, endTime } = getVisibleTimeRange()
    updatePianoRollView(startTime, endTime)
  }
})
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no test covers `main.js`/`waveform.js`'s wiring directly — this confirms nothing else broke).

- [ ] **Step 6: Verify manually**

Run: `bin/dev`, open http://localhost:5173.

1. Upload an audio file with varied frequency content (e.g. a rising chirp, or anything with distinct low/mid/high sections). Confirm a piano-roll grid appears below the Selections section, with a horizontal note-name axis below it.
2. Confirm columns are discrete (quantized to semitones), not a smooth continuous gradient — you should be able to see distinct vertical bands.
3. Confirm the range spans C2 to C7 (check the horizontal axis labels).
4. Confirm peak notes are highlighted in green, and are visually distinguishable from the blue intensity heatmap of non-peak content — this should look noticeably less saturated/washed-out than the old `roseus` colormap.
5. Zoom the waveform in/out (mouse wheel over the waveform) — confirm the piano roll's visible time range zooms in sync (more/fewer visible rows).
6. Pan the waveform (shift+wheel or scroll) — confirm the piano roll's content changes to match the new visible time range.
7. Play the file and let it auto-scroll — confirm the piano roll keeps following along in real time.
8. Resize the browser window — confirm the piano roll and its label axis both resize cleanly (no stretched/blurry text, no misaligned columns).
9. Confirm no console errors throughout.

- [ ] **Step 7: Commit**

```bash
git add index.html src/style.css src/main.js
git commit -m "Wire up the piano roll view, synced to the waveform's visible time range"
```
