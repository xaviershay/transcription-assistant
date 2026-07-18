const FFT_SIZE = 2048
const HOP_SIZE = 512
const MIN_ONSET_GAP_SECONDS = 0.06
const MIN_ONSET_START_SECONDS = 0.03
const LOCAL_MEAN_WINDOW_FRAMES = 10
const SILENCE_LOOKAHEAD_FRAMES = 3
const SILENCE_FLOOR_FRACTION = 0.15

export function mixToMono(channelData) {
  if (channelData.length === 1) return channelData[0]
  const length = channelData[0].length
  const mono = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let sum = 0
    for (let ch = 0; ch < channelData.length; ch++) sum += channelData[ch][i]
    mono[i] = sum / channelData.length
  }
  return mono
}

function hannWindow(size) {
  const window = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))
  }
  return window
}

// In-place radix-2 Cooley-Tukey FFT. real/imag are Float64Array of length = power of 2.
function fft(real, imag) {
  const n = real.length
  if (n <= 1) return

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = real[i]
      real[i] = real[j]
      real[j] = tr
      const ti = imag[i]
      imag[i] = imag[j]
      imag[j] = ti
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curWr = 1
      let curWi = 0
      for (let k = 0; k < len / 2; k++) {
        const uRe = real[i + k]
        const uIm = imag[i + k]
        const vRe = real[i + k + len / 2] * curWr - imag[i + k + len / 2] * curWi
        const vIm = real[i + k + len / 2] * curWi + imag[i + k + len / 2] * curWr
        real[i + k] = uRe + vRe
        imag[i + k] = uIm + vIm
        real[i + k + len / 2] = uRe - vRe
        imag[i + k + len / 2] = uIm - vIm
        const nextWr = curWr * wr - curWi * wi
        const nextWi = curWr * wi + curWi * wr
        curWr = nextWr
        curWi = nextWi
      }
    }
  }
}

export function computeSpectralFlux(samples, sampleRate) {
  const window = hannWindow(FFT_SIZE)
  const numFrames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP_SIZE) + 1)
  const flux = new Float32Array(numFrames)
  const energy = new Float32Array(numFrames)
  const prevLogMag = new Float64Array(FFT_SIZE / 2)

  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * HOP_SIZE
    const real = new Float64Array(FFT_SIZE)
    const imag = new Float64Array(FFT_SIZE)
    for (let i = 0; i < FFT_SIZE; i++) {
      real[i] = samples[offset + i] * window[i]
    }
    fft(real, imag)

    let sum = 0
    let energySum = 0
    for (let bin = 0; bin < FFT_SIZE / 2; bin++) {
      const mag = Math.hypot(real[bin], imag[bin])
      energySum += mag * mag
      const logMag = Math.log1p(mag)
      const diff = logMag - prevLogMag[bin]
      if (diff > 0) sum += diff
      prevLogMag[bin] = logMag
    }
    flux[frame] = sum
    energy[frame] = Math.sqrt(energySum)
  }

  return { flux, energy, hopSize: HOP_SIZE, sampleRate }
}

export function pickOnsets(fluxResult, sensitivity) {
  const { flux, energy, hopSize, sampleRate } = fluxResult
  const onsets = []
  const minGapFrames = Math.round((MIN_ONSET_GAP_SECONDS * sampleRate) / hopSize)
  const minStartFrames = Math.round((MIN_ONSET_START_SECONDS * sampleRate) / hopSize)
  let lastOnsetFrame = -Infinity

  for (let i = 1; i < flux.length - 1; i++) {
    if (i < minStartFrames) continue

    const start = Math.max(0, i - LOCAL_MEAN_WINDOW_FRAMES)
    const end = Math.min(flux.length, i + LOCAL_MEAN_WINDOW_FRAMES + 1)
    let localSum = 0
    let localMaxEnergy = 0
    for (let j = start; j < end; j++) {
      localSum += flux[j]
      if (energy[j] > localMaxEnergy) localMaxEnergy = energy[j]
    }
    const localMean = localSum / (end - start)

    const threshold = localMean * (2 / sensitivity)
    const isLocalPeak = flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1]
    const exceedsThreshold = flux[i] > threshold && flux[i] > 0.01

    const lookaheadIdx = Math.min(flux.length - 1, i + SILENCE_LOOKAHEAD_FRAMES)
    const notDecayingToSilence = energy[lookaheadIdx] > localMaxEnergy * SILENCE_FLOOR_FRACTION

    if (isLocalPeak && exceedsThreshold && notDecayingToSilence && i - lastOnsetFrame >= minGapFrames) {
      onsets.push((i * hopSize) / sampleRate)
      lastOnsetFrame = i
    }
  }

  return onsets
}

export function detectOnsets(samples, sampleRate, sensitivity = 1.0) {
  return pickOnsets(computeSpectralFlux(samples, sampleRate), sensitivity)
}
