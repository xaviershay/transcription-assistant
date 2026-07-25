import { describe, it, expect } from 'vitest'
import { MIN_GAIN, MAX_GAIN, clampGain, gainToY, yToGain } from './eq.js'

describe('clampGain', () => {
  it('passes through values within range', () => {
    expect(clampGain(5)).toBe(5)
  })

  it('clamps above MAX_GAIN', () => {
    expect(clampGain(30)).toBe(MAX_GAIN)
  })

  it('clamps below MIN_GAIN', () => {
    expect(clampGain(-30)).toBe(MIN_GAIN)
  })
})

describe('gainToY', () => {
  it('maps 0 dB to vertical center', () => {
    expect(gainToY(0, 200)).toBe(100)
  })

  it('maps MAX_GAIN to the top (y=0)', () => {
    expect(gainToY(MAX_GAIN, 200)).toBe(0)
  })

  it('maps MIN_GAIN to the bottom', () => {
    expect(gainToY(MIN_GAIN, 200)).toBe(200)
  })
})

describe('yToGain', () => {
  it('maps vertical center to 0 dB', () => {
    expect(yToGain(100, 200)).toBeCloseTo(0, 5)
  })

  it('maps the top to MAX_GAIN', () => {
    expect(yToGain(0, 200)).toBeCloseTo(MAX_GAIN, 5)
  })

  it('maps the bottom to MIN_GAIN', () => {
    expect(yToGain(200, 200)).toBeCloseTo(MIN_GAIN, 5)
  })

  it('clamps y values beyond the canvas', () => {
    expect(yToGain(-50, 200)).toBe(MAX_GAIN)
    expect(yToGain(250, 200)).toBe(MIN_GAIN)
  })

  it('round-trips with gainToY', () => {
    expect(yToGain(gainToY(12, 200), 200)).toBeCloseTo(12, 5)
  })
})
