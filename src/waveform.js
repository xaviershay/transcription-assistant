import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import SpectrogramPlugin from 'wavesurfer.js/plugins/spectrogram'

export function createWaveSurfer(container, spectrogramContainer) {
  const regions = RegionsPlugin.create()
  const spectrogram = SpectrogramPlugin.create({
    container: spectrogramContainer,
    height: 200,
    labels: true,
    scale: 'logarithmic',
    frequencyMin: 27.5,
    frequencyMax: 4186,
    colorMap: 'roseus',
    useWebWorker: true,
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
