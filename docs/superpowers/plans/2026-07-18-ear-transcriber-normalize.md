# Ear Transcriber Normalize-on-Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Peak-normalize every uploaded audio file before it reaches wavesurfer, so playback, the waveform display, the spectrum panel, and onset detection all operate on a consistently-leveled signal instead of whatever gain the source recording happened to have.

**Architecture:** A new pure, dependency-free module (`src/normalize.js`) — peak-gain computation, gain application, and a hand-written 16-bit PCM WAV encoder — gets real vitest coverage, consistent with `notes.js`/`selections.js`/`onsets.js`. `src/main.js`'s upload handler gets a decode→normalize→re-encode step inserted before `wavesurfer.loadBlob`.

**Tech Stack:** Same as the rest of the app — vanilla JS, native Web Audio (`AudioContext.decodeAudioData`). No new dependencies.

## Global Constraints

- All code in this plan (`computePeakGain`, `applyGain`, `encodeWav`) was
  hand-verified against expected byte-level and numeric output in Node
  before this plan was written — do not alter the rounding/clamping logic
  without re-verifying.
- One global gain computed across **all** channels together (not
  per-channel) — preserves stereo balance.
- Normalization always scales to the target peak in both directions
  (turns down already-hot audio, boosts quiet audio) — this is the
  standard meaning of "normalize," not a boost-only limiter.
- Silent input (`peak === 0`) must return gain `1`, never divide by zero.
- WAV output is 16-bit PCM, mono-or-multi-channel interleaved,
  little-endian — matches the standard RIFF/WAVE format exactly (see
  Task 1's code for exact byte offsets).
- Always on for every upload — no UI toggle.
- No automated tests for the upload-handler wiring itself (DOM/Web-Audio
  glue, consistent with the app's established testing approach) — only
  `src/normalize.js` gets vitest coverage.

---

## File Structure

```
src/
  normalize.js       # NEW — pure: peak gain, gain application, WAV encoding
  normalize.test.js    # NEW
  main.js                # MODIFIED — upload handler decodes/normalizes before loadBlob
```

---

### Task 1: Normalize algorithm (`src/normalize.js`)

**Files:**
- Create: `src/normalize.js`
- Create: `src/normalize.test.js`

**Interfaces:**
- Produces: `computePeakGain(channelData: Float32Array[], targetPeak =
  0.98): number`, `applyGain(channelData: Float32Array[], gain: number):
  Float32Array[]` (new arrays, does not mutate input), `encodeWav(
  channelData: Float32Array[], sampleRate: number): ArrayBuffer`. Consumed
  by Task 2's `main.js` wiring.

- [ ] **Step 1: Write the failing tests**

```js
// src/normalize.test.js
import { describe, it, expect } from 'vitest'
import { computePeakGain, applyGain, encodeWav } from './normalize.js'

describe('computePeakGain', () => {
  it('computes gain to reach target peak from a known peak', () => {
    const channel = new Float32Array([0.1, -0.5, 0.3])
    const gain = computePeakGain([channel], 0.98)
    expect(gain).toBeCloseTo(0.98 / 0.5, 5)
  })

  it('finds the peak across multiple channels', () => {
    const left = new Float32Array([0.1, 0.2])
    const right = new Float32Array([0.1, 0.6])
    const gain = computePeakGain([left, right], 0.98)
    expect(gain).toBeCloseTo(0.98 / 0.6, 5)
  })

  it('returns 1 for silent audio (avoids divide by zero)', () => {
    const channel = new Float32Array([0, 0, 0])
    expect(computePeakGain([channel], 0.98)).toBe(1)
  })

  it('returns a gain less than 1 when the peak already exceeds the target', () => {
    const channel = new Float32Array([0.99, -1.0])
    const gain = computePeakGain([channel], 0.98)
    expect(gain).toBeLessThan(1)
  })
})

describe('applyGain', () => {
  it('scales samples by the gain factor', () => {
    const channel = new Float32Array([0.1, -0.2, 0.3])
    const [out] = applyGain([channel], 2)
    const expected = [0.2, -0.4, 0.6]
    out.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 5))
  })

  it('clamps samples that would exceed [-1, 1]', () => {
    const channel = new Float32Array([0.8, -0.9])
    const [out] = applyGain([channel], 2)
    expect(Array.from(out)).toEqual([1, -1])
  })

  it('does not mutate the input array', () => {
    const channel = new Float32Array([0.1, 0.2])
    const before = Array.from(channel)
    applyGain([channel], 2)
    expect(Array.from(channel)).toEqual(before)
  })
})

describe('encodeWav', () => {
  it('writes correct RIFF/WAVE/fmt/data header fields', () => {
    const channel = new Float32Array([0, 0.5, -0.5])
    const buffer = encodeWav([channel], 44100)
    const view = new DataView(buffer)

    const readString = (offset, length) => {
      let s = ''
      for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i))
      return s
    }

    expect(readString(0, 4)).toBe('RIFF')
    expect(readString(8, 4)).toBe('WAVE')
    expect(readString(12, 4)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint16(34, true)).toBe(16)
    expect(readString(36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(6)
    expect(buffer.byteLength).toBe(44 + 6)
  })

  it('round-trips sample values through 16-bit quantization', () => {
    const channel = new Float32Array([0, 0.5, -1, 1])
    const buffer = encodeWav([channel], 44100)
    const view = new DataView(buffer)

    const samples = []
    for (let i = 0; i < 4; i++) {
      samples.push(view.getInt16(44 + i * 2, true))
    }
    expect(samples).toEqual([0, 16384, -32767, 32767])
  })

  it('interleaves multiple channels', () => {
    const left = new Float32Array([1, -1])
    const right = new Float32Array([0.5, -0.5])
    const buffer = encodeWav([left, right], 44100)
    const view = new DataView(buffer)

    const samples = []
    for (let i = 0; i < 4; i++) samples.push(view.getInt16(44 + i * 2, true))
    expect(samples).toEqual([32767, 16384, -32767, -16383])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/normalize.test.js`
Expected: FAIL — `Cannot find module './normalize.js'`.

- [ ] **Step 3: Write `src/normalize.js`**

```js
export function computePeakGain(channelData, targetPeak = 0.98) {
  let peak = 0
  for (const channel of channelData) {
    for (let i = 0; i < channel.length; i++) {
      const abs = Math.abs(channel[i])
      if (abs > peak) peak = abs
    }
  }
  if (peak === 0) return 1
  return targetPeak / peak
}

export function applyGain(channelData, gain) {
  return channelData.map((channel) => {
    const out = new Float32Array(channel.length)
    for (let i = 0; i < channel.length; i++) {
      out[i] = Math.max(-1, Math.min(1, channel[i] * gain))
    }
    return out
  })
}

export function encodeWav(channelData, sampleRate) {
  const numChannels = channelData.length
  const numFrames = channelData[0].length
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = numFrames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]))
      const intSample = Math.round(sample * 32767)
      view.setInt16(offset, intSample, true)
      offset += 2
    }
  }

  return buffer
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/normalize.test.js`
Expected: PASS, all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/normalize.js src/normalize.test.js
git commit -m "feat: add peak normalization and WAV encoding"
```

---

### Task 2: Wire normalization into the upload handler

**Files:**
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `computePeakGain`, `applyGain`, `encodeWav` from Task 1.
  `wavesurfer` (from Task 3 of the base plan), `uploadInput`, `uploadError`,
  `uploadFilename` (all already declared in `main.js`).

- [ ] **Step 1: Modify `src/main.js`**

Add to the imports at the top:

```js
import { computePeakGain, applyGain, encodeWav } from './normalize.js'
```

Replace the existing upload `change` handler:

```js
uploadInput.addEventListener('change', () => {
  const file = uploadInput.files[0]
  if (!file) return
  uploadError.hidden = true
  uploadFilename.textContent = file.name
  wavesurfer.loadBlob(file)
})
```

with:

```js
async function normalizeFile(file) {
  const arrayBuffer = await file.arrayBuffer()
  const audioCtx = new AudioContext()
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
    const channelData = []
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      channelData.push(audioBuffer.getChannelData(ch))
    }
    const gain = computePeakGain(channelData)
    const normalized = applyGain(channelData, gain)
    const wavBuffer = encodeWav(normalized, audioBuffer.sampleRate)
    return new Blob([wavBuffer], { type: 'audio/wav' })
  } finally {
    audioCtx.close()
  }
}

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

- [ ] **Step 2: Run the full test suite and build**

Run: `npm test`
Expected: PASS, all 36 tests green (26 from before + 10 new from Task 1).

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: Manual check — normalization actually applies**

Run: `npm run dev`.
1. Generate or find a *quiet* test file (e.g. a sine tone at low amplitude
   — `python3 -c "import numpy,scipy.io.wavfile as w; sr=44100;
   t=numpy.linspace(0,2,sr*2); w.write('/tmp/quiet.wav', sr,
   (numpy.sin(2*numpy.pi*440*t)*3000).astype(numpy.int16))"` writes a
   quiet ~440Hz tone at roughly -20dB peak).
2. Upload it. Expected: the waveform display shows a *tall* waveform
   (near full height) despite the source file being quiet — confirms
   normalization ran before the waveform was drawn, not just applied to
   playback volume.
3. Play it. Expected: audibly louder than the raw quiet file would be if
   played directly (e.g. in another player) — sanity-check that
   normalization affected the actual played-back audio, not just the
   visual waveform.
4. Upload a second, normal-volume file. Expected: still loads and plays
   correctly — normalizing an already-reasonable-level file shouldn't
   break anything (it'll just scale slightly, up or down, to hit the
   target peak).
5. Upload a corrupt/bogus file (`head -c 100 /dev/urandom > /tmp/fake.mp3`
   renamed appropriately, or reuse the approach from the base plan's
   Task 3 verification). Expected: the existing red error-text UI still
   appears — confirms the try/catch fallback and wavesurfer's own error
   handling both still work when normalization's decode step fails.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: normalize audio peak level on upload"
```

---

## Final Verification

- [ ] Run `npm test` — all 36 tests pass.
- [ ] Run `npm run build` — succeeds.
- [ ] Full manual walkthrough per Task 2 Step 3, plus a spot-check that
  existing features (waveform zoom/pan, playback, spectrum, selections,
  subdivide) still work unaffected on a normalized file.
