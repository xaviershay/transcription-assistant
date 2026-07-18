# Transcription Assistant

A client-side web app for transcribing music by ear. Upload an audio
file and get a waveform scrubber with speed/volume control, a
note-labeled spectrum analyzer, loopable selections (with automatic
note-onset subdivision), and a tempo/beat grid overlaid on the
waveform. Everything runs in the browser — no backend, no upload to a
server.

Live at https://xaviershay.github.io/transcription-assistant/

## Scripts

- `bin/setup` — installs dependencies.
- `bin/dev` — starts the local dev server (with hot reload) at
  http://localhost:5173.
- `bin/publish` — builds the app and publishes it to GitHub Pages
  (pushes `dist/` to the `gh-pages` branch).

## Getting started

```
bin/setup
bin/dev
```
