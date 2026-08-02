import { describe, it, expect } from 'vitest'
import { magnitudeToByte, computeSpectrogramFrames, PIANO_ROLL_MIN_FREQ, PIANO_ROLL_MAX_FREQ } from './pianoRoll.js'

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
