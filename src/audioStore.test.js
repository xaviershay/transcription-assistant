import { describe, it, expect } from 'vitest'
import { saveCurrentAudio, loadCurrentAudio } from './audioStore.js'

function createMemoryStore() {
  const map = new Map()
  return {
    get: async (key) => map.get(key),
    put: async (key, value) => {
      map.set(key, value)
    },
  }
}

describe('saveCurrentAudio / loadCurrentAudio', () => {
  it('returns undefined when nothing has been saved', async () => {
    const store = createMemoryStore()
    expect(await loadCurrentAudio(store)).toBeUndefined()
  })

  it('round-trips a saved blob and label', async () => {
    const store = createMemoryStore()
    const blob = new Blob(['fake audio bytes'])
    await saveCurrentAudio(store, blob, 'my-file.mp3')
    const loaded = await loadCurrentAudio(store)
    expect(loaded.blob).toBe(blob)
    expect(loaded.label).toBe('my-file.mp3')
    expect(typeof loaded.storedAt).toBe('number')
  })

  it('overwrites the prior save', async () => {
    const store = createMemoryStore()
    await saveCurrentAudio(store, new Blob(['first']), 'first.mp3')
    const secondBlob = new Blob(['second'])
    await saveCurrentAudio(store, secondBlob, 'second.mp3')
    const loaded = await loadCurrentAudio(store)
    expect(loaded.blob).toBe(secondBlob)
    expect(loaded.label).toBe('second.mp3')
  })
})
