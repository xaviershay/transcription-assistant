# Ear Transcriber Beat/Subdivision Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the waveform's seconds timeline with a beat/subdivision grid — sequentially-numbered beat marks plus unlabeled subdivision ticks between them — driven by tempo and subdivisions-per-beat sliders, and a starting offset set by clicking the waveform.

**Architecture:** wavesurfer's built-in Timeline plugin is reused (not hand-rolled) with computed options; its exact option semantics were verified empirically against the real running app before this plan was written (see the design doc). Timeline plugin ownership moves from `waveform.js` (created once, fixed) to `main.js` (created initially, then destroyed/recreated on any control change) — `waveform.js` keeps only the stable `regions` plugin.

**Tech Stack:** Same as the rest of the app — vanilla JS, wavesurfer.js 7.12.11's Timeline plugin. No new dependencies.

## Global Constraints

- Timeline option formula, verified empirically (see
  `docs/superpowers/specs/2026-07-18-ear-transcriber-beat-grid-design.md`
  for the full verification): given `secondsPerBeat = 60 / bpm`, use
  `timeInterval: secondsPerBeat / subdivisions`, `primaryLabelInterval:
  secondsPerBeat`, `timeOffset: offsetSeconds`, `formatTimeCallback: (t) =>
  String(Math.round(t / secondsPerBeat) + 1)`. Do not add
  `secondaryLabelInterval` — leaving it unset is what makes subdivision
  ticks render unlabeled.
- The Timeline plugin instance must be unregistered (`wavesurfer.
  unregisterPlugin(...)`) before registering a new one on every
  tempo/subdivisions/offset change — it has no live-update method.
- No time signature/measures — every beat numbered sequentially (1, 2, 3,
  ...), no downbeat distinction.
- No new CSS needed — the new controls reuse the existing generic
  `button`, `input[type='range']`, and `.panel` selectors already defined
  in `src/style.css`.

---

## File Structure

```
src/
  waveform.js    # MODIFIED — Timeline plugin creation removed, regions only
  main.js          # MODIFIED — Timeline plugin ownership, beat-grid controls wiring
index.html             # MODIFIED — new beat-grid controls panel
```

---

### Task 1: Remove Timeline plugin from `waveform.js`

**Files:**
- Modify: `src/waveform.js`

**Interfaces:**
- Produces: `createWaveSurfer(container)` now returns `{ wavesurfer,
  regions }` with `wavesurfer` carrying only the `regions` plugin at
  creation time (no `timeline`). Consumed by Task 3's `main.js`, which now
  owns Timeline plugin creation entirely.

- [ ] **Step 1: Replace `src/waveform.js`**

```js
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

- [ ] **Step 2: Commit**

```bash
git add src/waveform.js
git commit -m "refactor: move Timeline plugin ownership out of waveform.js"
```

(Build will be broken until Task 3 re-adds a Timeline plugin in `main.js`
— that's expected and fine to commit as an intermediate step, consistent
with how earlier plans in this project have sequenced tightly-coupled
multi-file changes. If you want a working tree at every commit, do Task 1
and Task 3's `main.js` edit together before committing either.)

---

### Task 2: Add beat-grid controls to `index.html`

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces: DOM ids `#tempo`, `#tempo-label`, `#subdivisions`,
  `#subdivisions-label`, `#set-beat-one`. Consumed by Task 3's `main.js`.

- [ ] **Step 1: Modify `index.html`** — insert a new panel between the
  waveform section and the controls section:

Replace:

```html
      <section id="waveform-section">
        <div id="waveform"></div>
      </section>

      <section id="controls-section" class="panel">
```

with:

```html
      <section id="waveform-section">
        <div id="waveform"></div>
      </section>

      <section id="beat-grid-section" class="panel">
        <label for="tempo">Tempo</label>
        <input type="range" id="tempo" min="40" max="240" step="1" value="120" />
        <span id="tempo-label">120 BPM</span>
        <label for="subdivisions">Subdivisions</label>
        <input type="range" id="subdivisions" min="1" max="8" step="1" value="4" />
        <span id="subdivisions-label">4</span>
        <button id="set-beat-one">Set Beat 1</button>
      </section>

      <section id="controls-section" class="panel">
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: add beat-grid controls panel to markup"
```

---

### Task 3: Wire beat-grid logic into `main.js`

**Files:**
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `wavesurfer` (from `createWaveSurfer`, Task 1), DOM ids from
  Task 2, the existing `wavesurfer.on('interaction', ...)` handler
  (written in the base plan's Task 6, later extended in the UI-polish
  round) which this task modifies further.

- [ ] **Step 1: Add the Timeline plugin import** near the top with the
  other imports:

```js
import TimelinePlugin from 'wavesurfer.js/plugins/timeline'
```

- [ ] **Step 2: Insert the beat-grid setup block** — after the existing
  waveform zoom/pan `wheel` listener (which ends with the line
  `)` closing `waveformContainer.addEventListener('wheel', ...)`) and
  before `const speedInput = document.getElementById('speed')`:

```js
const tempoSlider = document.getElementById('tempo')
const tempoLabel = document.getElementById('tempo-label')
const subdivisionsSlider = document.getElementById('subdivisions')
const subdivisionsLabel = document.getElementById('subdivisions-label')
const setBeatOneBtn = document.getElementById('set-beat-one')

let beatBpm = Number(tempoSlider.value)
let beatSubdivisions = Number(subdivisionsSlider.value)
let beatOffset = 0
let settingBeatOne = false
let timelinePlugin = null

function rebuildTimeline() {
  if (timelinePlugin) {
    wavesurfer.unregisterPlugin(timelinePlugin)
  }
  const secondsPerBeat = 60 / beatBpm
  timelinePlugin = TimelinePlugin.create({
    height: 20,
    timeInterval: secondsPerBeat / beatSubdivisions,
    primaryLabelInterval: secondsPerBeat,
    timeOffset: beatOffset,
    formatTimeCallback: (t) => String(Math.round(t / secondsPerBeat) + 1),
    style: { color: '#e6e6e6', fontSize: '10px' },
  })
  wavesurfer.registerPlugin(timelinePlugin)
}

rebuildTimeline()

tempoSlider.addEventListener('input', () => {
  beatBpm = Number(tempoSlider.value)
  tempoLabel.textContent = `${beatBpm} BPM`
  rebuildTimeline()
})

subdivisionsSlider.addEventListener('input', () => {
  beatSubdivisions = Number(subdivisionsSlider.value)
  subdivisionsLabel.textContent = String(beatSubdivisions)
  rebuildTimeline()
})

setBeatOneBtn.addEventListener('click', () => {
  settingBeatOne = true
  setBeatOneBtn.textContent = 'Click waveform…'
  setBeatOneBtn.disabled = true
})
```

- [ ] **Step 3: Modify the existing `interaction` handler** to capture the
  beat-1 offset when armed. Replace:

```js
wavesurfer.on('interaction', () => {
  activeRegionId = null
  activeLabel.textContent = ''
  refreshSelectionsList()
})
```

with:

```js
wavesurfer.on('interaction', (newTime) => {
  if (settingBeatOne) {
    beatOffset = newTime
    settingBeatOne = false
    setBeatOneBtn.textContent = 'Set Beat 1'
    setBeatOneBtn.disabled = false
    rebuildTimeline()
  }
  activeRegionId = null
  activeLabel.textContent = ''
  refreshSelectionsList()
})
```

- [ ] **Step 4: Run the full test suite and build**

Run: `npm test`
Expected: PASS, all 36 tests green (unchanged — this task adds no new
automated tests, DOM/wavesurfer wiring, consistent with the rest of the
app's testing approach).

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 5: Manual check — beat grid**

Run: `npm run dev`, upload an audio file.
1. Expected: the waveform's timeline immediately shows a beat grid
   starting at "1" from the left edge (default offset 0, 120 BPM, 4
   subdivisions) — a full-height labeled tick every beat, 3 shorter
   unlabeled ticks between each pair.
2. Drag the Tempo slider. Expected: the grid spacing changes live, labels
   stay sequential (1, 2, 3, ...).
3. Drag the Subdivisions slider to a different value (e.g. 3 or 6).
   Expected: the number of unlabeled ticks between each beat changes to
   match (subdivisions − 1 ticks between consecutive beat marks).
4. Click "Set Beat 1". Expected: button text changes to something like
   "Click waveform…" and disables (visually indicating armed state).
   Click somewhere on the waveform. Expected: the grid shifts so "1" now
   starts at that clicked position (nothing rendered before it); the
   button reverts to "Set Beat 1" and re-enables; the playhead also seeks
   there (expected side effect of the click).
5. Confirm existing waveform interactions still work: dragging still
   creates a selection region, clicking an existing region still loops
   it, zoom/pan via wheel still works.

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat: wire beat-grid tempo/subdivisions/offset controls"
```

---

## Final Verification

- [ ] Run `npm test` — all 36 tests pass.
- [ ] Run `npm run build` — succeeds.
- [ ] Full manual walkthrough per Task 3 Step 5.
