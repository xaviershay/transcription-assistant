import { frequencyToNoteName } from './notes.js'

const MIN_FREQ = 27.5 // A0
const MAX_FREQ = 4186 // C8
const LOG_MIN = Math.log2(MIN_FREQ)
const LOG_MAX = Math.log2(MAX_FREQ)

export function createSpectrumAnalyser(wavesurfer, canvas) {
  const audioCtx = new AudioContext()
  const source = audioCtx.createMediaElementSource(wavesurfer.getMediaElement())
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 8192
  source.connect(analyser)
  analyser.connect(audioCtx.destination)

  const freqData = new Uint8Array(analyser.frequencyBinCount)
  const ctx = canvas.getContext('2d')
  const binHz = audioCtx.sampleRate / analyser.fftSize

  let animationFrame = null

  function xForFreq(freq) {
    return ((Math.log2(freq) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * canvas.width
  }

  function draw() {
    analyser.getByteFrequencyData(freqData)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    ctx.fillStyle = '#4f6df5'
    for (let i = 0; i < freqData.length; i++) {
      const freq = i * binHz
      if (freq < MIN_FREQ || freq > MAX_FREQ) continue
      const x = xForFreq(freq)
      const barHeight = (freqData[i] / 255) * canvas.height
      ctx.fillRect(x, canvas.height - barHeight, 2, barHeight)
    }

    ctx.fillStyle = '#e0e0e0'
    ctx.font = '10px sans-serif'
    for (let midi = 21; midi <= 108; midi += 3) {
      const freq = 440 * Math.pow(2, (midi - 69) / 12)
      const x = xForFreq(freq)
      ctx.fillText(frequencyToNoteName(freq), x, canvas.height - 2)
    }

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

  return { start, stop }
}
