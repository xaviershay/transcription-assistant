# Double-click a slider to reset it to default

## Problem

No quick way to reset a slider (tempo, subdivisions, speed, volume, onset
sensitivity) back to its default without manually dragging it there.

## Fix

Each `<input type="range">` already carries its default as its HTML
`value=` attribute, which the DOM exposes via `.defaultValue` regardless of
the slider's current `.value`. A shared helper attaches a `dblclick`
listener to a slider that sets `.value = .defaultValue` and dispatches a
synthetic `input` event — reusing whatever `input` listener is already
wired to that slider (label update, timeline rebuild, persistence save,
etc.) rather than duplicating that logic per slider.

Applied to all 5 existing sliders: tempo, subdivisions, speed, volume,
onset-sensitivity. No special-casing needed for the disabled
onset-sensitivity slider — a disabled `<input>` doesn't receive mouse
events at all, so double-clicking it while disabled is simply a no-op,
which is correct.

## Testing (manual)

For each of the 5 sliders: drag it away from its default, double-click it,
confirm it snaps back to its original default value and its label/dependent
UI (timeline, volume readout, etc.) updates to match, exactly as if it had
been dragged there.
