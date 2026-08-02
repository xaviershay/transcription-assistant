import { describe, it, expect } from 'vitest'
import { yForFrequency, computeSpectrogramLabels } from './spectrogramLabels.js'
import { frequencyFromMidi } from './notes.js'

describe('yForFrequency', () => {
  it('places the minimum frequency at the bottom (height)', () => {
    expect(yForFrequency(100, 100, 400, 300)).toBeCloseTo(300, 5)
  })

  it('places the maximum frequency at the top (0)', () => {
    expect(yForFrequency(400, 100, 400, 300)).toBeCloseTo(0, 5)
  })

  it('places the log-midpoint frequency at the vertical midpoint', () => {
    // log2(100)..log2(400) spans exactly 2 - the geometric mean (200) is the midpoint
    expect(yForFrequency(200, 100, 400, 300)).toBeCloseTo(150, 5)
  })
})

describe('computeSpectrogramLabels', () => {
  it('returns labels within the canvas height bounds', () => {
    const labels = computeSpectrogramLabels(frequencyFromMidi(36), frequencyFromMidi(72), 400)
    for (const { y } of labels) {
      expect(y).toBeGreaterThanOrEqual(-0.01)
      expect(y).toBeLessThanOrEqual(400.01)
    }
  })

  it('includes a label at the low end whose text is C2', () => {
    const labels = computeSpectrogramLabels(frequencyFromMidi(36), frequencyFromMidi(72), 400)
    expect(labels[0].text).toBe('C2')
  })

  it('orders labels from bottom (largest y) to top (smallest y)', () => {
    const labels = computeSpectrogramLabels(frequencyFromMidi(36), frequencyFromMidi(72), 400)
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i].y).toBeLessThan(labels[i - 1].y)
    }
  })

  it('spaces labels out rather than returning one per semitone', () => {
    // 36 semitones in 400px would be ~11px apart if unspaced - confirm labelStep is actually applied
    const labels = computeSpectrogramLabels(frequencyFromMidi(36), frequencyFromMidi(72), 400)
    expect(labels.length).toBeLessThan(36)
  })
})
