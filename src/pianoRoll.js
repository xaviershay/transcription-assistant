import { computeNoteBuckets, computePeakMidis } from './spectrum-bars.js'
import { iterateMagnitudeFrames, HOP_SIZE } from './onsets.js'
import { frequencyFromMidi } from './notes.js'

export const PIANO_ROLL_MIN_MIDI = 36 // C2
export const PIANO_ROLL_MAX_MIDI = 96 // C7
export const PIANO_ROLL_MIN_FREQ = frequencyFromMidi(PIANO_ROLL_MIN_MIDI)
export const PIANO_ROLL_MAX_FREQ = frequencyFromMidi(PIANO_ROLL_MAX_MIDI)

const PEAK_THRESHOLD = 90
const DB_FLOOR = -80 // dB below the track's single loudest bucket; quieter maps to 0

export function magnitudeToByte(magnitude, peakMagnitude) {
  if (peakMagnitude <= 0 || magnitude <= 0) return 0
  const db = 20 * Math.log10(magnitude / peakMagnitude)
  return Math.round(255 * Math.max(0, (db - DB_FLOOR) / -DB_FLOOR))
}

export function computeSpectrogramFrames(samples, sampleRate, minFreq, maxFreq) {
  const rawFrames = []
  let peakMagnitude = 0

  for (const magnitudes of iterateMagnitudeFrames(samples)) {
    const binHz = sampleRate / (magnitudes.length * 2)
    const buckets = computeNoteBuckets(magnitudes, binHz, minFreq, maxFreq)
    for (const bucket of buckets) {
      if (bucket.value > peakMagnitude) peakMagnitude = bucket.value
    }
    rawFrames.push(buckets)
  }

  const frames = rawFrames.map((buckets) => {
    const scaledBuckets = buckets.map((bucket) => ({
      ...bucket,
      value: magnitudeToByte(bucket.value, peakMagnitude),
    }))
    return { buckets: scaledBuckets, peakMidis: new Set(computePeakMidis(scaledBuckets, PEAK_THRESHOLD)) }
  })

  return { frames, hopSize: HOP_SIZE, sampleRate }
}
