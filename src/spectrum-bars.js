import { midiFromFrequency, frequencyFromMidi } from './notes.js'

export function computeNoteBuckets(freqData, binHz, minFreq, maxFreq) {
  const minMidi = Math.floor(midiFromFrequency(minFreq) - 0.5)
  const maxMidi = Math.ceil(midiFromFrequency(maxFreq) + 0.5)
  const buckets = []

  for (let midi = minMidi; midi <= maxMidi; midi++) {
    const lowFreq = frequencyFromMidi(midi - 0.5)
    const highFreq = frequencyFromMidi(midi + 0.5)
    const startBin = Math.max(0, Math.ceil(lowFreq / binHz))
    const endBin = Math.min(freqData.length - 1, Math.floor(highFreq / binHz))

    let value = 0
    for (let i = startBin; i <= endBin; i++) {
      if (freqData[i] > value) value = freqData[i]
    }

    buckets.push({ midi, lowFreq, highFreq, value })
  }

  return buckets
}

export function computePeakMidis(buckets, minMarginAboveAverage) {
  if (buckets.length === 0) return []

  // A bucket must clear this frame's own average by a real margin, not just
  // an absolute floor - "locally highest" alone isn't enough, since a flat or
  // noisy region (common at low frequencies, where coarse FFT resolution
  // means several adjacent semitone buckets read nearly the same
  // insignificant value) can otherwise flag almost every bucket as a "peak"
  // purely from small alternations, with nothing musically significant
  // happening at all.
  const average = buckets.reduce((sum, b) => sum + b.value, 0) / buckets.length
  const requiredValue = average + minMarginAboveAverage

  const peaks = []
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]
    if (b.value < requiredValue) continue
    const prev = buckets[i - 1]
    const next = buckets[i + 1]
    if (prev && b.value < prev.value) continue
    if (next && b.value < next.value) continue
    peaks.push(b.midi)
  }
  return peaks
}
