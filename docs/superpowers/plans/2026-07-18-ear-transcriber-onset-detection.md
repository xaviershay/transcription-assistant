# Ear Transcriber Onset Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Subdivide" action to each selection region: detect likely note-onset boundaries within that region's audio (spectral flux onset detection), preview the proposed split at an adjustable sensitivity, and let the user Confirm (replace the region with the split pieces) or Cancel (leave it untouched).

**Architecture:** A new pure, dependency-free algorithm module (`src/onsets.js`) — hand-rolled FFT, spectral flux, adaptive-threshold peak-picking — gets real vitest coverage, consistent with `notes.js`/`selections.js`. `src/selectionsList.js` gets mechanical additions for the new per-row buttons. `src/main.js` gets the preview state machine, which is genuinely DOM/wavesurfer-specific and untested (consistent with the rest of the app's testing approach).

**Tech Stack:** Same as the rest of the app — vanilla JS, wavesurfer.js 7.12.11, native Web Audio's decoded `AudioBuffer`. No new dependencies.

## Global Constraints

- Algorithm constants, verified by prototyping against synthetic signals
  before this plan was written (see
  `docs/superpowers/specs/2026-07-18-ear-transcriber-onset-detection-design.md`
  for the full rationale): `FFT_SIZE = 2048`, `HOP_SIZE = 512`,
  `MIN_ONSET_GAP_SECONDS = 0.06`, `MIN_ONSET_START_SECONDS = 0.03`,
  `LOCAL_MEAN_WINDOW_FRAMES = 10`, `SILENCE_LOOKAHEAD_FRAMES = 3`,
  `SILENCE_FLOOR_FRACTION = 0.15`, threshold formula
  `localMean(flux) * (2 / sensitivity)`. Do not re-derive or re-tune these —
  they were validated against 3 synthetic test scenarios during design.
- Flux must be computed on **log-compressed** magnitude
  (`Math.log1p(magnitude)`), not raw linear magnitude — linear magnitude
  was tried first and produced false onsets from spectral leakage noise
  during steady tones.
- Peak-picking must include the **silence-lookahead gate** (reject a
  candidate onset if energy has dropped below `SILENCE_FLOOR_FRACTION` of
  the recent local peak energy by `SILENCE_LOOKAHEAD_FRAMES` frames later)
  — without it, a note's *offset* (tail decaying into silence) gets
  misdetected as a new onset.
- Regions plugin API (wavesurfer.js 7.12.11, already used elsewhere in this
  codebase): `regions.getRegions(): Region[]`, `regions.addRegion(params):
  Region` (params include `id`, `start`, `end`, `color`, `drag`, `resize`),
  `region.remove()`. `wavesurfer.getDecodedData(): AudioBuffer | null`.
- No Web Worker — computation runs on the main thread, scoped to a single
  region's audio slice (short by construction).
- No automated tests for DOM/wavesurfer wiring (per the app's established
  testing approach) — only `src/onsets.js` gets vitest coverage.

---

## File Structure

```
src/
  onsets.js          # NEW — pure: FFT, spectral flux, onset peak-picking
  onsets.test.js       # NEW
  selectionsList.js      # MODIFIED — Subdivide/Confirm/Cancel buttons per row
  main.js                  # MODIFIED — preview state machine
index.html                  # MODIFIED — sensitivity slider
src/style.css                 # MODIFIED — sensitivity slider row, button group
```

---

### Task 1: Onset detection algorithm (`src/onsets.js`)

**Files:**
- Create: `src/onsets.js`
- Create: `src/onsets.test.js`

**Interfaces:**
- Produces: `mixToMono(channelData: Float32Array[]): Float32Array`,
  `computeSpectralFlux(samples: Float32Array, sampleRate: number): {flux:
  Float32Array, energy: Float32Array, hopSize: number, sampleRate: number}`,
  `pickOnsets(fluxResult, sensitivity: number): number[]` (onset times in
  seconds, relative to the start of `samples`), `detectOnsets(samples,
  sampleRate, sensitivity=1.5): number[]` (convenience: `pickOnsets(
  computeSpectralFlux(samples, sampleRate), sensitivity)`). Consumed by
  Task 3's `main.js` wiring.

- [ ] **Step 1: Write the failing tests**

```js
// src/onsets.test.js
import { describe, it, expect } from 'vitest'
import { mixToMono, computeSpectralFlux, pickOnsets, detectOnsets } from './onsets.js'

const SAMPLE_RATE = 44100

function silence(seconds) {
  return new Float32Array(Math.round(seconds * SAMPLE_RATE))
}

function tone(freq, seconds, amplitude = 0.5) {
  const n = Math.round(seconds * SAMPLE_RATE)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const attack = Math.min(1, i / (SAMPLE_RATE * 0.005))
    out[i] = amplitude * attack * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE)
  }
  return out
}

function concat(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

function expectOnsetsNear(onsets, expectedTimes, toleranceSeconds = 0.05) {
  expect(onsets.length).toBe(expectedTimes.length)
  onsets.forEach((t, i) => {
    expect(Math.abs(t - expectedTimes[i])).toBeLessThanOrEqual(toleranceSeconds)
  })
}

describe('mixToMono', () => {
  it('returns the single channel unchanged for mono input', () => {
    const channel = new Float32Array([0.1, 0.2, 0.3])
    expect(mixToMono([channel])).toBe(channel)
  })

  it('averages multiple channels sample by sample', () => {
    const left = new Float32Array([1, 0, -1])
    const right = new Float32Array([0, 1, -1])
    const mono = mixToMono([left, right])
    expect(Array.from(mono)).toEqual([0.5, 0.5, -1])
  })
})

describe('detectOnsets', () => {
  it('finds zero onsets in pure silence', () => {
    const onsets = detectOnsets(silence(1.0), SAMPLE_RATE, 1.5)
    expect(onsets).toEqual([])
  })

  it('finds two onsets for two tones separated by silence', () => {
    const signal = concat(silence(0.2), tone(300, 0.3), silence(0.05), tone(600, 0.3), silence(0.2))
    const onsets = detectOnsets(signal, SAMPLE_RATE, 1.5)
    expectOnsetsNear(onsets, [0.2, 0.55])
  })

  it('finds four onsets for a legato run of adjacent notes with no gaps', () => {
    const signal = concat(
      tone(261.63, 0.15),
      tone(293.66, 0.15),
      tone(329.63, 0.15),
      tone(349.23, 0.15),
      tone(392.0, 0.15),
    )
    const onsets = detectOnsets(signal, SAMPLE_RATE, 1.5)
    expectOnsetsNear(onsets, [0.15, 0.3, 0.45, 0.6])
  })
})

describe('two-stage split (computeSpectralFlux + pickOnsets)', () => {
  it('reuses one flux computation across multiple sensitivity values', () => {
    const signal = concat(silence(0.2), tone(300, 0.3), silence(0.05), tone(600, 0.3), silence(0.2))
    const fluxResult = computeSpectralFlux(signal, SAMPLE_RATE)

    expectOnsetsNear(pickOnsets(fluxResult, 1.0), [0.2, 0.55])
    expectOnsetsNear(pickOnsets(fluxResult, 3.0), [0.2, 0.55])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/onsets.test.js`
Expected: FAIL — `Cannot find module './onsets.js'`.

- [ ] **Step 3: Write `src/onsets.js`**

```js
const FFT_SIZE = 2048
const HOP_SIZE = 512
const MIN_ONSET_GAP_SECONDS = 0.06
const MIN_ONSET_START_SECONDS = 0.03
const LOCAL_MEAN_WINDOW_FRAMES = 10
const SILENCE_LOOKAHEAD_FRAMES = 3
const SILENCE_FLOOR_FRACTION = 0.15

export function mixToMono(channelData) {
  if (channelData.length === 1) return channelData[0]
  const length = channelData[0].length
  const mono = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let sum = 0
    for (let ch = 0; ch < channelData.length; ch++) sum += channelData[ch][i]
    mono[i] = sum / channelData.length
  }
  return mono
}

function hannWindow(size) {
  const window = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))
  }
  return window
}

// In-place radix-2 Cooley-Tukey FFT. real/imag are Float64Array of length = power of 2.
function fft(real, imag) {
  const n = real.length
  if (n <= 1) return

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = real[i]
      real[i] = real[j]
      real[j] = tr
      const ti = imag[i]
      imag[i] = imag[j]
      imag[j] = ti
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curWr = 1
      let curWi = 0
      for (let k = 0; k < len / 2; k++) {
        const uRe = real[i + k]
        const uIm = imag[i + k]
        const vRe = real[i + k + len / 2] * curWr - imag[i + k + len / 2] * curWi
        const vIm = real[i + k + len / 2] * curWi + imag[i + k + len / 2] * curWr
        real[i + k] = uRe + vRe
        imag[i + k] = uIm + vIm
        real[i + k + len / 2] = uRe - vRe
        imag[i + k + len / 2] = uIm - vIm
        const nextWr = curWr * wr - curWi * wi
        const nextWi = curWr * wi + curWi * wr
        curWr = nextWr
        curWi = nextWi
      }
    }
  }
}

export function computeSpectralFlux(samples, sampleRate) {
  const window = hannWindow(FFT_SIZE)
  const numFrames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP_SIZE) + 1)
  const flux = new Float32Array(numFrames)
  const energy = new Float32Array(numFrames)
  const prevLogMag = new Float64Array(FFT_SIZE / 2)

  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * HOP_SIZE
    const real = new Float64Array(FFT_SIZE)
    const imag = new Float64Array(FFT_SIZE)
    for (let i = 0; i < FFT_SIZE; i++) {
      real[i] = samples[offset + i] * window[i]
    }
    fft(real, imag)

    let sum = 0
    let energySum = 0
    for (let bin = 0; bin < FFT_SIZE / 2; bin++) {
      const mag = Math.hypot(real[bin], imag[bin])
      energySum += mag * mag
      const logMag = Math.log1p(mag)
      const diff = logMag - prevLogMag[bin]
      if (diff > 0) sum += diff
      prevLogMag[bin] = logMag
    }
    flux[frame] = sum
    energy[frame] = Math.sqrt(energySum)
  }

  return { flux, energy, hopSize: HOP_SIZE, sampleRate }
}

export function pickOnsets(fluxResult, sensitivity) {
  const { flux, energy, hopSize, sampleRate } = fluxResult
  const onsets = []
  const minGapFrames = Math.round((MIN_ONSET_GAP_SECONDS * sampleRate) / hopSize)
  const minStartFrames = Math.round((MIN_ONSET_START_SECONDS * sampleRate) / hopSize)
  let lastOnsetFrame = -Infinity

  for (let i = 1; i < flux.length - 1; i++) {
    if (i < minStartFrames) continue

    const start = Math.max(0, i - LOCAL_MEAN_WINDOW_FRAMES)
    const end = Math.min(flux.length, i + LOCAL_MEAN_WINDOW_FRAMES + 1)
    let localSum = 0
    let localMaxEnergy = 0
    for (let j = start; j < end; j++) {
      localSum += flux[j]
      if (energy[j] > localMaxEnergy) localMaxEnergy = energy[j]
    }
    const localMean = localSum / (end - start)

    const threshold = localMean * (2 / sensitivity)
    const isLocalPeak = flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1]
    const exceedsThreshold = flux[i] > threshold && flux[i] > 0.01

    const lookaheadIdx = Math.min(flux.length - 1, i + SILENCE_LOOKAHEAD_FRAMES)
    const notDecayingToSilence = energy[lookaheadIdx] > localMaxEnergy * SILENCE_FLOOR_FRACTION

    if (isLocalPeak && exceedsThreshold && notDecayingToSilence && i - lastOnsetFrame >= minGapFrames) {
      onsets.push((i * hopSize) / sampleRate)
      lastOnsetFrame = i
    }
  }

  return onsets
}

export function detectOnsets(samples, sampleRate, sensitivity = 1.5) {
  return pickOnsets(computeSpectralFlux(samples, sampleRate), sensitivity)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/onsets.test.js`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/onsets.js src/onsets.test.js
git commit -m "feat: add spectral flux onset detection algorithm"
```

---

### Task 2: Subdivide/Confirm/Cancel buttons in the selections list

**Files:**
- Modify: `src/selectionsList.js`

**Interfaces:**
- Consumes: nothing new from other modules.
- Produces: `renderSelectionsList(listEl, sortedRegions, activeId, {
  onActivate, onDelete, onSubdivide, onConfirmSubdivide, onCancelSubdivide,
  previewingId })` — three new callback params and one new state param,
  added to the existing four. Consumed by Task 3's `main.js`.

- [ ] **Step 1: Replace `src/selectionsList.js`**

```js
export function renderSelectionsList(
  listEl,
  sortedRegions,
  activeId,
  { onActivate, onDelete, onSubdivide, onConfirmSubdivide, onCancelSubdivide, previewingId },
) {
  listEl.innerHTML = ''

  sortedRegions.forEach((region) => {
    const li = document.createElement('li')
    li.className = region.id === activeId ? 'active' : ''

    const label = document.createElement('span')
    label.textContent = `${region.start.toFixed(2)}s – ${region.end.toFixed(2)}s`
    label.addEventListener('click', () => onActivate(region.id))

    const buttonGroup = document.createElement('span')
    buttonGroup.className = 'row-buttons'

    if (region.id === previewingId) {
      const confirmBtn = document.createElement('button')
      confirmBtn.textContent = 'Confirm'
      confirmBtn.addEventListener('click', () => onConfirmSubdivide(region.id))

      const cancelBtn = document.createElement('button')
      cancelBtn.textContent = 'Cancel'
      cancelBtn.addEventListener('click', () => onCancelSubdivide(region.id))

      buttonGroup.append(confirmBtn, cancelBtn)
    } else {
      const subdivideBtn = document.createElement('button')
      subdivideBtn.textContent = 'Subdivide'
      subdivideBtn.disabled = previewingId !== null
      subdivideBtn.addEventListener('click', () => onSubdivide(region.id))

      const deleteBtn = document.createElement('button')
      deleteBtn.textContent = 'Delete'
      deleteBtn.addEventListener('click', () => onDelete(region.id))

      buttonGroup.append(subdivideBtn, deleteBtn)
    }

    li.append(label, buttonGroup)
    listEl.append(li)
  })
}
```

- [ ] **Step 2: Run the existing test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS, all 26 tests green (20 from before + 6 new from Task 1).
`selectionsList.js` has no automated tests of its own (DOM-rendering,
consistent with the rest of the app), so this step confirms no accidental
breakage elsewhere.

- [ ] **Step 3: Commit**

```bash
git add src/selectionsList.js
git commit -m "feat: add Subdivide/Confirm/Cancel buttons to selections list rows"
```

---

### Task 3: Preview state machine and sensitivity slider

**Files:**
- Modify: `index.html`
- Modify: `src/style.css`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `mixToMono`, `computeSpectralFlux`, `pickOnsets` from Task 1;
  the updated `renderSelectionsList` signature from Task 2; `wavesurfer`,
  `regions`, `activeRegionId`, `activateRegion`, `refreshSelectionsList`,
  `sortRegionsByStart`, `getAdjacentRegionId` already present in `main.js`.

- [ ] **Step 1: Modify `index.html`** — add the sensitivity slider to the
  Selections panel header:

Replace:

```html
      <section id="selections-section" class="panel">
        <h2>Selections</h2>
        <ul id="selections-list"></ul>
      </section>
```

with:

```html
      <section id="selections-section" class="panel">
        <div class="selections-header">
          <h2>Selections</h2>
          <label for="onset-sensitivity">Sensitivity</label>
          <input type="range" id="onset-sensitivity" min="0.5" max="5" step="0.1" value="1.5" disabled />
        </div>
        <ul id="selections-list"></ul>
      </section>
```

- [ ] **Step 2: Modify `src/style.css`** — add layout for the new header
  row and the per-row button group. Append to the end of the file:

```css
.selections-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.selections-header h2 {
  margin: 0;
}

.row-buttons {
  display: flex;
  gap: 0.4rem;
}
```

- [ ] **Step 3: Modify `src/main.js`**

Add to the imports at the top:

```js
import { mixToMono, computeSpectralFlux, pickOnsets } from './onsets.js'
```

Add near the other `getElementById` calls (alongside `selectionsListEl` /
`activeLabel`):

```js
const sensitivitySlider = document.getElementById('onset-sensitivity')
```

Append the following block after the existing `let activeRegionId = null`
declaration and before `function refreshSelectionsList() {`:

```js
let previewingRegionId = null
let previewFluxResult = null
let previewSliceStart = null
let previewRegionIds = []
let sensitivityDebounceTimer = null

function isPreviewRegion(region) {
  return region.id.startsWith('preview-')
}

function clearPreviewRegions() {
  for (const id of previewRegionIds) {
    const region = regions.getRegions().find((r) => r.id === id)
    if (region) region.remove()
  }
  previewRegionIds = []
}

function renderPreview(sensitivity) {
  clearPreviewRegions()
  const relativeOnsets = pickOnsets(previewFluxResult, sensitivity)
  const parent = regions.getRegions().find((r) => r.id === previewingRegionId)
  if (!parent) return

  const boundaries = [parent.start, ...relativeOnsets.map((t) => previewSliceStart + t), parent.end]
  for (let i = 0; i < boundaries.length - 1; i++) {
    const previewRegion = regions.addRegion({
      id: `preview-${i}`,
      start: boundaries[i],
      end: boundaries[i + 1],
      color: 'rgba(245, 166, 79, 0.25)',
      drag: false,
      resize: false,
    })
    previewRegionIds.push(previewRegion.id)
  }
}

function startSubdivide(regionId) {
  if (previewingRegionId) return
  const region = regions.getRegions().find((r) => r.id === regionId)
  if (!region) return

  const audioBuffer = wavesurfer.getDecodedData()
  if (!audioBuffer) return

  const sampleRate = audioBuffer.sampleRate
  const startSample = Math.floor(region.start * sampleRate)
  const endSample = Math.ceil(region.end * sampleRate)
  const channelData = []
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch).slice(startSample, endSample))
  }
  const mono = mixToMono(channelData)

  previewingRegionId = regionId
  previewFluxResult = computeSpectralFlux(mono, sampleRate)
  previewSliceStart = region.start

  sensitivitySlider.disabled = false
  renderPreview(Number(sensitivitySlider.value))
  refreshSelectionsList()
}

function endPreview() {
  previewingRegionId = null
  previewFluxResult = null
  previewSliceStart = null
  sensitivitySlider.disabled = true
  refreshSelectionsList()
}

function confirmSubdivide() {
  const parent = regions.getRegions().find((r) => r.id === previewingRegionId)
  const boundaries = previewRegionIds
    .map((id) => regions.getRegions().find((r) => r.id === id))
    .filter(Boolean)
    .map((r) => ({ start: r.start, end: r.end }))

  clearPreviewRegions()
  if (parent) parent.remove()

  for (const { start, end } of boundaries) {
    regions.addRegion({ start, end, color: 'rgba(79, 109, 245, 0.2)' })
  }

  endPreview()
}

function cancelSubdivide() {
  clearPreviewRegions()
  endPreview()
}

sensitivitySlider.addEventListener('input', () => {
  if (!previewingRegionId) return
  clearTimeout(sensitivityDebounceTimer)
  sensitivityDebounceTimer = setTimeout(() => {
    renderPreview(Number(sensitivitySlider.value))
    refreshSelectionsList()
  }, 60)
})
```

Replace the existing `refreshSelectionsList` function body (written in the
base plan's Task 6) — it needs to filter out preview regions and pass the
new callbacks/state:

```js
function refreshSelectionsList() {
  const sorted = sortRegionsByStart(regions.getRegions().filter((r) => !isPreviewRegion(r)))
  renderSelectionsList(selectionsListEl, sorted, activeRegionId, {
    onActivate: activateRegion,
    onDelete: (id) => {
      const region = regions.getRegions().find((r) => r.id === id)
      if (region) region.remove()
    },
    onSubdivide: startSubdivide,
    onConfirmSubdivide: confirmSubdivide,
    onCancelSubdivide: cancelSubdivide,
    previewingId: previewingRegionId,
  })
}
```

Replace the Tab-cycling line inside the `keydown` listener (written in the
base plan's Task 8) so it also excludes preview regions:

Replace:

```js
    const sorted = sortRegionsByStart(regions.getRegions())
```

with:

```js
    const sorted = sortRegionsByStart(regions.getRegions().filter((r) => !isPreviewRegion(r)))
```

- [ ] **Step 4: Run the full test suite and build**

Run: `npm test`
Expected: PASS, all 26 tests green (no new automated tests added in this
task — DOM/wavesurfer wiring, consistent with the rest of the app).

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 5: Manual check — subdivide preview/confirm/cancel**

Run: `npm run dev`, upload an audio file with at least one passage of
several adjacent notes.
1. Drag out a region covering that passage. Click its "Subdivide" button.
   Expected: the sensitivity slider enables; amber-colored preview regions
   appear inside the original region's span, at the detected note
   boundaries; the row's buttons change to "Confirm"/"Cancel"; other rows'
   "Subdivide" buttons are disabled (their "Delete" buttons remain
   enabled).
2. Click one of the amber preview regions. Expected: it loops (audition),
   same as a normal region — no special-casing needed since preview
   regions are real regions.
3. Drag the sensitivity slider. Expected: after a brief pause (~60ms
   debounce), the preview regions update to reflect the new split, without
   visibly re-fetching audio (should feel instant, no lag from
   re-running the FFT).
4. Click "Confirm". Expected: the amber preview regions and the original
   region are replaced by normal blue regions at the previewed split
   points; they appear in the Selections list; the sensitivity slider
   disables again.
5. Repeat, but click "Cancel" instead. Expected: the amber preview regions
   disappear, the original region is unchanged and still listed, the
   sensitivity slider disables again.
6. While previewing, press `Tab`/`Shift+Tab`. Expected: cycling moves only
   between real (non-preview) regions — it should not jump into an amber
   preview region.

- [ ] **Step 6: Commit**

```bash
git add index.html src/style.css src/main.js
git commit -m "feat: add onset-detection subdivide preview/confirm/cancel workflow"
```

---

## Final Verification

- [ ] Run `npm test` — all 26 tests pass.
- [ ] Run `npm run build` — succeeds.
- [ ] Full manual walkthrough per Task 3 Step 5, plus a spot-check that
  existing features (drag-to-create, click-to-loop, delete, Tab-cycling
  among *confirmed* regions, spectrum, playback) still work unaffected.
