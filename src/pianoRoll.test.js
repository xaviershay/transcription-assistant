import { describe, it, expect } from 'vitest'
import { magnitudeToByte, computeSpectrogramFrames, PIANO_ROLL_MIN_FREQ, PIANO_ROLL_MAX_FREQ } from './pianoRoll.js'
import { frameRangeForTime, computeBeatGridLines } from './pianoRoll.js'

const SAMPLE_RATE = 44100

function tone(freq, seconds) {
  const n = Math.round(seconds * SAMPLE_RATE)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE)
  }
  return out
}

describe('magnitudeToByte', () => {
  it('maps the peak magnitude itself to 255', () => {
    expect(magnitudeToByte(10, 10)).toBe(255)
  })

  it('maps digital silence (0) to 0', () => {
    expect(magnitudeToByte(0, 10)).toBe(0)
  })

  it('maps a magnitude at the -80dB floor to 0', () => {
    const peak = 1
    const atFloor = peak * Math.pow(10, -80 / 20)
    expect(magnitudeToByte(atFloor, peak)).toBe(0)
  })

  it('maps -40dB (half the default floor) to roughly half scale', () => {
    const peak = 1
    const midpoint = peak * Math.pow(10, -40 / 20)
    // 255 * 0.5 = 127.5 exactly; Math.round rounds half-up in JS, giving 128.
    // toBeCloseTo(127.5, 0) requires a diff strictly < 0.5, which a diff of
    // exactly 0.5 fails deterministically (not FFT-related flakiness), so
    // assert the exact, reproducible rounded value instead.
    expect(magnitudeToByte(midpoint, peak)).toBe(128)
  })

  it('returns 0 when peakMagnitude is 0, rather than NaN/-Infinity from log(0)', () => {
    expect(magnitudeToByte(5, 0)).toBe(0)
  })
})

describe('computeSpectrogramFrames', () => {
  it('returns frames/hopSize/sampleRate', () => {
    const signal = tone(261.63, 0.3)
    const result = computeSpectrogramFrames(signal, SAMPLE_RATE, PIANO_ROLL_MIN_FREQ, PIANO_ROLL_MAX_FREQ)
    expect(result.hopSize).toBeGreaterThan(0)
    expect(result.sampleRate).toBe(SAMPLE_RATE)
    expect(result.frames.length).toBeGreaterThan(0)
  })

  it('every frame has a buckets array and a peakMidis Set', () => {
    const signal = tone(261.63, 0.3)
    const { frames } = computeSpectrogramFrames(signal, SAMPLE_RATE, PIANO_ROLL_MIN_FREQ, PIANO_ROLL_MAX_FREQ)
    for (const frame of frames) {
      expect(Array.isArray(frame.buckets)).toBe(true)
      expect(frame.peakMidis).toBeInstanceOf(Set)
    }
  })

  it('registers strong energy at C4 (midi 60) for a pure 261.63Hz tone', () => {
    const signal = tone(261.63, 0.3)
    const { frames } = computeSpectrogramFrames(signal, SAMPLE_RATE, PIANO_ROLL_MIN_FREQ, PIANO_ROLL_MAX_FREQ)
    const midFrame = frames[Math.floor(frames.length / 2)]
    const c4Bucket = midFrame.buckets.find((b) => b.midi === 60)
    expect(c4Bucket).toBeDefined()
    expect(c4Bucket.value).toBeGreaterThan(200) // near the peak byte value (255), since this tone dominates the track
  })
})

describe('frameRangeForTime', () => {
  it('maps a time range to the corresponding frame index range', () => {
    const { startFrame, endFrame } = frameRangeForTime(1, 2, 512, 44100, 1000)
    expect(startFrame).toBe(Math.floor((1 * 44100) / 512))
    expect(endFrame).toBe(Math.ceil((2 * 44100) / 512))
  })

  it('clamps startFrame to 0 for a negative start time', () => {
    const { startFrame } = frameRangeForTime(-5, 1, 512, 44100, 1000)
    expect(startFrame).toBe(0)
  })

  it('clamps endFrame to totalFrames - 1', () => {
    const { endFrame } = frameRangeForTime(0, 9999, 512, 44100, 100)
    expect(endFrame).toBe(99)
  })
})

describe('computeBeatGridLines', () => {
  it('places a line at every subdivision within range, at the correct fractional y', () => {
    // 120 BPM -> 0.5s/beat, 4 subdivisions -> 0.125s apart, offset 0, range [0, 1]
    // -> lines at t = 0, 0.125, 0.25, ..., 1.0 (9 lines total)
    const lines = computeBeatGridLines(0, 1, 120, 4, 0)
    expect(lines.length).toBe(9)
    expect(lines[0].fraction).toBeCloseTo(0, 10)
    expect(lines[4].fraction).toBeCloseTo(0.5, 10) // t=0.5, the midpoint of [0,1]
    expect(lines[8].fraction).toBeCloseTo(1, 10)
  })

  it('marks every subdivisions-th line as a beat, numbered from 1', () => {
    const lines = computeBeatGridLines(0, 1, 120, 4, 0)
    const beats = lines.filter((l) => l.isBeat)
    expect(beats.map((b) => b.beatNumber)).toEqual([1, 2, 3])
    // non-beat subdivision lines carry no beat number
    expect(lines[1].isBeat).toBe(false)
    expect(lines[1].beatNumber).toBeNull()
  })

  it('respects a non-zero offset', () => {
    // offset 0.3 shifts every line by 0.3s; range [0.3, 0.8] with the same
    // 120bpm/4-subdivision spacing -> lines at 0.3, 0.425, 0.55, 0.675, 0.8
    const lines = computeBeatGridLines(0.3, 0.8, 120, 4, 0.3)
    expect(lines.length).toBe(5)
    expect(lines[0].fraction).toBeCloseTo(0, 10)
    expect(lines[4].fraction).toBeCloseTo(1, 10)
  })

  it('returns no lines for an inverted or zero-width range', () => {
    expect(computeBeatGridLines(1, 1, 120, 4, 0)).toEqual([])
    expect(computeBeatGridLines(2, 1, 120, 4, 0)).toEqual([])
  })

  it('returns no lines for a non-positive bpm or subdivisions', () => {
    expect(computeBeatGridLines(0, 1, 0, 4, 0)).toEqual([])
    expect(computeBeatGridLines(0, 1, 120, 0, 0)).toEqual([])
  })
})
