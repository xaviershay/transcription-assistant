const CURRENT_KEY = 'current'

export async function saveCurrentAudio(store, blob, label) {
  await store.put(CURRENT_KEY, { blob, label, storedAt: Date.now() })
}

export async function loadCurrentAudio(store) {
  return store.get(CURRENT_KEY)
}
