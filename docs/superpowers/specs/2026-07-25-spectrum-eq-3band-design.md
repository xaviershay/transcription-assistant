# 3-band spectrum EQ + reset button

## Problem

The spectrum EQ currently has one draggable band. Want two more (three
total), each independently draggable/scrollable exactly like the existing
one, plus a single button that resets all three back to their defaults.

## Scope

Extends the single-band EQ shipped in `docs/superpowers/specs/2026-07-25-
spectrum-eq-design.md`. This spec only covers going from 1 band to 3 and
adding the reset button — no other behavior changes.

## Defaults

Three bands, spread low/mid/high across the spectrum view so they're
visually separated from the start rather than stacked:

| Band | Frequency | Gain | Q |
|------|-----------|------|---|
| 0    | 200 Hz    | 0 dB | 1 |
| 1    | 1000 Hz   | 0 dB | 1 |
| 2    | 3000 Hz   | 0 dB | 1 |

A single `defaultEqBands()` helper in `eq.js` is the one source of truth for
these values — returns a fresh array (not a shared reference) each call, so
no caller can accidentally mutate the defaults. Used by `persistence.js`
(fallback/migration), `spectrum.js` (initial filter values), and the reset
button.

## Audio graph

Three `BiquadFilterNode`s (`type = 'peaking'`), cascaded in series:

```
source -> filter[0] -> filter[1] -> filter[2] -> analyser -> destination
```

## Combined response curve

Because the three filters are in series, the total magnitude response in dB
is the *sum* of each band's own response — no new math beyond what
`eq.js`'s existing `peakingResponseDb()` already computes. For each x-pixel,
sum `peakingResponseDb()` across all three bands to get the combined curve
value. One curve line is drawn (not three), matching the "combined curve"
decision from the single-band spec.

Each band still gets its own dot at its own (frequency, gain), drawn in a
distinct color so it's visually clear which dot belongs to which band while
dragging. The curve itself stays a single consistent color regardless of
which band is being adjusted, since it represents the combined effect.

## Interaction

Same drag/wheel mechanics as the single-band version, extended to hit-test
against all three dots:

- **Mousedown**: check all three dots (in band order), the first one within
  the existing 8px hit-radius starts the drag for that band.
- **Drag**: moves only the grabbed band's frequency/gain.
- **Wheel-on-a-dot**: adjusts only that band's Q. Each band keeps its own Q
  accumulator (three independent accumulators, same accumulator math as the
  single-band version).
- Away from all three dots, existing zoom/pan behavior is unchanged.

## Reset button

One new button, `#reset-eq`, placed in `#spectrum-section` next to the
canvas. On click: all three bands are set back to `defaultEqBands()` and the
result is persisted immediately (same as any other EQ change) — no
confirmation dialog, since it's trivially undoable by dragging again.

## Persistence

Replaces the single-band `eqFreq`/`eqGain`/`eqQ` fields (shipped in the
prior iteration) with `eqBands: [{freq, gain, q}, ...]` (array of 3).
`loadSettings` migrates existing data on read:

- A valid 3-element `eqBands` array (all three entries have numeric
  `freq`/`gain`/`q`) → used as-is.
- The old single-band `eqFreq`/`eqGain`/`eqQ` numeric fields (present in
  anyone's already-saved settings from the single-band iteration) → become
  band 0, bands 1 and 2 fall back to their defaults.
- Neither (settings saved before the EQ feature existed at all) → all three
  bands default.

`persistence.test.js`'s single-band round-trip and legacy-defaulting tests
are replaced with the array shape, plus a new test for the single-band → 3-
band migration path.

## File structure

- **Modify `src/eq.js`**: add `defaultEqBands()` (and a `BAND_COUNT = 3`
  constant if useful for clarity elsewhere). No changes to the existing
  per-band math (`gainToY`/`yToGain`/the Q accumulator functions/
  `peakingResponseDb`/`isNearDot`) — all of it is reused as-is, once per
  band.
- **Modify `src/spectrum.js`**: `filter` becomes an array of 3 nodes wired
  in series; `getEqState()`/`setEqState()` operate on arrays of 3;
  mousedown/mousemove/wheel hit-test across all 3 dots; `render()` draws the
  summed curve once and 3 colored dots.
- **Modify `src/persistence.js`**: shape change plus the migration logic
  above.
- **Modify `src/persistence.test.js`**: updated/new tests for the array
  shape and both legacy-migration paths.
- **Modify `src/main.js`**: `DEFAULT_SETTINGS`/`applySettings`/
  `saveCurrentSettings` swap the three scalar EQ fields for one `eqBands`
  array; wire the new reset button.
- **Modify `index.html`**: add `<button id="reset-eq">Reset EQ</button>` in
  `#spectrum-section`.

## Testing

- `eq.js`: unit test that `defaultEqBands()` returns 3 bands with the
  documented frequencies, all at 0 dB / Q 1, and that two separate calls
  return distinct array instances (mutating one doesn't affect the other).
- `persistence.js`: unit tests for all three `loadSettings` migration paths
  (fresh 3-band data, single-band legacy data, no-EQ legacy data).
- `spectrum.js`/`main.js`/`index.html` changes are manually verified in the
  browser, consistent with the rest of that file: drag each of the three
  dots independently and confirm only the grabbed one moves; scroll on each
  dot and confirm only that band's width changes; confirm the curve reflects
  the combined effect of all three bands at once (e.g. two overlapping
  boosts add up visibly higher than either alone); click reset and confirm
  all three dots return to their default positions and the sound returns to
  unfiltered; reload and confirm the 3-band state persists.
