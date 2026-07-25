export const MIN_GAIN = -24
export const MAX_GAIN = 24

export function clampGain(gainDb) {
  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, gainDb))
}

export function gainToY(gainDb, canvasHeight) {
  const half = canvasHeight / 2
  return half - (clampGain(gainDb) / MAX_GAIN) * half
}

export function yToGain(y, canvasHeight) {
  const half = canvasHeight / 2
  return clampGain(((half - y) / half) * MAX_GAIN)
}

export const MIN_Q = 0.1
export const MAX_Q = 24
export const DEFAULT_Q = 1
const Q_ZOOM_FACTOR = 1.15
const MAX_Q_ACCUMULATOR = (100 * Math.log(MAX_Q / MIN_Q)) / Math.log(Q_ZOOM_FACTOR)

export function accumulatorForQ(q) {
  const clamped = Math.min(MAX_Q, Math.max(MIN_Q, q))
  return (100 * Math.log(clamped / MIN_Q)) / Math.log(Q_ZOOM_FACTOR)
}

export function qForAccumulator(accumulator) {
  const clamped = Math.min(MAX_Q_ACCUMULATOR, Math.max(0, accumulator))
  return MIN_Q * Math.pow(Q_ZOOM_FACTOR, clamped / 100)
}

export function updateQAccumulator(accumulator, deltaY) {
  return Math.min(MAX_Q_ACCUMULATOR, Math.max(0, accumulator - deltaY))
}

export function peakingResponseDb(freq, centerFreq, gainDb, q, sampleRate) {
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * centerFreq) / sampleRate
  const alpha = Math.sin(w0) / (2 * q)
  const cosw0 = Math.cos(w0)

  const b0 = 1 + alpha * A
  const b1 = -2 * cosw0
  const b2 = 1 - alpha * A
  const a0 = 1 + alpha / A
  const a1 = -2 * cosw0
  const a2 = 1 - alpha / A

  const w = (2 * Math.PI * freq) / sampleRate
  const cosW = Math.cos(w)
  const sinW = Math.sin(w)
  const cos2W = Math.cos(2 * w)
  const sin2W = Math.sin(2 * w)

  const numRe = b0 + b1 * cosW + b2 * cos2W
  const numIm = -(b1 * sinW + b2 * sin2W)
  const denRe = a0 + a1 * cosW + a2 * cos2W
  const denIm = -(a1 * sinW + a2 * sin2W)

  const numMag = Math.sqrt(numRe * numRe + numIm * numIm)
  const denMag = Math.sqrt(denRe * denRe + denIm * denIm)

  return 20 * Math.log10(numMag / denMag)
}

export function isNearDot(cursorX, cursorY, dotX, dotY, hitRadius) {
  const dx = cursorX - dotX
  const dy = cursorY - dotY
  return dx * dx + dy * dy <= hitRadius * hitRadius
}
