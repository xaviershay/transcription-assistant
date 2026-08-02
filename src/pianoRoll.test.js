import { describe, it, expect } from 'vitest'
import {
  magnitudeToByte,
  computeSpectrogramFrames,
  scaleFrames,
  DEFAULT_GAIN_DB,
  DEFAULT_RANGE_DB,
  PIANO_ROLL_MIN_FREQ,
  PIANO_ROLL_MAX_FREQ,
} from './pianoRoll.js'
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
  it('maps the magnitude at the gain point (gainDB below peak) to 255', () => {
    // gainDB=0 -> white point is exactly the peak itself
    expect(magnitudeToByte(10, 10, 0, 80)).toBe(255)
  })

  it('shifts the white point when gainDB > 0: quieter-than-peak content can map to 255', () => {
    const peak = 1
    const gainDB = 20
    // magnitude 20dB below peak should now be the white point, not the peak itself
    const atGainPoint = peak * Math.pow(10, -gainDB / 20)
    expect(magnitudeToByte(atGainPoint, peak, gainDB, 80)).toBe(255)
  })

  it('clamps above 255 rather than overflowing when gainDB pushes the peak past the white point', () => {
    // db=0 (the peak itself) with gainDB=20 computes past 1.0 before clamping
    expect(magnitudeToByte(10, 10, 20, 80)).toBe(255)
  })

  it('maps digital silence (0) to 0', () => {
    expect(magnitudeToByte(0, 10, 0, 80)).toBe(0)
  })

  it('maps a magnitude at gainDB+rangeDB below peak to 0 (the black point)', () => {
    const peak = 1
    const gainDB = 0
    const rangeDB = 80
    const atFloor = peak * Math.pow(10, -(gainDB + rangeDB) / 20)
    expect(magnitudeToByte(atFloor, peak, gainDB, rangeDB)).toBe(0)
  })

  it('maps the midpoint between white and black points to roughly half scale', () => {
    const peak = 1
    const gainDB = 0
    const rangeDB = 80
    const midpoint = peak * Math.pow(10, -(gainDB + rangeDB / 2) / 20)
    // 255 * 0.5 = 127.5 exactly; Math.round rounds half-up in JS, giving 128.
    expect(magnitudeToByte(midpoint, peak, gainDB, rangeDB)).toBe(128)
  })

  it('returns 0 when peakMagnitude is 0, rather than NaN/-Infinity from log(0)', () => {
    expect(magnitudeToByte(5, 0, 0, 80)).toBe(0)
  })
})

describe('computeSpectrogramFrames', () => {
  it('returns rawFrames/peakMagnitude/hopSize/sampleRate', () => {
    const signal = tone(261.63, 0.3)
    const result = computeSpectrogramFrames(signal, SAMPLE_RATE, PIANO_ROLL_MIN_FREQ, PIANO_ROLL_MAX_FREQ)
    expect(result.hopSize).toBeGreaterThan(0)
    expect(result.sampleRate).toBe(SAMPLE_RATE)
    expect(result.rawFrames.length).toBeGreaterThan(0)
    expect(result.peakMagnitude).toBeGreaterThan(0)
  })

  it('every raw frame is a plain buckets array with non-negative magnitude values', () => {
    const signal = tone(261.63, 0.3)
    const { rawFrames } = computeSpectrogramFrames(signal, SAMPLE_RATE, PIANO_ROLL_MIN_FREQ, PIANO_ROLL_MAX_FREQ)
    for (const buckets of rawFrames) {
      expect(Array.isArray(buckets)).toBe(true)
      for (const bucket of buckets) {
        expect(bucket.value).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('registers the C4 (midi 60) bucket as at or near peakMagnitude for a pure 261.63Hz tone', () => {
    const signal = tone(261.63, 0.3)
    const { rawFrames, peakMagnitude } = computeSpectrogramFrames(signal, SAMPLE_RATE, PIANO_ROLL_MIN_FREQ, PIANO_ROLL_MAX_FREQ)
    const midFrame = rawFrames[Math.floor(rawFrames.length / 2)]
    const c4Bucket = midFrame.find((b) => b.midi === 60)
    expect(c4Bucket).toBeDefined()
    expect(c4Bucket.value / peakMagnitude).toBeGreaterThan(0.9) // this tone dominates the track
  })
})

describe('scaleFrames', () => {
  function rawBucket(midi, value) {
    return { midi, lowFreq: 0, highFreq: 0, value }
  }

  it('applies magnitudeToByte to every bucket of every frame with the given gain/range', () => {
    const rawFrames = [
      [rawBucket(60, 10), rawBucket(61, 5)],
      [rawBucket(60, 2), rawBucket(61, 10)],
    ]
    const peakMagnitude = 10
    const scaled = scaleFrames(rawFrames, peakMagnitude, DEFAULT_GAIN_DB, DEFAULT_RANGE_DB)

    expect(scaled.length).toBe(2)
    for (let f = 0; f < rawFrames.length; f++) {
      for (let b = 0; b < rawFrames[f].length; b++) {
        expect(scaled[f].buckets[b].value).toBe(
          magnitudeToByte(rawFrames[f][b].value, peakMagnitude, DEFAULT_GAIN_DB, DEFAULT_RANGE_DB),
        )
        expect(scaled[f].buckets[b].midi).toBe(rawFrames[f][b].midi)
      }
    }
  })

  it('produces different byte values for the same raw data under different gain/range', () => {
    const rawFrames = [[rawBucket(60, 3)]]
    const low = scaleFrames(rawFrames, 10, 0, 80)[0].buckets[0].value
    const high = scaleFrames(rawFrames, 10, 20, 80)[0].buckets[0].value
    expect(high).toBeGreaterThan(low)
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
