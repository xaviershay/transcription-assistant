import { describe, it, expect } from 'vitest'
import { MIN_GAIN, MAX_GAIN, clampGain, gainToY, yToGain } from './eq.js'
import { MIN_Q, MAX_Q, DEFAULT_Q, accumulatorForQ, qForAccumulator, updateQAccumulator } from './eq.js'
import { peakingResponseDb } from './eq.js'
import { isNearDot } from './eq.js'
import { defaultEqBands } from './eq.js'

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

describe('accumulatorForQ / qForAccumulator', () => {
  it('round-trips a mid-range Q', () => {
    const acc = accumulatorForQ(2)
    expect(qForAccumulator(acc)).toBeCloseTo(2, 5)
  })

  it('maps MIN_Q to accumulator 0', () => {
    expect(accumulatorForQ(MIN_Q)).toBeCloseTo(0, 5)
  })

  it('qForAccumulator(0) returns MIN_Q', () => {
    expect(qForAccumulator(0)).toBeCloseTo(MIN_Q, 5)
  })

  it('clamps Q above MAX_Q when converting to accumulator', () => {
    const acc = accumulatorForQ(1000)
    expect(qForAccumulator(acc)).toBeCloseTo(MAX_Q, 5)
  })

  it('clamps Q below MIN_Q when converting to accumulator', () => {
    const acc = accumulatorForQ(0.001)
    expect(qForAccumulator(acc)).toBeCloseTo(MIN_Q, 5)
  })
})

describe('updateQAccumulator', () => {
  it('increases the accumulator for a negative deltaY (scroll up)', () => {
    const acc = accumulatorForQ(DEFAULT_Q)
    const updated = updateQAccumulator(acc, -10)
    expect(updated).toBeGreaterThan(acc)
  })

  it('decreases the accumulator for a positive deltaY (scroll down)', () => {
    const acc = accumulatorForQ(DEFAULT_Q)
    const updated = updateQAccumulator(acc, 10)
    expect(updated).toBeLessThan(acc)
  })

  it('is path-independent: a zero-sum sequence of deltas returns to the same Q', () => {
    let acc = accumulatorForQ(DEFAULT_Q)
    acc = updateQAccumulator(acc, -5)
    acc = updateQAccumulator(acc, -3)
    acc = updateQAccumulator(acc, 8)
    expect(qForAccumulator(acc)).toBeCloseTo(DEFAULT_Q, 5)
  })

  it('does not push the accumulator below 0', () => {
    const updated = updateQAccumulator(0, 100)
    expect(updated).toBe(0)
    expect(qForAccumulator(updated)).toBeCloseTo(MIN_Q, 5)
  })
})

describe('peakingResponseDb', () => {
  it('returns the set gain exactly at the center frequency', () => {
    expect(peakingResponseDb(1000, 1000, 6, 1, 44100)).toBeCloseTo(6, 1)
  })

  it('returns the set (negative) gain exactly at the center frequency', () => {
    expect(peakingResponseDb(1000, 1000, -9, 2, 44100)).toBeCloseTo(-9, 1)
  })

  it('approaches 0 dB far below the center frequency', () => {
    expect(Math.abs(peakingResponseDb(50, 1000, 6, 1, 44100))).toBeLessThan(1.5)
  })

  it('approaches 0 dB far above the center frequency', () => {
    expect(Math.abs(peakingResponseDb(8000, 1000, 6, 1, 44100))).toBeLessThan(1.5)
  })

  it('is symmetric in dB around the center for a given Q (boost vs matching cut have opposite sign at center)', () => {
    const boost = peakingResponseDb(1000, 1000, 6, 1, 44100)
    const cut = peakingResponseDb(1000, 1000, -6, 1, 44100)
    expect(boost).toBeCloseTo(-cut, 1)
  })

  it('a higher Q narrows the response (less boost one octave away)', () => {
    const narrow = peakingResponseDb(2000, 1000, 12, 8, 44100)
    const wide = peakingResponseDb(2000, 1000, 12, 1, 44100)
    expect(narrow).toBeLessThan(wide)
  })
})

describe('isNearDot', () => {
  it('is true exactly at the dot', () => {
    expect(isNearDot(100, 50, 100, 50, 8)).toBe(true)
  })

  it('is true within the hit radius', () => {
    expect(isNearDot(105, 50, 100, 50, 8)).toBe(true)
  })

  it('is true exactly on the hit radius boundary', () => {
    expect(isNearDot(108, 50, 100, 50, 8)).toBe(true)
  })

  it('is false outside the hit radius', () => {
    expect(isNearDot(120, 50, 100, 50, 8)).toBe(false)
  })

  it('accounts for both x and y distance', () => {
    expect(isNearDot(106, 106, 100, 100, 8)).toBe(false)
  })
})

describe('defaultEqBands', () => {
  it('returns 3 bands with the documented defaults', () => {
    expect(defaultEqBands()).toEqual([
      { freq: 200, gain: 0, q: 1 },
      { freq: 1000, gain: 0, q: 1 },
      { freq: 3000, gain: 0, q: 1 },
    ])
  })

  it('returns a fresh array each call, safe to mutate', () => {
    const a = defaultEqBands()
    const b = defaultEqBands()
    expect(a).not.toBe(b)
    expect(a[0]).not.toBe(b[0])
    a[0].gain = 12
    expect(b[0].gain).toBe(0)
  })
})
