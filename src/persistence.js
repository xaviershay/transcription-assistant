import { defaultEqBands } from './eq.js'
import { DEFAULT_GAIN_DB, DEFAULT_RANGE_DB } from './pianoRoll.js'

export function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function computeFileHash(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer)
  return bufferToHex(digest)
}

function storageKey(hash) {
  return `ear-transcriber:settings:${hash}`
}

function isValidBand(band) {
  return (
    band !== null &&
    typeof band === 'object' &&
    typeof band.freq === 'number' &&
    typeof band.gain === 'number' &&
    typeof band.q === 'number'
  )
}

function normalizeEqBands(parsed) {
  if (Array.isArray(parsed.eqBands) && parsed.eqBands.length === 3 && parsed.eqBands.every(isValidBand)) {
    return parsed.eqBands
  }
  if (typeof parsed.eqFreq === 'number' && typeof parsed.eqGain === 'number' && typeof parsed.eqQ === 'number') {
    const [, band1, band2] = defaultEqBands()
    return [{ freq: parsed.eqFreq, gain: parsed.eqGain, q: parsed.eqQ }, band1, band2]
  }
  return defaultEqBands()
}

export function loadSettings(storage, hash) {
  const raw = storage.getItem(storageKey(hash))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (
      typeof parsed.bpm !== 'number' ||
      typeof parsed.subdivisions !== 'number' ||
      typeof parsed.offset !== 'number' ||
      typeof parsed.volume !== 'number'
    ) {
      return null
    }
    return {
      bpm: parsed.bpm,
      subdivisions: parsed.subdivisions,
      offset: parsed.offset,
      volume: parsed.volume,
      eqBands: normalizeEqBands(parsed),
      gainDB: typeof parsed.gainDB === 'number' ? parsed.gainDB : DEFAULT_GAIN_DB,
      rangeDB: typeof parsed.rangeDB === 'number' ? parsed.rangeDB : DEFAULT_RANGE_DB,
    }
  } catch {
    return null
  }
}

export function saveSettings(storage, hash, settings) {
  storage.setItem(storageKey(hash), JSON.stringify(settings))
}
