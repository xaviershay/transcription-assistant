import { frequencyToNoteName, midiFromFrequency } from './notes.js'
import { gainToY, peakingResponseDb } from './eq.js'

const MIN_FREQ = 27.5 // A0
const MAX_FREQ = 4186 // C8
const MIN_SPAN_SEMITONES = 2
const ZOOM_FACTOR = 1.15
const PAN_FRACTION = 0.15
const BACKGROUND_COLOR = '#121212'
const LABEL_COLOR = '#f0f0f0'
const BAR_COLOR = '#4f6df5'
const EQ_COLOR = '#f5a64f'

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
  const filter = audioCtx.createBiquadFilter()
  filter.type = 'peaking'
  filter.frequency.value = 1000
  filter.gain.value = 0
  filter.Q.value = 1
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 8192
  source.connect(filter)
  filter.connect(analyser)
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

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      if (e.shiftKey) {
        pan(e.deltaY > 0 ? 1 : -1)
      } else {
        const rect = canvas.getBoundingClientRect()
        const cursorX = ((e.clientX - rect.left) / rect.width) * canvas.width
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

    ctx.fillStyle = BAR_COLOR
    for (let i = 0; i < freqData.length; i++) {
      const freq = i * binHz
      if (freq < viewMinFreq || freq > viewMaxFreq) continue
      const x = xForFreq(freq)
      const barHeight = (freqData[i] / 255) * canvas.height
      ctx.fillRect(x, canvas.height - barHeight, 2, barHeight)
    }

    ctx.fillStyle = LABEL_COLOR
    ctx.font = '13px sans-serif'
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
      const responseDb = peakingResponseDb(freq, filter.frequency.value, filter.gain.value, filter.Q.value, audioCtx.sampleRate)
      const y = gainToY(responseDb, canvas.height)
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    const dotX = xForFreq(filter.frequency.value)
    const dotY = gainToY(filter.gain.value, canvas.height)
    ctx.fillStyle = EQ_COLOR
    ctx.beginPath()
    ctx.arc(dotX, dotY, 5, 0, 2 * Math.PI)
    ctx.fill()
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
    return { freq: filter.frequency.value, gain: filter.gain.value, q: filter.Q.value }
  }

  function setEqState({ freq, gain, q }) {
    filter.frequency.value = freq
    filter.gain.value = gain
    filter.Q.value = q
  }

  render()

  return { start, stop, getEqState, setEqState }
}
