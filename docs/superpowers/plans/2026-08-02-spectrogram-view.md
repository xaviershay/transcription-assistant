# Spectrogram View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a spectrogram visualization at the bottom of the page — time on the x axis (synced to the main waveform's pan/zoom), frequency on the y axis, color for amplitude — using wavesurfer.js's official Spectrogram plugin.

**Architecture:** `wavesurfer.js/plugins/spectrogram`'s `SpectrogramPlugin` is registered on the same `wavesurfer` instance as the existing `RegionsPlugin`, targeting a new dedicated container element, so it renders from the same decoded buffer. It automatically stays in sync with the waveform on zoom, but — per a real gap found during Task 1's manual verification (see the Post-plan correction below) — pan and playback-follow require a small manual sync in `main.js` (Task 2), driving the plugin's container position from `wavesurfer`'s own `scroll`/`redraw` events.

**Tech Stack:** `wavesurfer.js` (already a dependency) and its bundled Spectrogram plugin. No new dependencies, no new test infrastructure.

## Global Constraints

- The spectrogram reflects the original decoded audio (the same buffer the waveform renders from), not the post-EQ signal — the 3-band EQ is a separate downstream Web Audio graph that doesn't touch wavesurfer's own buffer. (Spec: Plugin configuration)
- Sync with the waveform's zoom is automatic via wavesurfer's plugin mechanism. Sync with pan/playback-follow is NOT automatic (a confirmed upstream gap, not a config mistake) and requires the manual `scroll`/`redraw` wiring added in Task 2 — see the Post-plan correction and the spec's Correction section. (Spec: Sync with the main waveform)
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
4. Pan the main waveform (shift+wheel, or scroll) — confirm the spectrogram pans in sync, showing the same time range as the waveform (expected to fail at this point — see Post-plan correction).
5. Play the file and confirm the spectrogram doesn't need to be re-triggered — it was already fully rendered from upload, independent of playback.
6. Confirm no console errors during upload/zoom/pan.

- [ ] **Step 7: Commit**

```bash
git add index.html src/style.css src/waveform.js src/main.js
git commit -m "Add spectrogram view synced to the main waveform"
```

---

## Post-plan correction: manual scroll sync required (found in manual verification)

The manual browser verification in Task 1's Step 6 found that the plugin
does **not** actually keep the spectrogram in sync with the waveform for
pan or playback-follow — only zoom happens to look correct (and only
because the plugin fully re-renders from position 0 on every zoom change).
This was confirmed with direct event instrumentation in a real browser,
and confirmed not fixable by switching to the newer
`spectrogram-windowed` plugin variant or by disabling `useWebWorker`. Full
investigation and evidence in the design spec's "Correction" section
(`docs/superpowers/specs/2026-08-02-spectrogram-view-design.md`).

This invalidated Global Constraint #2 above, which originally asserted that
sync with the waveform (including pan/playback-follow) was fully automatic
and that no code should manually listen to scroll/zoom events — an assumption
Task 1's own verification disproved. That constraint has since been rewritten
in place (see its current text above) to instead require the manual
`scroll`/`redraw` wiring Task 2 below adds.

### Task 2: Manually sync the spectrogram's scroll position

**Files:**
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `wavesurfer`, `spectrogramContainer` (both already in scope in `main.js` from Task 1).
- Produces: nothing new consumed by later tasks — this is the last task in this plan.

- [ ] **Step 1: Add the sync function and wire it to `wavesurfer`'s `scroll` and `redraw` events**

In `src/main.js`, change:

```javascript
const { wavesurfer, regions, spectrogram } = createWaveSurfer(waveformContainer, spectrogramContainer)

spectrogram.on('error', (error) => {
  showToast(`Could not render spectrogram: ${error.message}`)
})
```

to:

```javascript
const { wavesurfer, regions, spectrogram } = createWaveSurfer(waveformContainer, spectrogramContainer)

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
function syncSpectrogramScroll() {
  const wideCanvas = [...spectrogramContainer.querySelectorAll('canvas')].find(
    (c) => c.width > spectrogramContainer.clientWidth,
  )
  if (wideCanvas && wideCanvas.parentElement) {
    wideCanvas.parentElement.style.transform = `translateX(${-wavesurfer.getScroll()}px)`
  }
}
wavesurfer.on('scroll', syncSpectrogramScroll)
wavesurfer.on('redraw', syncSpectrogramScroll)
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no test covers `main.js` — this confirms nothing else broke).

- [ ] **Step 3: Verify manually**

Run: `bin/dev`, open http://localhost:5173.

1. Upload an audio file with varied frequency content over its duration (e.g. something with a rising pitch, a fade, or distinct sections) so panning to a different part of the track is visually obvious in the spectrogram.
2. Zoom the waveform in significantly (mouse wheel over the waveform, positioned over the waveform itself so the zoom handler actually fires).
3. Pan the waveform (shift+wheel, or scroll) to a different part of the track. Confirm the spectrogram's visible content changes to match — NOT frozen on the original view.
4. Confirm the frequency-axis labels stay pinned on the left edge (don't pan away with the content).
5. Click Play from a zoomed-in view and let it run a few seconds so the waveform auto-scrolls to follow the playhead. Confirm the spectrogram scrolls along with it in real time, not just after the fact.
6. Zoom again after having panned/played - confirm the spectrogram correctly resets to show the current (not stale) time position, not snapping back to the very start of the track.
7. Confirm no console errors throughout.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "Manually sync spectrogram scroll position with the waveform"
```
