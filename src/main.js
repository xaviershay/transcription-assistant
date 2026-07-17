import './style.css'
import { createWaveSurfer } from './waveform.js'

const uploadInput = document.getElementById('upload')
const uploadError = document.getElementById('upload-error')
const zoomInput = document.getElementById('zoom')
const waveformContainer = document.getElementById('waveform')
const playPauseBtn = document.getElementById('play-pause')

const { wavesurfer, regions } = createWaveSurfer(waveformContainer)

wavesurfer.on('error', (error) => {
  uploadError.textContent = `Could not load audio file: ${error.message}`
  uploadError.hidden = false
  playPauseBtn.disabled = true
})

wavesurfer.on('ready', () => {
  uploadError.hidden = true
  playPauseBtn.disabled = false
})

uploadInput.addEventListener('change', () => {
  const file = uploadInput.files[0]
  if (!file) return
  uploadError.hidden = true
  wavesurfer.loadBlob(file)
})

zoomInput.addEventListener('input', () => {
  wavesurfer.zoom(Number(zoomInput.value))
})

const speedInput = document.getElementById('speed')
const speedLabel = document.getElementById('speed-label')

playPauseBtn.addEventListener('click', () => {
  wavesurfer.playPause()
})

wavesurfer.on('play', () => {
  playPauseBtn.textContent = 'Pause'
})

wavesurfer.on('pause', () => {
  playPauseBtn.textContent = 'Play'
})

speedInput.addEventListener('input', () => {
  const rate = Number(speedInput.value)
  wavesurfer.setPlaybackRate(rate, true)
  speedLabel.textContent = `${rate.toFixed(2)}x`
})
