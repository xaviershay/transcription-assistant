# Transient error toast, replacing the persistent error box

## Problem

Two silent-failure gaps exist in the just-built recording/persistence
feature:

1. `indexedDbStore.js` catches every IndexedDB failure (quota exceeded,
   private-browsing block, unsupported) and swallows it — `get` resolves
   `undefined`, `put` no-ops. This was deliberate (best-effort save/restore
   should never crash the app), but it means a real failure is
   indistinguishable from "nothing has been saved yet" to the user — they
   only discover it when a reload silently restores nothing.
2. The startup auto-restore IIFE in `main.js` calls `loadAudio(stored.blob,
   stored.label)` with no `.catch()` — if the stored blob can't be read
   (e.g. corrupted), the promise rejects unhandled and the user sees a
   restored filename with no waveform and no explanation.

Meanwhile the app's only error UI, `#upload-error`, is a persistent
`<p>` that stays visible until code explicitly hides it again — fine for
the two things it currently reports (a failed audio load, a failed
recording attempt), but not a good fit for background failures that can
fire without a corresponding user action to eventually clear it.

This replaces `#upload-error` entirely with a transient toast: a floating
message that shows itself, auto-dismisses after ~5 seconds (or immediately
on click), and is used for every error the app already reports plus the
two IndexedDB-adjacent gaps above.

## Toast module

New `src/toast.js`:

```js
showToast(message)
```

- Sets the shared toast element's text, un-hides it, and (re)starts a
  5-second auto-dismiss timer.
- Clicking the toast dismisses it immediately and clears the timer.
- A second call while one is already showing replaces the message and
  restarts the timer — at most one toast visible at a time, no
  stacking/queueing.

This is DOM/timer glue with no pure logic worth isolating — untested by
convention, the same treatment `recording.js`'s browser-API half and
`indexedDbStore.js` already get.

## Markup and styling

`index.html`: `<p id="upload-error" class="error" hidden></p>` is removed
and replaced with `<div id="toast" class="toast" hidden></div>`, placed
once near the end of `<main>` (not inside `#upload-section` — errors can
now originate from anywhere: startup restore, background IndexedDB writes,
not just the upload/record controls).

`style.css`: new `.toast` rule — fixed position (floats over the page
regardless of scroll), reusing the existing `.error` rule's red palette.
No animation library; plain show/hide via the `hidden` attribute.

## Wiring

Every existing call site that did:

```js
uploadError.textContent = message
uploadError.hidden = false
```

becomes:

```js
showToast(message)
```

Call sites: the `wavesurfer.on('error', ...)` handler, `recording.js`'s
no-audio-track error surfaced in the Record click handler, and the
`stopActiveRecording()` catch block.

### IndexedDB errors

`createIndexedDbStore(dbName = 'ear-transcriber', storeName = 'audio',
onError)` gains a third parameter: a callback invoked with the caught
error inside both the `get` and `put` catch blocks, in addition to their
existing swallow-and-degrade behavior (`get` still resolves `undefined`,
`put` still no-ops — `onError` is purely an additional notification, it
doesn't change the resolved value).

Critically, `onError` is only invoked from the `catch` blocks — a
legitimately-empty first-visit read (nothing ever saved) resolves via
`request.onsuccess` with `undefined` and never reaches `catch`, so it
never fires `onError`. No false-positive toast on a fresh browser with
nothing saved.

`main.js` wires: `createIndexedDbStore(undefined, undefined, (err) =>
showToast(err.message))` (passing `undefined` for the first two
parameters to keep their defaults).

### Startup restore

```js
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

## Testing

No new test infrastructure. `toast.js` and the `onError` plumbing in
`indexedDbStore.js` are both untested browser/DOM glue, consistent with
existing conventions in this codebase.
