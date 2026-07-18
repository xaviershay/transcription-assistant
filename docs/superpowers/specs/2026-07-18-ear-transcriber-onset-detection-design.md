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
3. **Log-compressed magnitude, not linear**: flux is computed on
   `log(1 + magnitude)` per bin, not raw magnitude. Verified by prototyping
   against a synthetic steady tone that linear-magnitude flux is dominated
   by spectral leakage sidelobe wobble (small magnitude fluctuations in the
   bins around a non-bin-aligned frequency's peak, which shift slightly
   every frame purely from window-phase, unrelated to any real onset) —
   large enough to produce false onset peaks mid-note. Log compression
   suppresses this because it compresses the *relative* size of small
   sidelobe wobble much more than the *relative* size of a genuine
   near-zero-to-substantial energy jump.
4. **Peak-picking with adaptive threshold**: a frame is a candidate onset
   if its flux is a local maximum and exceeds `localMean(flux) * (2 /
   sensitivity)` (an adaptive threshold computed from a local window of the
   flux curve, not one global number — adapts to the passage's own
   dynamics).
5. **Not-decaying-to-silence gate**: a candidate is rejected if energy a
   short lookahead (3 frames, ~35ms) later has dropped below 15% of the
   recent local peak energy. This was the second bug found by prototyping:
   spectral flux alone can't distinguish a genuine new-note onset from a
   note's *offset* (its tail decaying into trailing silence), because an
   abrupt cutoff also broadens the spectrum and produces a flux spike —
   the FFT window's forward extent means this is detected 1-2 frames
   *before* the nominal offset time, which otherwise gets misread as a new
   onset. An earlier attempt at a general "energy must be rising" gate was
   tried and rejected: it also rejected genuine legato onsets between two
   equal-loudness notes, which can show a brief energy *dip* right at the
   transition (a real windowing/phase artifact at the boundary) before
   recovering to the new note's steady level — the discriminator that
   actually works is whether energy *recovers* shortly after (new note) vs.
   *keeps falling toward zero* (note actually ending).
6. Minimum 60ms gap enforced between accepted onsets (prevents
   double-triggering within a single attack transient), and onsets within
   ~30ms of the slice's own start are dropped (windowing edge artifact from
   FFT-ing right at an abrupt buffer boundary, not a real note boundary).
7. Returns onset times **relative to the start of the sample slice
   passed in** — the caller (UI layer) adds the region's own start time to
   get absolute times. Detected onset times run ~30-40ms *earlier* than the
   nominal note boundary — a systematic, expected bias from the FFT
   window's forward extent (a 2048-sample window "sees" an upcoming change
   before its nominal sample position), not detection jitter.

**Known limitation** (accepted, not fixed): prototyping surfaced one
remaining edge case — pure, harmonically-simple tones at certain
frequencies can occasionally produce one extra spurious split mid-note at
high sensitivity. This did not reproduce across most tested scenarios
(silence gaps, legato runs of adjacent notes) and real recorded audio's
natural timbral complexity and noise floor make the specific pure-sine
leakage pattern behind it unlikely — and when it does happen, the
preview/adjust/confirm workflow below is precisely the intended recourse:
lower the sensitivity and re-preview.

**Two-stage split**, so re-previewing at a different sensitivity is cheap:

- `computeSpectralFlux(samples, sampleRate)` — the expensive FFT pass, run
  once per "Subdivide" click. Returns `{ flux, energy, hopSize, sampleRate
  }` — `flux` and `energy` are parallel per-frame arrays (`energy` is the
  frame's total broadband magnitude, used by the silence-lookahead gate).
- `pickOnsets(fluxResult, sensitivity)` — cheap threshold/peak-pick only,
  re-run on every sensitivity-slider change without recomputing the FFT.

Sensitivity range: higher = more onsets detected (lower relative
threshold). Verified constants (via prototyping, see above): `FFT_SIZE
= 2048`, `HOP_SIZE = 512`, `MIN_ONSET_GAP_SECONDS = 0.06`,
`MIN_ONSET_START_SECONDS = 0.03`, `LOCAL_MEAN_WINDOW_FRAMES = 10`,
`SILENCE_LOOKAHEAD_FRAMES = 3`, `SILENCE_FLOOR_FRACTION = 0.15`,
threshold formula `localMean(flux) * (2 / sensitivity)`. UI slider range
0.5–5, default 1.5.

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

- Synthetic signals, matching what was verified during prototyping: pure
  silence → zero onsets. Two isolated tones with a silent gap between them
  → exactly 2 onsets, each within ~50ms of the expected boundary (accounts
  for the systematic window-forward-extent lag noted above). Four adjacent
  legato tones with no gaps → exactly 4 onsets, same tolerance — this is
  the primary real-world case (a run of adjacent notes) and the one most
  worth locking down with a test.
- The known pure-tone edge case (occasional extra split at high
  sensitivity) is *not* asserted against in the test suite — it's a
  documented, accepted limitation, not a regression target.
  given the two-stage split.

Everything else (preview rendering, region promotion on confirm, UI state
transitions) is manual browser testing, consistent with the rest of the
app's testing approach — no automated coverage for DOM/wavesurfer wiring.
