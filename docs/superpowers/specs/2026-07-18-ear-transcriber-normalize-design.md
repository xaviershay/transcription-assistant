# Ear Transcriber — Normalize on Upload Design

Date: 2026-07-18

Third follow-up to `2026-07-18-ear-transcriber-design.md`.

## Purpose

Quiet recordings are hard to work with — hard to hear detail when looping
a note, and weaker spectrum peaks. Peak-normalize every uploaded file so
playback, the spectrum panel, and onset detection all operate on a
consistently-leveled signal.

## Algorithm

Pure, dependency-free (`src/normalize.js`), consistent with the app's
existing hand-rolled DSP modules (`onsets.js`'s FFT, `notes.js`'s
frequency math):

1. `computePeakGain(channelData: Float32Array[], targetPeak = 0.98):
   number` — scans **all** channels for a single global peak absolute
   sample value, returns `targetPeak / peak`. Returns `1` (no change) if
   peak is `0` (silent file) — avoids a divide-by-zero producing
   `Infinity`/`NaN` gain.
2. `applyGain(channelData: Float32Array[], gain: number): Float32Array[]`
   — new arrays (does not mutate input), each sample multiplied by `gain`
   and clamped to `[-1, 1]`.
3. `encodeWav(channelData: Float32Array[], sampleRate: number):
   ArrayBuffer` — hand-written 16-bit PCM WAV encoder: RIFF header, `fmt `
   chunk (PCM, channel count, sample rate, byte rate, block align, 16
   bits/sample), `data` chunk with interleaved little-endian 16-bit
   samples (`Math.round(sample * 32767)`).

One gain factor applied uniformly across all channels — not computed
per-channel — so stereo balance is preserved (a per-channel gain would
alter the left/right balance of anything not perfectly centered).

Always scales to the target peak in both directions (turns already-hot
recordings down as well as boosting quiet ones) — this is the standard
meaning of "normalize" (e.g. Audacity's Normalize effect behaves this
way), not a "boost quiet audio only" limiter.

## Wiring

In `main.js`'s upload handler, before calling `wavesurfer.loadBlob`:

1. Read the uploaded `File` as an `ArrayBuffer`.
2. Decode it with a throwaway `AudioContext` (`decodeAudioData`), then
   `close()` the context — this context exists only for this one decode,
   it's not the same context `spectrum.js` creates later for live FFT
   analysis.
3. Extract each channel's `Float32Array` via `AudioBuffer.getChannelData`.
4. Run `computePeakGain` → `applyGain` → `encodeWav`.
5. Wrap the resulting `ArrayBuffer` in a `Blob` (`type: 'audio/wav'`) and
   call `wavesurfer.loadBlob()` with *that* instead of the original file.

Because every downstream consumer (waveform display, spectrum panel via
`wavesurfer.getMediaElement()`, onset detection via
`wavesurfer.getDecodedData()`) reads from whatever wavesurfer loaded, they
all automatically see the normalized audio — no changes needed to
`spectrum.js` or the subdivide/`onsets.js` wiring.

**Always on**, every upload — no UI toggle (not requested, YAGNI).

## Error handling

If `decodeAudioData` fails (corrupt/unsupported file), fall back to
calling `wavesurfer.loadBlob(file)` with the **original** file directly —
graceful degradation rather than blocking the upload. wavesurfer's own
`'error'` event (already wired) still catches files it can't load either
way, so a genuinely bad file still surfaces the existing upload-error UI.

## Non-goals

- No loudness (RMS/LUFS) normalization — peak only, per the earlier design
  choice.
- No UI toggle to disable normalization.
- No re-normalizing already-loaded audio (e.g. after a Subdivide) — only
  happens once, at upload time.

## Testing approach

`src/normalize.js` gets real vitest coverage, consistent with
`notes.js`/`selections.js`/`onsets.js`:

- `computePeakGain`: known peak value → correct gain (e.g. peak 0.5,
  target 0.98 → gain 1.96); silent input → gain 1 (not `Infinity`/`NaN`);
  peak already above target → gain < 1 (turns down).
- `applyGain`: scaling correctness on known values; clamping (a gain that
  would push a sample past ±1 gets clamped, not wrapped/overflowed); does
  not mutate its input arrays.
- `encodeWav`: structural — verify the `RIFF`/`WAVE`/`fmt `/`data` magic
  bytes and chunk sizes are correct for a small known input, and that
  manually parsing the encoded 16-bit samples back out of the returned
  `ArrayBuffer` matches the expected quantized values (round-trip check).

Everything else (the upload-handler wiring, the throwaway `AudioContext`,
`Blob`/`loadBlob` glue) is manual browser testing, consistent with the
rest of the app's testing approach.
