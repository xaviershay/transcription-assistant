# Spectrogram View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a spectrogram visualization at the bottom of the page — time on the x axis (synced to the main waveform's pan/zoom), frequency on the y axis, color for amplitude — using wavesurfer.js's official Spectrogram plugin.

**Architecture:** `wavesurfer.js/plugins/spectrogram`'s `SpectrogramPlugin` is registered on the same `wavesurfer` instance as the existing `RegionsPlugin`, targeting a new dedicated container element. Because it's a real wavesurfer plugin, it automatically renders from the same decoded buffer and stays in sync with pan/zoom — no manual scroll/zoom wiring needed.

**Tech Stack:** `wavesurfer.js` (already a dependency) and its bundled Spectrogram plugin. No new dependencies, no new test infrastructure.

## Global Constraints

- The spectrogram reflects the original decoded audio (the same buffer the waveform renders from), not the post-EQ signal — the 3-band EQ is a separate downstream Web Audio graph that doesn't touch wavesurfer's own buffer. (Spec: Plugin configuration)
- Sync with the waveform's pan/zoom is automatic via wavesurfer's plugin mechanism — no code should manually listen to scroll/zoom events to drive the spectrogram. (Spec: Sync with the main waveform)
- No new test infrastructure — this is plugin registration and static config, the same untested-by-convention treatment `TimelinePlugin`/`RegionsPlugin` registration already gets. (Spec: Testing)

---

## File Structure

- Modify: `src/waveform.js` — `createWaveSurfer(container, spectrogramContainer)` gains a second parameter, registers `SpectrogramPlugin`.
- Modify: `index.html` — new `#spectrogram-section` at the bottom of `<main>`.
- Modify: `src/style.css` — container styling matching `#waveform`/`#spectrum`.
- Modify: `src/main.js` — passes the new container into `createWaveSurfer(...)`, wires the plugin's `error` event to `showToast`.

---

### Task 1: Register and configure the Spectrogram plugin

**Files:**
- Modify: `src/waveform.js`
- Modify: `index.html`
- Modify: `src/style.css`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `showToast` (already imported in `main.js`, from the toast work on this branch).
- Produces: `createWaveSurfer(container, spectrogramContainer)` returns `{ wavesurfer, regions, spectrogram }` — `spectrogram` is the created `SpectrogramPlugin` instance, needed by `main.js` to attach the `error` listener. Last task for this plan.

- [ ] **Step 1: Add the markup**

In `index.html`, change:

```html
      <section id="selections-section" class="panel">
        <div class="selections-header">
          <h2>Selections</h2>
          <label for="onset-sensitivity">Sensitivity</label>
          <input type="range" id="onset-sensitivity" min="0.2" max="2.5" step="0.1" value="1.0" disabled />
          <button id="delete-all-selections" disabled>Delete All</button>
        </div>
        <ul id="selections-list"></ul>
      </section>

      <footer>Made by <a href="https://xaviershay.com" target="_blank" rel="noopener">Xavier Shay</a></footer>
```

to:

```html
      <section id="selections-section" class="panel">
        <div class="selections-header">
          <h2>Selections</h2>
          <label for="onset-sensitivity">Sensitivity</label>
          <input type="range" id="onset-sensitivity" min="0.2" max="2.5" step="0.1" value="1.0" disabled />
          <button id="delete-all-selections" disabled>Delete All</button>
        </div>
        <ul id="selections-list"></ul>
      </section>

      <section id="spectrogram-section">
        <div id="spectrogram"></div>
      </section>

      <footer>Made by <a href="https://xaviershay.com" target="_blank" rel="noopener">Xavier Shay</a></footer>
```

- [ ] **Step 2: Add the CSS**

In `src/style.css`, add (near the existing `#waveform`/`#spectrum` rules):

```css
#spectrogram {
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  margin-block: 0.5rem;
  overflow: hidden;
}
```

- [ ] **Step 3: Register the plugin in `waveform.js`**

Change:

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

to:

```javascript
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import SpectrogramPlugin from 'wavesurfer.js/plugins/spectrogram'

export function createWaveSurfer(container, spectrogramContainer) {
  const regions = RegionsPlugin.create()
  const spectrogram = SpectrogramPlugin.create({
    container: spectrogramContainer,
    height: 200,
    labels: true,
    scale: 'logarithmic',
    frequencyMin: 27.5,
    frequencyMax: 4186,
    colorMap: 'roseus',
    useWebWorker: true,
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

- [ ] **Step 4: Wire it up in `main.js`**

Change:

```javascript
const uploadInput = document.getElementById('upload')
const uploadFilename = document.getElementById('upload-filename')
const waveformContainer = document.getElementById('waveform')
const playPauseBtn = document.getElementById('play-pause')
const spectrumCanvas = document.getElementById('spectrum')
let spectrumAnalyser = null

const { wavesurfer, regions } = createWaveSurfer(waveformContainer)
```

to:

```javascript
const uploadInput = document.getElementById('upload')
const uploadFilename = document.getElementById('upload-filename')
const waveformContainer = document.getElementById('waveform')
const spectrogramContainer = document.getElementById('spectrogram')
const playPauseBtn = document.getElementById('play-pause')
const spectrumCanvas = document.getElementById('spectrum')
let spectrumAnalyser = null

const { wavesurfer, regions, spectrogram } = createWaveSurfer(waveformContainer, spectrogramContainer)

spectrogram.on('error', (error) => {
  showToast(`Could not render spectrogram: ${error.message}`)
})
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no test covers `waveform.js`/`main.js` — this confirms nothing else broke).

- [ ] **Step 6: Verify manually**

Run: `bin/dev`, open http://localhost:5173.

1. Upload an audio file. Confirm a spectrogram appears below the Selections section, with visible frequency-axis labels.
2. Confirm the spectrogram's colors follow a purple → teal → yellow progression (the `roseus` colormap) rather than a single-hue ramp.
3. Zoom the main waveform in/out (mouse wheel over the waveform) — confirm the spectrogram's visible time window zooms in sync.
4. Pan the main waveform (shift+wheel, or scroll) — confirm the spectrogram pans in sync, showing the same time range as the waveform.
5. Play the file and confirm the spectrogram doesn't need to be re-triggered — it was already fully rendered from upload, independent of playback.
6. Confirm no console errors during upload/zoom/pan.

- [ ] **Step 7: Commit**

```bash
git add index.html src/style.css src/waveform.js src/main.js
git commit -m "Add spectrogram view synced to the main waveform"
```
