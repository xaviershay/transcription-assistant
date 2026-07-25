export function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function computeFileHash(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer)
  return bufferToHex(digest)
}

function storageKey(hash) {
  return `ear-transcriber:settings:${hash}`
}

const DEFAULT_EQ = { eqFreq: 1000, eqGain: 0, eqQ: 1 }

export function loadSettings(storage, hash) {
  const raw = storage.getItem(storageKey(hash))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (
      typeof parsed.bpm !== 'number' ||
      typeof parsed.subdivisions !== 'number' ||
      typeof parsed.offset !== 'number' ||
      typeof parsed.volume !== 'number'
    ) {
      return null
    }
    return {
      ...parsed,
      eqFreq: typeof parsed.eqFreq === 'number' ? parsed.eqFreq : DEFAULT_EQ.eqFreq,
      eqGain: typeof parsed.eqGain === 'number' ? parsed.eqGain : DEFAULT_EQ.eqGain,
      eqQ: typeof parsed.eqQ === 'number' ? parsed.eqQ : DEFAULT_EQ.eqQ,
    }
  } catch {
    return null
  }
}

export function saveSettings(storage, hash, settings) {
  storage.setItem(storageKey(hash), JSON.stringify(settings))
}
