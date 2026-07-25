# Draggable peaking EQ on the spectrum analyzer

## Problem

The spectrum analyzer (`src/spectrum.js`) currently only visualizes frequency
content — there's no way to boost or cut a frequency band to make a
particular instrument or note easier to hear while transcribing by ear. Want
a single draggable point on the spectrum canvas: x-axis position sets the
center frequency, y-axis position sets boost/cut in dB, and the mouse wheel
(while hovering the point) sets the band's width (Q).

## Scope

One band, always active. No enable/disable toggle — a band at 0 dB gain has
no audible or visual effect, so a toggle would be redundant. No support for
multiple simultaneous bands in this iteration.

## Filter choice

Web Audio `BiquadFilterNode`, type `'peaking'`. A true one-pole shelf filter
only has frequency and gain — no width/Q parameter — which conflicts with
the "mousewheel adjusts width" requirement. Peaking is the standard
parametric-EQ "bell" filter and is built into Web Audio, so no hand-rolled
DSP is needed.

## Audio graph change

`spectrum.js` currently wires:

```
source -> analyser -> destination
```

This becomes:

```
source -> filter -> analyser -> destination
```

The filter is created once per `createSpectrumAnalyser` call (same lifetime
as the existing `analyser`). Because the filter sits before the analyser,
the spectrum bars show the post-EQ signal, and playback audibly reflects the
current filter settings — dragging the dot changes both what you hear and
what you see.

## Parameters and ranges

- Frequency: defaults to 1000 Hz. Range matches the spectrum view's existing
  `MIN_FREQ`/`MAX_FREQ` (27.5 Hz–4186 Hz), consistent with what's already
  visible on the x-axis.
- Gain: defaults to 0 dB. Clamped to ±24 dB (`BiquadFilterNode.gain`'s
  practical peaking range).
- Q: defaults to 1. Clamped to 0.1–24 (Web Audio's usable peaking range;
  above ~24 the bell becomes narrower than a single FFT bin at this
  analyser's resolution and stops being meaningfully adjustable).

## Interaction

All on the existing spectrum `<canvas>`, which already handles wheel
events for zoom/pan (`spectrum.js:118-132`).

- **Drag**: mousedown within an 8px hit-radius of the dot starts a drag;
  mousemove while dragging sets frequency from x (via the existing
  `freqForX` log-frequency mapping) and gain from y (linear: canvas top =
  +24 dB, bottom = −24 dB, vertical center = 0 dB). Mouseup ends the drag.
- **Wheel-on-dot**: if the cursor is within the 8px hit-radius when a wheel
  event fires, it adjusts Q instead of running the existing zoom/pan
  behavior — checked first in the existing wheel handler, before the
  `e.shiftKey` branch. Uses the same accumulator-based log mapping already
  used for spectrum zoom (`spectrum.js:44-51`), so a sequence of wheel
  events that sums to zero returns Q to exactly where it started, matching
  the existing zoom behavior's path-independence.
- The dot and its response curve are drawn every frame once a file is
  loaded, not just while actively dragging.

## Rendering

Alongside the existing bar rendering in `render()`:

1. Compute the peaking filter's analytic gain-vs-frequency response
   directly from the current frequency/gain/Q (the standard biquad peaking
   transfer function), not `AudioParam.getFrequencyResponse()` — the
   analytic formula is synchronous and doesn't require handing arrays to
   the audio thread every frame.
2. Trace that response as a line across the visible x range, using the same
   dB-to-y mapping as the dot, so curve and dot always agree visually.
3. Draw the dot on top, at (frequency, gain).

## File structure

- **New: `src/eq.js`** — pure functions, no DOM/canvas/AudioContext access:
  - dB ↔ canvas-y mapping (given canvas height and the ±24 dB range)
  - Q ↔ wheel-delta accumulator mapping (mirrors the existing zoom
    accumulator pattern in `spectrum.js`)
  - peaking-filter analytic response formula: `(freq, centerFreq, gainDb, Q,
    sampleRate) => gainDb at freq`
  - dot hit-testing: `(cursorX, cursorY, dotX, dotY, hitRadius) => boolean`
- **New: `src/eq.test.js`** — unit tests for everything in `eq.js`, using
  vitest, following the style of `notes.test.js` / `selections.test.js`.
- **Modify: `src/spectrum.js`** — create the `BiquadFilterNode`, rewire the
  graph, add drag state and mouse/wheel handlers, call into `eq.js` for the
  math, draw the dot and curve in `render()`.
- **Modify: `src/persistence.js`** — extend the settings shape validated in
  `loadSettings` with `eqFreq`, `eqGain`, `eqQ`.
- **Modify: `src/main.js`** — extend `DEFAULT_SETTINGS`, `applySettings`,
  and `saveCurrentSettings` to include the three EQ fields, same pattern as
  the existing `bpm`/`volume`/etc. handling. Requires `spectrum.js` to
  expose a way to read and set the current filter's frequency/gain/Q (an
  addition to the object `createSpectrumAnalyser` returns, alongside the
  existing `start`/`stop`).

## Persistence

EQ settings (`eqFreq`, `eqGain`, `eqQ`) persist per-file-hash exactly like
`bpm`, `subdivisions`, `offset`, and `volume` already do via
`persistence.js` — saved on every drag-move and wheel adjustment, debounced
at 60ms (matching `sensitivitySlider`'s existing debounce at
`main.js:314-321`) to avoid hammering `localStorage` continuously during a
drag, restored on file load.

## Testing

- `src/eq.test.js`: unit tests for the dB/y mapping, the Q accumulator
  mapping (including that a zero-sum sequence of deltas returns to the
  starting Q, mirroring the existing zoom accumulator's tested-by-design
  property), the peaking response formula at known points (e.g. response at
  the center frequency equals the set gain; response far from center
  approaches 0 dB), and hit-testing (inside/outside/edge of hit-radius).
- `spectrum.js` changes are manually verified in-browser, consistent with
  the rest of that file (no existing test coverage for canvas/audio
  wiring): load a file, drag the dot and confirm both the audible playback
  and the spectrum bars change; scroll while hovering the dot and confirm
  the curve narrows/widens; scroll away from the dot and confirm existing
  zoom/pan still works; reload the same file and confirm the EQ position is
  restored.
