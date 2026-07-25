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
