import { describe, it, expect } from 'vitest'
import {
  midiFromFrequency,
  frequencyFromMidi,
  noteNameFromMidi,
  frequencyToNoteName,
} from './notes.js'

describe('midiFromFrequency', () => {
  it('returns 69 for A440', () => {
    expect(midiFromFrequency(440)).toBeCloseTo(69, 5)
  })

  it('returns approximately 60 for middle C (261.6256 Hz)', () => {
    expect(midiFromFrequency(261.6256)).toBeCloseTo(60, 2)
  })
})

describe('frequencyFromMidi', () => {
  it('returns 440 for midi 69', () => {
    expect(frequencyFromMidi(69)).toBeCloseTo(440, 5)
  })
})

describe('noteNameFromMidi', () => {
  it('names midi 69 as A4', () => {
    expect(noteNameFromMidi(69)).toBe('A4')
  })

  it('names midi 60 as C4', () => {
    expect(noteNameFromMidi(60)).toBe('C4')
  })

  it('names midi 61 as C#4', () => {
    expect(noteNameFromMidi(61)).toBe('C#4')
  })

  it('rounds midi 69.4 to A4', () => {
    expect(noteNameFromMidi(69.4)).toBe('A4')
  })

  it('names midi 21 as A0 (lowest piano key)', () => {
    expect(noteNameFromMidi(21)).toBe('A0')
  })
})

describe('frequencyToNoteName', () => {
  it('identifies 440Hz as A4', () => {
    expect(frequencyToNoteName(440)).toBe('A4')
  })

  it('identifies 523.25Hz as C5', () => {
    expect(frequencyToNoteName(523.25)).toBe('C5')
  })
})
