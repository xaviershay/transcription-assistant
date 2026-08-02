# Record system/tab audio, and persist current audio across sessions

## Problem

Today the only way to get audio into the app is `<input type="file">`. Two
gaps:

1. There's no way to capture audio playing on the computer itself (e.g. a
   track in another tab) without first saving it to a file some other way.
2. Nothing survives a reload — every session starts from an empty state,
   even if you were mid-transcription of the same file last time.

This adds an in-browser recording option (system/tab audio, via
`getDisplayMedia`) and persists whatever audio is currently loaded
(recorded or uploaded) so it's automatically restored on next load.

Explicitly out of scope (YAGNI): microphone-input capture, a history of
multiple saved recordings, manual renaming/labeling, cross-device sync. The
app persists exactly one "current audio" slot, overwritten by whatever you
record or upload next.

## Capture

New module `src/recording.js`:

- `startRecording()` calls `navigator.mediaDevices.getDisplayMedia({ video:
  true, audio: true })`. Chromium browsers only offer a "share audio"
  checkbox in the picker when `video: true` is requested — the video track
  is stopped and discarded immediately after the stream is obtained, only
  the audio track is used.
- If the resulting stream has no audio track (user didn't check "share
  audio", or the shared source has no audio), throws a descriptive error
  instead of silently recording silence.
- The audio-only stream is fed into a `MediaRecorder`; chunks are collected
  and resolved into a single `Blob` (`audio/webm`) when recording stops.
- `stopRecording()` stops the recorder and stops every track on the
  original stream (including the discarded video track), so the browser's
  screen-share indicator is never left active.
- `getDisplayMedia` support is feature-detected at page load
  (`navigator.mediaDevices?.getDisplayMedia`); if absent, `#record-btn` is
  rendered `disabled` with a `title` explaining why, rather than failing on
  click.

## UI

One new toggle button, `#record-btn`, next to the existing `#upload`
control in `#upload-section`:

- Idle: label "Record".
- Recording: label switches to `Stop (mm:ss)`, updated once per second via
  `setInterval` from recording start.
- Click while idle → `startRecording()`. Click while recording →
  `stopRecording()`, which resolves the Blob and hands it to the same
  `loadAudio()` path described below, with label `` `Recording — ${niceTimestamp}` ``
  (e.g. "Recording — Aug 2, 3:41pm").
- Errors (no audio track, permission cancelled) reuse the existing
  `#upload-error` element. A user-cancelled picker
  (`NotAllowedError`/`AbortError` from `getDisplayMedia`) is treated as a
  no-op, not an error — button just resets to "Record", nothing shown.

## Persistence

New module `src/audioStore.js` (unit-tested), mirroring the injectable-
storage pattern `persistence.js` already uses for settings:

```js
saveCurrentAudio(store, blob, label) // store.put('current', { blob, label, storedAt: Date.now() })
loadCurrentAudio(store)              // store.get('current') -> { blob, label, storedAt } | undefined
```

`store` is an abstract Promise-based interface — `{ get(key), put(key,
value) }` — so tests inject an in-memory fake, exactly like
`persistence.test.js` fakes `localStorage`.

New thin wrapper `src/indexedDbStore.js` (untested glue, same role
`localStorage` plays for settings today): opens IndexedDB database
`ear-transcriber`, object store `audio`, and implements the `{get, put}`
interface against it. IndexedDB is used instead of `localStorage` because
recorded/uploaded blobs can be tens of MB, well past `localStorage`'s
~5MB string-only quota.

There is exactly one key, `'current'` — every save overwrites the prior
value. No history, no per-file slots (this is separate from the existing
per-file-hash settings persistence in `persistence.js`, which is unaffected
and keyed by content hash as before).

### Wiring (`main.js`)

The upload handler, the recording-stop handler, and startup restore all
need to do the same sequence — hash the blob, load its per-hash settings,
normalize, `wavesurfer.loadBlob`, update `#upload-filename` — so this is
extracted into one shared function:

```js
async function loadAudio(blob, label) {
  const arrayBuffer = await blob.arrayBuffer()
  currentFileHash = await computeFileHash(arrayBuffer)
  applySettings(loadSettings(localStorage, currentFileHash) ?? DEFAULT_SETTINGS)
  uploadFilename.textContent = label
  try {
    wavesurfer.loadBlob(await normalizeAudio(arrayBuffer))
  } catch {
    wavesurfer.loadBlob(blob)
  }
}
```

Call sites:

- **Upload** (`uploadInput` change handler): `await loadAudio(file, file.name)`,
  then fire-and-forget `saveCurrentAudio(dbStore, file, file.name)`.
- **Recording stop**: same — `loadAudio(blob, label)` then fire-and-forget
  `saveCurrentAudio(dbStore, blob, label)`.
- **Startup**: a top-level async IIFE in `main.js` calls
  `loadCurrentAudio(dbStore)`; if a record is found, `await
  loadAudio(stored.blob, stored.label)` runs automatically, restoring
  playback state, beat grid, EQ, and volume without any click.

`saveCurrentAudio` calls are fire-and-forget (not awaited by the UI path)
so a slow or failing save never blocks or delays playback.

## Error handling

- Any IndexedDB failure (quota exceeded, private-browsing mode blocking
  IndexedDB entirely, API unsupported) is caught inside
  `indexedDbStore.js`: `loadCurrentAudio` resolves `undefined` on failure,
  `saveCurrentAudio` no-ops. Save/restore is best-effort — it never throws
  into `main.js` or blocks recording/upload/playback.
- Recording errors (no audio track, `getDisplayMedia` rejection other than
  user-cancel) surface through `#upload-error`, same element already used
  for `wavesurfer`'s `error` event.

## Testing

Follows the existing per-module vitest convention (`environment: 'node'`,
no jsdom/fake-indexeddb dependency added):

- `audioStore.test.js`: round-trip save/load against an in-memory fake
  store; overwrite replaces the prior value; missing key resolves
  `undefined`.
- `recording.js`: pure/testable pieces (timestamp label formatting) get
  unit tests. The `getDisplayMedia`/`MediaRecorder` orchestration itself is
  thin and untested, the same treatment `main.js` already gives
  `AudioContext`/`decodeAudioData` usage.
- `indexedDbStore.js` is untested glue, same as `localStorage` usage isn't
  separately unit-tested today.
