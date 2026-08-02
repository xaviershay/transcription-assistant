import { describe, it, expect } from 'vitest'
import { formatRecordingLabel } from './recording.js'

describe('formatRecordingLabel', () => {
  it('formats a date as "Recording — <month> <day>, <time>"', () => {
    const date = new Date('2026-08-02T15:41:00')
    expect(formatRecordingLabel(date)).toBe('Recording — Aug 2, 3:41 PM')
  })

  it('pads single-digit minutes', () => {
    const date = new Date('2026-01-05T09:05:00')
    expect(formatRecordingLabel(date)).toBe('Recording — Jan 5, 9:05 AM')
  })
})
