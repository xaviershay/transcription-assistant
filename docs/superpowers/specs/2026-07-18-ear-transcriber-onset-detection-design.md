# Ear Transcriber — Automatic Note Subdivision Design

Date: 2026-07-18

Second follow-up to `2026-07-18-ear-transcriber-design.md`. Adds a way to
automatically split an existing selection into per-note sub-selections, so
the user doesn't have to hand-drag every note boundary — especially useful
for a fast run of adjacent notes.

## Purpose

Given an existing selection (region) covering a passage with multiple
notes, detect likely note-onset boundaries within it and offer to replace
that one region with several smaller regions, one per detected note. The
user previews the proposed split at an adjustable sensitivity before
committing.

## Algorithm: spectral flux onset detection

Pure, dependency-free, offline (not realtime) — operates on the decoded
`AudioBuffer` slice covering just the region being subdivided, not the
whole file.

1. **Mix to mono**: average all channels of the region's sample slice into
   one `Float32Array`.
2. **Spectral flux over sliding windows**: 2048-sample Hann-windowed FFT
   (hand-rolled radix-2 Cooley-Tukey, no dependency), 512-sample hop
   (~11.6ms resolution at 44.1kHz). Flux per frame = sum of *positive-only*
   magnitude increases vs. the previous frame (rising energy only — decays
   are ignored, since a new note's onset is an energy increase).
3. **Peak-picking with adaptive threshold**: a frame is a candidate onset
   if its flux is a local maximum, exceeds `localMean(flux) * (2 /
   sensitivity)` (an adaptive threshold computed from a local window of the
   flux curve, not one global number — adapts to the passage's own
   dynamics), and is at least 60ms after the previously accepted onset
   (prevents double-triggering within a single attack transient).
4. Onsets within ~30ms of the slice's own start are dropped — this is a
   windowing edge artifact from FFT-ing right at an abrupt buffer boundary,
   not a real note boundary.
5. Returns onset times **relative to the start of the sample slice
   passed in** — the caller (UI layer) adds the region's own start time to
   get absolute times.

**Two-stage split**, so re-previewing at a different sensitivity is cheap:

- `computeSpectralFlux(samples, sampleRate)` — the expensive FFT pass, run
  once per "Subdivide" click.
- `pickOnsets(fluxResult, sensitivity)` — cheap threshold/peak-pick only,
  re-run on every sensitivity-slider change without recomputing the FFT.

Sensitivity range: higher = more onsets detected (lower relative
threshold). Exact default value tuned during implementation against a
synthetic test signal.

## UI: preview → confirm/cancel

**Selections panel header** gains a sensitivity `<input type="range">`,
disabled except while a subdivision preview is active.

**Each row in the selections list** gains a "Subdivide" button (alongside
the existing "Delete"). Clicking it:

1. Computes the flux once for that region's sample slice.
2. Renders **preview regions**: real wavesurfer regions (so they're
   automatically clickable-to-loop for free, via the existing
   region-clicked/loop mechanism — no new code needed for that), but with
   `drag: false, resize: false`, an id prefixed `preview-`, and a distinct
   amber color (vs. the normal blue) to mark them as provisional.
3. That row's "Subdivide" button is replaced with "Confirm" and "Cancel".
   Other rows' "Subdivide" buttons disable (only one region can be
   previewed at a time); their "Delete" buttons remain active.
4. Enables the sensitivity slider. Dragging it (debounced ~60ms) re-runs
   `pickOnsets` on the cached flux, removes the old preview regions, adds
   new ones at the updated split points — no FFT recompute.
5. **Confirm**: removes the preview regions and the original parent
   region, adds real (non-`preview-`-prefixed, normal blue, fully
   interactive) regions at the previewed split points.
6. **Cancel**: removes the preview regions only. Parent region is
   untouched. Row reverts to showing "Subdivide". Sensitivity slider
   disables again.

**Filtering `preview-`-prefixed regions**: both the Selections list
rendering and the existing Tab/Shift+Tab cycling logic read from
`regions.getRegions()` — both are updated to exclude ids starting with
`preview-`, via one shared filter, so preview regions never appear in the
list or get cycled into while just provisional.

## Non-goals

- No Web Worker — computation runs on the main thread. Since it now
  operates on a single region's slice (not the whole file), expected
  durations are short (well under what would need a worker for a
  responsive UI).
- No support for previewing more than one region's subdivision
  simultaneously.
- No polyphonic/chord awareness — same caveat as the original spec:
  spectral flux reacts to overall energy change, works best on
  monophonic melodic material.

## Testing approach

`src/onsets.js` (the pure algorithm module) gets real vitest coverage,
consistent with `notes.js`/`selections.js`:

- Synthetic signals: pure silence → zero onsets. Two isolated tone bursts
  with a known silent gap → detects ~2 onsets near the expected sample
  positions (within a tolerance). Varying `sensitivity` on the same flux
  data changes the onset count as expected (higher sensitivity → same or
  more onsets).
- `pickOnsets` tested independently of `computeSpectralFlux` where useful,
  given the two-stage split.

Everything else (preview rendering, region promotion on confirm, UI state
transitions) is manual browser testing, consistent with the rest of the
app's testing approach — no automated coverage for DOM/wavesurfer wiring.
