import { describe, it, expect } from 'vitest'
import { computeNoteBuckets } from './spectrum-bars.js'
import { frequencyFromMidi } from './notes.js'

const SAMPLE_RATE = 44100
const FFT_SIZE = 8192
const BIN_HZ = SAMPLE_RATE / FFT_SIZE

describe('computeNoteBuckets', () => {
  it('attributes a single loud bin to its nearest note, leaving neighbors at 0', () => {
    const freqData = new Uint8Array(4096)
    const binIndexNear440 = Math.round(440 / BIN_HZ)
    freqData[binIndexNear440] = 200

    const buckets = computeNoteBuckets(freqData, BIN_HZ, 27.5, 4186)
    const a4 = buckets.find((b) => b.midi === 69)
    const gSharp4 = buckets.find((b) => b.midi === 68)
    const aSharp4 = buckets.find((b) => b.midi === 70)

    expect(a4.value).toBe(200)
    expect(gSharp4.value).toBe(0)
    expect(aSharp4.value).toBe(0)
  })

  it('computes bucket boundaries from frequencyFromMidi(midi +/- 0.5)', () => {
    const freqData = new Uint8Array(4096)
    const buckets = computeNoteBuckets(freqData, BIN_HZ, 27.5, 4186)
    const a4 = buckets.find((b) => b.midi === 69)

    expect(a4.lowFreq).toBeCloseTo(frequencyFromMidi(68.5), 5)
    expect(a4.highFreq).toBeCloseTo(frequencyFromMidi(69.5), 5)
  })

  it('takes the max across multiple bins in one bucket, not sum or average', () => {
    const freqData = new Uint8Array(4096)
    const lowC5 = frequencyFromMidi(71.5)
    const highC5 = frequencyFromMidi(72.5)
    const startBin = Math.ceil(lowC5 / BIN_HZ)
    freqData[startBin] = 50
    freqData[startBin + 1] = 180
    freqData[Math.floor(highC5 / BIN_HZ)] = 90

    const buckets = computeNoteBuckets(freqData, BIN_HZ, 27.5, 4186)
    expect(buckets.find((b) => b.midi === 72).value).toBe(180)
  })

  it('only returns buckets overlapping the given frequency range', () => {
    const freqData = new Uint8Array(4096)
    const buckets = computeNoteBuckets(freqData, BIN_HZ, 440, 440)
    const midis = buckets.map((b) => b.midi)

    expect(Math.min(...midis)).toBe(Math.floor(69 - 0.5))
    expect(Math.max(...midis)).toBe(Math.ceil(69 + 0.5))
  })

  it('returns buckets ordered by ascending midi', () => {
    const freqData = new Uint8Array(4096)
    const buckets = computeNoteBuckets(freqData, BIN_HZ, 220, 880)
    const midis = buckets.map((b) => b.midi)
    const sorted = [...midis].sort((a, b) => a - b)
    expect(midis).toEqual(sorted)
  })
})
