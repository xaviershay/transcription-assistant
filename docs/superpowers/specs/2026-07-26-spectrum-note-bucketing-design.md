# Bucket spectrum bars by note

## Problem

The spectrum analyzer currently draws one 2px bar per raw FFT bin
(`src/spectrum.js`'s `render()`), positioned at that bin's exact frequency
on the log-frequency x-axis. Since the x-axis is logarithmic but FFT bins
are linearly spaced in frequency, bars don't line up cleanly with the note
labels drawn along the bottom — multiple bins can crowd under one note, or
a note's label can sit between two unrelated bars. Want one bar per note,
spanning exactly the width between that note's neighbors, so the display
reads as "how loud is each note" rather than "raw FFT bin amplitudes."

## Fix

Replace the per-bin bar loop with note buckets. For each semitone (MIDI
note) visible in the current view, aggregate all FFT bins whose frequency
falls within that note's range into a single bar spanning that note's pixel
width.

## Bucket boundaries

Each note's bucket covers the MIDI range `[midi - 0.5, midi + 0.5)` — the
standard "nearest note" range (quarter-tone either side) — converted to Hz
via the existing `frequencyFromMidi()` in `notes.js`. This tiles the entire
frequency axis with no gaps or overlaps between adjacent notes' buckets.

## Aggregation

Bar value = the maximum byte value (`analyser.getByteFrequencyData`'s 0-255
output) across all FFT bins whose frequency falls within the bucket, not an
average or sum. Chosen because averaging would dilute a strong, narrow
partial if it shares a bucket with mostly-quiet bins — max preserves
visibility of what's actually sounding. Verified numerically: a single loud
bin at 441Hz (nearest FFT bin to A4's 440Hz) is correctly attributed to the
A4 bucket alone, with immediate neighbor buckets reading 0; a bucket
containing multiple bins of varying loudness correctly reports the loudest
one, not their sum or average.

A known, accepted limitation: at very low notes (e.g. A0 at 27.5Hz), the
note's true bucket width (~1.6Hz) is narrower than a single FFT bin's
resolution at `fftSize = 8192` (~5.4Hz sample rate/8192 ≈ 5.38Hz at 44100Hz
sample rate). Low notes are inherently under-resolved by a fixed-size FFT;
fixing that would require variable-resolution analysis (e.g. a constant-Q
transform), which is out of scope for this change.

## Rendering

For each MIDI note whose bucket overlaps the current view — computed as
`floor(midiFromFrequency(minFreq) - 0.5)` through
`ceil(midiFromFrequency(maxFreq) + 0.5)`, one note wider on each side than
the view itself so edge notes aren't abruptly clipped (canvas naturally
clips any bar extending past its edges, so no manual clamping is needed) —
draw one bar from `xForFreq(bucket.lowFreq)` to
`xForFreq(bucket.highFreq)`, minus a small 1px gap so adjacent notes' bars
are visually distinguishable, at a height proportional to the bucket's
aggregated value (same 0-255-to-canvas-height scaling as today). The
existing note-label rendering (and its density-based label-skipping via
`labelStep()`) is unchanged — only the bars change, so bars are drawn for
every visible note even when not every note gets a label at the current
zoom level.

## File structure

- New `src/spectrum-bars.js` + `src/spectrum-bars.test.js`: pure function
  `computeNoteBuckets(freqData, binHz, minFreq, maxFreq)` returning
  `[{ midi, lowFreq, highFreq, value }, ...]` for every note bucket
  overlapping `[minFreq, maxFreq]`. Pure — no DOM/canvas/AudioContext
  access — following this repo's existing split (`notes.js`/`selections.js`/
  `onsets.js`/`normalize.js`/`eq.js` are pure+tested; `spectrum.js`/
  `waveform.js` are DOM-wiring+untested). Frequency-to-pixel conversion
  stays out of this module — `spectrum.js` converts the returned
  `lowFreq`/`highFreq` to x-coordinates using its own existing `xForFreq`,
  keeping the log-frequency-to-pixel mapping in one place rather than
  duplicating it.
- Modify `src/spectrum.js`: `render()` calls `computeNoteBuckets()` instead
  of iterating `freqData` directly, and draws one rect per returned bucket.

## Testing

- `spectrum-bars.test.js`: covers bucket boundary correctness (a known
  frequency maps to the expected MIDI bucket, using `frequencyFromMidi` for
  expected boundaries), max-not-sum aggregation across multiple bins in one
  bucket, correct 0 value for buckets with no signal, and that buckets
  outside `[minFreq, maxFreq]` aren't included.
- `spectrum.js`'s rendering change is manually verified in-browser,
  consistent with the rest of that file: bars visually align under their
  note labels at various zoom levels, and a single sustained note produces
  one bar at the correct position rather than a cluster of adjacent bars.
