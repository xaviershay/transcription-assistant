# Transcription Assistant

A client-side web app for transcribing music by ear. Upload an audio
file and get a waveform scrubber with speed/volume control, a
note-labeled spectrum analyzer, a spectrogram view synced to the
waveform, loopable selections (with automatic note-onset subdivision),
and a tempo/beat grid overlaid on the waveform. Everything runs in the
browser.

Live at https://xaviershay.github.io/transcription-assistant/

## Scripts

- `bin/setup` — installs dependencies.
- `bin/dev` — starts the local dev server (with hot reload) at
  http://localhost:5173.
- `bin/publish` — builds the app and publishes it to GitHub Pages
