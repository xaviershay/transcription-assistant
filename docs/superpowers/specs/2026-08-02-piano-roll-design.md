# Piano-roll frequency view (replaces the spectrogram)

## Problem

The just-shipped spectrogram (time horizontal, frequency vertical, using
wavesurfer.js's official plugin) has three real usability problems once
actually used:

1. The `roseus` colormap is too saturated across most of its range —
   individual note peaks don't stand out the way they do in the
   real-time spectrum analyzer (`spectrum.js`), which explicitly
   highlights local-maximum semitones in green.
2. The range needs to reach C7, not stop at C5.
3. Continuous, unquantized frequency content is harder to read than
   discrete note rows.

Separately, the orientation itself is being reconsidered: frequency
horizontal, time vertical — closer to how a piano roll displays notes —
would use the page's width better than a narrow vertical strip squeezed
under the waveform. wavesurfer.js's Spectrogram plugin has no orientation
option (confirmed by reading its type definitions/source) and is
architecturally time-horizontal by design, so this isn't achievable by
configuring the existing plugin.

This replaces the plugin-based spectrogram entirely with a hand-built
piano-roll-style view: frequency horizontal (quantized to semitone
columns, C2–C7), time vertical, computed from the app's own STFT (reusing
`onsets.js`'s existing FFT machinery) and bucketed into semitones using
the exact same logic the real-time analyzer already uses
(`spectrum-bars.js`'s `computeNoteBuckets`/`computePeakMidis`).

**Removed**: the `SpectrogramPlugin` registration in `waveform.js`, the
`#spectrogram`/`#spectrogram-labels` markup and CSS, the manual
`syncSpectrogramScroll` workaround, and `spectrogramLabels.js` (its
vertical-axis-specific label math doesn't apply to the new horizontal
axis, and the old C2–C5 crop is superseded by C2–C7 — nothing in it is
reused).

## Sync behavior

Chosen: the piano roll shows exactly whatever time range is currently
visible in the horizontal waveform above it, panning/zooming together —
re-deriving, in the vertical axis, the same kind of sync the previous
spectrogram needed in the horizontal axis. This uses the same
`wavesurfer.on('scroll', ...)`/`wavesurfer.on('redraw', ...)` events
already proven reliable for that purpose (this time via their officially
documented API — `scroll` gives `[visibleStartTime, visibleEndTime,
scrollLeft, scrollRight]` directly — no DOM-reaching workaround needed,
since this is now our own renderer, not a third-party plugin's private
internals).

The whole track's data is computed **once**, on load; only the drawn
slice changes on scroll/zoom/redraw — no FFT recomputation per
interaction.

## Data pipeline

### 1. Per-frame magnitude spectra (`onsets.js`)

New generator, added alongside the existing `computeSpectralFlux` (which
is left untouched — it has its own inlined per-bin flux/energy
accumulation in the same loop, and refactoring it to share this generator
risks behavior changes to an already-shipped, tested function for a
marginal DRY gain; the small duplication is an accepted, deliberate
tradeoff):

```js
export function* iterateMagnitudeFrames(samples, sampleRate, { fftSize = FFT_SIZE, hopSize = HOP_SIZE } = {}) {
  const window = hannWindow(fftSize)
  const numFrames = Math.max(0, Math.floor((samples.length - fftSize) / hopSize) + 1)
  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * hopSize
    const real = new Float64Array(fftSize)
    const imag = new Float64Array(fftSize)
    for (let i = 0; i < fftSize; i++) real[i] = samples[offset + i] * window[i]
    fft(real, imag)
    const magnitudes = new Float32Array(fftSize / 2)
    for (let bin = 0; bin < fftSize / 2; bin++) {
      magnitudes[bin] = Math.hypot(real[bin], imag[bin])
    }
    yield magnitudes
  }
}
```

Reuses the existing private `fft`/`hannWindow` — they stay private,
nothing new is exported from them directly.

### 2. Semitone bucketing + peak detection (reused as-is)

`spectrum-bars.js`'s `computeNoteBuckets(freqData, binHz, minFreq,
maxFreq)` and `computePeakMidis(buckets, threshold)` are **not
modified**. Both already operate generically on any indexable numeric
array via plain `[]` indexing and comparison — nothing in either function
assumes `Uint8Array` specifically, so they work unchanged on the
`Float32Array` magnitudes from step 1, and later again on the
byte-converted values from step 3. Picking "the max value in a semitone's
bin range" is invariant under any monotonic rescaling applied uniformly
across the whole track, so it's correct to bucket on raw magnitude first
and rescale after.

### 3. Whole-track peak-relative normalization (new, in `pianoRoll.js`)

Directly addresses the "too saturated" complaint: the wavesurfer plugin's
`roseus`+fixed-gain approach didn't adapt to the actual track, so most
content clustered in the same saturated color range. Normalizing to the
track's own loudest moment guarantees full use of the color range
regardless of the source recording's absolute level:

```js
const DB_FLOOR = -80 // dB below the track's single loudest bucket; quieter than this maps to 0

function magnitudeToByte(magnitude, peakMagnitude) {
  if (peakMagnitude <= 0 || magnitude <= 0) return 0
  const db = 20 * Math.log10(magnitude / peakMagnitude)
  return Math.round(255 * Math.max(0, (db - DB_FLOOR) / -DB_FLOOR))
}
```

`computeSpectrogramFrames(samples, sampleRate, minFreq, maxFreq)`:
iterates `iterateMagnitudeFrames`, buckets each frame with
`computeNoteBuckets`, tracks the global peak bucket value across every
frame, then remaps every bucket's value through `magnitudeToByte` and runs
`computePeakMidis` (reusing the existing `PEAK_THRESHOLD = 90`, same
constant/spirit as `spectrum.js`'s live analyzer — tunable later if 90
turns out wrong against this new peak-relative scale) on the final
byte-scale buckets. Returns one entry per frame: `{ buckets, peakMidis }`
(`peakMidis` a `Set`, matching how `spectrum.js` already consumes
`computePeakMidis`'s output).

`DB_FLOOR` and `PEAK_THRESHOLD` are both acknowledged-tunable constants,
same treatment as `gainDB`/`rangeDB` were for the plugin approach —
reasonable defaults now, adjust later if the actual contrast/peak
sensitivity looks wrong in practice.

### Range: C2–C7

```js
export const PIANO_ROLL_MIN_FREQ = frequencyFromMidi(36) // C2
export const PIANO_ROLL_MAX_FREQ = frequencyFromMidi(96) // C7
```

60 semitone columns.

## Rendering

Peak semitones are shown as a solid highlight color
(`#388e3c`, matching `spectrum.js`); everything else as a
black→`#4f6df5` intensity ramp from the byte value. **No per-cell text
labels for peaks** — unlike the live analyzer (a single, label-less
instant that needs inline text to identify what's playing right now), the
piano roll has a persistent horizontal note-name axis always visible, so
the column position alone tells you which note a highlighted cell is —
repeating that as text on every row of a sustained note would just be
clutter.

```js
export function frameRangeForTime(startTime, endTime, hopSize, sampleRate, totalFrames) {
  const startFrame = Math.max(0, Math.floor((startTime * sampleRate) / hopSize))
  const endFrame = Math.min(totalFrames - 1, Math.ceil((endTime * sampleRate) / hopSize))
  return { startFrame, endFrame }
}

export function drawPianoRollSlice(canvas, frames, startFrame, endFrame, minMidi, maxMidi) {
  // clears canvas, computes column width from canvas.width / (maxMidi - minMidi + 1)
  // and row height from canvas.height / (endFrame - startFrame + 1), then fills
  // one rect per (frame, semitone) cell: green if peak, else rgba(79,109,245,value/255)
}
```

`frameRangeForTime` is the sync-critical math (maps a wavesurfer
`scroll`/`redraw` event's visible time range to which precomputed frames
to draw) and gets real unit tests. `drawPianoRollSlice` is canvas-drawing
glue, untested by the same convention as `drawSpectrogramLabels` was.

### Horizontal note-name axis

A second, short canvas below the main grid, labeled using the same
adaptive spacing already shared via `notes.js`'s `labelStep` (60 semitones
is too many to label every one without overlap — same problem the
vertical axis had, same fix). Drawn once; doesn't change with
scroll/zoom, since column positions are fixed regardless of which time
slice is visible.

## File structure

- Modify: `src/onsets.js` — add `iterateMagnitudeFrames` generator.
- Modify: `src/onsets.test.js` — tests for it.
- Create: `src/pianoRoll.js` — `computeSpectrogramFrames`,
  `magnitudeToByte`, `frameRangeForTime` (all tested), plus
  `drawPianoRollSlice`/`drawPianoRollLabels` (untested canvas glue),
  `PIANO_ROLL_MIN_FREQ`/`PIANO_ROLL_MAX_FREQ`.
- Create: `src/pianoRoll.test.js` — tests for the pure functions.
- Delete: `src/spectrogramLabels.js`, `src/spectrogramLabels.test.js` —
  superseded, vertical-axis-specific, nothing reused.
- Modify: `src/waveform.js` — remove `SpectrogramPlugin`
  registration/import entirely; `createWaveSurfer` reverts to its
  pre-spectrogram signature (`container` only, no `spectrogramContainer`
  parameter), returning `{ wavesurfer, regions }` as before.
- Modify: `index.html` — remove `#spectrogram-section` (and its two
  children); add a new `#piano-roll-section` containing `<canvas
  id="piano-roll">` (the grid) and `<canvas id="piano-roll-labels">` (the
  horizontal axis, placed below the grid).
- Modify: `src/style.css` — remove the old `#spectrogram-section`/
  `#spectrogram-labels`/`#spectrogram` rules; add rules for the new
  section (stacked vertically, not a flex row this time).
- Modify: `src/main.js` — remove all spectrogram-plugin wiring
  (`spectrogram` destructuring, its `error` listener,
  `syncSpectrogramScroll` and its `scroll`/`redraw` listeners,
  `drawSpectrogramLabels` call, `SPECTROGRAM_MIN_FREQ`/`MAX_FREQ`
  imports); add: compute `computeSpectrogramFrames` once (in the
  `wavesurfer.on('ready', ...)` handler, using
  `wavesurfer.getDecodedData()` + `mixToMono`, the same pattern
  `startSubdivide` already uses elsewhere in this file), draw the
  horizontal axis labels once, and wire `wavesurfer.on('scroll', ...)` /
  `wavesurfer.on('redraw', ...)` to redraw the visible slice via
  `frameRangeForTime` + `drawPianoRollSlice`.

## Testing

`iterateMagnitudeFrames`, `magnitudeToByte`, `computeSpectrogramFrames`,
and `frameRangeForTime` are pure/deterministic and get real unit tests
(small synthetic sample arrays, same convention `onsets.test.js` already
uses for FFT-based functions). `drawPianoRollSlice`/
`drawPianoRollLabels` and all `main.js`/markup/CSS wiring stay untested,
consistent with this codebase's existing canvas/DOM convention. Verified
manually in a real browser: correct note range (C2–C7), correct
quantization (discrete columns, not continuous), correct peak
highlighting, correct sync with the waveform's pan/zoom/playback, and
visibly better contrast than the previous `roseus` heatmap.
