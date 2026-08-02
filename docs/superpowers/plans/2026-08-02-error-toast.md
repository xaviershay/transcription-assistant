# Transient Error Toast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the persistent `#upload-error` box with a transient, auto-dismissing toast, and use it to surface two previously-silent failure paths: IndexedDB get/put errors, and a failed startup audio restore.

**Architecture:** A new `src/toast.js` owns one shared toast DOM element (`showToast(message)`: sets text, un-hides, (re)starts a 5s auto-dismiss timer; click dismisses immediately). Every existing `uploadError.textContent = …; uploadError.hidden = false` call site in `main.js` becomes `showToast(...)`. `indexedDbStore.js` gains an `onError` callback invoked only from its existing catch blocks (not from the normal "nothing saved yet" path), and the startup restore IIFE gets a try/catch — both route into the same `showToast`.

**Tech Stack:** Vanilla JS, DOM, `setTimeout`. No new dependencies, no new test infra.

## Global Constraints

- At most one toast visible at a time — a new `showToast()` call while one is showing replaces its message and restarts the 5s timer. No stacking/queueing. (Spec: Toast module)
- Auto-dismiss after 5 seconds; clicking the toast dismisses immediately and clears the timer. (Spec: Toast module)
- `onError` on `createIndexedDbStore` fires only from the `catch` blocks in `get`/`put` — never for a legitimately-missing key (which resolves via `onsuccess` with `undefined` and never reaches `catch`). No false-positive toast on a fresh browser with nothing saved. (Spec: IndexedDB errors)
- `get`/`put`'s existing resolved values are unchanged (`get` still resolves `undefined` on failure, `put` still no-ops) — `onError` is an additional notification only, not a behavior change. (Spec: IndexedDB errors)
- No new test infrastructure. `toast.js` and the `onError` plumbing are both untested DOM/browser glue, consistent with `recording.js`/`indexedDbStore.js`'s existing treatment. (Spec: Testing)

---

## File Structure

- Create: `src/toast.js` — `showToast(message)`.
- Modify: `index.html` — remove `#upload-error`, add `#toast`.
- Modify: `src/style.css` — remove now-unused `.error` rule, add `.toast` rule.
- Modify: `src/main.js` — import and call `showToast` everywhere `uploadError` was used; remove the `uploadError` const; add `onError` wiring to `createIndexedDbStore`; wrap the startup restore's `loadAudio` call in try/catch.
- Modify: `src/indexedDbStore.js` — add the `onError` parameter.

---

### Task 1: `toast.js` + markup/CSS + replace all `#upload-error` call sites

**Files:**
- Create: `src/toast.js`
- Modify: `index.html`
- Modify: `src/style.css`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `showToast(message)`. Task 2 calls this same function from `indexedDbStore.js`'s `onError` callback and the startup-restore catch block.

- [ ] **Step 1: Create the toast module**

Create `src/toast.js`:

```javascript
const DISMISS_DELAY_MS = 5000

let toastEl = null
let dismissTimer = null

function getToastEl() {
  if (!toastEl) {
    toastEl = document.getElementById('toast')
    toastEl.addEventListener('click', hideToast)
  }
  return toastEl
}

function hideToast() {
  clearTimeout(dismissTimer)
  getToastEl().hidden = true
}

export function showToast(message) {
  const el = getToastEl()
  el.textContent = message
  el.hidden = false
  clearTimeout(dismissTimer)
  dismissTimer = setTimeout(hideToast, DISMISS_DELAY_MS)
}
```

- [ ] **Step 2: Update the markup**

In `index.html`, change:

```html
      <section id="upload-section" class="panel">
        <label for="upload" class="file-button">Choose Audio File</label>
        <input type="file" id="upload" accept="audio/*" class="visually-hidden" />
        <button id="record-btn">Record</button>
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
      </section>
```

And change:

```html
      <footer>Made by <a href="https://xaviershay.com" target="_blank" rel="noopener">Xavier Shay</a></footer>
    </main>
```

to:

```html
      <footer>Made by <a href="https://xaviershay.com" target="_blank" rel="noopener">Xavier Shay</a></footer>
      <div id="toast" class="toast" hidden></div>
    </main>
```

- [ ] **Step 3: Update the CSS**

In `src/style.css`, remove:

```css
.error {
  color: #ff6b6b;
  width: 100%;
  margin: 0;
}
```

and add (anywhere in the file; placing it near the removed `.error` rule is fine):

```css
.toast {
  position: fixed;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  background: #1a1a1a;
  color: #ff6b6b;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  padding: 0.6rem 1rem;
  max-width: 90vw;
  cursor: pointer;
  z-index: 100;
}
```

- [ ] **Step 4: Wire `main.js` to use `showToast` instead of `uploadError`**

Change the import block — add `showToast`:

```javascript
import { isRecordingSupported, formatRecordingLabel, startRecording } from './recording.js'
import { defaultEqBands } from './eq.js'
```

to:

```javascript
import { isRecordingSupported, formatRecordingLabel, startRecording } from './recording.js'
import { defaultEqBands } from './eq.js'
import { showToast } from './toast.js'
```

Remove the `uploadError` const entirely. Change:

```javascript
const uploadInput = document.getElementById('upload')
const uploadError = document.getElementById('upload-error')
const uploadFilename = document.getElementById('upload-filename')
```

to:

```javascript
const uploadInput = document.getElementById('upload')
const uploadFilename = document.getElementById('upload-filename')
```

Change the `wavesurfer.on('error', ...)` handler:

```javascript
wavesurfer.on('error', (error) => {
  uploadError.textContent = `Could not load audio file: ${error.message}`
  uploadError.hidden = false
  playPauseBtn.disabled = true
})
```

to:

```javascript
wavesurfer.on('error', (error) => {
  showToast(`Could not load audio file: ${error.message}`)
  playPauseBtn.disabled = true
})
```

Change the `wavesurfer.on('ready', ...)` handler — remove the `uploadError.hidden = true` line (the toast is self-dismissing and generic now; it shouldn't be force-cleared just because a file finished loading, since it might be showing an unrelated error):

```javascript
wavesurfer.on('ready', () => {
  uploadError.hidden = true
  playPauseBtn.disabled = false
  if (!spectrumAnalyser) {
    spectrumAnalyser = createSpectrumAnalyser(wavesurfer, spectrumCanvas, { onEqChange: scheduleEqSave })
  }
  spectrumAnalyser.setEqState(pendingEqSettings)
})
```

to:

```javascript
wavesurfer.on('ready', () => {
  playPauseBtn.disabled = false
  if (!spectrumAnalyser) {
    spectrumAnalyser = createSpectrumAnalyser(wavesurfer, spectrumCanvas, { onEqChange: scheduleEqSave })
  }
  spectrumAnalyser.setEqState(pendingEqSettings)
})
```

In `loadAudio`, remove the `uploadError.hidden = true` line for the same reason:

```javascript
async function loadAudio(blob, label) {
  const generation = ++loadGeneration

  const arrayBuffer = await blob.arrayBuffer()
  const hash = await computeFileHash(arrayBuffer)
  if (generation !== loadGeneration) return
  uploadError.hidden = true
  uploadFilename.textContent = label
  currentFileHash = hash
  applySettings(loadSettings(localStorage, currentFileHash) ?? DEFAULT_SETTINGS)
```

to:

```javascript
async function loadAudio(blob, label) {
  const generation = ++loadGeneration

  const arrayBuffer = await blob.arrayBuffer()
  const hash = await computeFileHash(arrayBuffer)
  if (generation !== loadGeneration) return
  uploadFilename.textContent = label
  currentFileHash = hash
  applySettings(loadSettings(localStorage, currentFileHash) ?? DEFAULT_SETTINGS)
```

In `stopActiveRecording`, change:

```javascript
  } catch (err) {
    uploadError.textContent = err.message
    uploadError.hidden = false
  } finally {
    recordingBusy = false
  }
```

to:

```javascript
  } catch (err) {
    showToast(err.message)
  } finally {
    recordingBusy = false
  }
```

In the `recordBtn` click handler, change:

```javascript
  } catch (err) {
    recordingBusy = false
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') return
    uploadError.textContent = err.message
    uploadError.hidden = false
    return
  }
```

to:

```javascript
  } catch (err) {
    recordingBusy = false
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') return
    showToast(err.message)
    return
  }
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no automated test covers `toast.js` or `main.js` — this confirms nothing else broke).

- [ ] **Step 6: Verify manually**

Run: `bin/dev`, open http://localhost:5173.

1. Upload a valid audio file — confirm it loads normally, no toast appears.
2. Upload something that isn't a decodable audio file (e.g. rename a `.txt` file to `.mp3` and select it) — confirm a toast appears at the bottom of the page with an error message, and disappears on its own after ~5 seconds.
3. Trigger it again and click directly on the toast — confirm it disappears immediately rather than waiting out the timer.
4. Confirm no leftover `#upload-error` element exists anywhere (inspect the DOM) and no console errors reference `uploadError`.

- [ ] **Step 7: Commit**

```bash
git add src/toast.js index.html src/style.css src/main.js
git commit -m "Replace persistent error box with a transient toast"
```

---

### Task 2: Surface IndexedDB errors and startup-restore failures via the toast

**Files:**
- Modify: `src/indexedDbStore.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `showToast` (Task 1).
- Produces: `createIndexedDbStore(dbName, storeName, onError)` — `onError` is a new, optional third parameter. Last task for this plan.

- [ ] **Step 1: Add the `onError` parameter to `indexedDbStore.js`**

Change:

```javascript
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

to:

```javascript
export function createIndexedDbStore(dbName = 'ear-transcriber', storeName = 'audio', onError) {
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
      } catch (err) {
        onError?.(err)
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
      } catch (err) {
        onError?.(err)
        // best-effort; save failures must never break the app
      }
    },
  }
}
```

- [ ] **Step 2: Wire `onError` and the startup-restore catch in `main.js`**

Change:

```javascript
const dbStore = createIndexedDbStore()
```

to:

```javascript
const dbStore = createIndexedDbStore(undefined, undefined, (err) => showToast(err.message))
```

Change:

```javascript
;(async () => {
  const stored = await loadCurrentAudio(dbStore)
  if (stored) {
    await loadAudio(stored.blob, stored.label)
  }
})()
```

to:

```javascript
;(async () => {
  const stored = await loadCurrentAudio(dbStore)
  if (stored) {
    try {
      await loadAudio(stored.blob, stored.label)
    } catch (err) {
      showToast(err.message)
    }
  }
})()
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Verify manually**

Run: `bin/dev`, open http://localhost:5173, open devtools console.

1. Confirm the app loads normally with nothing saved yet — no toast appears (proves `onError` doesn't fire for the legitimate "nothing saved" case).
2. Upload a file, then in the console run `indexedDB.deleteDatabase('ear-transcriber')` to simulate the database becoming unavailable mid-session, then upload another file — confirm behavior is still graceful (a toast may or may not appear depending on timing of the delete vs. the open connection already cached in `dbStore`; the key thing is nothing crashes).
3. To more reliably trigger the `onError` path: temporarily add `throw new Error('test')` at the top of `openDb` in `indexedDbStore.js`, reload the page, confirm a toast reading "test" appears — then revert that temporary change.
4. Confirm `npm test` still passes after reverting the temporary throw.

- [ ] **Step 5: Commit**

```bash
git add src/indexedDbStore.js src/main.js
git commit -m "Surface IndexedDB and startup-restore errors via the toast"
```
