import { describe, it, expect } from 'vitest'
import { mixToMono, computeSpectralFlux, pickOnsets, detectOnsets, iterateMagnitudeFrames } from './onsets.js'

const SAMPLE_RATE = 44100

function silence(seconds) {
  return new Float32Array(Math.round(seconds * SAMPLE_RATE))
}

function tone(freq, seconds, amplitude = 0.5) {
  const n = Math.round(seconds * SAMPLE_RATE)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const attack = Math.min(1, i / (SAMPLE_RATE * 0.005))
    out[i] = amplitude * attack * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE)
  }
  return out
}

function concat(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

function expectOnsetsNear(onsets, expectedTimes, toleranceSeconds = 0.05) {
  expect(onsets.length).toBe(expectedTimes.length)
  onsets.forEach((t, i) => {
    expect(Math.abs(t - expectedTimes[i])).toBeLessThanOrEqual(toleranceSeconds)
  })
}

describe('mixToMono', () => {
  it('returns the single channel unchanged for mono input', () => {
    const channel = new Float32Array([0.1, 0.2, 0.3])
    expect(mixToMono([channel])).toBe(channel)
  })

  it('averages multiple channels sample by sample', () => {
    const left = new Float32Array([1, 0, -1])
    const right = new Float32Array([0, 1, -1])
    const mono = mixToMono([left, right])
    expect(Array.from(mono)).toEqual([0.5, 0.5, -1])
  })
})

describe('detectOnsets', () => {
  it('finds zero onsets in pure silence', () => {
    const onsets = detectOnsets(silence(1.0), SAMPLE_RATE, 1.5)
    expect(onsets).toEqual([])
  })

  it('finds two onsets for two tones separated by silence', () => {
    const signal = concat(silence(0.2), tone(300, 0.3), silence(0.05), tone(600, 0.3), silence(0.2))
    const onsets = detectOnsets(signal, SAMPLE_RATE, 1.5)
    expectOnsetsNear(onsets, [0.2, 0.55])
  })

  it('finds four onsets for a legato run of adjacent notes with no gaps', () => {
    const signal = concat(
      tone(261.63, 0.15),
      tone(293.66, 0.15),
      tone(329.63, 0.15),
      tone(349.23, 0.15),
      tone(392.0, 0.15),
    )
    const onsets = detectOnsets(signal, SAMPLE_RATE, 1.5)
    expectOnsetsNear(onsets, [0.15, 0.3, 0.45, 0.6])
  })
})

describe('two-stage split (computeSpectralFlux + pickOnsets)', () => {
  it('reuses one flux computation across multiple sensitivity values', () => {
    const signal = concat(silence(0.2), tone(300, 0.3), silence(0.05), tone(600, 0.3), silence(0.2))
    const fluxResult = computeSpectralFlux(signal, SAMPLE_RATE)

    expectOnsetsNear(pickOnsets(fluxResult, 1.0), [0.2, 0.55])
    expectOnsetsNear(pickOnsets(fluxResult, 3.0), [0.2, 0.55])
  })
})

describe('iterateMagnitudeFrames', () => {
  it('yields one Float32Array per frame, each of length fftSize/2', () => {
    const signal = tone(440, 0.2)
    const frames = [...iterateMagnitudeFrames(signal)]
    expect(frames.length).toBeGreaterThan(0)
    for (const frame of frames) {
      expect(frame).toBeInstanceOf(Float32Array)
      expect(frame.length).toBe(1024) // default FFT_SIZE (2048) / 2
    }
  })

  it('places the loudest bin near the expected frequency for a pure tone', () => {
    const freq = 440
    const signal = tone(freq, 0.2)
    const frames = [...iterateMagnitudeFrames(signal)]
    const midFrame = frames[Math.floor(frames.length / 2)]
    let peakBin = 0
    for (let i = 1; i < midFrame.length; i++) {
      if (midFrame[i] > midFrame[peakBin]) peakBin = i
    }
    const binHz = SAMPLE_RATE / 2048 // default fftSize
    expect(Math.abs(peakBin * binHz - freq)).toBeLessThan(binHz)
  })

  it('respects a custom fftSize/hopSize', () => {
    const signal = tone(440, 0.2)
    const frames = [...iterateMagnitudeFrames(signal, { fftSize: 512, hopSize: 256 })]
    expect(frames[0].length).toBe(256)
  })

  it('yields zero frames for a signal shorter than one fftSize window', () => {
    const frames = [...iterateMagnitudeFrames(new Float32Array(100))]
    expect(frames).toEqual([])
  })
})
