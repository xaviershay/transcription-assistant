import { computeNoteBuckets, computePeakMidis } from './spectrum-bars.js'
import { iterateMagnitudeFrames, HOP_SIZE } from './onsets.js'
import { frequencyFromMidi, noteNameFromMidi, labelStep } from './notes.js'

export const PIANO_ROLL_MIN_MIDI = 36 // C2
export const PIANO_ROLL_MAX_MIDI = 96 // C7
export const PIANO_ROLL_MIN_FREQ = frequencyFromMidi(PIANO_ROLL_MIN_MIDI)
export const PIANO_ROLL_MAX_FREQ = frequencyFromMidi(PIANO_ROLL_MAX_MIDI)

const PEAK_MARGIN_ABOVE_AVERAGE = 40
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
    return { buckets: scaledBuckets, peakMidis: new Set(computePeakMidis(scaledBuckets, PEAK_MARGIN_ABOVE_AVERAGE)) }
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

export function computeBeatGridLines(startTime, endTime, bpm, subdivisions, offset) {
  if (!(endTime > startTime) || !(bpm > 0) || !(subdivisions > 0)) return []

  const secondsPerBeat = 60 / bpm
  const subdivisionInterval = secondsPerBeat / subdivisions
  const firstIndex = Math.ceil((startTime - offset) / subdivisionInterval)
  const lastIndex = Math.floor((endTime - offset) / subdivisionInterval)

  const lines = []
  for (let i = firstIndex; i <= lastIndex; i++) {
    const time = offset + i * subdivisionInterval
    const fraction = (time - startTime) / (endTime - startTime)
    const isBeat = ((i % subdivisions) + subdivisions) % subdivisions === 0
    lines.push({ fraction, isBeat, beatNumber: isBeat ? Math.round(i / subdivisions) + 1 : null })
  }
  return lines
}

export function drawBeatGrid(canvas, startTime, endTime, bpm, subdivisions, offset) {
  const ctx = canvas.getContext('2d')
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  for (const { fraction, isBeat, beatNumber } of computeBeatGridLines(startTime, endTime, bpm, subdivisions, offset)) {
    const y = fraction * canvas.height
    ctx.strokeStyle = isBeat ? 'rgba(230, 230, 230, 0.4)' : 'rgba(230, 230, 230, 0.15)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(canvas.width, y)
    ctx.stroke()

    if (isBeat) {
      ctx.fillStyle = LABEL_COLOR
      ctx.fillText(String(beatNumber), 2, y + 1)
    }
  }
}

const PLAYHEAD_COLOR = '#ffffff'

export function drawPlayhead(canvas, currentTime, startTime, endTime) {
  if (!(endTime > startTime)) return
  if (currentTime < startTime || currentTime > endTime) return
  const ctx = canvas.getContext('2d')
  const y = ((currentTime - startTime) / (endTime - startTime)) * canvas.height
  ctx.strokeStyle = PLAYHEAD_COLOR
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, y)
  ctx.lineTo(canvas.width, y)
  ctx.stroke()
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
