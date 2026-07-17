# Ear Transcriber UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix spectrum-label readability, add wheel-based zoom/pan to both the waveform and spectrum panels (replacing the waveform's zoom slider), make the dark theme permanent, and add spacebar play/pause — all per feedback from the first manual browser walkthrough.

**Architecture:** Small, tightly-coupled edits to the existing four source files (`style.css`, `waveform.js`, `spectrum.js`, `main.js`) and `index.html`. No new files, no new dependencies. Tasks touch overlapping files, so this plan is executed inline in the controlling session rather than via one-subagent-per-task.

**Tech Stack:** Same as the base app — Vite + vanilla JS, wavesurfer.js 7.12.11, native Web Audio/Canvas. No new dependencies.

## Global Constraints

- Dark theme is permanent — no `prefers-color-scheme` adaptation, no toggle.
- Background `#121212`, text `#e6e6e6` (from the design addendum).
- Spectrum note range stays A0 (27.5 Hz) – C8 (4186 Hz) as the outer zoom/pan bound.
- Waveform panning must reuse wavesurfer's existing native `overflow-x` scroll (via `Shift+wheel`, which browsers translate to horizontal scroll automatically) — no custom pan code for the waveform.
- Reuse `midiFromFrequency` from `src/notes.js` (Task 2 of the base plan) for the spectrum's dynamic label spacing — do not reimplement frequency→MIDI math.

---

### Task 1: Always-dark theme

**Files:**
- Modify: `src/style.css`
- Modify: `src/waveform.js`

**Change `src/style.css`** — replace the `:root` block:

```css
:root {
  color-scheme: dark;
  font-family: system-ui, sans-serif;
  background: #121212;
  color: #e6e6e6;
}
```

And update `body` to inherit the dark background explicitly (some browsers don't propagate `:root` background to `body` when `body` has its own box):

```css
body {
  margin: 0 auto;
  max-width: 900px;
  padding: 1rem;
  background: #121212;
  color: #e6e6e6;
}
```

**Change `src/waveform.js`** — `progressColor` goes from `'#2c3e91'` to `'#8ea0ff'` (lighter blue, stays visible against the dark background; the darker blue nearly disappeared):

```js
  const wavesurfer = WaveSurfer.create({
    container,
    waveColor: '#4f6df5',
    progressColor: '#8ea0ff',
    cursorColor: 'currentColor',
    height: 120,
    minPxPerSec: 50,
    plugins: [regions],
  })
```

(Only `progressColor`'s value changes; everything else in the `WaveSurfer.create` call is unchanged.)

- [ ] Make both edits above
- [ ] Run `npm run build` — expect success
- [ ] Manual check: `npm run dev`, load the page, confirm dark background with light text from first paint (no light-mode flash), and that the played portion of the waveform (after clicking play) is visibly lighter blue against the dark background
- [ ] Commit: `git add src/style.css src/waveform.js && git commit -m "feat: make dark theme permanent"`

---

### Task 2: Waveform wheel-zoom, remove zoom slider

**Files:**
- Modify: `index.html`
- Modify: `src/main.js`

**Change `index.html`** — remove the zoom slider (the `<label>` and `<input id="zoom">`), leaving just the waveform div in that section:

```html
      <section id="waveform-section">
        <div id="waveform"></div>
      </section>
```

**Change `src/main.js`** — remove the `zoomInput` declaration and its listener, replacing both with a wheel-based zoom handler on the waveform container. Remove these two existing lines:

```js
const zoomInput = document.getElementById('zoom')
```

(from the top block of `getElementById` calls) and:

```js
zoomInput.addEventListener('input', () => {
  wavesurfer.zoom(Number(zoomInput.value))
})
```

Replace the removed listener with:

```js
const ZOOM_FACTOR = 1.2
const MIN_PX_PER_SEC = 10
const MAX_PX_PER_SEC = 1000
let currentPxPerSec = 50

waveformContainer.addEventListener(
  'wheel',
  (e) => {
    if (e.shiftKey) return // let native horizontal scroll handle panning
    e.preventDefault()
    currentPxPerSec =
      e.deltaY < 0
        ? Math.min(MAX_PX_PER_SEC, currentPxPerSec * ZOOM_FACTOR)
        : Math.max(MIN_PX_PER_SEC, currentPxPerSec / ZOOM_FACTOR)
    wavesurfer.zoom(currentPxPerSec)
  },
  { passive: false },
)
```

`currentPxPerSec`'s initial value (50) matches `waveform.js`'s `minPxPerSec: 50` so the tracked value starts in sync with the actual rendered zoom level.

- [ ] Make both edits above
- [ ] Run `npm run build` — expect success
- [ ] Manual check: `npm run dev`, upload an audio file, scroll the mouse wheel over the waveform — confirm it zooms in/out; once zoomed in past the container width, hold Shift and scroll (or use a trackpad horizontal swipe) — confirm the waveform pans left/right; confirm dragging on the waveform still creates a selection region (unaffected by this change)
- [ ] Commit: `git add index.html src/main.js && git commit -m "feat: replace waveform zoom slider with wheel-zoom, pan via native scroll"`

---

### Task 3: Spectrum wheel-zoom/pan and readability fix

**Files:**
- Modify: `src/spectrum.js`

**Interfaces:**
- Consumes: `midiFromFrequency`, `frequencyToNoteName` from `src/notes.js` (Task 2 of the base plan — both already exported).
- Produces: same public shape as before, `{ start(), stop() }` — `createSpectrumAnalyser`'s signature is unchanged, so `src/main.js` needs no changes for this task.

**Replace the full contents of `src/spectrum.js`:**

```js
import { frequencyToNoteName, midiFromFrequency } from './notes.js'

const MIN_FREQ = 27.5 // A0
const MAX_FREQ = 4186 // C8
const MIN_SPAN_SEMITONES = 2
const ZOOM_FACTOR = 1.15
const PAN_FRACTION = 0.15
const BACKGROUND_COLOR = '#121212'
const LABEL_COLOR = '#f0f0f0'
const BAR_COLOR = '#4f6df5'

export function createSpectrumAnalyser(wavesurfer, canvas) {
  const audioCtx = new AudioContext()
  const source = audioCtx.createMediaElementSource(wavesurfer.getMediaElement())
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 8192
  source.connect(analyser)
  analyser.connect(audioCtx.destination)

  const freqData = new Uint8Array(analyser.frequencyBinCount)
  const ctx = canvas.getContext('2d')
  const binHz = audioCtx.sampleRate / analyser.fftSize

  let viewMinFreq = MIN_FREQ
  let viewMaxFreq = MAX_FREQ
  let animationFrame = null

  function xForFreq(freq) {
    const logMin = Math.log2(viewMinFreq)
    const logMax = Math.log2(viewMaxFreq)
    return ((Math.log2(freq) - logMin) / (logMax - logMin)) * canvas.width
  }

  function freqForX(x) {
    const logMin = Math.log2(viewMinFreq)
    const logMax = Math.log2(viewMaxFreq)
    return Math.pow(2, logMin + (x / canvas.width) * (logMax - logMin))
  }

  function zoomAt(cursorX, factor) {
    const anchorFreq = freqForX(cursorX)
    const logMin = Math.log2(viewMinFreq)
    const logMax = Math.log2(viewMaxFreq)
    const logAnchor = Math.log2(anchorFreq)
    const oldSpan = logMax - logMin
    const anchorFrac = (logAnchor - logMin) / oldSpan

    const minSpan = MIN_SPAN_SEMITONES / 12
    const maxSpan = Math.log2(MAX_FREQ) - Math.log2(MIN_FREQ)
    const newSpan = Math.min(maxSpan, Math.max(minSpan, oldSpan / factor))

    let newLogMin = logAnchor - anchorFrac * newSpan
    let newLogMax = newLogMin + newSpan

    const fullLogMin = Math.log2(MIN_FREQ)
    const fullLogMax = Math.log2(MAX_FREQ)
    if (newLogMin < fullLogMin) {
      newLogMin = fullLogMin
      newLogMax = newLogMin + newSpan
    }
    if (newLogMax > fullLogMax) {
      newLogMax = fullLogMax
      newLogMin = newLogMax - newSpan
    }

    viewMinFreq = Math.pow(2, newLogMin)
    viewMaxFreq = Math.pow(2, newLogMax)
  }

  function pan(direction) {
    const logMin = Math.log2(viewMinFreq)
    const logMax = Math.log2(viewMaxFreq)
    const span = logMax - logMin
    const shift = span * PAN_FRACTION * direction

    let newLogMin = logMin + shift
    let newLogMax = logMax + shift

    const fullLogMin = Math.log2(MIN_FREQ)
    const fullLogMax = Math.log2(MAX_FREQ)
    if (newLogMin < fullLogMin) {
      newLogMin = fullLogMin
      newLogMax = newLogMin + span
    }
    if (newLogMax > fullLogMax) {
      newLogMax = fullLogMax
      newLogMin = newLogMax - span
    }

    viewMinFreq = Math.pow(2, newLogMin)
    viewMaxFreq = Math.pow(2, newLogMax)
  }

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      if (e.shiftKey) {
        pan(e.deltaY > 0 ? 1 : -1)
      } else {
        const rect = canvas.getBoundingClientRect()
        const cursorX = ((e.clientX - rect.left) / rect.width) * canvas.width
        zoomAt(cursorX, e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)
      }
    },
    { passive: false },
  )

  function labelStep() {
    const spanSemitones = midiFromFrequency(viewMaxFreq) - midiFromFrequency(viewMinFreq)
    const desiredLabels = canvas.width / 50
    return Math.max(1, Math.round(spanSemitones / desiredLabels))
  }

  function draw() {
    analyser.getByteFrequencyData(freqData)

    ctx.fillStyle = BACKGROUND_COLOR
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.fillStyle = BAR_COLOR
    for (let i = 0; i < freqData.length; i++) {
      const freq = i * binHz
      if (freq < viewMinFreq || freq > viewMaxFreq) continue
      const x = xForFreq(freq)
      const barHeight = (freqData[i] / 255) * canvas.height
      ctx.fillRect(x, canvas.height - barHeight, 2, barHeight)
    }

    ctx.fillStyle = LABEL_COLOR
    ctx.font = '13px sans-serif'
    const step = labelStep()
    const minMidi = Math.ceil(midiFromFrequency(viewMinFreq))
    const maxMidi = Math.floor(midiFromFrequency(viewMaxFreq))
    for (let midi = minMidi; midi <= maxMidi; midi += step) {
      const freq = 440 * Math.pow(2, (midi - 69) / 12)
      const x = xForFreq(freq)
      ctx.fillText(frequencyToNoteName(freq), x, canvas.height - 2)
    }

    animationFrame = requestAnimationFrame(draw)
  }

  function start() {
    if (audioCtx.state === 'suspended') audioCtx.resume()
    if (!animationFrame) draw()
  }

  function stop() {
    if (animationFrame) cancelAnimationFrame(animationFrame)
    animationFrame = null
  }

  return { start, stop }
}
```

- [ ] Replace the file as shown above
- [ ] Run `npm run build` — expect success
- [ ] Run `npm test` — expect all 20 existing tests still passing (this file has no automated tests itself, but confirms nothing else broke)
- [ ] Manual check: `npm run dev`, play an audio file, confirm the spectrum background is dark and note labels are clearly readable (bright text, 13px); scroll the wheel over the spectrum canvas — confirm it zooms in/out anchored near the cursor; hold Shift and scroll — confirm it pans left/right; confirm the view can't zoom out past A0–C8 or invert
- [ ] Commit: `git add src/spectrum.js && git commit -m "feat: add spectrum zoom/pan and fix note-label readability"`

---

### Task 4: Spacebar play/pause

**Files:**
- Modify: `src/main.js`

**Change `src/main.js`** — the existing combined `keydown` listener (from the base plan's Tasks 6/8) gains a new branch at the top, before the Delete/Backspace check:

Replace:

```js
window.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
```

with:

```js
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault()
    wavesurfer.playPause()
    return
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
```

(The rest of the listener — the Delete/Backspace branch and the Tab branch — is unchanged.)

- [ ] Make the edit above
- [ ] Run `npm run build` — expect success
- [ ] Manual check: `npm run dev`, upload a file, press spacebar with no input focused — confirm playback toggles; click the "Play"/"Pause" button once (to give it focus) then press spacebar again — confirm it still toggles playback rather than re-clicking the button natively (since we `preventDefault()`)
- [ ] Commit: `git add src/main.js && git commit -m "feat: add spacebar play/pause"`

---

## Final Verification

- [ ] Run `npm test` — all 20 tests still pass (unchanged from the base plan; this work adds no new automated tests, per the design addendum's testing approach).
- [ ] Run `npm run build` — succeeds.
- [ ] Full manual walkthrough per the design addendum's "Manual checks to add" list.
