# Spectrogram: taller, note-name y-axis, cropped to C2-C5

## Problem

The spectrogram (just added) has three usability issues once actually used:

1. At 200px tall, there isn't much vertical detail to work with.
2. Its y-axis shows raw Hz labels ("28 Hz", "360 Hz", "1.3 kHz"), which don't
   map to anything musically meaningful at a glance — everything else in
   the app (the spectrum analyzer, note buckets, peak labels) speaks in
   note names.
3. Its frequency range spans the full piano range (A0-C8, 27.5Hz-4186Hz).
   Most of that vertical space is spent on very low frequencies that are
   rarely the interesting part of a transcription — the low end dominates
   the log-scale layout without adding much value.

This changes the spectrogram to 400px tall, crops its range to C2-C5
(three octaves — enough to cover most melodic/vocal content without
over-allocating to the sub-bass region), and replaces its Hz labels with
note names.

## Frequency crop: C2-C5

`SPECTROGRAM_MIN_FREQ`/`SPECTROGRAM_MAX_FREQ` are computed from
`notes.js`'s existing `frequencyFromMidi` rather than hardcoded:

```js
export const SPECTROGRAM_MIN_FREQ = frequencyFromMidi(36) // C2, ~65.41 Hz
export const SPECTROGRAM_MAX_FREQ = frequencyFromMidi(72) // C5, ~523.25 Hz
```

This is a different range from `spectrum.js`'s `MIN_FREQ`/`MAX_FREQ`
(A0-C8) — that widget stays unchanged; the two views now legitimately
cover different ranges for different purposes (full-keyboard live analysis
vs. a cropped, denser transcription view).

## Height: 400px

Up from 200px.

## Note-name y-axis: a custom label overlay

wavesurfer.js's Spectrogram plugin only supports on/off Hz labels (no
custom formatter — confirmed by reading its type definitions and source;
there's no hook to supply note names instead). The fix is to turn the
plugin's own labels off (`labels: false`) and draw our own:

- A new `<canvas id="spectrogram-labels" width="55" height="400">`,
  placed to the left of the existing `<div id="spectrogram">` inside
  `#spectrogram-section` (flexbox row).
- Drawn **once**, not per-frame: label positions depend only on the fixed
  frequency range and height, never on audio content, so there's no
  animation loop involved (unlike `spectrum.js`'s live-analyzer labels,
  which redraw every frame because the view can zoom/pan).

### Shared adaptive label spacing

`spectrum.js` already has a private `labelStep()` that picks a
semitone-skip so labels stay roughly 50px apart (avoiding overlap) —
needed here too, since 36 semitones in 400px would be ~11px apart
(unreadable) without it. Extracted into a shared, tested, pure function in
`notes.js`:

```js
export function labelStep(spanSemitones, availablePixels, desiredLabelSpacingPx = 50) {
  const desiredLabels = availablePixels / desiredLabelSpacingPx
  return Math.max(1, Math.round(spanSemitones / desiredLabels))
}
```

`spectrum.js`'s own `labelStep()` is removed in favor of calling this
shared version with its existing `canvas.width`/view-span arguments —
identical math, no behavior change for the existing widget, just DRY'd up
since the same algorithm is now needed twice.

### New module: `src/spectrogramLabels.js`

Two pure, tested functions plus one untested drawing function (matching
the codebase's convention: pure logic tested, canvas-drawing glue isn't):

```js
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

`main.js` calls `drawSpectrogramLabels(spectrogramLabelsCanvas,
SPECTROGRAM_MIN_FREQ, SPECTROGRAM_MAX_FREQ)` once, right after creating
the wavesurfer instance — no event wiring needed since nothing about this
canvas ever changes after that.

## File structure

- Modify: `src/notes.js` — add exported `labelStep`.
- Modify: `src/notes.test.js` — tests for `labelStep`.
- Modify: `src/spectrum.js` — remove the private `labelStep`, call the shared one instead. No behavior change.
- Create: `src/spectrogramLabels.js` — `yForFrequency`, `computeSpectrogramLabels`, `drawSpectrogramLabels`.
- Create: `src/spectrogramLabels.test.js` — tests for the two pure functions.
- Modify: `src/waveform.js` — export `SPECTROGRAM_MIN_FREQ`/`SPECTROGRAM_MAX_FREQ`; change the plugin's `height`, `frequencyMin`/`frequencyMax`, `labels: false`.
- Modify: `index.html` — add `#spectrogram-labels` canvas inside `#spectrogram-section`.
- Modify: `src/style.css` — `#spectrogram-section` becomes a flex row; `#spectrogram-labels` styled to sit flush beside `#spectrogram`.
- Modify: `src/main.js` — grab the new canvas, call `drawSpectrogramLabels` once.

## Testing

`labelStep`, `yForFrequency`, and `computeSpectrogramLabels` are pure
functions with real test coverage. `drawSpectrogramLabels` and the
`waveform.js`/`main.js`/markup/CSS wiring are untested by the same
existing convention as the rest of this canvas/DOM-heavy codebase.
Verified manually in a real browser: height, note-name labels (not Hz),
correct vertical positions relative to the spectrogram content, and the
cropped C2-C5 range.
