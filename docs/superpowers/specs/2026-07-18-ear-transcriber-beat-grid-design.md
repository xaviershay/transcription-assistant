# Ear Transcriber — Beat/Subdivision Grid Design

Date: 2026-07-18

Fourth follow-up to `2026-07-18-ear-transcriber-design.md`.

## Purpose

Replace the waveform's seconds-based timeline with a beat/subdivision grid:
sequentially-numbered beat marks (1, 2, 3, ...) plus evenly-spaced
unlabeled subdivision ticks between them, driven by a user-settable tempo,
subdivisions-per-beat, and a starting offset (where beat 1 falls) set by
clicking the waveform.

## Verified mechanism

wavesurfer's built-in Timeline plugin (already used for the seconds
timeline it replaces) supports this natively through its existing option
surface — no custom canvas drawing needed. Verified empirically against a
real running instance (not just documentation) by temporarily registering
a second Timeline plugin with controlled options and reading the actual
rendered DOM (each tick renders as a `div` with `part="timeline-notch
timeline-notch-primary"` or `timeline-notch-tick`, inside a shadow root):

```js
const secondsPerBeat = 60 / bpm
TimelinePlugin.create({
  height: 20,
  timeInterval: secondsPerBeat / subdivisions,
  primaryLabelInterval: secondsPerBeat,
  timeOffset: offsetSeconds,
  formatTimeCallback: (t) => String(Math.round(t / secondsPerBeat) + 1),
  style: { color: '#e6e6e6', fontSize: '10px' },
})
```

Confirmed via two configurations (BPM 120/subdivisions 4/offset 0.3, and
BPM 100/subdivisions 3/offset 0) that:
- `timeInterval` (seconds between every tick, including subdivisions) set
  to `secondsPerBeat / subdivisions` produces one tick per subdivision.
- `primaryLabelInterval` (seconds) set to `secondsPerBeat` correctly marks
  every tick that lands on a beat boundary as `timeline-notch-primary`
  (full height, opacity 1, labeled) — confirmed robust for both a
  power-of-2 subdivision count (4) and a non-power-of-2 one (3), no
  floating-point modulo misfires.
- All non-primary ticks render as plain `timeline-notch-tick` (50% height,
  25% opacity, **empty text**) since `secondaryLabelInterval` is left
  unset — exactly the "unlabeled division marks" requirement, no extra
  work needed to suppress labels on them.
- `formatTimeCallback` is only invoked for primary (beat) ticks — confirmed
  by the tick elements' empty `textContent`. Receives the tick's loop-local
  elapsed time (starting from 0), *not* including `timeOffset` — so the
  beat-number formula (`Math.round(t / secondsPerBeat) + 1`) is computed
  against unshifted time and produces the correct sequential count (1, 2,
  3, ...) starting from the first tick regardless of where `timeOffset`
  visually places it.
- `timeOffset` shifts tick *pixel position* only (added before the
  seconds-to-pixels conversion) — the first tick (labeled "1") renders at
  the pixel position corresponding to `offsetSeconds` into the waveform,
  and nothing renders before it. This is exactly the "starting offset"
  behavior needed — confirmed by the offset-0.3s test placing "1" at the
  pixel position matching 0.3s at the current zoom level, and the offset-0
  test placing "1" at pixel 0.

## Controls

New panel between the waveform and the playback-controls panel:

- **Tempo** slider, 40–240 BPM, default 120.
- **Subdivisions** slider, 1–8, default 4.
- **"Set Beat 1"** button — arms a one-shot mode (a boolean flag). While
  armed, the *next* click on the waveform sets that click's time as the
  offset (reusing the time wavesurfer's own `interaction` event already
  reports) and disarms. Does not change the existing click-to-seek
  behavior otherwise — the armed click still seeks too (a reasonable,
  expected side effect of clicking to place beat 1 there).

## Architecture change: Timeline plugin ownership moves to `main.js`

The Timeline plugin must be destroyed and recreated whenever tempo,
subdivisions, or offset change (it has no live-update method for its own
options, unlike a `Region`'s `setOptions`). Since `waveform.js` currently
creates it once at `WaveSurfer.create()` time as a fixed initial plugin,
and the `regions` plugin (which *is* stable, never recreated) already
follows a "created once, returned for `main.js` to drive" pattern, the
cleanest fix is: `waveform.js` stops creating a Timeline plugin at all
(only `regions` remains in its initial `plugins` array). `main.js` creates
the *first* Timeline instance right after `createWaveSurfer()` returns
(default BPM 120, subdivisions 4, offset 0) via `wavesurfer.registerPlugin
(...)`, and a `rebuildTimeline()` function — called on init and whenever
any of the three controls change — calls `wavesurfer.unregisterPlugin()`
on the current instance before registering a fresh one with recomputed
options.

## Post-launch fix: beat labels disappearing at certain tempos

Reported after initial ship: some labeled beat marks silently vanished
after changing tempo, more so after also setting a beat-1 offset. Root
cause, found via `systematic-debugging` and confirmed by evaluating the
Timeline plugin's actual primary-classification formula in Node against
the failing BPM values: `primaryLabelInterval` is time-based and computes
`Math.round(100*t) % Math.round(100*interval) == 0` — rounding the
interval itself to 2 decimal places internally. For a BPM whose
`secondsPerBeat` doesn't round cleanly to 2 decimals (e.g. 133 BPM =
0.451128...s/beat → rounds to 0.45), that rounding error compounds beat
over beat and the check starts failing after only a handful of beats —
confirmed directly: BPM 133 matched correctly through beat 5, then every
beat after was wrongly classified as a plain unlabeled tick.

Fixed by switching to `primaryLabelSpacing` — an index-based sibling
option in the same plugin (`e % spacing == 0` on the tick loop counter,
not a time comparison) that can't drift since it never touches floating
point. `primaryLabelInterval` is kept but neutralized (set to `1e6`,
a value no real file duration reaches) rather than deleted, since leaving
it unset falls back to the plugin's own auto-computed default interval,
which could independently — and unpredictably — mark unrelated ticks
primary by coincidence.

Verified against a 20-second test file across the BPM values that failed
(133, 90, 140, 87) plus the two that had coincidentally worked before
(120, 100 — both have a `secondsPerBeat` that rounds cleanly, which is
why the bug didn't surface during the original implementation's manual
verification pass) — all now produce gap-free sequential labeling. Also
verified the exact combination reported: a tempo change together with a
beat-1 offset set by clicking the waveform.

## Non-goals

- No time signature / measure / downbeat distinction — every beat looks
  the same, numbered sequentially, per the earlier design answer.
- No snap-to-grid for region creation or the existing subdivide feature —
  purely a visual axis labeling change.
- No persistence of tempo/subdivisions/offset across file uploads or page
  reloads — resets to defaults each time (consistent with the app's
  existing no-persistence design constraint).

## Testing approach

No new pure-logic module — the beat-number/tick-interval math is a few
lines directly embedded in the `formatTimeCallback`/options object in
`main.js`, not worth extracting into a separate tested module (the
`secondsPerBeat = 60/bpm` and interval arithmetic is trivial and was
already hand-verified above; the actual complexity here was in the
Timeline plugin's option *semantics*, which was verified through direct
DOM inspection, not something a vitest unit test could exercise anyway
since it depends on the plugin's internal shadow-DOM rendering).
Consistent with the rest of the app's testing approach, this is manual
browser verification only.
