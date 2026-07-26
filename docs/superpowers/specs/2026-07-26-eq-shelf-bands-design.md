# Low/high shelf outer EQ bands

## Problem

The 3-band spectrum EQ currently uses a peaking ("bell") filter for all
three bands. Band 0 (lowest) and band 2 (highest) would be more useful as
shelf filters — a low-shelf cuts/boosts everything below its corner
frequency, a high-shelf cuts/boosts everything above its corner frequency —
matching how EQ's outer bands conventionally work (bell in the middle,
shelves on the outside). The middle band stays a peaking filter.

## Filter types

`BiquadFilterNode.type`, set once when each band's filter node is created
(position-based, never changes afterward):

- Band 0 → `'lowshelf'`
- Band 1 → `'peaking'` (unchanged)
- Band 2 → `'highshelf'`

## Response curve math

Two new pure functions in `eq.js`, alongside the existing
`peakingResponseDb()`, using the standard RBJ Audio EQ Cookbook shelf-filter
coefficient formulas (the same family of formulas `peakingResponseDb`
already implements for the peaking case):

- `lowShelfResponseDb(freq, cornerFreq, gainDb, q, sampleRate)`
- `highShelfResponseDb(freq, cornerFreq, gainDb, q, sampleRate)`

Verified numerically before writing this spec: at `freq === cornerFreq`,
both return exactly half the set gain in dB (e.g. a +12dB shelf reads +6dB
at its corner) — the textbook-correct shelf midpoint. Far on the shelved
side, response approaches the full set gain; far on the flat side, it
approaches 0dB. Confirmed for both boost and cut.

`spectrum.js`'s combined-curve sum (already summing each band's response
across the visible frequency range) picks the correct formula per band by
its fixed position/type instead of always calling `peakingResponseDb`.

## Q range safety constraint (found during verification)

The shelf formulas' `alpha` term includes `sqrt((A + 1/A)*(1/Q - 1) + 2)`,
which goes undefined (NaN) once `Q` is large enough relative to the gain.
At our existing max gain of ±24dB, the exact breaking point is
`Q ≈ 1.896` — numerically confirmed (both the exact threshold and that
`Q = 1.8` stays safe with margin across the full ±24dB range).

This is not just a drawing concern: `BiquadFilterNode`'s internal
implementation for `lowshelf`/`highshelf` uses this same coefficient
family, so an out-of-range Q on a shelf band risks broken/silent real audio,
not only a broken visual curve.

Consequence: bands 0 and 2 get a tighter Q range, `[0.1, 1.8]`, separate
from band 1's existing `[0.1, 24]`. `eq.js`'s `MIN_Q`/`MAX_Q`-based
accumulator functions (`accumulatorForQ`, `qForAccumulator`,
`updateQAccumulator`) currently close over fixed module-level `MIN_Q`/
`MAX_Q` constants — they need to accept min/max as parameters instead, so
both Q ranges can share the same accumulator logic without duplicating it.
`DEFAULT_Q` (1) stays valid and in-range for both.

## Unchanged

- Drag mechanics (x = frequency, y = gain) work identically for shelf
  bands — frequency becomes the shelf's corner frequency, gain becomes its
  plateau boost/cut amount. No changes needed to drag/mousedown/mousemove
  handling.
- Wheel-adjust-Q still works per-band; only the clamping range differs for
  bands 0/2.
- Default band values (200/1000/3000 Hz, 0 dB, Q 1) are unchanged and valid
  under the new tighter shelf range.
- Reset-to-default button, persistence shape (`eqBands` array), dot
  colors — all unaffected.

## Testing

- `eq.js`: unit tests for both new response functions — shelf-midpoint
  property (response at corner frequency equals half the set gain, for
  both boost and cut), far-side-approaches-0dB, shelved-side-approaches-
  full-gain, and that neither function produces NaN/Infinity across the
  full Q range `[0.1, 1.8]` crossed with the full gain range `[-24, 24]`
  (the exact stability sweep already run during design verification).
- `eq.js`: the accumulator functions' existing test coverage gets extended
  to cover being called with a non-default min/max range, confirming the
  parameterization didn't change behavior for the existing default-range
  callers.
- `spectrum.js`'s rendering/audio changes are manually verified in-browser,
  consistent with the rest of that file: band 0's curve should look like a
  shelf (flat below its corner, rolling into 0dB above) rather than a bell;
  band 2 symmetric on the high side; band 1 unchanged bell shape; audio
  changes accordingly when dragging bands 0 and 2.

## Correction: shelf bands have no adjustable Q at all (found in final review)

The "Q range safety constraint" section above is built on a false premise,
caught by the final whole-branch review and independently confirmed against
MDN's `BiquadFilterNode` documentation: **`Q` is not used at all for
`lowshelf`/`highshelf` filter types** — Web Audio hardcodes a fixed shelf
slope (equivalent to `S = 1`) for both, regardless of what `Q` is set to.
The claim that "`BiquadFilterNode`'s internal implementation for
`lowshelf`/`highshelf` uses this same coefficient family [as the drawn
curve]" was wrong in the specific sense that mattered: the real filter
ignores `Q`/`S` entirely, while the drawn curve was using it. That mismatch
meant scrolling a shelf band's Q changed the picture without changing the
sound at all — up to ~9dB of drawn-vs-real divergence at the range extremes
this spec originally chose, and off-canvas (32.9dB) at full gain.

Corrected design:

- Shelf bands (0, 2) have **no Q control**. The response curve for
  `lowShelfResponseDb`/`highShelfResponseDb` is always evaluated at a fixed
  `q = 1` (matching what the real filter actually does), never
  `filter.Q.value` — so the drawn curve can never diverge from the audio.
- The wheel-scroll-to-adjust-Q interaction now only fires when hovering
  band 1's (peaking) dot. Scrolling over bands 0/2's dots falls through to
  the existing zoom/pan behavior instead of doing nothing silently.
- Consequently, the whole "Q range safety constraint" section is moot —
  there's no shelf Q parameter to clamp, so no NaN class exists. The
  accumulator-function parameterization (min/max range) added for that
  purpose is reverted; `eq.js`'s `accumulatorForQ`/`qForAccumulator`/
  `updateQAccumulator` go back to their original unparameterized form, and
  `MIN_SHELF_Q`/`MAX_SHELF_Q` are removed.
- This also fixes a second bug the false premise caused: `setEqState` was
  writing persisted `band.q` straight to the filter node with no
  validation, so a `Q` value saved back when band 0 was still a peaking
  filter (scrollable up to 24) produced `NaN` in the shelf response
  formula on load, silently blanking the entire EQ curve. Pinning the
  shelf formula's `q` to a fixed `1` removes this failure mode too, since
  the stored (now-irrelevant) `q` value is never read for shelf bands.
  `setEqState` also now clamps `gain` via the existing `clampGain()`
  before writing it, closing the same class of unvalidated-persisted-data
  risk for gain.
- The persisted shape (`eqBands: [{freq, gain, q}, ...]`) is unchanged —
  `q` is still stored for all 3 bands for schema uniformity, it's simply
  never read back for bands 0/2 anymore.
