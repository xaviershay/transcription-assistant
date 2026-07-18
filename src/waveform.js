import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import TimelinePlugin from 'wavesurfer.js/plugins/timeline'

export function createWaveSurfer(container) {
  const regions = RegionsPlugin.create()
  const timeline = TimelinePlugin.create({
    height: 20,
    style: { color: '#e6e6e6', fontSize: '10px' },
  })

  const wavesurfer = WaveSurfer.create({
    container,
    waveColor: '#4f6df5',
    progressColor: '#8ea0ff',
    cursorColor: 'currentColor',
    height: 120,
    minPxPerSec: 50,
    plugins: [regions, timeline],
  })

  return { wavesurfer, regions }
}
