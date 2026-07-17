import './style.css'
import { createWaveSurfer } from './waveform.js'
import { createSpectrumAnalyser } from './spectrum.js'
import { sortRegionsByStart, getAdjacentRegionId } from './selections.js'
import { renderSelectionsList } from './selectionsList.js'

const uploadInput = document.getElementById('upload')
const uploadError = document.getElementById('upload-error')
const waveformContainer = document.getElementById('waveform')
const playPauseBtn = document.getElementById('play-pause')
const spectrumCanvas = document.getElementById('spectrum')
let spectrumAnalyser = null

const { wavesurfer, regions } = createWaveSurfer(waveformContainer)

wavesurfer.on('error', (error) => {
  uploadError.textContent = `Could not load audio file: ${error.message}`
  uploadError.hidden = false
  playPauseBtn.disabled = true
})

wavesurfer.on('ready', () => {
  uploadError.hidden = true
  playPauseBtn.disabled = false
  if (!spectrumAnalyser) {
    spectrumAnalyser = createSpectrumAnalyser(wavesurfer, spectrumCanvas)
  }
})

uploadInput.addEventListener('change', () => {
  const file = uploadInput.files[0]
  if (!file) return
  uploadError.hidden = true
  wavesurfer.loadBlob(file)
})

const ZOOM_FACTOR = 1.2
const MIN_PX_PER_SEC = 10
const MAX_PX_PER_SEC = 1000
let currentPxPerSec = 50

waveformContainer.addEventListener(
  'wheel',
  (e) => {
    if (e.shiftKey) return // let native horizontal scroll handle panning
    e.preventDefault()
    currentPxPerSec =
      e.deltaY < 0
        ? Math.min(MAX_PX_PER_SEC, currentPxPerSec * ZOOM_FACTOR)
        : Math.max(MIN_PX_PER_SEC, currentPxPerSec / ZOOM_FACTOR)
    wavesurfer.zoom(currentPxPerSec)
  },
  { passive: false },
)

const speedInput = document.getElementById('speed')
const speedLabel = document.getElementById('speed-label')

playPauseBtn.addEventListener('click', () => {
  wavesurfer.playPause()
})

wavesurfer.on('play', () => {
  playPauseBtn.textContent = 'Pause'
  spectrumAnalyser?.start()
})

wavesurfer.on('pause', () => {
  playPauseBtn.textContent = 'Play'
  spectrumAnalyser?.stop()
})

speedInput.addEventListener('input', () => {
  const rate = Number(speedInput.value)
  wavesurfer.setPlaybackRate(rate, true)
  speedLabel.textContent = `${rate.toFixed(2)}x`
})

const selectionsListEl = document.getElementById('selections-list')
const activeLabel = document.getElementById('active-label')

let activeRegionId = null

function refreshSelectionsList() {
  const sorted = sortRegionsByStart(regions.getRegions())
  renderSelectionsList(selectionsListEl, sorted, activeRegionId, {
    onActivate: activateRegion,
    onDelete: (id) => {
      const region = regions.getRegions().find((r) => r.id === id)
      if (region) region.remove()
    },
  })
}

function activateRegion(id) {
  const region = regions.getRegions().find((r) => r.id === id)
  if (!region) return
  activeRegionId = id
  activeLabel.textContent = `Looping: ${region.start.toFixed(2)}s – ${region.end.toFixed(2)}s`
  refreshSelectionsList()
  region.play()
}

regions.enableDragSelection({ color: 'rgba(79, 109, 245, 0.2)' })

regions.on('region-created', () => refreshSelectionsList())

regions.on('region-removed', (region) => {
  if (region.id === activeRegionId) {
    activeRegionId = null
    activeLabel.textContent = ''
  }
  refreshSelectionsList()
})

regions.on('region-clicked', (region, e) => {
  e.stopPropagation()
  activateRegion(region.id)
})

regions.on('region-out', (region) => {
  if (region.id === activeRegionId) {
    region.play()
  }
})

wavesurfer.on('interaction', () => {
  activeRegionId = null
  activeLabel.textContent = ''
  refreshSelectionsList()
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!activeRegionId) return
    const region = regions.getRegions().find((r) => r.id === activeRegionId)
    if (region) region.remove()
    return
  }

  if (e.key === 'Tab') {
    e.preventDefault()
    const sorted = sortRegionsByStart(regions.getRegions())
    const direction = e.shiftKey ? 'prev' : 'next'
    const nextId = getAdjacentRegionId(sorted, activeRegionId, direction)
    if (nextId) activateRegion(nextId)
  }
})
