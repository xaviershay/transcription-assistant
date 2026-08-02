import { frequencyFromMidi, labelStep, midiFromFrequency, noteNameFromMidi } from './notes.js'

export function yForFrequency(freq, minFreq, maxFreq, heightPx) {
  const logMin = Math.log2(minFreq)
  const logMax = Math.log2(maxFreq)
  return heightPx - ((Math.log2(freq) - logMin) / (logMax - logMin)) * heightPx
}

export function computeSpectrogramLabels(minFreq, maxFreq, heightPx) {
  const minMidi = Math.ceil(midiFromFrequency(minFreq))
  const maxMidi = Math.floor(midiFromFrequency(maxFreq))
  const step = labelStep(maxMidi - minMidi, heightPx)

  const labels = []
  for (let midi = minMidi; midi <= maxMidi; midi += step) {
    const freq = frequencyFromMidi(midi)
    labels.push({ y: yForFrequency(freq, minFreq, maxFreq, heightPx), text: noteNameFromMidi(midi) })
  }
  return labels
}

export function drawSpectrogramLabels(canvas, minFreq, maxFreq) {
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#121212'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#f0f0f0'
  ctx.font = '13px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const { y, text } of computeSpectrogramLabels(minFreq, maxFreq, canvas.height)) {
    ctx.fillText(text, canvas.width - 4, y)
  }
}
