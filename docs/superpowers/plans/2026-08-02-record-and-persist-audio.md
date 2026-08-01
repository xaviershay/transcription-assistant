# Record and Persist Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user record system/tab audio (not microphone) directly in the browser as an alternative to uploading a file, and persist whichever audio (recorded or uploaded) is currently loaded so it's automatically restored on the next page load.

**Architecture:** Two new pure/testable modules — `audioStore.js` (save/load a single "current audio" record against an injectable Promise-based key-value store, mirroring `persistence.js`'s injectable-storage pattern) and `recording.js` (capture via `getDisplayMedia` + `MediaRecorder`, plus label formatting). One new untested glue module, `indexedDbStore.js`, implements the store interface against real IndexedDB (chosen over `localStorage` because blobs can be tens of MB). `main.js` gains a shared `loadAudio(blob, label)` function used by the upload handler, the new record button, and a startup restore check — collapsing what would otherwise be three near-duplicate code paths into one.

**Tech Stack:** Vanilla JS, `MediaRecorder`/`getDisplayMedia` (Web Audio/Media Capture APIs), IndexedDB, vitest for the pure modules.

## Global Constraints

- Capture source is system/tab audio via `getDisplayMedia`, not microphone input. (Spec: Problem)
- Chromium browsers only offer a "share audio" checkbox when `video: true` is requested — the video track must be requested, then stopped and discarded immediately, keeping only the audio track. (Spec: Capture)
- Exactly one "current audio" slot is persisted — no history, no renaming, no per-file library. Every save overwrites the prior value. (Spec: Problem, Persistence)
- Persistence uses IndexedDB, not `localStorage` — blobs can be tens of MB, well past `localStorage`'s ~5MB string quota. This is separate from the existing per-file-hash settings persistence in `persistence.js` (unaffected, still `localStorage`, still keyed by content hash). (Spec: Persistence)
- `saveCurrentAudio` calls are fire-and-forget from the UI's perspective — never awaited before continuing playback/UI updates. (Spec: Wiring)
- Any IndexedDB failure (quota, private-browsing block, unsupported) is caught inside `indexedDbStore.js`: `get` resolves `undefined`, `put` no-ops. Never throws into `main.js`. (Spec: Error handling)
- A user-cancelled share picker (`NotAllowedError`/`AbortError`) is a no-op, not an error — no message shown, button just resets. (Spec: UI)
- No new test infra — stays `environment: 'node'`, no jsdom/fake-indexeddb dependency. (Spec: Testing)

---

## File Structure

- Create: `src/audioStore.js` — `saveCurrentAudio`/`loadCurrentAudio` against an injectable store.
- Create: `src/audioStore.test.js` — tests for the above.
- Create: `src/indexedDbStore.js` — real-IndexedDB implementation of the store interface (untested glue).
- Create: `src/recording.js` — `startRecording`/`isRecordingSupported`/`formatRecordingLabel`.
- Create: `src/recording.test.js` — tests for `formatRecordingLabel`.
- Modify: `index.html` — add `#record-btn` next to `#upload`.
- Modify: `src/main.js` — extract `loadAudio()`, wire persistence (save on upload, restore on startup), wire recording (button, timer, save on stop).

---

### Task 1: `audioStore.js` — save/load the current-audio record

**Files:**
- Create: `src/audioStore.js`
- Create: `src/audioStore.test.js`

**Interfaces:**
- Consumes: nothing new — takes an abstract `store` object `{ get(key): Promise<value|undefined>, put(key, value): Promise<void> }`, injected by the caller.
- Produces: `saveCurrentAudio(store, blob, label)`, `loadCurrentAudio(store)` — resolves `{ blob, label, storedAt } | undefined`. Task 2 provides a real-IndexedDB `store`; Task 3 wires both into `main.js`.

- [ ] **Step 1: Write the failing tests**

Create `src/audioStore.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { saveCurrentAudio, loadCurrentAudio } from './audioStore.js'

function createMemoryStore() {
  const map = new Map()
  return {
    get: async (key) => map.get(key),
    put: async (key, value) => {
      map.set(key, value)
    },
  }
}

describe('saveCurrentAudio / loadCurrentAudio', () => {
  it('returns undefined when nothing has been saved', async () => {
    const store = createMemoryStore()
    expect(await loadCurrentAudio(store)).toBeUndefined()
  })

  it('round-trips a saved blob and label', async () => {
    const store = createMemoryStore()
    const blob = new Blob(['fake audio bytes'])
    await saveCurrentAudio(store, blob, 'my-file.mp3')
    const loaded = await loadCurrentAudio(store)
    expect(loaded.blob).toBe(blob)
    expect(loaded.label).toBe('my-file.mp3')
    expect(typeof loaded.storedAt).toBe('number')
  })

  it('overwrites the prior save', async () => {
    const store = createMemoryStore()
    await saveCurrentAudio(store, new Blob(['first']), 'first.mp3')
    const secondBlob = new Blob(['second'])
    await saveCurrentAudio(store, secondBlob, 'second.mp3')
    const loaded = await loadCurrentAudio(store)
    expect(loaded.blob).toBe(secondBlob)
    expect(loaded.label).toBe('second.mp3')
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/audioStore.test.js`
Expected: FAIL — `src/audioStore.js` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/audioStore.js`:

```javascript
const CURRENT_KEY = 'current'

export async function saveCurrentAudio(store, blob, label) {
  await store.put(CURRENT_KEY, { blob, label, storedAt: Date.now() })
}

export async function loadCurrentAudio(store) {
  return store.get(CURRENT_KEY)
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/audioStore.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/audioStore.js src/audioStore.test.js
git commit -m "Add audioStore for saving/loading the current audio record"
```

---

### Task 2: `indexedDbStore.js` — real IndexedDB-backed store

**Files:**
- Create: `src/indexedDbStore.js`

**Interfaces:**
- Consumes: nothing from Task 1 directly (no shared code), but implements the exact `{ get(key), put(key, value) }` shape Task 1's `saveCurrentAudio`/`loadCurrentAudio` expect as their `store` argument.
- Produces: `createIndexedDbStore(dbName = 'ear-transcriber', storeName = 'audio')` — returns `{ get(key), put(key, value) }`. Task 3 calls this once in `main.js` to get the real `dbStore` passed into Task 1's functions.

This module talks to a real browser API (`indexedDB`) unavailable under the `environment: 'node'` vitest setup, so — like `computeFileHash`'s use of `crypto.subtle` or `main.js`'s use of `AudioContext` — it has no automated test. It's verified manually in Step 2 below.

- [ ] **Step 1: Write the implementation**

Create `src/indexedDbStore.js`:

```javascript
function openDb(dbName, storeName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function createIndexedDbStore(dbName = 'ear-transcriber', storeName = 'audio') {
  let dbPromise = null
  function getDb() {
    if (!dbPromise) dbPromise = openDb(dbName, storeName)
    return dbPromise
  }

  return {
    async get(key) {
      try {
        const db = await getDb()
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readonly')
          const request = tx.objectStore(storeName).get(key)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      } catch {
        return undefined
      }
    },

    async put(key, value) {
      try {
        const db = await getDb()
        await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite')
          tx.objectStore(storeName).put(value, key)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      } catch {
        // best-effort; save failures must never break the app
      }
    },
  }
}
```

- [ ] **Step 2: Verify manually in the browser**

Run: `bin/dev`, open http://localhost:5173, open the browser devtools console.

```javascript
const { createIndexedDbStore } = await import('/src/indexedDbStore.js')
const store = createIndexedDbStore()
await store.put('current', { hello: 'world' })
await store.get('current') // should log { hello: 'world' }
```

Then check devtools → Application → IndexedDB → `ear-transcriber` → `audio` shows the `current` key with that value.

- [ ] **Step 3: Commit**

```bash
git add src/indexedDbStore.js
git commit -m "Add IndexedDB-backed store for persisting current audio"
```

---

### Task 3: Wire persistence into `main.js` — extract `loadAudio`, save on upload, restore on startup

**Files:**
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `saveCurrentAudio`, `loadCurrentAudio` (Task 1), `createIndexedDbStore` (Task 2).
- Produces: `async function loadAudio(blob, label)` — the shared load path. Task 5's recording-stop handler calls this same function and the same `dbStore`/`saveCurrentAudio` wiring set up here.

- [ ] **Step 1: Add the new imports**

In `src/main.js`, change:

```javascript
import { computeFileHash, loadSettings, saveSettings } from './persistence.js'
```

to:

```javascript
import { computeFileHash, loadSettings, saveSettings } from './persistence.js'
import { saveCurrentAudio, loadCurrentAudio } from './audioStore.js'
import { createIndexedDbStore } from './indexedDbStore.js'
```

- [ ] **Step 2: Replace the upload handler with a shared `loadAudio` + persistence wiring**

Change:

```javascript
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

to:

```javascript
const dbStore = createIndexedDbStore()

async function loadAudio(blob, label) {
  uploadError.hidden = true
  uploadFilename.textContent = label

  const arrayBuffer = await blob.arrayBuffer()
  currentFileHash = await computeFileHash(arrayBuffer)
  applySettings(loadSettings(localStorage, currentFileHash) ?? DEFAULT_SETTINGS)

  try {
    const normalizedBlob = await normalizeAudio(arrayBuffer)
    wavesurfer.loadBlob(normalizedBlob)
  } catch {
    wavesurfer.loadBlob(blob)
  }
}

uploadInput.addEventListener('change', async () => {
  const file = uploadInput.files[0]
  if (!file) return
  await loadAudio(file, file.name)
  saveCurrentAudio(dbStore, file, file.name)
})

;(async () => {
  const stored = await loadCurrentAudio(dbStore)
  if (stored) {
    await loadAudio(stored.blob, stored.label)
  }
})()
```

Note the startup IIFE's `saveCurrentAudio` is deliberately *not* called — restoring already-saved audio shouldn't immediately re-save it (it's already there; re-saving would just be redundant IndexedDB traffic on every page load).

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no test directly covers `main.js`, but this confirms nothing else broke).

- [ ] **Step 4: Verify manually**

Run: `bin/dev`, open http://localhost:5173.

1. Upload an audio file. Confirm it loads and plays as before.
2. Reload the page. Confirm the same file automatically loads (waveform appears, filename shown) without clicking Upload again.
3. Adjust tempo/volume/EQ, reload again — confirm both the audio *and* its settings (same as before this change, via the existing hash-keyed `localStorage`) are restored together.
4. Upload a second, different file. Reload — confirm the second file is now what restores (overwrite behavior).

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "Persist and restore current audio across page loads"
```

---

### Task 4: `recording.js` — capture system/tab audio

**Files:**
- Create: `src/recording.js`
- Create: `src/recording.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `isRecordingSupported()`, `formatRecordingLabel(date = new Date())`, `async function startRecording()` — resolves `{ stop: () => Promise<Blob> }`. Task 5 wires all three into `main.js`.

- [ ] **Step 1: Write the failing test**

Create `src/recording.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { formatRecordingLabel } from './recording.js'

describe('formatRecordingLabel', () => {
  it('formats a date as "Recording — <month> <day>, <time>"', () => {
    const date = new Date('2026-08-02T15:41:00')
    expect(formatRecordingLabel(date)).toBe('Recording — Aug 2, 3:41 PM')
  })

  it('pads single-digit minutes', () => {
    const date = new Date('2026-01-05T09:05:00')
    expect(formatRecordingLabel(date)).toBe('Recording — Jan 5, 9:05 AM')
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/recording.test.js`
Expected: FAIL — `src/recording.js` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/recording.js`:

```javascript
export function isRecordingSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia
}

export function formatRecordingLabel(date = new Date()) {
  const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `Recording — ${datePart}, ${timePart}`
}

export async function startRecording() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  const audioTracks = stream.getAudioTracks()

  if (audioTracks.length === 0) {
    stream.getTracks().forEach((track) => track.stop())
    throw new Error("No audio track — check 'share audio' in the picker.")
  }

  stream.getVideoTracks().forEach((track) => track.stop())

  const audioStream = new MediaStream(audioTracks)
  const chunks = []
  const recorder = new MediaRecorder(audioStream)
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const stopped = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }))
  })

  recorder.start()

  return {
    stop: () => {
      recorder.stop()
      stream.getTracks().forEach((track) => track.stop())
      return stopped
    },
  }
}
```

- [ ] **Step 4: Run and verify pass**

Run: `npx vitest run src/recording.test.js`
Expected: PASS, both tests green. (`toLocaleDateString`/`toLocaleTimeString` with `'en-US'` are locale-independent regardless of the machine's default locale, since the locale is passed explicitly.)

- [ ] **Step 5: Commit**

```bash
git add src/recording.js src/recording.test.js
git commit -m "Add recording.js for capturing system/tab audio"
```

---

### Task 5: Wire the Record button into `main.js` and `index.html`

**Files:**
- Modify: `index.html`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `loadAudio`, `dbStore`, `saveCurrentAudio` (Task 3), `isRecordingSupported`, `formatRecordingLabel`, `startRecording` (Task 4).
- Produces: fully working record button. Last task for this plan.

- [ ] **Step 1: Add the button markup**

In `index.html`, change:

```html
      <section id="upload-section" class="panel">
        <label for="upload" class="file-button">Choose Audio File</label>
        <input type="file" id="upload" accept="audio/*" class="visually-hidden" />
        <span id="upload-filename"></span>
        <p id="upload-error" class="error" hidden></p>
      </section>
```

to:

```html
      <section id="upload-section" class="panel">
        <label for="upload" class="file-button">Choose Audio File</label>
        <input type="file" id="upload" accept="audio/*" class="visually-hidden" />
        <button id="record-btn">Record</button>
        <span id="upload-filename"></span>
        <p id="upload-error" class="error" hidden></p>
      </section>
```

- [ ] **Step 2: Add the new imports**

In `src/main.js`, change:

```javascript
import { saveCurrentAudio, loadCurrentAudio } from './audioStore.js'
import { createIndexedDbStore } from './indexedDbStore.js'
```

to:

```javascript
import { saveCurrentAudio, loadCurrentAudio } from './audioStore.js'
import { createIndexedDbStore } from './indexedDbStore.js'
import { isRecordingSupported, formatRecordingLabel, startRecording } from './recording.js'
```

- [ ] **Step 3: Wire the record button**

Add this after the `loadAudio`/`uploadInput` block from Task 3 (i.e. after the startup-restore IIFE):

```javascript
const recordBtn = document.getElementById('record-btn')
let activeRecording = null
let recordingTimer = null

if (!isRecordingSupported()) {
  recordBtn.disabled = true
  recordBtn.title = 'Recording tab/system audio is not supported in this browser.'
}

function formatElapsed(startedAt) {
  const elapsed = Math.floor((Date.now() - startedAt) / 1000)
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

async function stopActiveRecording() {
  const recording = activeRecording
  activeRecording = null
  clearInterval(recordingTimer)
  recordBtn.textContent = 'Record'

  const blob = await recording.stop()
  const label = formatRecordingLabel()
  await loadAudio(blob, label)
  saveCurrentAudio(dbStore, blob, label)
}

recordBtn.addEventListener('click', async () => {
  if (activeRecording) {
    await stopActiveRecording()
    return
  }

  let recording
  try {
    recording = await startRecording()
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') return
    uploadError.textContent = err.message
    uploadError.hidden = false
    return
  }

  activeRecording = recording
  const startedAt = Date.now()
  recordBtn.textContent = `Stop (${formatElapsed(startedAt)})`
  recordingTimer = setInterval(() => {
    recordBtn.textContent = `Stop (${formatElapsed(startedAt)})`
  }, 1000)
})
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Verify manually**

Run: `bin/dev`, open http://localhost:5173.

1. Click "Record" — browser's share picker appears. Pick a tab/window/screen and check "share audio" (or equivalent), confirm. Button changes to "Stop (00:00)" and the timer counts up.
2. Play some audio in the shared source. Click "Stop" — button returns to "Record", the recording loads into the waveform and plays back what was captured.
3. Confirm `#upload-filename` shows something like "Recording — Aug 2, 3:41 PM".
4. Reload the page — confirm the recording (not just an uploaded file) restores automatically, same as Task 3's upload case.
5. Click "Record", then cancel the picker (Esc or Cancel button) — confirm no error is shown and the button stays/returns to "Record".
6. Click "Record", share a source *without* checking "share audio" — confirm the error message appears ("No audio track...") and the button resets to "Record".
7. Click "Record", then "Stop" almost immediately — confirm a very short recording still loads without errors.

- [ ] **Step 6: Commit**

```bash
git add index.html src/main.js
git commit -m "Add Record button for capturing system/tab audio"
```
