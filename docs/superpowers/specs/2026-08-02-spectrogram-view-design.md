# Spectrogram view

## Problem

The app's only frequency-domain view is the real-time spectrum analyzer
(`spectrum.js`): a live bar chart of the currently-playing instant, reset
every animation frame. There's no way to see frequency content over time —
e.g. spotting a held note's harmonics, a fade, or a percussive hit's
broadband energy — without scrubbing back and forth and reading the live
bars from memory.

This adds a standard spectrogram at the bottom of the page: time on the x
axis (synced to the main waveform's pan/zoom), frequency on the y axis,
color for amplitude. Computed once from the whole track, like the waveform
itself already is — not a live-only view.

## Build approach: wavesurfer.js's official Spectrogram plugin

`wavesurfer.js` (already a dependency, already providing `TimelinePlugin`
and `RegionsPlugin` to this app) ships `wavesurfer.js/plugins/spectrogram`
— a mature, actively-maintained plugin that computes and renders a
spectrogram from a wavesurfer instance's decoded audio, with built-in
web-worker FFT support, dB-scaled color, and log/mel/bark/ERB frequency
scales. Registering it is the same pattern already used for `RegionsPlugin`
in `waveform.js`.

This was chosen over hand-rolling STFT + canvas rendering + manual
scroll/zoom sync: the plugin already solves memory-efficient rendering for
long tracks (segmented canvases, `maxCanvasWidth`), automatic sync to
wavesurfer's pan/zoom (it's a real wavesurfer plugin, same mechanism as
`RegionsPlugin`), and web-worker offloading so a long track's FFT doesn't
freeze the page. None of that would be free to build from scratch, and all
of it is already tested upstream.

## Plugin configuration

```js
SpectrogramPlugin.create({
  container: spectrogramContainer,
  height: 200, // matches #spectrum's existing height
  labels: true,
  scale: 'logarithmic',
  frequencyMin: 27.5, // A0 - matches spectrum.js's MIN_FREQ
  frequencyMax: 4186, // C8 - matches spectrum.js's MAX_FREQ
  colorMap: 'roseus', // perceptually-uniform: dark purple -> teal -> yellow
  useWebWorker: true, // avoid blocking the main thread on long tracks
})
```

`gainDB`/`rangeDB` (the plugin's dB gain/range controls) are left at their
plugin defaults (20dB / 80dB respectively) — standard values, tunable later
if the default contrast turns out wrong in practice.

The spectrogram reflects the original decoded audio (same buffer the
waveform renders from), not the post-EQ signal — the 3-band EQ is a
separate downstream Web Audio graph (`spectrum.js`'s `filters` chain) that
only affects what you hear and the live analyzer, not the buffer wavesurfer
and its plugins read from.

## Sync with the main waveform

Automatic — no manual wiring needed. Because `SpectrogramPlugin` is
registered on the same `wavesurfer` instance as the waveform and
`RegionsPlugin`, it renders from the same decoded buffer and stays in sync
with pan/zoom the same way `RegionsPlugin`'s regions already do, without
any code in `main.js` reacting to scroll/zoom events.

## File structure

- Modify: `src/waveform.js` — `createWaveSurfer(container, spectrogramContainer)` gains a second parameter and registers `SpectrogramPlugin` alongside the existing `RegionsPlugin`.
- Modify: `index.html` — new `<section id="spectrogram-section">` at the bottom of `<main>`, after `#selections-section`, containing the plugin's target `<div id="spectrogram">`.
- Modify: `src/style.css` — container styling matching the existing `#waveform`/`#spectrum` panel look (bordered, rounded, `overflow: hidden`).
- Modify: `src/main.js` — pass the new container element into `createWaveSurfer(...)`; wire the plugin's `error` event to `showToast(...)`, the same error-reporting path already used for `wavesurfer.on('error', ...)`.

## Error handling

`SpectrogramPlugin` emits its own `error` event (distinct from
`wavesurfer`'s), fired if FFT computation fails. Wired to the same
`showToast` used elsewhere:

```js
spectrogramPlugin.on('error', (error) => {
  showToast(`Could not render spectrogram: ${error.message}`)
})
```

## Testing

No new test module. This is plugin registration and static configuration,
no custom logic — the same untested-by-convention treatment
`TimelinePlugin`/`RegionsPlugin` registration already gets in this
codebase. Verified manually in a real browser instead (uploading a file,
confirming the spectrogram renders and its visible time range moves
correctly when the waveform is scrolled/zoomed).
