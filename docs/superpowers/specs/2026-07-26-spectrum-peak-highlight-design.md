# Highlight likely-sounding note peaks

## Problem

The spectrum bars show loudness per note, but nothing calls out which
note(s) are likely actually sounding versus just background/harmonic
content. Want a visual "best guess at sounding notes" hint. Starting with
the naive approach: local-maximum peak-picking on the existing note
buckets, not true pitch detection.

## Known limitation (accepted for this iteration)

Naive peak-picking will also highlight strong harmonics/overtones as false
peaks (e.g. an octave or fifth above the actual fundamental), since it has
no concept of harmonic relationships — it just finds locally-loudest notes
above a threshold. This is a deliberate starting point; harmonic-aware
detection (HPS, autocorrelation/YIN) is a possible follow-up if false
positives prove bothersome in practice.

## Peak definition

Given the note buckets already computed each frame (`computeNoteBuckets`),
a bucket is a peak if:

- its `value` is at least a threshold (default 40, out of the 0-255 byte
  range `getByteFrequencyData` produces — roughly 16%, a low bar meant to
  catch real content while ignoring noise floor; easily tunable later
  since it's a single constant), AND
- its `value` is greater than or equal to both immediate neighbors in the
  bucket array (ties count as peaks — no de-duplication of plateaus for
  this naive version).

Edge buckets (first/last in the array) only need to beat whichever
neighbor(s) actually exist.

## Highlight rendering

Per your choice: peak bars get a colored outline (`strokeRect`, distinct
color from the normal bar fill) drawn on top of the normal bar fill, and
that note's label (when shown at the current zoom's label density) is
drawn in bold instead of regular weight. Non-peak bars and labels are
unaffected.

## File structure

- Modify `src/spectrum-bars.js` + `src/spectrum-bars.test.js`: add
  `computePeakMidis(buckets, threshold)` — pure, returns an array of MIDI
  note numbers judged to be peaks. No DOM/canvas access, consistent with
  the rest of this module.
- Modify `src/spectrum.js`: `render()` calls `computePeakMidis()` once per
  frame (reusing the `buckets` array it already computes), builds a `Set`
  for O(1) lookup, and uses it to decide which bars get an outline and
  which labels get bolded.

## Testing

- `spectrum-bars.test.js`: unit tests for `computePeakMidis` — an isolated
  loud bucket is detected; a locally-highest but below-threshold bucket is
  not; a bucket that's lower than a neighbor is not a peak even if above
  threshold; edge buckets (first/last) are handled correctly; a plateau of
  equal-value adjacent buckets both count as peaks. All five cases already
  verified numerically against the exact planned implementation before
  writing this spec.
- `spectrum.js`'s rendering change is manually verified in-browser,
  consistent with the rest of that file: play a single clear note and
  confirm it gets highlighted; note (and accept, not fix) any octave/fifth
  harmonics that get highlighted alongside it.
