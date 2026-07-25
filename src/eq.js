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
