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
long tracks (segmented canvases, `maxCanvasWidth`), ~~automatic sync to
wavesurfer's pan/zoom (it's a real wavesurfer plugin, same mechanism as
`RegionsPlugin`)~~ (**false — only zoom sync turned out to be automatic; pan
and playback-follow needed manual wiring, see the Correction section below**),
and web-worker offloading so a long track's FFT doesn't freeze the page. None
of that would be free to build from scratch, and all of it is already tested
upstream.

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
  fallbackToMainThread: false, // otherwise a worker failure silently reruns the FFT on the main thread instead of emitting 'error'
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

~~Automatic — no manual wiring needed.~~ **Superseded — see Correction
below.** This section originally assumed that because `SpectrogramPlugin`
is registered on the same `wavesurfer` instance as the waveform and
`RegionsPlugin`, it would render from the same decoded buffer and stay in
sync with pan/zoom the same way `RegionsPlugin`'s regions already do. That
assumption turned out to be false for pan and playback-follow (zoom alone
does work automatically) — manual sync code is required; see the
Correction section.

## File structure

- Modify: `src/waveform.js` — `createWaveSurfer(container, spectrogramContainer)` gains a second parameter and registers `SpectrogramPlugin` alongside the existing `RegionsPlugin`.
- Modify: `index.html` — new `<section id="spectrogram-section">` at the bottom of `<main>`, after `#selections-section`, containing the plugin's target `<div id="spectrogram">`.
- Modify: `src/style.css` — container styling matching the existing `#waveform`/`#spectrum` panel look (bordered, rounded, `overflow: hidden`).
- Modify: `src/main.js` — pass the new container element into `createWaveSurfer(...)`; wire the plugin's `error` event to `showToast(...)`, the same error-reporting path already used for `wavesurfer.on('error', ...)`; also contains the manual scroll-sync wiring (`syncSpectrogramScroll`) described in the Correction section below.

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

## Correction: the plugin does not actually sync pan/playback (found during manual verification)

Manual browser verification (real headless Chromium, not just reading
code) found that `SpectrogramPlugin` only stays in sync with the waveform
on **zoom** — pan (shift+wheel) and playback's auto-follow-the-playhead
scrolling leave the spectrogram frozen on whatever view was rendered at the
last zoom change, even though `wavesurfer`'s own `scroll` event was
confirmed (via direct event instrumentation in the browser) to fire
correctly with accurate `[visibleStartTime, visibleEndTime, scrollLeft,
scrollRight]` data on every pan and playback tick. Zoom "appears" to sync
only because the plugin fully re-renders its canvas at the new zoomed
width starting from position 0 every time — which happens to look correct
immediately after a zoom (position 0 is often what's on screen right
after zooming around a click point near the start) but is not actually
tracking scroll position at all.

Confirmed this is not fixable by configuration: the newer
`wavesurfer.js/plugins/spectrogram-windowed` variant (`WindowedSpectrogram
Plugin`, from upstream PR #4125, explicitly built to improve on the
original plugin) explicitly subscribes to `wavesurfer`'s `scroll` event in
its own source — the theoretically-correct approach — but still exhibited
the identical frozen-view symptom when tested directly. Disabling
`useWebWorker` (in case rapid scroll events were racing with delayed
worker responses) made no difference either. A search of upstream
`wavesurfer.js` GitHub issues found related-but-unresolved reports (e.g.
"spectrogram has no changes" on zoom) with no maintainer-confirmed fix or
documented workaround, and no newer stable release beyond the one already
installed (7.12.11; only a v8 beta exists).

**Fix**: keep `SpectrogramPlugin` (its rendering — colors, labels, dB
scaling, FFT — is correct and unaffected by this bug), but drive its
container's horizontal position manually from `main.js`, using the exact
`wavesurfer.getScroll()` value both plugins already fail to apply
themselves:

```js
function syncSpectrogramScroll() {
  const wideCanvas = [...spectrogramContainer.querySelectorAll('canvas')].find(
    (c) => c.width > spectrogramContainer.clientWidth,
  )
  if (wideCanvas && wideCanvas.parentElement) {
    wideCanvas.parentElement.style.transform = `translateX(${-wavesurfer.getScroll()}px)`
  }
}
wavesurfer.on('scroll', syncSpectrogramScroll)
wavesurfer.on('redraw', syncSpectrogramScroll)
```

- `wavesurfer.on('scroll', ...)` covers pan and playback-follow (confirmed
  firing correctly in both cases).
- `wavesurfer.on('redraw', ...)` covers zoom — the plugin's own zoom-time
  re-render always starts from position 0, so this re-applies the current
  (possibly non-zero, e.g. after playback has scrolled forward and the
  user then zooms) scroll offset immediately after that re-render, rather
  than leaving the just-zoomed view snapped back to position 0.
- The "find the wide canvas" lookup avoids hardcoding the plugin's private
  DOM structure (a fixed index-based selector into an undocumented
  internal layout would be more fragile and no more correct); it looks for
  whichever canvas is currently wider than the visible container, which is
  the content canvas at any zoom level, and leaves the separate,
  always-narrow frequency-labels canvas untouched (so labels correctly
  stay pinned to the left edge while the content pans underneath).
- Reaching into the plugin's internal DOM at all is an explicit,
  acknowledged fragility: `SpectrogramPlugin` doesn't expose a public
  redraw/reposition method, so this could break on a future
  `wavesurfer.js` upgrade. Accepted as the pragmatic fix after confirming
  there is no supported alternative — if a future upgrade breaks this, the
  fix is to re-verify the DOM structure and adjust the lookup, not to
  revert to assuming automatic sync.

Verified end-to-end in a real browser after this fix: zoom, pan, and
playback-follow all now show the spectrogram content matching whatever
time range the waveform currently displays, with frequency labels staying
correctly pinned.
