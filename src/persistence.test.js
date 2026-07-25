import { describe, it, expect } from 'vitest'
import { bufferToHex, computeFileHash, loadSettings, saveSettings } from './persistence.js'

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
    const settings = { bpm: 140, subdivisions: 3, offset: 1.25, volume: 0.8, eqFreq: 500, eqGain: -3, eqQ: 2 }
    saveSettings(storage, 'abc123', settings)
    expect(loadSettings(storage, 'abc123')).toEqual(settings)
  })

  it('defaults EQ fields for settings saved before the EQ feature existed', () => {
    const storage = createMemoryStorage()
    storage.setItem(
      'ear-transcriber:settings:legacy',
      JSON.stringify({ bpm: 100, subdivisions: 4, offset: 0, volume: 1 }),
    )
    expect(loadSettings(storage, 'legacy')).toEqual({
      bpm: 100,
      subdivisions: 4,
      offset: 0,
      volume: 1,
      eqFreq: 1000,
      eqGain: 0,
      eqQ: 1,
    })
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
})
