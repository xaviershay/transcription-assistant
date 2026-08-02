import { frequencyToNoteName, midiFromFrequency, noteNameFromMidi } from './notes.js'
import { computeNoteBuckets, computePeakMidis } from './spectrum-bars.js'
import {
  gainToY,
  yToGain,
  clampGain,
  peakingResponseDb,
  lowShelfResponseDb,
  highShelfResponseDb,
  isNearDot,
  qForAccumulator,
  updateQAccumulator,
  accumulatorForQ,
  defaultEqBands,
} from './eq.js'

export const MIN_FREQ = 27.5 // A0
export const MAX_FREQ = 4186 // C8
const MIN_SPAN_SEMITONES = 2
const ZOOM_FACTOR = 1.15
const PAN_FRACTION = 0.15
const BACKGROUND_COLOR = '#121212'
const LABEL_COLOR = '#f0f0f0'
const BAR_COLOR = '#4f6df5'
const EQ_COLOR = '#f5a64f'
const EQ_BAND_COLORS = ['#f5a64f', '#4fc3f5', '#f54f8c']
const EQ_HIT_RADIUS = 8
const PEAK_COLOR = '#388e3c'
const PEAK_THRESHOLD = 90

const BAND_TYPES = ['lowshelf', 'peaking', 'highshelf']
const SHELF_Q = 1

function responseDbForBand(index, freq, filter, sampleRate) {
  if (BAND_TYPES[index] === 'lowshelf') {
    return lowShelfResponseDb(freq, filter.frequency.value, filter.gain.value, SHELF_Q, sampleRate)
  }
  if (BAND_TYPES[index] === 'highshelf') {
    return highShelfResponseDb(freq, filter.frequency.value, filter.gain.value, SHELF_Q, sampleRate)
  }
  return peakingResponseDb(freq, filter.frequency.value, filter.gain.value, filter.Q.value, sampleRate)
}

export function createSpectrumAnalyser(wavesurfer, canvas, { onEqChange } = {}) {
  function syncCanvasWidth() {
    const width = Math.round(canvas.getBoundingClientRect().width)
    if (width > 0 && canvas.width !== width) {
      canvas.width = width
    }
  }
  syncCanvasWidth()
  window.addEventListener('resize', syncCanvasWidth)

  const audioCtx = new AudioContext()
  const source = audioCtx.createMediaElementSource(wavesurfer.getMediaElement())
  const filters = defaultEqBands().map(({ freq, gain, q }, i) => {
    const node = audioCtx.createBiquadFilter()
    node.type = BAND_TYPES[i]
    node.frequency.value = freq
    node.gain.value = gain
    node.Q.value = q
    return node
  })
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 8192
  source.connect(filters[0])
  filters[0].connect(filters[1])
  filters[1].connect(filters[2])
  filters[2].connect(analyser)
  analyser.connect(audioCtx.destination)

  const freqData = new Uint8Array(analyser.frequencyBinCount)
  const ctx = canvas.getContext('2d')
  const binHz = audioCtx.sampleRate / analyser.fftSize

  let viewMinFreq = MIN_FREQ
  let viewMaxFreq = MAX_FREQ
  let animationFrame = null

  // Zoom level is derived from this accumulator, not from repeatedly multiplying
  // the current span - a chain of multiplicative "zoom in by X" operations is only
  // as reversible as its individual steps are exact opposites, which broke down for
  // real wheel/trackpad input (see zoomAt below). Deriving span fresh from a single
  // clamped, summed accumulator makes the result path-independent: any sequence of
  // deltaY events that sums to zero returns to exactly the same span, regardless of
  // how many events it was split into or their individual sizes.
  const MAX_LOG_SPAN = Math.log2(MAX_FREQ) - Math.log2(MIN_FREQ)
  const MIN_LOG_SPAN = MIN_SPAN_SEMITONES / 12
  const MAX_ZOOM_ACCUMULATOR = (100 * Math.log(MAX_LOG_SPAN / MIN_LOG_SPAN)) / Math.log(ZOOM_FACTOR)
  let zoomAccumulator = 0

  function spanForAccumulator(accumulator) {
    return MAX_LOG_SPAN * Math.pow(ZOOM_FACTOR, -accumulator / 100)
  }

  function xForFreq(freq) {
    const logMin = Math.log2(viewMinFreq)
    const logMax = Math.log2(viewMaxFreq)
    return ((Math.log2(freq) - logMin) / (logMax - logMin)) * canvas.width
  }

  function freqForX(x) {
    const logMin = Math.log2(viewMinFreq)
    const logMax = Math.log2(viewMaxFreq)
    return Math.pow(2, logMin + (x / canvas.width) * (logMax - logMin))
  }

  function zoomAt(cursorX, deltaY) {
    const anchorFreq = freqForX(cursorX)
    const logMin = Math.log2(viewMinFreq)
    const logMax = Math.log2(viewMaxFreq)
    const logAnchor = Math.log2(anchorFreq)
    const oldSpan = logMax - logMin
    const anchorFrac = (logAnchor - logMin) / oldSpan

    zoomAccumulator = Math.min(MAX_ZOOM_ACCUMULATOR, Math.max(0, zoomAccumulator - deltaY))
    const newSpan = spanForAccumulator(zoomAccumulator)

    let newLogMin = logAnchor - anchorFrac * newSpan
    let newLogMax = newLogMin + newSpan

    const fullLogMin = Math.log2(MIN_FREQ)
    const fullLogMax = Math.log2(MAX_FREQ)
    if (newLogMin < fullLogMin) {
      newLogMin = fullLogMin
      newLogMax = newLogMin + newSpan
    }
    if (newLogMax > fullLogMax) {
      newLogMax = fullLogMax
      newLogMin = newLogMax - newSpan
    }

    viewMinFreq = Math.pow(2, newLogMin)
    viewMaxFreq = Math.pow(2, newLogMax)
  }

  function pan(direction) {
    const logMin = Math.log2(viewMinFreq)
    const logMax = Math.log2(viewMaxFreq)
    const span = logMax - logMin
    const shift = span * PAN_FRACTION * direction

    let newLogMin = logMin + shift
    let newLogMax = logMax + shift

    const fullLogMin = Math.log2(MIN_FREQ)
    const fullLogMax = Math.log2(MAX_FREQ)
    if (newLogMin < fullLogMin) {
      newLogMin = fullLogMin
      newLogMax = newLogMin + span
    }
    if (newLogMax > fullLogMax) {
      newLogMax = fullLogMax
      newLogMin = newLogMax - span
    }

    viewMinFreq = Math.pow(2, newLogMin)
    viewMaxFreq = Math.pow(2, newLogMax)
  }

  let draggingBandIndex = null
  let qAccumulators = filters.map((f) => accumulatorForQ(f.Q.value))

  function dotPosition(index) {
    return { x: xForFreq(filters[index].frequency.value), y: gainToY(filters[index].gain.value, canvas.height) }
  }

  function findNearDotIndex(x, y) {
    for (let i = 0; i < filters.length; i++) {
      const dot = dotPosition(i)
      if (isNearDot(x, y, dot.x, dot.y, EQ_HIT_RADIUS)) return i
    }
    return null
  }

  function eventCanvasPos(e) {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  canvas.addEventListener('mousedown', (e) => {
    const { x, y } = eventCanvasPos(e)
    draggingBandIndex = findNearDotIndex(x, y)
  })

  window.addEventListener('mousemove', (e) => {
    if (draggingBandIndex === null) return
    const { x, y } = eventCanvasPos(e)
    const clampedX = Math.min(canvas.width, Math.max(0, x))
    filters[draggingBandIndex].frequency.value = freqForX(clampedX)
    filters[draggingBandIndex].gain.value = yToGain(y, canvas.height)
    onEqChange?.()
    if (!animationFrame) render()
  })

  window.addEventListener('mouseup', () => {
    draggingBandIndex = null
  })

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const { x: cursorX, y: cursorY } = eventCanvasPos(e)
      const hoveredIndex = findNearDotIndex(cursorX, cursorY)
      if (hoveredIndex !== null && BAND_TYPES[hoveredIndex] === 'peaking') {
        qAccumulators[hoveredIndex] = updateQAccumulator(qAccumulators[hoveredIndex], e.deltaY)
        filters[hoveredIndex].Q.value = qForAccumulator(qAccumulators[hoveredIndex])
        onEqChange?.()
      } else if (e.shiftKey) {
        pan(e.deltaY > 0 ? 1 : -1)
      } else {
        zoomAt(cursorX, e.deltaY)
      }
      if (!animationFrame) render()
    },
    { passive: false },
  )

  function labelStep() {
    const spanSemitones = midiFromFrequency(viewMaxFreq) - midiFromFrequency(viewMinFreq)
    const desiredLabels = canvas.width / 50
    return Math.max(1, Math.round(spanSemitones / desiredLabels))
  }

  function render() {
    analyser.getByteFrequencyData(freqData)

    ctx.fillStyle = BACKGROUND_COLOR
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const buckets = computeNoteBuckets(freqData, binHz, viewMinFreq, viewMaxFreq)
    const peakMidis = new Set(computePeakMidis(buckets, PEAK_THRESHOLD))
    for (const bucket of buckets) {
      const x1 = xForFreq(bucket.lowFreq)
      const x2 = xForFreq(bucket.highFreq)
      const barHeight = (bucket.value / 255) * canvas.height
      const barWidth = Math.max(0, x2 - x1 - 1)
      const isPeak = peakMidis.has(bucket.midi)
      ctx.fillStyle = isPeak ? PEAK_COLOR : BAR_COLOR
      ctx.fillRect(x1, canvas.height - barHeight, barWidth, barHeight)
      if (isPeak) {
        ctx.font = 'bold 12px sans-serif'
        ctx.textAlign = 'center'
        const labelY = Math.max(12, canvas.height - barHeight - 4)
        ctx.fillText(noteNameFromMidi(bucket.midi), (x1 + x2) / 2, labelY)
      }
    }

    ctx.fillStyle = LABEL_COLOR
    ctx.font = '13px sans-serif'
    ctx.textAlign = 'center'
    const step = labelStep()
    const minMidi = Math.ceil(midiFromFrequency(viewMinFreq))
    const maxMidi = Math.floor(midiFromFrequency(viewMaxFreq))
    for (let midi = minMidi; midi <= maxMidi; midi += step) {
      const freq = 440 * Math.pow(2, (midi - 69) / 12)
      const x = xForFreq(freq)
      ctx.fillText(frequencyToNoteName(freq), x, canvas.height - 2)
    }

    ctx.strokeStyle = EQ_COLOR
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let x = 0; x <= canvas.width; x += 2) {
      const freq = freqForX(x)
      const responseDb = filters.reduce(
        (sum, f, i) => sum + responseDbForBand(i, freq, f, audioCtx.sampleRate),
        0,
      )
      const y = gainToY(responseDb, canvas.height)
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    filters.forEach((f, i) => {
      const dotX = xForFreq(f.frequency.value)
      const dotY = gainToY(f.gain.value, canvas.height)
      ctx.fillStyle = EQ_BAND_COLORS[i]
      ctx.beginPath()
      ctx.arc(dotX, dotY, 5, 0, 2 * Math.PI)
      ctx.fill()
    })
  }

  function draw() {
    render()
    animationFrame = requestAnimationFrame(draw)
  }

  function start() {
    if (audioCtx.state === 'suspended') audioCtx.resume()
    if (!animationFrame) draw()
  }

  function stop() {
    if (animationFrame) cancelAnimationFrame(animationFrame)
    animationFrame = null
    // Without this, the AudioContext keeps running (and the analyser keeps
    // smoothing its output toward silence) even while playback is paused,
    // since nothing else ever suspends it - each repaint after a pause would
    // reveal a slightly more decayed frame than the last, making bars look
    // like they shrink over time whenever paused, regardless of the cause
    // of the repaint (e.g. zooming).
    audioCtx.suspend()
  }

  function getEqState() {
    return filters.map((f) => ({ freq: f.frequency.value, gain: f.gain.value, q: f.Q.value }))
  }

  function setEqState(bands) {
    bands.forEach((band, i) => {
      filters[i].frequency.value = band.freq
      filters[i].gain.value = clampGain(band.gain)
      qAccumulators[i] = accumulatorForQ(band.q)
      filters[i].Q.value = qForAccumulator(qAccumulators[i])
    })
    if (!animationFrame) render()
  }

  render()

  return { start, stop, getEqState, setEqState }
}
