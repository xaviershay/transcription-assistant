import './style.css'
import { createWaveSurfer } from './waveform.js'
import TimelinePlugin from 'wavesurfer.js/plugins/timeline'
import { createSpectrumAnalyser } from './spectrum.js'
import { sortRegionsByStart, getAdjacentRegionId } from './selections.js'
import { renderSelectionsList } from './selectionsList.js'
import { mixToMono, computeSpectralFlux, pickOnsets } from './onsets.js'
import { computePeakGain, applyGain, encodeWav } from './normalize.js'
import { computeFileHash, loadSettings, saveSettings } from './persistence.js'
import { saveCurrentAudio, loadCurrentAudio } from './audioStore.js'
import { createIndexedDbStore } from './indexedDbStore.js'
import { isRecordingSupported, formatRecordingLabel, startRecording } from './recording.js'
import { defaultEqBands } from './eq.js'

const uploadInput = document.getElementById('upload')
const uploadError = document.getElementById('upload-error')
const uploadFilename = document.getElementById('upload-filename')
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
    spectrumAnalyser = createSpectrumAnalyser(wavesurfer, spectrumCanvas, { onEqChange: scheduleEqSave })
  }
  spectrumAnalyser.setEqState(pendingEqSettings)
})

async function normalizeAudio(arrayBuffer) {
  const audioCtx = new AudioContext()
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
    const channelData = []
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      channelData.push(audioBuffer.getChannelData(ch))
    }
    const gain = computePeakGain(channelData)
    const normalized = applyGain(channelData, gain)
    const wavBuffer = encodeWav(normalized, audioBuffer.sampleRate)
    return new Blob([wavBuffer], { type: 'audio/wav' })
  } finally {
    audioCtx.close()
  }
}

const DEFAULT_SETTINGS = { bpm: 120, subdivisions: 4, offset: 0, volume: 1, eqBands: defaultEqBands() }

let currentFileHash = null
let pendingEqSettings = DEFAULT_SETTINGS.eqBands

function applySettings(settings) {
  beatBpm = settings.bpm
  beatSubdivisions = settings.subdivisions
  beatOffset = settings.offset
  tempoSlider.value = String(beatBpm)
  tempoLabel.textContent = `${beatBpm} BPM`
  subdivisionsSlider.value = String(beatSubdivisions)
  subdivisionsLabel.textContent = String(beatSubdivisions)
  volumeInput.value = String(settings.volume)
  volumeLabel.textContent = `${Math.round(settings.volume * 100)}%`
  wavesurfer.setVolume(settings.volume)
  rebuildTimeline()
  pendingEqSettings = settings.eqBands
}

let eqSaveDebounceTimer = null

function scheduleEqSave() {
  clearTimeout(eqSaveDebounceTimer)
  eqSaveDebounceTimer = setTimeout(saveCurrentSettings, 60)
}

function saveCurrentSettings() {
  if (!currentFileHash) return
  const eqBands = spectrumAnalyser ? spectrumAnalyser.getEqState() : pendingEqSettings
  saveSettings(localStorage, currentFileHash, {
    bpm: beatBpm,
    subdivisions: beatSubdivisions,
    offset: beatOffset,
    volume: Number(volumeInput.value),
    eqBands,
  })
}

const dbStore = createIndexedDbStore()

async function loadAudio(blob, label) {
  uploadError.hidden = true
  uploadFilename.textContent = label

  const arrayBuffer = await blob.arrayBuffer()
  currentFileHash = await computeFileHash(arrayBuffer)
  applySettings(loadSettings(localStorage, currentFileHash) ?? DEFAULT_SETTINGS)

  try {
    const normalizedBlob = await normalizeAudio(arrayBuffer)
    wavesurfer.loadBlob(normalizedBlob)
  } catch {
    wavesurfer.loadBlob(blob)
  }
}

uploadInput.addEventListener('change', async () => {
  const file = uploadInput.files[0]
  if (!file) return
  await loadAudio(file, file.name)
  saveCurrentAudio(dbStore, file, file.name)
})

;(async () => {
  const stored = await loadCurrentAudio(dbStore)
  if (stored) {
    await loadAudio(stored.blob, stored.label)
  }
})()

const recordBtn = document.getElementById('record-btn')
let activeRecording = null
let recordingTimer = null
let recordingBusy = false

if (!isRecordingSupported()) {
  recordBtn.disabled = true
  recordBtn.title = 'Recording tab/system audio is not supported in this browser.'
}

function formatElapsed(startedAt) {
  const elapsed = Math.floor((Date.now() - startedAt) / 1000)
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

async function stopActiveRecording() {
  const recording = activeRecording
  activeRecording = null
  clearInterval(recordingTimer)
  recordBtn.textContent = 'Record'

  try {
    const blob = await recording.stop()
    const label = formatRecordingLabel()
    await loadAudio(blob, label)
    saveCurrentAudio(dbStore, blob, label)
  } catch (err) {
    uploadError.textContent = err.message
    uploadError.hidden = false
  } finally {
    recordingBusy = false
  }
}

recordBtn.addEventListener('click', async () => {
  if (recordingBusy) return

  if (activeRecording) {
    recordingBusy = true
    await stopActiveRecording()
    return
  }

  recordingBusy = true
  let recording
  try {
    recording = await startRecording()
  } catch (err) {
    recordingBusy = false
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') return
    uploadError.textContent = err.message
    uploadError.hidden = false
    return
  }
  recordingBusy = false

  activeRecording = recording
  const startedAt = Date.now()
  recordBtn.textContent = `Stop (${formatElapsed(startedAt)})`
  recordingTimer = setInterval(() => {
    recordBtn.textContent = `Stop (${formatElapsed(startedAt)})`
  }, 1000)
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

const tempoSlider = document.getElementById('tempo')
const tempoLabel = document.getElementById('tempo-label')
const subdivisionsSlider = document.getElementById('subdivisions')
const subdivisionsLabel = document.getElementById('subdivisions-label')
const setBeatOneBtn = document.getElementById('set-beat-one')

let beatBpm = Number(tempoSlider.value)
let beatSubdivisions = Number(subdivisionsSlider.value)
let beatOffset = 0
let settingBeatOne = false
let timelinePlugin = null

function rebuildTimeline() {
  if (timelinePlugin) {
    wavesurfer.unregisterPlugin(timelinePlugin)
  }
  const secondsPerBeat = 60 / beatBpm
  timelinePlugin = TimelinePlugin.create({
    height: 20,
    timeInterval: secondsPerBeat / beatSubdivisions,
    // primaryLabelInterval is time-based and rounds the interval to 2 decimal
    // places internally, which drifts out of sync for BPMs whose secondsPerBeat
    // doesn't round cleanly (e.g. 133 BPM = 0.4511...s/beat) - neutralized here
    // (a value no real file duration will reach) in favor of the index-based
    // primaryLabelSpacing below, which counts ticks directly and can't drift.
    primaryLabelInterval: 1e6,
    primaryLabelSpacing: beatSubdivisions,
    timeOffset: beatOffset,
    formatTimeCallback: (t) => String(Math.round(t / secondsPerBeat) + 1),
    style: { color: '#e6e6e6', fontSize: '10px' },
  })
  wavesurfer.registerPlugin(timelinePlugin)
}

rebuildTimeline()

tempoSlider.addEventListener('input', () => {
  beatBpm = Number(tempoSlider.value)
  tempoLabel.textContent = `${beatBpm} BPM`
  rebuildTimeline()
  saveCurrentSettings()
})

subdivisionsSlider.addEventListener('input', () => {
  beatSubdivisions = Number(subdivisionsSlider.value)
  subdivisionsLabel.textContent = String(beatSubdivisions)
  rebuildTimeline()
  saveCurrentSettings()
})

setBeatOneBtn.addEventListener('click', () => {
  settingBeatOne = true
  setBeatOneBtn.textContent = 'Click waveform…'
  setBeatOneBtn.disabled = true
})

const speedInput = document.getElementById('speed')
const speedLabel = document.getElementById('speed-label')
const volumeInput = document.getElementById('volume')
const volumeLabel = document.getElementById('volume-label')

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

volumeInput.addEventListener('input', () => {
  const volume = Number(volumeInput.value)
  wavesurfer.setVolume(volume)
  volumeLabel.textContent = `${Math.round(volume * 100)}%`
  saveCurrentSettings()
})

const selectionsListEl = document.getElementById('selections-list')
const activeLabel = document.getElementById('active-label')
const sensitivitySlider = document.getElementById('onset-sensitivity')
const deleteAllBtn = document.getElementById('delete-all-selections')

function resetOnDoubleClick(slider) {
  slider.addEventListener('dblclick', () => {
    slider.value = slider.defaultValue
    slider.dispatchEvent(new Event('input'))
  })
}

for (const slider of [tempoSlider, subdivisionsSlider, speedInput, volumeInput, sensitivitySlider]) {
  resetOnDoubleClick(slider)
}

let activeRegionId = null

let previewingRegionId = null
let previewFluxResult = null
let previewSliceStart = null
let previewRegionIds = []
let sensitivityDebounceTimer = null

function isPreviewRegion(region) {
  return region.id.startsWith('preview-')
}

function clearPreviewRegions() {
  for (const id of previewRegionIds) {
    const region = regions.getRegions().find((r) => r.id === id)
    if (region) region.remove()
  }
  previewRegionIds = []
}

function renderPreview(sensitivity) {
  clearPreviewRegions()
  const relativeOnsets = pickOnsets(previewFluxResult, sensitivity)
  const parent = regions.getRegions().find((r) => r.id === previewingRegionId)
  if (!parent) return

  const boundaries = [parent.start, ...relativeOnsets.map((t) => previewSliceStart + t), parent.end]
  for (let i = 0; i < boundaries.length - 1; i++) {
    const previewRegion = regions.addRegion({
      id: `preview-${i}`,
      start: boundaries[i],
      end: boundaries[i + 1],
      color: 'rgba(245, 166, 79, 0.45)',
      drag: false,
      resize: false,
    })
    if (previewRegion.element) {
      previewRegion.element.style.borderLeft = '2px solid #f5a64f'
      previewRegion.element.style.borderRight = '2px solid #f5a64f'
      previewRegion.element.style.boxSizing = 'border-box'
    }
    previewRegionIds.push(previewRegion.id)
  }
}

function startSubdivide(regionId) {
  if (previewingRegionId) return
  const region = regions.getRegions().find((r) => r.id === regionId)
  if (!region) return

  const audioBuffer = wavesurfer.getDecodedData()
  if (!audioBuffer) return

  const sampleRate = audioBuffer.sampleRate
  const startSample = Math.floor(region.start * sampleRate)
  const endSample = Math.ceil(region.end * sampleRate)
  const channelData = []
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch).slice(startSample, endSample))
  }
  const mono = mixToMono(channelData)

  previewingRegionId = regionId
  previewFluxResult = computeSpectralFlux(mono, sampleRate)
  previewSliceStart = region.start
  region.setOptions({ color: 'transparent' })

  sensitivitySlider.disabled = false
  renderPreview(Number(sensitivitySlider.value))
  refreshSelectionsList()
}

function endPreview() {
  previewingRegionId = null
  previewFluxResult = null
  previewSliceStart = null
  sensitivitySlider.disabled = true
  refreshSelectionsList()
}

function confirmSubdivide() {
  const parent = regions.getRegions().find((r) => r.id === previewingRegionId)
  const boundaries = previewRegionIds
    .map((id) => regions.getRegions().find((r) => r.id === id))
    .filter(Boolean)
    .map((r) => ({ start: r.start, end: r.end }))

  clearPreviewRegions()
  if (parent) parent.remove()

  for (const { start, end } of boundaries) {
    regions.addRegion({ start, end, color: 'rgba(79, 109, 245, 0.2)' })
  }

  endPreview()
}

function cancelSubdivide() {
  const parent = regions.getRegions().find((r) => r.id === previewingRegionId)
  if (parent) parent.setOptions({ color: 'rgba(79, 109, 245, 0.2)' })
  clearPreviewRegions()
  endPreview()
}

sensitivitySlider.addEventListener('input', () => {
  if (!previewingRegionId) return
  clearTimeout(sensitivityDebounceTimer)
  sensitivityDebounceTimer = setTimeout(() => {
    renderPreview(Number(sensitivitySlider.value))
    refreshSelectionsList()
  }, 60)
})

function refreshSelectionsList() {
  const sorted = sortRegionsByStart(regions.getRegions().filter((r) => !isPreviewRegion(r)))
  renderSelectionsList(selectionsListEl, sorted, activeRegionId, {
    onActivate: activateRegion,
    onDelete: (id) => {
      const region = regions.getRegions().find((r) => r.id === id)
      if (region) region.remove()
    },
    onSubdivide: startSubdivide,
    onConfirmSubdivide: confirmSubdivide,
    onCancelSubdivide: cancelSubdivide,
    previewingId: previewingRegionId,
  })
  deleteAllBtn.disabled = sorted.length === 0
}

deleteAllBtn.addEventListener('click', () => {
  for (const region of regions.getRegions().filter((r) => !isPreviewRegion(r))) {
    region.remove()
  }
})

const resetEqBtn = document.getElementById('reset-eq')

resetEqBtn.addEventListener('click', () => {
  spectrumAnalyser?.setEqState(defaultEqBands())
  saveCurrentSettings()
})

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

wavesurfer.on('interaction', (newTime) => {
  if (settingBeatOne) {
    beatOffset = newTime
    settingBeatOne = false
    setBeatOneBtn.textContent = 'Set Beat 1'
    setBeatOneBtn.disabled = false
    rebuildTimeline()
    saveCurrentSettings()
  }
  activeRegionId = null
  activeLabel.textContent = ''
  refreshSelectionsList()
})

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault()
    wavesurfer.playPause()
    return
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!activeRegionId) return
    const region = regions.getRegions().find((r) => r.id === activeRegionId)
    if (region) region.remove()
    return
  }

  if (e.key === 'Tab') {
    e.preventDefault()
    const sorted = sortRegionsByStart(regions.getRegions().filter((r) => !isPreviewRegion(r)))
    const direction = e.shiftKey ? 'prev' : 'next'
    const nextId = getAdjacentRegionId(sorted, activeRegionId, direction)
    if (nextId) activateRegion(nextId)
  }
})
