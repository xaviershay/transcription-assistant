import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import SpectrogramPlugin from 'wavesurfer.js/plugins/spectrogram'
import { MIN_FREQ, MAX_FREQ } from './spectrum.js'

export function createWaveSurfer(container, spectrogramContainer) {
  const regions = RegionsPlugin.create()
  const spectrogram = SpectrogramPlugin.create({
    container: spectrogramContainer,
    height: 200,
    labels: true,
    scale: 'logarithmic',
    frequencyMin: MIN_FREQ,
    frequencyMax: MAX_FREQ,
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
