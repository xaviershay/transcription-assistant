# Ear Transcriber — UI Polish Design Addendum

Date: 2026-07-18

Follow-up to `2026-07-18-ear-transcriber-design.md`, based on feedback from
the first manual browser walkthrough of the implemented app.

## Purpose

Fix real problems found in manual testing and add controls needed to make
the spectrum panel actually usable:

1. Spectrum note labels were unreadable (wrong color for the actual
   background, font too small).
2. No way to zoom/pan the spectrum panel's frequency axis — full A0–C8
   range is too coarse to read individual notes precisely.
3. App should be dark-themed always, not conditionally light/dark.
4. No spacebar play/pause (common expectation for an audio tool).

## Changes

### 1. Always-dark theme

`src/style.css` drops `color-scheme: light dark` and hardcodes a dark
palette: background `#121212`, text `#e6e6e6`. Not adaptive — dark is the
only theme.

`src/waveform.js`'s `progressColor` changes from `#2c3e91` to `#8ea0ff`
(lighter blue) so the played portion of the waveform stays visible against
the dark background. `waveColor` (`#4f6df5`) and `cursorColor`
(`currentColor`, already fixed in prior polish) are unaffected.

### 2. Waveform zoom/pan via wheel — replaces the zoom slider

The zoom `<input type="range" id="zoom">` in `index.html` and its wiring in
`src/main.js` are removed entirely.

A `wheel` listener on `#waveform`:
- Plain wheel → zoom: adjusts a tracked `pxPerSec` value (multiplied by a
  factor per tick, clamped to a sane range) and calls `wavesurfer.zoom()`.
- `Shift+wheel` → pan: **no new code needed.** wavesurfer's internal
  wrapper already has native horizontal `overflow-x` scroll (confirmed via
  its `hideScrollbar`/`autoScroll`/`setScroll` API surface) — browsers
  natively translate `Shift+wheel` (and trackpad horizontal swipe) into
  horizontal scroll on any scrollable element, so this works automatically
  once the wrapper is scrollable, which it already is when zoomed past
  container width.

### 3. Spectrum zoom/pan via wheel

Canvas has no native scroll, so this is hand-rolled. `src/spectrum.js`
tracks a visible frequency window, `viewMinFreq`/`viewMaxFreq`, initialized
to the full instrument range (`MIN_FREQ`=27.5, `MAX_FREQ`=4186, i.e. A0–C8).

- Plain wheel → zoom: narrows/widens the window by a fixed ratio per tick,
  anchored so the frequency currently under the mouse cursor stays under
  the cursor after the zoom. Clamped so the window's span never drops below
  ~2 semitones (avoids zooming to nothing) and never exceeds the full
  A0–C8 range.
- `Shift+wheel` → pan: shifts both window bounds by a fixed fraction of the
  current span, clamped so the window never moves outside A0–C8.

`xForFreq` uses `viewMinFreq`/`viewMaxFreq` (via their log2) instead of the
previous fixed `LOG_MIN`/`LOG_MAX` constants.

Note-label density becomes dynamic instead of the fixed "every 3
semitones": compute the semitone span of the current view and pick a step
so labels land roughly every 50px of canvas width, so labels never overlap
when zoomed out and aren't too sparse when zoomed in.

### 4. Spectrum readability fix

Each animation frame, the canvas background is explicitly painted dark
(`#121212`) before drawing bars/labels — canvas elements don't reliably
inherit page background, so this can't be left implicit. Label color
changes to `#f0f0f0` (was an unreadable light-gray-on-white due to a prior
fix that assumed a light background). Label font size increases from 10px
to 13px.

### 5. Spacebar play/pause

The existing combined `keydown` listener in `src/main.js` (currently
handling Delete/Backspace and Tab/Shift+Tab) gains a branch: `e.code ===
'Space'` → `e.preventDefault()` (stops page scroll) → `wavesurfer.playPause()`.

## Non-goals

- Not turning the spectrum into a time-based spectrogram (heatmap) — still
  an instantaneous magnitude-vs-frequency view, just zoomable/pannable on
  the frequency axis. (Considered and explicitly rejected in favor of the
  simpler option.)
- No light-mode toggle — dark is the only theme, not a preference.
- No slider UI for spectrum zoom/pan — wheel/shift-wheel only, matching
  the waveform's new interaction model.

## Testing approach

Manual browser testing, same as the original spec — no automated coverage
for canvas rendering, wheel-event math, or the theme. `notes.js` and
`selections.js` are untouched by this change, their existing vitest
coverage remains valid.

Manual checks to add to the walkthrough:
- Spectrum and waveform backgrounds are dark on load, no light-mode flash.
- Note labels are clearly readable (bright text, readable size) against
  the dark spectrum background.
- Mouse wheel over the waveform zooms in/out; Shift+wheel (or trackpad
  horizontal swipe) pans left/right once zoomed in.
- Mouse wheel over the spectrum zooms the frequency window anchored at the
  cursor; Shift+wheel pans it; window can't invert or escape A0–C8.
- Spacebar toggles play/pause from anywhere on the page (not just when a
  button has focus).
