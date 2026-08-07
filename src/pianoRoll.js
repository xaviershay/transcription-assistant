import { computeNoteBuckets } from './spectrum-bars.js'
import { iterateMagnitudeFrames, HOP_SIZE } from './onsets.js'
import { frequencyFromMidi, noteNameFromMidi, labelStep } from './notes.js'

export const PIANO_ROLL_MIN_MIDI = 36 // C2
export const PIANO_ROLL_MAX_MIDI = 96 // C7
export const PIANO_ROLL_MIN_FREQ = frequencyFromMidi(PIANO_ROLL_MIN_MIDI)
export const PIANO_ROLL_MAX_FREQ = frequencyFromMidi(PIANO_ROLL_MAX_MIDI)

// Matches the wavesurfer Spectrogram plugin's own gainDB/rangeDB convention
// (the one this piano roll replaced): gainDB shifts how far below the
// track's peak magnitude counts as "white" - 0 means only the peak itself is
// white, higher values let quieter content reach full brightness too.
// rangeDB is how many dB below that white point fall all the way to black -
// smaller means higher contrast (a narrower band of loudness shown at all),
// larger means a more gradual falloff.
export const DEFAULT_GAIN_DB = 0
export const DEFAULT_RANGE_DB = 20

export function magnitudeToByte(magnitude, peakMagnitude, gainDB, rangeDB) {
  if (peakMagnitude <= 0 || magnitude <= 0) return 0
  const db = 20 * Math.log10(magnitude / peakMagnitude)
  const value01 = Math.min(1, Math.max(0, (db + gainDB + rangeDB) / rangeDB))
  return Math.round(255 * value01)
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

  return { rawFrames, peakMagnitude, hopSize: HOP_SIZE, sampleRate }
}

// Separated from computeSpectrogramFrames so changing gain/range (e.g. from
// UI sliders) only re-runs this cheap per-bucket remapping, not the whole
// FFT/bucketing pass over the entire track.
export function scaleFrames(rawFrames, peakMagnitude, gainDB, rangeDB) {
  return rawFrames.map((buckets) => ({
    buckets: buckets.map((bucket) => ({
      ...bucket,
      value: magnitudeToByte(bucket.value, peakMagnitude, gainDB, rangeDB),
    })),
  }))
}

const BACKGROUND_COLOR = '#121212'
const LABEL_COLOR = '#f0f0f0'

// Classic thermal-style gradient: black (quiet) -> blue -> red -> yellow ->
// white (loudest), evenly spaced across the 0-255 byte range.
const COLOR_STOPS = [
  { stop: 0, color: [0, 0, 0] },
  { stop: 64, color: [0, 0, 255] },
  { stop: 128, color: [255, 0, 0] },
  { stop: 192, color: [255, 255, 0] },
  { stop: 255, color: [255, 255, 255] },
]

export function colorForByte(value) {
  const clamped = Math.min(255, Math.max(0, value))
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i]
    const b = COLOR_STOPS[i + 1]
    if (clamped >= a.stop && clamped <= b.stop) {
      const t = (clamped - a.stop) / (b.stop - a.stop)
      const r = Math.round(a.color[0] + (b.color[0] - a.color[0]) * t)
      const g = Math.round(a.color[1] + (b.color[1] - a.color[1]) * t)
      const bch = Math.round(a.color[2] + (b.color[2] - a.color[2]) * t)
      return `rgb(${r}, ${g}, ${bch})`
    }
  }
  return 'rgb(255, 255, 255)'
}

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
      ctx.fillStyle = colorForByte(bucket.value)
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
  const dpr = window.devicePixelRatio || 1
  const ctx = canvas.getContext('2d')
  ctx.font = `${11 * dpr}px sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  for (const { fraction, isBeat, beatNumber } of computeBeatGridLines(startTime, endTime, bpm, subdivisions, offset)) {
    const y = fraction * canvas.height
    ctx.strokeStyle = isBeat ? 'rgba(230, 230, 230, 0.4)' : 'rgba(230, 230, 230, 0.15)'
    ctx.lineWidth = dpr
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(canvas.width, y)
    ctx.stroke()

    if (isBeat) {
      ctx.fillStyle = LABEL_COLOR
      ctx.fillText(String(beatNumber), 2 * dpr, y + dpr)
    }
  }
}

const PLAYHEAD_COLOR = '#ffffff'

export function drawPlayhead(canvas, currentTime, startTime, endTime) {
  if (!(endTime > startTime)) return
  if (currentTime < startTime || currentTime > endTime) return
  const dpr = window.devicePixelRatio || 1
  const ctx = canvas.getContext('2d')
  const y = ((currentTime - startTime) / (endTime - startTime)) * canvas.height
  ctx.strokeStyle = PLAYHEAD_COLOR
  ctx.lineWidth = 2 * dpr
  ctx.beginPath()
  ctx.moveTo(0, y)
  ctx.lineTo(canvas.width, y)
  ctx.stroke()
}

export function drawPianoRollLabels(canvas, minMidi, maxMidi) {
  const dpr = window.devicePixelRatio || 1
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = BACKGROUND_COLOR
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = LABEL_COLOR
  ctx.font = `${12 * dpr}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const numColumns = maxMidi - minMidi + 1
  const colWidth = canvas.width / numColumns
  const step = labelStep(numColumns, canvas.width, 50 * dpr)
  for (let midi = minMidi; midi <= maxMidi; midi += step) {
    const x = (midi - minMidi + 0.5) * colWidth
    ctx.fillText(noteNameFromMidi(midi), x, canvas.height / 2)
  }
}
