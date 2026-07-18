# Ear Transcriber — Per-File Settings Persistence Design

Date: 2026-07-18

Fifth follow-up to `2026-07-18-ear-transcriber-design.md`. Deliberately
reverses that spec's "no persistence" constraint (and the beat-grid
design's explicit non-goal restating it) for exactly four settings.

## Purpose

Remember tempo (BPM), subdivisions-per-beat, beat-1 offset, and volume
per uploaded file, so re-opening a file you've already set up doesn't
require re-entering all four every time.

## File identity: content hash

Keyed by a SHA-256 hash of the file's raw bytes (via Web Crypto
`crypto.subtle.digest`), not filename/size — a renamed copy of the same
file still matches, and two different files never collide just because
they happen to share a name/size. The hash is computed once per upload
from the same `ArrayBuffer` already read for normalization (no second
file read).

## New module: `src/persistence.js`

Pure/testable, consistent with the app's other hand-rolled modules:

- `bufferToHex(buffer: ArrayBuffer): string` — hex-encodes a byte buffer.
- `computeFileHash(arrayBuffer: ArrayBuffer): Promise<string>` — SHA-256
  via `crypto.subtle.digest`, hex-encoded via `bufferToHex`. Works
  identically in the browser and in Node (Web Crypto is a standard global
  in both), so this is fully vitest-testable against known SHA-256 test
  vectors — no browser needed for this part.
- `loadSettings(storage, hash): {bpm, subdivisions, offset, volume} |
  null` — reads `storage.getItem(key)`, JSON-parses, returns `null` on
  missing key or malformed JSON (defensive — a corrupted localStorage
  entry shouldn't crash the app).
- `saveSettings(storage, hash, settings): void` — JSON-stringifies and
  writes via `storage.setItem(key)`.

`storage` is dependency-injected (not hardcoded to `window.localStorage`)
specifically so `loadSettings`/`saveSettings` are testable with a plain
in-memory stub (`{getItem, setItem}`) rather than requiring a browser or
jsdom environment.

Storage key format: `ear-transcriber:settings:<hex-hash>`.

## Wiring (`main.js`)

**On upload**, before `wavesurfer.loadBlob`:
1. Read the file as `ArrayBuffer` (already happens for normalization —
   reused, not duplicated).
2. `computeFileHash` → store as `currentFileHash` (module-level state).
3. `loadSettings(localStorage, currentFileHash)`:
   - **Found**: apply `bpm`/`subdivisions`/`offset`/`volume` to their
     respective slider DOM values + internal state variables, call
     `wavesurfer.setVolume(volume)`, call `rebuildTimeline()`.
   - **Not found**: explicitly reset all four to defaults (120 BPM, 4
     subdivisions, offset 0, volume 1) the same way — so a new unrelated
     file never inherits the previous file's settings left over in
     session state.

**On every settings change** — the existing tempo slider, subdivisions
slider, volume slider `input` handlers, and the beat-1-offset branch
inside the existing `interaction` handler — after updating state, also
call `saveSettings(localStorage, currentFileHash, {bpm, subdivisions,
offset, volume})`. No-op (skip the save) if `currentFileHash` is `null`
(no file loaded yet — shouldn't normally be reachable since the sliders
are only meaningfully interactive after a file loads, but guarding is
cheap).

No debouncing on the writes — localStorage writes of a ~50-byte JSON
blob are cheap enough that writing on every slider `input` tick (even
mid-drag) is not a real performance concern, unlike the onset-detection
preview recompute which genuinely needed debouncing.

## Non-goals

- Only these four settings persist — regions/selections, zoom level, and
  playback position still don't (unchanged from the base spec).
- No UI to view/clear saved settings, no storage size cap/eviction beyond
  whatever the browser's own localStorage quota does — YAGNI unless this
  becomes a real problem (each entry is ~50 bytes; would take tens of
  thousands of distinct files to matter).
- No migration/versioning of the stored JSON shape — if the shape ever
  changes, old entries simply fail the (implicit, informal) shape check
  in `loadSettings` and fall back to defaults, which is an acceptable
  failure mode for a small convenience feature like this.

## Testing approach

`src/persistence.js` gets real vitest coverage, consistent with the
app's other pure modules:

- `bufferToHex`: known byte sequences → known hex strings.
- `computeFileHash`: a known input buffer → its well-known published
  SHA-256 hex digest (a standard test vector), confirming the hashing
  pipeline end-to-end.
- `loadSettings`/`saveSettings`: round-trip through an in-memory stub
  storage object; missing key → `null`; malformed JSON in storage →
  `null` (not a thrown error).

The upload-handler wiring itself (applying loaded settings to sliders,
resetting to defaults, saving on each change) is manual browser testing,
consistent with the rest of the app's testing approach.
