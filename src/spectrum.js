import { frequencyToNoteName, midiFromFrequency } from './notes.js'

const MIN_FREQ = 27.5 // A0
const MAX_FREQ = 4186 // C8
const MIN_SPAN_SEMITONES = 2
const ZOOM_FACTOR = 1.15
const PAN_FRACTION = 0.15
const BACKGROUND_COLOR = '#121212'
const LABEL_COLOR = '#f0f0f0'
const BAR_COLOR = '#4f6df5'

export function createSpectrumAnalyser(wavesurfer, canvas) {
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
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 8192
  source.connect(analyser)
  analyser.connect(audioCtx.destination)

  const freqData = new Uint8Array(analyser.frequencyBinCount)
  const ctx = canvas.getContext('2d')
  const binHz = audioCtx.sampleRate / analyser.fftSize

  let viewMinFreq = MIN_FREQ
  let viewMaxFreq = MAX_FREQ
  let animationFrame = null

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

  function zoomAt(cursorX, factor) {
    const anchorFreq = freqForX(cursorX)
    const logMin = Math.log2(viewMinFreq)
    const logMax = Math.log2(viewMaxFreq)
    const logAnchor = Math.log2(anchorFreq)
    const oldSpan = logMax - logMin
    const anchorFrac = (logAnchor - logMin) / oldSpan

    const minSpan = MIN_SPAN_SEMITONES / 12
    const maxSpan = Math.log2(MAX_FREQ) - Math.log2(MIN_FREQ)
    const newSpan = Math.min(maxSpan, Math.max(minSpan, oldSpan / factor))

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
        zoomAt(cursorX, e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)
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
  }

  render()

  return { start, stop }
}
