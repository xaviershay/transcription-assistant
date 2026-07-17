import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'

export function createWaveSurfer(container) {
  const regions = RegionsPlugin.create()

  const wavesurfer = WaveSurfer.create({
    container,
    waveColor: '#4f6df5',
    progressColor: '#2c3e91',
    cursorColor: '#333',
    height: 120,
    minPxPerSec: 50,
    plugins: [regions],
  })

  return { wavesurfer, regions }
}
