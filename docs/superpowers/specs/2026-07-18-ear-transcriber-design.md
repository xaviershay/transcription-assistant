# Ear Transcriber — Design Spec

Date: 2026-07-18

## Purpose

Client-side web page to assist transcribing music by ear. User uploads an
audio file, scrubs/loops small sections at reduced speed (pitch preserved),
and reads a note-labeled spectrum of the currently looping section to
identify pitches. Part 2 adds multiple saved selections with hotkey cycling,
so a user can step note-by-note through a phrase.

## Non-goals

- No backend, no persistence across reloads (in-memory only).
- No export/save of transcription results.
- No multi-track / multi-file support.
- No pitch-detection note guessing (spectrum is visual aid only, user reads
  it themselves).

## Stack

- Vite + vanilla JS, no UI framework.
- [wavesurfer.js](https://wavesurfer.xyz/) for waveform rendering, zoom,
  playback, and the Regions plugin for selections/looping.
- Native Web Audio `AnalyserNode` for FFT spectrum data.
- No other runtime dependencies.

## Layout

Single page, top to bottom:

1. File upload (click or drag-drop).
2. Waveform view (wavesurfer canvas) with a horizontal zoom slider above it.
3. Playback controls: play/pause, speed slider (0.25x–1.5x, pitch
   preserved), label showing which selection (if any) is active/looping.
4. Spectrum panel: canvas plot of magnitude vs. frequency, X-axis in
   note names (e.g. `A3`, `C#4`) rather than Hz, log-scaled frequency axis.
   Updates live while a selection is looping.
5. Selections list: all regions in left-to-right time order, active one
   highlighted, delete button per row.

## Core behavior

### Upload & waveform

- wavesurfer loads the file (MediaElement backend, so native `<audio>`
  element powers playback — needed for `preservesPitch`).
- Decode an `AudioBuffer` in parallel (via `AudioContext.decodeAudioData`)
  for spectrum analysis needs, if not directly available from wavesurfer.

### Selections (regions)

- Dragging on the waveform creates a new region via the Regions plugin.
  Each region is a "selection."
- Clicking a region makes it active: seeks to its start, enables loop on
  that region, disables loop on any previously active region.
- Regions kept in time order (sorted by start time) for cycling purposes.
- `Delete`/`Backspace` while a region is active removes it from the list.

### Playback

- Play/pause toggles the underlying media element.
- Speed slider calls `wavesurfer.setPlaybackRate(rate)`; the underlying
  `<audio>` element's `preservesPitch` (`mozPreservesPitch` /
  `webkitPreservesPitch` fallbacks) is set to `true` once at load so tempo
  changes independently of pitch.
- Zoom slider calls `wavesurfer.zoom(pxPerSec)`.

### Spectrum panel

- While a region is actively looping, on each animation frame: pull
  frequency data from an `AnalyserNode` fed by the media element source
  (`getByteFrequencyData`).
- Plot magnitude bars on a canvas with a log-scaled frequency X-axis.
- X-axis ticks are note names, not Hz: convert frequency → nearest
  semitone via `midi = 69 + 12*log2(f/440)`, round, format as note name
  (e.g. `A4`, `C#5`) using A440 12-tone equal temperament.
- When nothing is looping (no active selection), panel shows current
  playhead position's live spectrum instead (best-effort, same mechanism).

### Hotkey cycling (Part 2)

- `Tab` (or configurable key) → activate next region in time order past
  the currently active one (wraps to first); seeks, loops, and plays it
  immediately.
- `Shift+Tab` → same, previous region.
- If no region is active yet, `Tab` activates the first region.

## Error handling

- Unsupported/corrupt audio file: show inline error message near upload
  control, do not crash the page.
- No regions yet: cycling hotkeys and spectrum-while-looping simply no-op
  (spectrum still shows live playhead spectrum if playing).

## Testing approach

Manual browser testing (no automated test suite planned for this small
client-only tool):

- Upload various formats (mp3, wav, ogg) — confirm waveform renders.
- Drag to create 2–3 regions, confirm click-to-activate loop works.
- Confirm speed slider changes tempo without pitch shift (audible check).
- Confirm zoom slider changes waveform horizontal scale.
- Confirm spectrum panel shows plausible note peaks for a known single
  note test tone/recording.
- Confirm Tab/Shift+Tab cycles through regions in order, wrapping at
  ends.
- Confirm delete key removes the active region and list updates.
