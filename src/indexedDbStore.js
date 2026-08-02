function openDb(dbName, storeName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function createIndexedDbStore(dbName = 'ear-transcriber', storeName = 'audio', onError) {
  let dbPromise = null
  function getDb() {
    if (!dbPromise) dbPromise = openDb(dbName, storeName)
    return dbPromise
  }

  return {
    async get(key) {
      try {
        const db = await getDb()
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readonly')
          const request = tx.objectStore(storeName).get(key)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      } catch (err) {
        try {
          onError?.(err)
        } catch {
          // notification must never break the store's best-effort guarantee
        }
        return undefined
      }
    },

    async put(key, value) {
      try {
        const db = await getDb()
        await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite')
          tx.objectStore(storeName).put(value, key)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      } catch (err) {
        try {
          onError?.(err)
        } catch {
          // notification must never break the store's best-effort guarantee
        }
        // best-effort; save failures must never break the app
      }
    },
  }
}
