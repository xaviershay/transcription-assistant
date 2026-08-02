import { computeNoteBuckets, computePeakMidis } from './spectrum-bars.js'
import { iterateMagnitudeFrames, HOP_SIZE } from './onsets.js'
import { frequencyFromMidi, noteNameFromMidi, labelStep } from './notes.js'

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

const BACKGROUND_COLOR = '#121212'
const PEAK_COLOR = '#388e3c'
const BAR_COLOR_RGB = '79, 109, 245' // #4f6df5
const LABEL_COLOR = '#f0f0f0'

export function frameRangeForTime(startTime, endTime, hopSize, sampleRate, totalFrames) {
  const startFrame = Math.max(0, Math.floor((startTime * sampleRate) / hopSize))
  const endFrame = Math.min(totalFrames - 1, Math.ceil((endTime * sampleRate) / hopSize))
  return { startFrame, endFrame }
}

export function drawPianoRollSlice(canvas, frames, startFrame, endFrame, minMidi, maxMidi) {
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = BACKGROUND_COLOR
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const numColumns = maxMidi - minMidi + 1
  const colWidth = canvas.width / numColumns
  const numRows = endFrame - startFrame + 1
  const rowHeight = canvas.height / numRows

  for (let f = startFrame; f <= endFrame; f++) {
    const frame = frames[f]
    if (!frame) continue
    const y = (f - startFrame) * rowHeight
    for (const bucket of frame.buckets) {
      if (bucket.midi < minMidi || bucket.midi > maxMidi) continue
      const x = (bucket.midi - minMidi) * colWidth
      ctx.fillStyle = frame.peakMidis.has(bucket.midi) ? PEAK_COLOR : `rgba(${BAR_COLOR_RGB}, ${bucket.value / 255})`
      ctx.fillRect(x, y, colWidth, rowHeight)
    }
  }
}

export function drawPianoRollLabels(canvas, minMidi, maxMidi) {
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = BACKGROUND_COLOR
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = LABEL_COLOR
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const numColumns = maxMidi - minMidi + 1
  const colWidth = canvas.width / numColumns
  const step = labelStep(numColumns, canvas.width)
  for (let midi = minMidi; midi <= maxMidi; midi += step) {
    const x = (midi - minMidi + 0.5) * colWidth
    ctx.fillText(noteNameFromMidi(midi), x, canvas.height / 2)
  }
}
