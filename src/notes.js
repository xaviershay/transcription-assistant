const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function midiFromFrequency(freq) {
  return 69 + 12 * Math.log2(freq / 440)
}

export function frequencyFromMidi(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function noteNameFromMidi(midi) {
  const rounded = Math.round(midi)
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12]
  const octave = Math.floor(rounded / 12) - 1
  return `${name}${octave}`
}

export function frequencyToNoteName(freq) {
  return noteNameFromMidi(midiFromFrequency(freq))
}
