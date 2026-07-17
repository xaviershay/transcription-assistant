# Ear Transcriber Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a client-side web page for transcribing music by ear: upload audio, scrub/zoom a waveform, loop selected sections at adjustable pitch-preserved speed, read a note-labeled spectrum of the looping section, and cycle between multiple saved selections with a hotkey.

**Architecture:** Vite-bundled vanilla JS single-page app. wavesurfer.js (with its Regions plugin) owns waveform rendering, playback, zoom, and selection regions. A small set of pure, unit-tested modules (`notes.js`, `selections.js`) hold logic that's easy to get wrong (frequency→note math, region ordering/wraparound); DOM wiring lives in `main.js` and is verified manually in the browser per the spec's testing approach. A Web Audio `AnalyserNode` tapped off wavesurfer's own media element drives the spectrum panel.

**Tech Stack:** Vite 5, vitest 2, wavesurfer.js 7.12.11 (pinned — its `Player.setPlaybackRate(rate, preservePitch)` and Regions plugin API are the load-bearing APIs this plan is written against). No other runtime dependencies.

## Global Constraints

- wavesurfer.js version pinned to `7.12.11` (exact API — `setPlaybackRate`, `getMediaElement`, Regions plugin — verified against this version's type declarations).
- Note naming: A440 tuning, 12-tone equal temperament, scientific pitch notation (MIDI 69 = `A4`, MIDI 60 = `C4`).
- Displayed note/frequency range: piano range A0 (27.5 Hz) to C8 (4186 Hz).
- No backend, no persistence — everything in-memory (per spec).
- No automated tests for DOM/wavesurfer wiring (per spec's testing approach) — automated vitest coverage is limited to the pure logic in `notes.js` and `selections.js`; everything else is verified manually in the browser as described in each task.

---

## File Structure

```
transcriber/
  package.json
  vite.config.js
  index.html
  src/
    style.css
    main.js            # DOM wiring / bootstrap, imports everything else
    waveform.js         # wavesurfer + Regions plugin instance creation
    notes.js             # pure: frequency <-> MIDI <-> note name
    notes.test.js
    selections.js         # pure: region sorting / next-prev-with-wrap
    selections.test.js
    selectionsList.js      # pure-ish DOM rendering of the selections <ul>
    spectrum.js              # AnalyserNode setup + canvas draw loop
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `index.html`
- Create: `src/style.css`
- Create: `src/main.js`

**Interfaces:**
- Produces: a Vite project buildable with `npm run build`, servable with `npm run dev`, testable with `npm test`. DOM ids later tasks rely on: `#upload`, `#upload-error`, `#zoom`, `#waveform`, `#play-pause`, `#speed`, `#speed-label`, `#active-label`, `#spectrum`, `#selections-list`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "ear-transcriber",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "wavesurfer.js": "7.12.11"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `vite.config.js`**

```js
import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 3: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ear Transcriber</title>
  </head>
  <body>
    <main>
      <h1>Ear Transcriber</h1>

      <section id="upload-section">
        <input type="file" id="upload" accept="audio/*" />
        <p id="upload-error" class="error" hidden></p>
      </section>

      <section id="waveform-section">
        <label for="zoom">Zoom</label>
        <input type="range" id="zoom" min="10" max="500" value="50" />
        <div id="waveform"></div>
      </section>

      <section id="controls-section">
        <button id="play-pause" disabled>Play</button>
        <label for="speed">Speed</label>
        <input type="range" id="speed" min="0.25" max="1.5" step="0.05" value="1" />
        <span id="speed-label">1.00x</span>
        <span id="active-label"></span>
      </section>

      <section id="spectrum-section">
        <canvas id="spectrum" width="800" height="200"></canvas>
      </section>

      <section id="selections-section">
        <h2>Selections</h2>
        <ul id="selections-list"></ul>
      </section>
    </main>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 4: Write `src/style.css`**

```css
:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
}

body {
  margin: 0 auto;
  max-width: 900px;
  padding: 1rem;
}

#waveform {
  border: 1px solid currentColor;
  margin-block: 0.5rem;
}

.error {
  color: #c0392b;
}

#selections-list {
  list-style: none;
  padding: 0;
}

#selections-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.25rem 0.5rem;
  border: 1px solid transparent;
}

#selections-list li.active {
  border-color: currentColor;
  font-weight: bold;
}
```

- [ ] **Step 5: Write `src/main.js`**

```js
import './style.css'

console.log('Ear Transcriber loaded')
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: installs without error, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: exits 0, creates `dist/` with `index.html` and bundled assets.

- [ ] **Step 8: Manual check — dev server**

Run: `npm run dev` (leave running), open the printed localhost URL in a browser.
Expected: page loads showing the "Ear Transcriber" heading, an empty waveform box, and a disabled "Play" button. Browser console shows "Ear Transcriber loaded" with no errors. Stop the dev server after checking.

- [ ] **Step 9: Commit**

```bash
git add package.json vite.config.js index.html src/style.css src/main.js package-lock.json
git commit -m "chore: scaffold vite project"
```

---

### Task 2: Frequency/note conversion (`notes.js`)

**Files:**
- Create: `src/notes.js`
- Create: `src/notes.test.js`

**Interfaces:**
- Produces: `midiFromFrequency(freq: number): number`, `frequencyFromMidi(midi: number): number`, `noteNameFromMidi(midi: number): string`, `frequencyToNoteName(freq: number): string`. Used by `spectrum.js` (Task 7).

- [ ] **Step 1: Write the failing tests**

```js
// src/notes.test.js
import { describe, it, expect } from 'vitest'
import {
  midiFromFrequency,
  frequencyFromMidi,
  noteNameFromMidi,
  frequencyToNoteName,
} from './notes.js'

describe('midiFromFrequency', () => {
  it('returns 69 for A440', () => {
    expect(midiFromFrequency(440)).toBeCloseTo(69, 5)
  })

  it('returns approximately 60 for middle C (261.6256 Hz)', () => {
    expect(midiFromFrequency(261.6256)).toBeCloseTo(60, 2)
  })
})

describe('frequencyFromMidi', () => {
  it('returns 440 for midi 69', () => {
    expect(frequencyFromMidi(69)).toBeCloseTo(440, 5)
  })
})

describe('noteNameFromMidi', () => {
  it('names midi 69 as A4', () => {
    expect(noteNameFromMidi(69)).toBe('A4')
  })

  it('names midi 60 as C4', () => {
    expect(noteNameFromMidi(60)).toBe('C4')
  })

  it('names midi 61 as C#4', () => {
    expect(noteNameFromMidi(61)).toBe('C#4')
  })

  it('rounds midi 69.4 to A4', () => {
    expect(noteNameFromMidi(69.4)).toBe('A4')
  })

  it('names midi 21 as A0 (lowest piano key)', () => {
    expect(noteNameFromMidi(21)).toBe('A0')
  })
})

describe('frequencyToNoteName', () => {
  it('identifies 440Hz as A4', () => {
    expect(frequencyToNoteName(440)).toBe('A4')
  })

  it('identifies 523.25Hz as C5', () => {
    expect(frequencyToNoteName(523.25)).toBe('C5')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/notes.test.js`
Expected: FAIL — `Cannot find module './notes.js'` (or similar).

- [ ] **Step 3: Write `src/notes.js`**

```js
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function midiFromFrequency(freq) {
  return 69 + 12 * Math.log2(freq / 440)
}

export function frequencyFromMidi(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function noteNameFromMidi(midi) {
  const rounded = Math.round(midi)
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12]
  const octave = Math.floor(rounded / 12) - 1
  return `${name}${octave}`
}

export function frequencyToNoteName(freq) {
  return noteNameFromMidi(midiFromFrequency(freq))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/notes.test.js`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/notes.js src/notes.test.js
git commit -m "feat: add frequency/note conversion helpers"
```

---

### Task 3: Waveform rendering, upload, zoom, load errors

**Files:**
- Create: `src/waveform.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: DOM ids from Task 1 (`#upload`, `#upload-error`, `#zoom`, `#waveform`, `#play-pause`).
- Produces: `createWaveSurfer(container: HTMLElement): { wavesurfer: WaveSurfer, regions: RegionsPlugin }`. `wavesurfer` and `regions` (the module-level variables in `main.js`) are consumed by Tasks 4, 6, 7, 8.

- [ ] **Step 1: Write `src/waveform.js`**

```js
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'

export function createWaveSurfer(container) {
  const regions = RegionsPlugin.create()

  const wavesurfer = WaveSurfer.create({
    container,
    waveColor: '#4f6df5',
    progressColor: '#2c3e91',
    cursorColor: '#333',
    height: 120,
    minPxPerSec: 50,
    plugins: [regions],
  })

  return { wavesurfer, regions }
}
```

- [ ] **Step 2: Replace `src/main.js`**

```js
import './style.css'
import { createWaveSurfer } from './waveform.js'

const uploadInput = document.getElementById('upload')
const uploadError = document.getElementById('upload-error')
const zoomInput = document.getElementById('zoom')
const waveformContainer = document.getElementById('waveform')
const playPauseBtn = document.getElementById('play-pause')

const { wavesurfer, regions } = createWaveSurfer(waveformContainer)

wavesurfer.on('error', (error) => {
  uploadError.textContent = `Could not load audio file: ${error.message}`
  uploadError.hidden = false
  playPauseBtn.disabled = true
})

wavesurfer.on('ready', () => {
  uploadError.hidden = true
  playPauseBtn.disabled = false
})

uploadInput.addEventListener('change', () => {
  const file = uploadInput.files[0]
  if (!file) return
  uploadError.hidden = true
  wavesurfer.loadBlob(file)
})

zoomInput.addEventListener('input', () => {
  wavesurfer.zoom(Number(zoomInput.value))
})
```

- [ ] **Step 3: Manual check — waveform, zoom, error handling**

Run: `npm run dev`, open the browser.
1. Upload a real audio file (mp3/wav). Expected: waveform draws, "Play" button becomes enabled.
2. Drag the zoom slider. Expected: waveform redraws wider/narrower horizontally.
3. Create a bogus file and upload it: `head -c 100 /dev/urandom > /tmp/fake.mp3`, upload `/tmp/fake.mp3`. Expected: red error text appears below the upload input, "Play" stays disabled.

- [ ] **Step 4: Commit**

```bash
git add src/waveform.js src/main.js
git commit -m "feat: render waveform from uploaded audio with zoom and error handling"
```

---

### Task 4: Playback controls (play/pause, pitch-preserving speed)

**Files:**
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `wavesurfer` from Task 3, DOM ids `#speed`, `#speed-label`, `#play-pause`.

- [ ] **Step 1: Append to `src/main.js`**

```js
const speedInput = document.getElementById('speed')
const speedLabel = document.getElementById('speed-label')

playPauseBtn.addEventListener('click', () => {
  wavesurfer.playPause()
})

wavesurfer.on('play', () => {
  playPauseBtn.textContent = 'Pause'
})

wavesurfer.on('pause', () => {
  playPauseBtn.textContent = 'Play'
})

speedInput.addEventListener('input', () => {
  const rate = Number(speedInput.value)
  wavesurfer.setPlaybackRate(rate, true)
  speedLabel.textContent = `${rate.toFixed(2)}x`
})
```

- [ ] **Step 2: Manual check — playback and pitch-preserving speed**

Run: `npm run dev`, upload an audio file with a clear sustained note or vocal line.
1. Click "Play". Expected: audio plays, button label switches to "Pause"; click again, audio pauses, label back to "Play".
2. While playing, drag speed slider to `0.5`. Expected: playback audibly slows to half speed; the pitch of the note/vocal stays the same (does not drop an octave); label shows "0.50x".
3. Drag speed back to `1.00`. Expected: playback returns to normal speed and pitch.

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat: add play/pause and pitch-preserving speed control"
```

---

### Task 5: Region ordering/cycling logic (`selections.js`)

**Files:**
- Create: `src/selections.js`
- Create: `src/selections.test.js`

**Interfaces:**
- Produces: `sortRegionsByStart(regions: Array<{id: string, start: number}>): Array<{id, start}>` (new sorted array, does not mutate input), `getAdjacentRegionId(sortedRegions: Array<{id, start}>, activeId: string|null, direction: 'next'|'prev'): string|null`. Consumed by Task 6 and Task 8. Designed to work directly with wavesurfer `Region` objects (which have `.id` and `.start`) or plain test doubles.

- [ ] **Step 1: Write the failing tests**

```js
// src/selections.test.js
import { describe, it, expect } from 'vitest'
import { sortRegionsByStart, getAdjacentRegionId } from './selections.js'

function region(id, start) {
  return { id, start }
}

describe('sortRegionsByStart', () => {
  it('sorts regions by start time ascending', () => {
    const list = [region('b', 5), region('a', 1), region('c', 3)]
    const sorted = sortRegionsByStart(list)
    expect(sorted.map((r) => r.id)).toEqual(['a', 'c', 'b'])
  })

  it('returns empty array for empty input', () => {
    expect(sortRegionsByStart([])).toEqual([])
  })

  it('does not mutate the input array', () => {
    const list = [region('b', 5), region('a', 1)]
    sortRegionsByStart(list)
    expect(list.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('getAdjacentRegionId', () => {
  const sorted = [region('a', 1), region('b', 3), region('c', 5)]

  it('returns null when there are no regions', () => {
    expect(getAdjacentRegionId([], 'a', 'next')).toBeNull()
  })

  it('returns the next region id', () => {
    expect(getAdjacentRegionId(sorted, 'a', 'next')).toBe('b')
  })

  it('wraps to the first region when advancing past the last', () => {
    expect(getAdjacentRegionId(sorted, 'c', 'next')).toBe('a')
  })

  it('returns the previous region id', () => {
    expect(getAdjacentRegionId(sorted, 'b', 'prev')).toBe('a')
  })

  it('wraps to the last region when going previous from the first', () => {
    expect(getAdjacentRegionId(sorted, 'a', 'prev')).toBe('c')
  })

  it('returns the first region when nothing is active and direction is next', () => {
    expect(getAdjacentRegionId(sorted, null, 'next')).toBe('a')
  })

  it('returns the last region when nothing is active and direction is prev', () => {
    expect(getAdjacentRegionId(sorted, null, 'prev')).toBe('c')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/selections.test.js`
Expected: FAIL — `Cannot find module './selections.js'`.

- [ ] **Step 3: Write `src/selections.js`**

```js
export function sortRegionsByStart(regions) {
  return [...regions].sort((a, b) => a.start - b.start)
}

export function getAdjacentRegionId(sortedRegions, activeId, direction) {
  if (sortedRegions.length === 0) return null

  const currentIndex = sortedRegions.findIndex((r) => r.id === activeId)
  if (currentIndex === -1) {
    return direction === 'next'
      ? sortedRegions[0].id
      : sortedRegions[sortedRegions.length - 1].id
  }

  const step = direction === 'next' ? 1 : -1
  const nextIndex = (currentIndex + step + sortedRegions.length) % sortedRegions.length
  return sortedRegions[nextIndex].id
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/selections.test.js`
Expected: PASS, all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/selections.js src/selections.test.js
git commit -m "feat: add region ordering and cycling logic"
```

---

### Task 6: Selections — create, list, activate+loop, delete

**Files:**
- Create: `src/selectionsList.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `regions` (RegionsPlugin) from Task 3, `sortRegionsByStart` from Task 5, DOM ids `#selections-list`, `#active-label`.
- Produces: `renderSelectionsList(listEl: HTMLElement, sortedRegions: Region[], activeId: string|null, handlers: {onActivate(id), onDelete(id)}): void`. Module-level `activeRegionId` and `activateRegion(id)` in `main.js`, consumed by Task 7 and Task 8.

- [ ] **Step 1: Write `src/selectionsList.js`**

```js
export function renderSelectionsList(listEl, sortedRegions, activeId, { onActivate, onDelete }) {
  listEl.innerHTML = ''

  sortedRegions.forEach((region) => {
    const li = document.createElement('li')
    li.className = region.id === activeId ? 'active' : ''

    const label = document.createElement('span')
    label.textContent = `${region.start.toFixed(2)}s – ${region.end.toFixed(2)}s`
    label.addEventListener('click', () => onActivate(region.id))

    const deleteBtn = document.createElement('button')
    deleteBtn.textContent = 'Delete'
    deleteBtn.addEventListener('click', () => onDelete(region.id))

    li.append(label, deleteBtn)
    listEl.append(li)
  })
}
```

- [ ] **Step 2: Append to `src/main.js`**

```js
import { sortRegionsByStart } from './selections.js'
import { renderSelectionsList } from './selectionsList.js'

const selectionsListEl = document.getElementById('selections-list')
const activeLabel = document.getElementById('active-label')

let activeRegionId = null

function refreshSelectionsList() {
  const sorted = sortRegionsByStart(regions.getRegions())
  renderSelectionsList(selectionsListEl, sorted, activeRegionId, {
    onActivate: activateRegion,
    onDelete: (id) => {
      const region = regions.getRegions().find((r) => r.id === id)
      if (region) region.remove()
    },
  })
}

function activateRegion(id) {
  const region = regions.getRegions().find((r) => r.id === id)
  if (!region) return
  activeRegionId = id
  activeLabel.textContent = `Looping: ${region.start.toFixed(2)}s – ${region.end.toFixed(2)}s`
  refreshSelectionsList()
  region.play()
}

regions.enableDragSelection({ color: 'rgba(79, 109, 245, 0.2)' })

regions.on('region-created', () => refreshSelectionsList())

regions.on('region-removed', (region) => {
  if (region.id === activeRegionId) {
    activeRegionId = null
    activeLabel.textContent = ''
  }
  refreshSelectionsList()
})

regions.on('region-clicked', (region, e) => {
  e.stopPropagation()
  activateRegion(region.id)
})

regions.on('region-out', (region) => {
  if (region.id === activeRegionId) {
    region.play()
  }
})

wavesurfer.on('interaction', () => {
  activeRegionId = null
  activeLabel.textContent = ''
  refreshSelectionsList()
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!activeRegionId) return
    const region = regions.getRegions().find((r) => r.id === activeRegionId)
    if (region) region.remove()
  }
})
```

- [ ] **Step 3: Manual check — selections**

Run: `npm run dev`, upload an audio file.
1. Drag a small section of the waveform. Expected: a highlighted region appears, and a matching row shows in the "Selections" list below with its start/end times.
2. Create a second region elsewhere on the waveform. Expected: second row appears in the list, ordered by time.
3. Click the first region (on the waveform, or its label in the list). Expected: playback jumps there and loops that region repeatedly (audibly repeats); the "Looping: …" label updates; the row is highlighted (bold/bordered).
4. Click on an empty part of the waveform (not a region). Expected: looping stops, active label clears, no row highlighted.
5. Activate a region, press `Delete`. Expected: that region disappears from the waveform and the list.

- [ ] **Step 4: Commit**

```bash
git add src/selectionsList.js src/main.js
git commit -m "feat: add region creation, list, activate-to-loop, and delete"
```

---

### Task 7: Spectrum panel with note-labeled axis

**Files:**
- Create: `src/spectrum.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `wavesurfer` from Task 3, `frequencyToNoteName` from Task 2, DOM id `#spectrum`.
- Produces: `createSpectrumAnalyser(wavesurfer: WaveSurfer, canvas: HTMLCanvasElement): { start(): void, stop(): void }`.

- [ ] **Step 1: Write `src/spectrum.js`**

```js
import { frequencyToNoteName } from './notes.js'

const MIN_FREQ = 27.5 // A0
const MAX_FREQ = 4186 // C8
const LOG_MIN = Math.log2(MIN_FREQ)
const LOG_MAX = Math.log2(MAX_FREQ)

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

  let animationFrame = null

  function xForFreq(freq) {
    return ((Math.log2(freq) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * canvas.width
  }

  function draw() {
    analyser.getByteFrequencyData(freqData)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    ctx.fillStyle = '#4f6df5'
    for (let i = 0; i < freqData.length; i++) {
      const freq = i * binHz
      if (freq < MIN_FREQ || freq > MAX_FREQ) continue
      const x = xForFreq(freq)
      const barHeight = (freqData[i] / 255) * canvas.height
      ctx.fillRect(x, canvas.height - barHeight, 2, barHeight)
    }

    ctx.fillStyle = '#333'
    ctx.font = '10px sans-serif'
    for (let midi = 21; midi <= 108; midi += 3) {
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

- [ ] **Step 2: Modify `src/main.js`**

Add the import near the top, with the other imports:

```js
import { createSpectrumAnalyser } from './spectrum.js'
```

Add the canvas reference and analyser variable near the other `getElementById` calls:

```js
const spectrumCanvas = document.getElementById('spectrum')
let spectrumAnalyser = null
```

Replace the existing `wavesurfer.on('ready', ...)` handler (written in Task 3) with:

```js
wavesurfer.on('ready', () => {
  uploadError.hidden = true
  playPauseBtn.disabled = false
  if (!spectrumAnalyser) {
    spectrumAnalyser = createSpectrumAnalyser(wavesurfer, spectrumCanvas)
  }
})
```

Replace the existing `wavesurfer.on('play', ...)` and `wavesurfer.on('pause', ...)` handlers (written in Task 4) with:

```js
wavesurfer.on('play', () => {
  playPauseBtn.textContent = 'Pause'
  spectrumAnalyser?.start()
})

wavesurfer.on('pause', () => {
  playPauseBtn.textContent = 'Play'
  spectrumAnalyser?.stop()
})
```

- [ ] **Step 3: Manual check — spectrum panel**

Run: `npm run dev`, upload an audio file that contains a clear single sustained note (or generate one: `python3 -c "import numpy,scipy.io.wavfile as w; sr=44100; t=numpy.linspace(0,2,sr*2); w.write('/tmp/a440.wav', sr, (numpy.sin(2*numpy.pi*440*t)*32767).astype(numpy.int16))"` produces a 2s A440 tone at `/tmp/a440.wav`).
1. Play the file. Expected: bars appear on the spectrum canvas, moving live; note labels (e.g. `A0`, `C1`, ...) are visible along the bottom axis.
2. For the A440 test tone specifically: expected a strong bar cluster near the `A4` label.
3. Pause. Expected: bars freeze in place (draw loop stops).

- [ ] **Step 4: Commit**

```bash
git add src/spectrum.js src/main.js
git commit -m "feat: add note-labeled spectrum panel"
```

---

### Task 8: Hotkey cycling between selections

**Files:**
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `getAdjacentRegionId`, `sortRegionsByStart` from Task 5; `activateRegion`, `activeRegionId`, `regions` from Task 6.

- [ ] **Step 1: Modify `src/main.js`**

Add the import next to the existing `selections.js` import (written in Task 6):

```js
import { sortRegionsByStart, getAdjacentRegionId } from './selections.js'
```

Replace the keydown listener written in Task 6 with one handling both Delete/Backspace and Tab cycling:

```js
window.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!activeRegionId) return
    const region = regions.getRegions().find((r) => r.id === activeRegionId)
    if (region) region.remove()
    return
  }

  if (e.key === 'Tab') {
    e.preventDefault()
    const sorted = sortRegionsByStart(regions.getRegions())
    const direction = e.shiftKey ? 'prev' : 'next'
    const nextId = getAdjacentRegionId(sorted, activeRegionId, direction)
    if (nextId) activateRegion(nextId)
  }
})
```

- [ ] **Step 2: Manual check — hotkey cycling**

Run: `npm run dev`, upload an audio file, drag out 3 separate regions across the waveform.
1. Press `Tab` with no region active. Expected: first (earliest) region activates and loops.
2. Press `Tab` again. Expected: jumps to the second region, loops it.
3. Press `Tab` again. Expected: jumps to the third region, loops it.
4. Press `Tab` again. Expected: wraps back to the first region.
5. Press `Shift+Tab`. Expected: goes back to the third (previous in order, wrapping backward).

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "feat: add Tab/Shift+Tab hotkey cycling between selections"
```

---

## Final Verification

- [ ] Run `npm test` — all vitest suites (`notes.test.js`, `selections.test.js`) pass.
- [ ] Run `npm run build` — succeeds with no errors.
- [ ] Full manual walkthrough in browser: upload → zoom → play/pause → speed change (pitch preserved) → create multiple regions → click to loop → spectrum shows note-labeled peaks → Tab/Shift+Tab cycles → Delete removes active region → bad file shows error.
