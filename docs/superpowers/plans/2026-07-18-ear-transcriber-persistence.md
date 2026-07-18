# Ear Transcriber Per-File Settings Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remember tempo, subdivisions-per-beat, beat-1 offset, and volume per uploaded file (keyed by a SHA-256 content hash), so re-uploading a file you've already set up restores those four settings instead of resetting to defaults.

**Architecture:** A new pure module (`src/persistence.js`) — hashing and storage read/write, both fully vitest-testable (Web Crypto is a standard global in both Node and the browser; storage is dependency-injected so tests use an in-memory stub, not a real browser). `main.js`'s upload handler hashes the file, loads or defaults the four settings, and every settings-changing handler saves back to storage.

**Tech Stack:** Same as the rest of the app — vanilla JS, Web Crypto (`crypto.subtle`), `localStorage`. No new dependencies.

## Global Constraints

- `computeFileHash` verified against known SHA-256 test vectors (empty
  buffer and `"abc"`) in Node before this plan was written — do not alter
  the hashing logic without re-verifying against those same vectors.
- `storage` is dependency-injected into `loadSettings`/`saveSettings` (not
  hardcoded `window.localStorage`) specifically so they're testable
  without a browser.
- Storage key format: `` `ear-transcriber:settings:${hash}` ``.
- `loadSettings` must return `null` (never throw) for a missing key,
  malformed JSON, or JSON missing any of the four expected numeric
  fields — a corrupted/foreign entry should fall back to defaults, not
  crash the app.
- Only these four settings persist — this does not reverse the rest of
  the app's no-persistence design (regions, zoom, playback position still
  don't persist).
- No debouncing on saves — writes are cheap enough to happen on every
  `input` event tick.

---

## File Structure

```
src/
  persistence.js       # NEW — pure: hashing, storage read/write
  persistence.test.js    # NEW
  main.js                  # MODIFIED — hash-on-upload, apply/save wiring
```

---

### Task 1: Hashing and storage module (`src/persistence.js`)

**Files:**
- Create: `src/persistence.js`
- Create: `src/persistence.test.js`

**Interfaces:**
- Produces: `bufferToHex(buffer: ArrayBuffer): string`,
  `computeFileHash(arrayBuffer: ArrayBuffer): Promise<string>`,
  `loadSettings(storage, hash: string): {bpm, subdivisions, offset,
  volume} | null`, `saveSettings(storage, hash: string, settings): void`.
  `storage` is any object with `getItem(key): string|null` and
  `setItem(key, value: string): void`. Consumed by Task 2's `main.js`.

- [ ] **Step 1: Write the failing tests**

```js
// src/persistence.test.js
import { describe, it, expect } from 'vitest'
import { bufferToHex, computeFileHash, loadSettings, saveSettings } from './persistence.js'

function createMemoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
  }
}

describe('bufferToHex', () => {
  it('hex-encodes a byte buffer', () => {
    const buffer = new Uint8Array([0, 15, 16, 255]).buffer
    expect(bufferToHex(buffer)).toBe('000f10ff')
  })
})

describe('computeFileHash', () => {
  it('matches the known SHA-256 digest of an empty buffer', async () => {
    const hash = await computeFileHash(new ArrayBuffer(0))
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('matches the known SHA-256 digest of "abc"', async () => {
    const buffer = new TextEncoder().encode('abc').buffer
    const hash = await computeFileHash(buffer)
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('loadSettings / saveSettings', () => {
  it('round-trips settings through storage', () => {
    const storage = createMemoryStorage()
    const settings = { bpm: 140, subdivisions: 3, offset: 1.25, volume: 0.8 }
    saveSettings(storage, 'abc123', settings)
    expect(loadSettings(storage, 'abc123')).toEqual(settings)
  })

  it('returns null for a hash with no saved settings', () => {
    const storage = createMemoryStorage()
    expect(loadSettings(storage, 'nope')).toBeNull()
  })

  it('returns null for malformed JSON rather than throwing', () => {
    const storage = createMemoryStorage()
    storage.setItem('ear-transcriber:settings:bad', 'not json{{{')
    expect(loadSettings(storage, 'bad')).toBeNull()
  })

  it('returns null for JSON missing expected fields', () => {
    const storage = createMemoryStorage()
    storage.setItem('ear-transcriber:settings:partial', JSON.stringify({ bpm: 120 }))
    expect(loadSettings(storage, 'partial')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/persistence.test.js`
Expected: FAIL — `Cannot find module './persistence.js'`.

- [ ] **Step 3: Write `src/persistence.js`**

```js
export function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function computeFileHash(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer)
  return bufferToHex(digest)
}

function storageKey(hash) {
  return `ear-transcriber:settings:${hash}`
}

export function loadSettings(storage, hash) {
  const raw = storage.getItem(storageKey(hash))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (
      typeof parsed.bpm !== 'number' ||
      typeof parsed.subdivisions !== 'number' ||
      typeof parsed.offset !== 'number' ||
      typeof parsed.volume !== 'number'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function saveSettings(storage, hash, settings) {
  storage.setItem(storageKey(hash), JSON.stringify(settings))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/persistence.test.js`
Expected: PASS, all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/persistence.js src/persistence.test.js
git commit -m "feat: add file-hash-keyed settings persistence"
```

---

### Task 2: Wire persistence into `main.js`

**Files:**
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `computeFileHash`, `loadSettings`, `saveSettings` from
  Task 1. `wavesurfer`, `tempoSlider`/`tempoLabel`,
  `subdivisionsSlider`/`subdivisionsLabel`, `volumeInput`/`volumeLabel`,
  `beatBpm`/`beatSubdivisions`/`beatOffset`, `rebuildTimeline`,
  `setBeatOneBtn` (all already declared in `main.js`).

- [ ] **Step 1: Add the import** near the top with the other imports:

```js
import { computeFileHash, loadSettings, saveSettings } from './persistence.js'
```

- [ ] **Step 2: Replace `normalizeFile(file)` with `normalizeAudio(arrayBuffer)`**
  — it now takes the already-read buffer instead of reading the file
  itself, so the same buffer can be reused for hashing. Replace:

```js
async function normalizeFile(file) {
  const arrayBuffer = await file.arrayBuffer()
  const audioCtx = new AudioContext()
  try {
```

with:

```js
async function normalizeAudio(arrayBuffer) {
  const audioCtx = new AudioContext()
  try {
```

(The rest of the function body — from `const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)` through the closing `}` — is unchanged.)

- [ ] **Step 3: Add settings defaults, apply, and save helpers.** Insert
  immediately after the `normalizeAudio` function (before the
  `uploadInput.addEventListener('change', ...)` block):

```js
const DEFAULT_SETTINGS = { bpm: 120, subdivisions: 4, offset: 0, volume: 1 }

let currentFileHash = null

function applySettings(settings) {
  beatBpm = settings.bpm
  beatSubdivisions = settings.subdivisions
  beatOffset = settings.offset
  tempoSlider.value = String(beatBpm)
  tempoLabel.textContent = `${beatBpm} BPM`
  subdivisionsSlider.value = String(beatSubdivisions)
  subdivisionsLabel.textContent = String(beatSubdivisions)
  volumeInput.value = String(settings.volume)
  volumeLabel.textContent = `${Math.round(settings.volume * 100)}%`
  wavesurfer.setVolume(settings.volume)
  rebuildTimeline()
}

function saveCurrentSettings() {
  if (!currentFileHash) return
  saveSettings(localStorage, currentFileHash, {
    bpm: beatBpm,
    subdivisions: beatSubdivisions,
    offset: beatOffset,
    volume: Number(volumeInput.value),
  })
}
```

- [ ] **Step 4: Replace the upload `change` handler** to hash the file
  and apply saved (or default) settings before loading:

```js
uploadInput.addEventListener('change', async () => {
  const file = uploadInput.files[0]
  if (!file) return
  uploadError.hidden = true
  uploadFilename.textContent = file.name

  try {
    const normalizedBlob = await normalizeFile(file)
    wavesurfer.loadBlob(normalizedBlob)
  } catch {
    wavesurfer.loadBlob(file)
  }
})
```

with:

```js
uploadInput.addEventListener('change', async () => {
  const file = uploadInput.files[0]
  if (!file) return
  uploadError.hidden = true
  uploadFilename.textContent = file.name

  const arrayBuffer = await file.arrayBuffer()
  currentFileHash = await computeFileHash(arrayBuffer)
  applySettings(loadSettings(localStorage, currentFileHash) ?? DEFAULT_SETTINGS)

  try {
    const normalizedBlob = await normalizeAudio(arrayBuffer)
    wavesurfer.loadBlob(normalizedBlob)
  } catch {
    wavesurfer.loadBlob(file)
  }
})
```

- [ ] **Step 5: Save on tempo change.** Replace:

```js
tempoSlider.addEventListener('input', () => {
  beatBpm = Number(tempoSlider.value)
  tempoLabel.textContent = `${beatBpm} BPM`
  rebuildTimeline()
})
```

with:

```js
tempoSlider.addEventListener('input', () => {
  beatBpm = Number(tempoSlider.value)
  tempoLabel.textContent = `${beatBpm} BPM`
  rebuildTimeline()
  saveCurrentSettings()
})
```

- [ ] **Step 6: Save on subdivisions change.** Replace:

```js
subdivisionsSlider.addEventListener('input', () => {
  beatSubdivisions = Number(subdivisionsSlider.value)
  subdivisionsLabel.textContent = String(beatSubdivisions)
  rebuildTimeline()
})
```

with:

```js
subdivisionsSlider.addEventListener('input', () => {
  beatSubdivisions = Number(subdivisionsSlider.value)
  subdivisionsLabel.textContent = String(beatSubdivisions)
  rebuildTimeline()
  saveCurrentSettings()
})
```

- [ ] **Step 7: Save on volume change.** Replace:

```js
volumeInput.addEventListener('input', () => {
  const volume = Number(volumeInput.value)
  wavesurfer.setVolume(volume)
  volumeLabel.textContent = `${Math.round(volume * 100)}%`
})
```

with:

```js
volumeInput.addEventListener('input', () => {
  const volume = Number(volumeInput.value)
  wavesurfer.setVolume(volume)
  volumeLabel.textContent = `${Math.round(volume * 100)}%`
  saveCurrentSettings()
})
```

- [ ] **Step 8: Save on beat-1 offset change.** Replace the `interaction`
  handler's beat-1 branch:

```js
wavesurfer.on('interaction', (newTime) => {
  if (settingBeatOne) {
    beatOffset = newTime
    settingBeatOne = false
    setBeatOneBtn.textContent = 'Set Beat 1'
    setBeatOneBtn.disabled = false
    rebuildTimeline()
  }
```

with:

```js
wavesurfer.on('interaction', (newTime) => {
  if (settingBeatOne) {
    beatOffset = newTime
    settingBeatOne = false
    setBeatOneBtn.textContent = 'Set Beat 1'
    setBeatOneBtn.disabled = false
    rebuildTimeline()
    saveCurrentSettings()
  }
```

(The rest of the handler — clearing `activeRegionId`, `activeLabel`,
`refreshSelectionsList()` — is unchanged.)

- [ ] **Step 9: Run the full test suite and build**

Run: `npm test`
Expected: PASS, all 43 tests green (36 from before + 7 new from Task 1).

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 10: Manual check — persistence round-trip**

Run: `npm run dev`, open the browser's dev tools to Application/Storage
→ Local Storage alongside the app.
1. Upload a file. Expected: tempo 120, subdivisions 4, volume 100%
   (defaults) — confirms first-upload-ever still defaults correctly.
2. Change tempo to something distinctive (e.g. 155), subdivisions to 6,
   volume to 60%, and click "Set Beat 1" then click partway into the
   waveform. Expected: a `localStorage` entry appears under a key like
   `ear-transcriber:settings:<64-hex-chars>` containing all four values.
3. Upload a *different* file. Expected: settings reset to defaults (120
   BPM, 4 subdivisions, 100% volume, offset 0) — confirms a new file
   doesn't inherit the previous file's leftover settings.
4. Re-upload the *first* file (the one you customized in step 2).
   Expected: tempo/subdivisions/volume/beat-1 offset are restored exactly
   as you left them — the grid should visually start at the same offset,
   sliders at the same positions.
5. Rename the first file's actual file on disk (same bytes, different
   filename) and upload the renamed copy. Expected: still matches and
   restores the same saved settings — confirms the hash is based on
   content, not filename.

- [ ] **Step 11: Commit**

```bash
git add src/main.js
git commit -m "feat: persist tempo/subdivisions/beat-1/volume per file"
```

---

## Final Verification

- [ ] Run `npm test` — all 43 tests pass.
- [ ] Run `npm run build` — succeeds.
- [ ] Full manual walkthrough per Task 2 Step 10.
