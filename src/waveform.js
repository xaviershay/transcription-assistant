import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import SpectrogramPlugin from 'wavesurfer.js/plugins/spectrogram'
import { frequencyFromMidi } from './notes.js'

export const SPECTROGRAM_MIN_FREQ = frequencyFromMidi(36) // C2
export const SPECTROGRAM_MAX_FREQ = frequencyFromMidi(72) // C5

export function createWaveSurfer(container, spectrogramContainer) {
  const regions = RegionsPlugin.create()
  const spectrogram = SpectrogramPlugin.create({
    container: spectrogramContainer,
    height: 400,
    labels: false,
    scale: 'logarithmic',
    frequencyMin: SPECTROGRAM_MIN_FREQ,
    frequencyMax: SPECTROGRAM_MAX_FREQ,
    colorMap: 'roseus',
    useWebWorker: true,
    // useWebWorker's whole point is to avoid blocking the main thread on long
    // tracks - the plugin's default fallbackToMainThread (true) would silently
    // redo the FFT on the main thread (with just a console.warn) if the worker
    // fails or times out, defeating that and swallowing the failure so the
    // 'error' handler below never fires for it.
    fallbackToMainThread: false,
  })

  const wavesurfer = WaveSurfer.create({
    container,
    waveColor: '#4f6df5',
    progressColor: '#8ea0ff',
    cursorColor: 'currentColor',
    height: 120,
    minPxPerSec: 50,
    sampleRate: 44100,
    plugins: [regions, spectrogram],
  })

  return { wavesurfer, regions, spectrogram }
}
