import { describe, it, expect } from 'vitest'
import { bufferToHex, computeFileHash, loadSettings, saveSettings } from './persistence.js'
import { DEFAULT_GAIN_DB, DEFAULT_RANGE_DB } from './pianoRoll.js'

function createMemoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
  }
}

describe('bufferToHex', () => {
  it('hex-encodes a byte buffer', () => {
    const buffer = new Uint8Array([0, 15, 16, 255]).buffer
    expect(bufferToHex(buffer)).toBe('000f10ff')
  })
})

describe('computeFileHash', () => {
  it('matches the known SHA-256 digest of an empty buffer', async () => {
    const hash = await computeFileHash(new ArrayBuffer(0))
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('matches the known SHA-256 digest of "abc"', async () => {
    const buffer = new TextEncoder().encode('abc').buffer
    const hash = await computeFileHash(buffer)
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('loadSettings / saveSettings', () => {
  it('round-trips settings through storage', () => {
    const storage = createMemoryStorage()
    const settings = {
      bpm: 140,
      subdivisions: 3,
      offset: 1.25,
      volume: 0.8,
      eqBands: [
        { freq: 100, gain: 3, q: 1.5 },
        { freq: 900, gain: -2, q: 2 },
        { freq: 5000, gain: 6, q: 0.8 },
      ],
      gainDB: 10,
      rangeDB: 60,
    }
    saveSettings(storage, 'abc123', settings)
    expect(loadSettings(storage, 'abc123')).toEqual(settings)
  })

  it('returns null for a hash with no saved settings', () => {
    const storage = createMemoryStorage()
    expect(loadSettings(storage, 'nope')).toBeNull()
  })

  it('returns null for malformed JSON rather than throwing', () => {
    const storage = createMemoryStorage()
    storage.setItem('ear-transcriber:settings:bad', 'not json{{{')
    expect(loadSettings(storage, 'bad')).toBeNull()
  })

  it('returns null for JSON missing expected fields', () => {
    const storage = createMemoryStorage()
    storage.setItem('ear-transcriber:settings:partial', JSON.stringify({ bpm: 120 }))
    expect(loadSettings(storage, 'partial')).toBeNull()
  })

  it('defaults all 3 EQ bands for settings saved before the EQ feature existed', () => {
    const storage = createMemoryStorage()
    storage.setItem(
      'ear-transcriber:settings:pre-eq',
      JSON.stringify({ bpm: 100, subdivisions: 4, offset: 0, volume: 1 }),
    )
    expect(loadSettings(storage, 'pre-eq')).toEqual({
      bpm: 100,
      subdivisions: 4,
      offset: 0,
      volume: 1,
      eqBands: [
        { freq: 200, gain: 0, q: 1 },
        { freq: 1000, gain: 0, q: 1 },
        { freq: 3000, gain: 0, q: 1 },
      ],
      gainDB: DEFAULT_GAIN_DB,
      rangeDB: DEFAULT_RANGE_DB,
    })
  })

  it('migrates single-band legacy EQ data into band 0, defaulting bands 1 and 2', () => {
    const storage = createMemoryStorage()
    storage.setItem(
      'ear-transcriber:settings:single-band',
      JSON.stringify({ bpm: 100, subdivisions: 4, offset: 0, volume: 1, eqFreq: 500, eqGain: -6, eqQ: 3 }),
    )
    expect(loadSettings(storage, 'single-band')).toEqual({
      bpm: 100,
      subdivisions: 4,
      offset: 0,
      volume: 1,
      eqBands: [
        { freq: 500, gain: -6, q: 3 },
        { freq: 1000, gain: 0, q: 1 },
        { freq: 3000, gain: 0, q: 1 },
      ],
      gainDB: DEFAULT_GAIN_DB,
      rangeDB: DEFAULT_RANGE_DB,
    })
  })

  it('defaults gain/range for settings saved before the piano roll feature existed', () => {
    const storage = createMemoryStorage()
    storage.setItem(
      'ear-transcriber:settings:pre-piano-roll',
      JSON.stringify({
        bpm: 100,
        subdivisions: 4,
        offset: 0,
        volume: 1,
        eqBands: [
          { freq: 200, gain: 0, q: 1 },
          { freq: 1000, gain: 0, q: 1 },
          { freq: 3000, gain: 0, q: 1 },
        ],
      }),
    )
    const loaded = loadSettings(storage, 'pre-piano-roll')
    expect(loaded.gainDB).toBe(DEFAULT_GAIN_DB)
    expect(loaded.rangeDB).toBe(DEFAULT_RANGE_DB)
  })
})
