# Spectrogram Note Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the spectrogram 400px tall, crop its frequency range to C2-C5, and replace its Hz y-axis labels with note names.

**Architecture:** `spectrum.js`'s existing adaptive label-spacing logic (`labelStep`) is extracted into a shared, tested function in `notes.js`. A new pure/tested module, `spectrogramLabels.js`, computes note-label positions using that shared function plus `notes.js`'s existing frequency/MIDI helpers, and draws them once (not per-frame, since the label canvas never changes after creation) onto a new narrow canvas placed beside the spectrogram. `waveform.js`'s plugin config changes to the new height/range and turns off the plugin's own Hz labels.

**Tech Stack:** Same as the rest of the app — vanilla JS, Canvas 2D, vitest for the pure modules.

## Global Constraints

- `SPECTROGRAM_MIN_FREQ`/`SPECTROGRAM_MAX_FREQ` are C2/C5, computed via `frequencyFromMidi(36)`/`frequencyFromMidi(72)` — not hardcoded Hz values, not the same as `spectrum.js`'s `MIN_FREQ`/`MAX_FREQ` (A0-C8), which is unaffected by this plan. (Spec: Frequency crop)
- The label canvas is drawn exactly once (right after the wavesurfer instance is created) — no per-frame redraw, no event listeners tied to it. (Spec: Note-name y-axis)
- `spectrum.js`'s own labeling behavior must not change — `labelStep`'s math is extracted verbatim, not altered. (Spec: Shared adaptive label spacing)
- No new test infrastructure. `yForFrequency`, `computeSpectrogramLabels`, and `labelStep` get real unit tests; `drawSpectrogramLabels` and all DOM/canvas wiring stay untested by existing convention. (Spec: Testing)

---

## File Structure

- Modify: `src/notes.js` / `src/notes.test.js` — shared `labelStep`.
- Modify: `src/spectrum.js` — use the shared `labelStep` instead of its own private copy.
- Create: `src/spectrogramLabels.js` / `src/spectrogramLabels.test.js` — label position computation + drawing.
- Modify: `src/waveform.js` — new frequency range/height/labels config.
- Modify: `index.html` / `src/style.css` — new label canvas + flex layout.
- Modify: `src/main.js` — draw the labels once.

---

### Task 1: Extract shared `labelStep` into `notes.js`

**Files:**
- Modify: `src/notes.js`
- Modify: `src/notes.test.js`
- Modify: `src/spectrum.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `labelStep(spanSemitones, availablePixels, desiredLabelSpacingPx = 50)`. Task 2's `spectrogramLabels.js` imports this from `notes.js`.

- [ ] **Step 1: Write the failing tests**

Add to `src/notes.test.js` (alongside its existing `describe` blocks — read the file first to match its existing import line and style):

```javascript
import { labelStep } from './notes.js'
```

```javascript
describe('labelStep', () => {
  it('picks a step so labels stay roughly desiredLabelSpacingPx apart', () => {
    // 400px / 50px desired spacing = 8 desired labels; 36 semitones / 8 = 4.5 -> rounds to 5
    expect(labelStep(36, 400)).toBe(5)
  })

  it('never returns less than 1, even when the raw calculation rounds to 0', () => {
    // 1000px / 50px desired spacing = 20 desired labels; 1 semitone / 20 = 0.05 -> rounds to 0, clamped to 1
    expect(labelStep(1, 1000)).toBe(1)
  })

  it('respects a custom desired spacing', () => {
    // 100px / 25px desired spacing = 4 desired labels; 12 semitones / 4 = 3
    expect(labelStep(12, 100, 25)).toBe(3)
  })

  it('returns a larger step for a wider span in the same pixel budget', () => {
    const narrow = labelStep(12, 200)
    const wide = labelStep(48, 200)
    expect(wide).toBeGreaterThanOrEqual(narrow)
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/notes.test.js`
Expected: FAIL — `labelStep` doesn't exist yet in `notes.js`.

- [ ] **Step 3: Add `labelStep` to `notes.js`**

Add to `src/notes.js`:

```javascript
export function labelStep(spanSemitones, availablePixels, desiredLabelSpacingPx = 50) {
  const desiredLabels = availablePixels / desiredLabelSpacingPx
  return Math.max(1, Math.round(spanSemitones / desiredLabels))
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/notes.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Refactor `spectrum.js` to use the shared function**

In `src/spectrum.js`, change the import line:

```javascript
import { frequencyToNoteName, midiFromFrequency, noteNameFromMidi } from './notes.js'
```

to:

```javascript
import { frequencyToNoteName, midiFromFrequency, noteNameFromMidi, labelStep } from './notes.js'
```

Remove the private `labelStep` function:

```javascript
  function labelStep() {
    const spanSemitones = midiFromFrequency(viewMaxFreq) - midiFromFrequency(viewMinFreq)
    const desiredLabels = canvas.width / 50
    return Math.max(1, Math.round(spanSemitones / desiredLabels))
  }

```

(delete this whole block, including the blank line after it)

Change the one call site:

```javascript
    const step = labelStep()
```

to:

```javascript
    const step = labelStep(midiFromFrequency(viewMaxFreq) - midiFromFrequency(viewMinFreq), canvas.width)
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no test covers `spectrum.js` directly — this confirms nothing else broke).

- [ ] **Step 7: Verify manually**

Run: `bin/dev`, open http://localhost:5173, upload a file.

1. Confirm the real-time spectrum analyzer (the `#spectrum` canvas, above the beat grid) still shows note-name labels along its x-axis exactly as before — same spacing behavior, nothing visually changed.
2. Zoom/pan the spectrum analyzer's frequency view (scroll/wheel over it) and confirm labels still update sensibly at different zoom levels (denser near max zoom, sparser zoomed out) — same as before this refactor.

- [ ] **Step 8: Commit**

```bash
git add src/notes.js src/notes.test.js src/spectrum.js
git commit -m "Extract shared labelStep function from spectrum.js into notes.js"
```

---

### Task 2: `spectrogramLabels.js` — label position computation and drawing

**Files:**
- Create: `src/spectrogramLabels.js`
- Create: `src/spectrogramLabels.test.js`

**Interfaces:**
- Consumes: `midiFromFrequency`, `frequencyFromMidi`, `noteNameFromMidi`, `labelStep` (all from `notes.js`, `labelStep` from Task 1).
- Produces: `yForFrequency(freq, minFreq, maxFreq, heightPx)`, `computeSpectrogramLabels(minFreq, maxFreq, heightPx)`, `drawSpectrogramLabels(canvas, minFreq, maxFreq)`. Task 3's `main.js` calls `drawSpectrogramLabels`.

- [ ] **Step 1: Write the failing tests**

Create `src/spectrogramLabels.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { yForFrequency, computeSpectrogramLabels } from './spectrogramLabels.js'
import { frequencyFromMidi } from './notes.js'

describe('yForFrequency', () => {
  it('places the minimum frequency at the bottom (height)', () => {
    expect(yForFrequency(100, 100, 400, 300)).toBeCloseTo(300, 5)
  })

  it('places the maximum frequency at the top (0)', () => {
    expect(yForFrequency(400, 100, 400, 300)).toBeCloseTo(0, 5)
  })

  it('places the log-midpoint frequency at the vertical midpoint', () => {
    // log2(100)..log2(400) spans exactly 2 - the geometric mean (200) is the midpoint
    expect(yForFrequency(200, 100, 400, 300)).toBeCloseTo(150, 5)
  })
})

describe('computeSpectrogramLabels', () => {
  it('returns labels within the canvas height bounds', () => {
    const labels = computeSpectrogramLabels(frequencyFromMidi(36), frequencyFromMidi(72), 400)
    for (const { y } of labels) {
      expect(y).toBeGreaterThanOrEqual(-0.01)
      expect(y).toBeLessThanOrEqual(400.01)
    }
  })

  it('includes a label at the low end whose text is C2', () => {
    const labels = computeSpectrogramLabels(frequencyFromMidi(36), frequencyFromMidi(72), 400)
    expect(labels[0].text).toBe('C2')
  })

  it('orders labels from bottom (largest y) to top (smallest y)', () => {
    const labels = computeSpectrogramLabels(frequencyFromMidi(36), frequencyFromMidi(72), 400)
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i].y).toBeLessThan(labels[i - 1].y)
    }
  })

  it('spaces labels out rather than returning one per semitone', () => {
    // 36 semitones in 400px would be ~11px apart if unspaced - confirm labelStep is actually applied
    const labels = computeSpectrogramLabels(frequencyFromMidi(36), frequencyFromMidi(72), 400)
    expect(labels.length).toBeLessThan(36)
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/spectrogramLabels.test.js`
Expected: FAIL — `src/spectrogramLabels.js` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/spectrogramLabels.js`:

```javascript
import { frequencyFromMidi, labelStep, midiFromFrequency, noteNameFromMidi } from './notes.js'

export function yForFrequency(freq, minFreq, maxFreq, heightPx) {
  const logMin = Math.log2(minFreq)
  const logMax = Math.log2(maxFreq)
  return heightPx - ((Math.log2(freq) - logMin) / (logMax - logMin)) * heightPx
}

export function computeSpectrogramLabels(minFreq, maxFreq, heightPx) {
  const minMidi = Math.ceil(midiFromFrequency(minFreq))
  const maxMidi = Math.floor(midiFromFrequency(maxFreq))
  const step = labelStep(maxMidi - minMidi, heightPx)

  const labels = []
  for (let midi = minMidi; midi <= maxMidi; midi += step) {
    const freq = frequencyFromMidi(midi)
    labels.push({ y: yForFrequency(freq, minFreq, maxFreq, heightPx), text: noteNameFromMidi(midi) })
  }
  return labels
}

export function drawSpectrogramLabels(canvas, minFreq, maxFreq) {
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#121212'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#f0f0f0'
  ctx.font = '13px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const { y, text } of computeSpectrogramLabels(minFreq, maxFreq, canvas.height)) {
    ctx.fillText(text, canvas.width - 4, y)
  }
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/spectrogramLabels.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/spectrogramLabels.js src/spectrogramLabels.test.js
git commit -m "Add spectrogramLabels module for note-name y-axis labels"
```

---

### Task 3: Wire it all up — taller spectrogram, cropped range, note-name labels rendered

**Files:**
- Modify: `src/waveform.js`
- Modify: `index.html`
- Modify: `src/style.css`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `drawSpectrogramLabels` (Task 2), `frequencyFromMidi` (from `notes.js`).
- Produces: `SPECTROGRAM_MIN_FREQ`/`SPECTROGRAM_MAX_FREQ` exported from `waveform.js`, consumed by `main.js`. Last task for this plan.

- [ ] **Step 1: Update `waveform.js`'s config**

Change:

```javascript
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import SpectrogramPlugin from 'wavesurfer.js/plugins/spectrogram'
import { MIN_FREQ, MAX_FREQ } from './spectrum.js'

export function createWaveSurfer(container, spectrogramContainer) {
  const regions = RegionsPlugin.create()
  const spectrogram = SpectrogramPlugin.create({
    container: spectrogramContainer,
    height: 200,
    labels: true,
    scale: 'logarithmic',
    frequencyMin: MIN_FREQ,
    frequencyMax: MAX_FREQ,
    colorMap: 'roseus',
    useWebWorker: true,
    // useWebWorker's whole point is to avoid blocking the main thread on long
    // tracks - the plugin's default fallbackToMainThread (true) would silently
    // redo the FFT on the main thread (with just a console.warn) if the worker
    // fails or times out, defeating that and swallowing the failure so the
    // 'error' handler below never fires for it.
    fallbackToMainThread: false,
  })
```

to:

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
```

(Note: `MIN_FREQ`/`MAX_FREQ` from `spectrum.js` are no longer imported here — the spectrogram now uses its own cropped range, distinct from the live analyzer's full A0-C8 range. `spectrum.js` itself is untouched by this task; its own `MIN_FREQ`/`MAX_FREQ` exports stay as they are for its own use.)

- [ ] **Step 2: Update the markup**

In `index.html`, change:

```html
      <section id="spectrogram-section">
        <div id="spectrogram"></div>
      </section>
```

to:

```html
      <section id="spectrogram-section">
        <canvas id="spectrogram-labels" width="55" height="400"></canvas>
        <div id="spectrogram"></div>
      </section>
```

- [ ] **Step 3: Update the CSS**

In `src/style.css`, change:

```css
#spectrogram {
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  margin-block: 0.5rem;
  overflow: hidden;
}
```

to:

```css
#spectrogram-section {
  display: flex;
  align-items: stretch;
  margin-block: 0.5rem;
}

#spectrogram-labels {
  flex-shrink: 0;
  display: block;
}

#spectrogram {
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  overflow: hidden;
  flex: 1;
  min-width: 0;
}
```

- [ ] **Step 4: Wire it up in `main.js`**

Change the import line:

```javascript
import { createWaveSurfer } from './waveform.js'
```

to:

```javascript
import { createWaveSurfer, SPECTROGRAM_MIN_FREQ, SPECTROGRAM_MAX_FREQ } from './waveform.js'
import { drawSpectrogramLabels } from './spectrogramLabels.js'
```

Change:

```javascript
const { wavesurfer, regions, spectrogram } = createWaveSurfer(waveformContainer, spectrogramContainer)
```

to:

```javascript
const { wavesurfer, regions, spectrogram } = createWaveSurfer(waveformContainer, spectrogramContainer)

drawSpectrogramLabels(document.getElementById('spectrogram-labels'), SPECTROGRAM_MIN_FREQ, SPECTROGRAM_MAX_FREQ)
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Verify manually**

Run: `bin/dev`, open http://localhost:5173.

1. Confirm the spectrogram section is now visibly taller (400px) than before.
2. Confirm there's a narrow column of note-name labels (e.g. "C2", "F2", "C3"...) to the left of the spectrogram, not Hz values.
3. Upload an audio file with some low content and some higher content (or the earlier chirp/tone test file) — confirm content below C2 or above C5 is no longer visible (the view is cropped), and that a known note's content lines up roughly with its label's vertical position.
4. Confirm the label canvas and the spectrogram sit flush together (same top/bottom edges, no visible gap or misalignment).
5. Zoom/pan/play the waveform — confirm the spectrogram content still syncs correctly (this is unrelated to this plan's changes, but confirms Task 3 didn't regress the earlier sync fix).
6. Confirm no console errors.

- [ ] **Step 7: Commit**

```bash
git add src/waveform.js index.html src/style.css src/main.js
git commit -m "Make spectrogram taller, crop to C2-C5, and label it with note names"
```
