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
