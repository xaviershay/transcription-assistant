import { describe, it, expect } from 'vitest'
import { MIN_GAIN, MAX_GAIN, clampGain, gainToY, yToGain } from './eq.js'
import { MIN_Q, MAX_Q, DEFAULT_Q, accumulatorForQ, qForAccumulator, updateQAccumulator } from './eq.js'

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
