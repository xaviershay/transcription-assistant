const DISMISS_DELAY_MS = 5000

let toastEl = null
let dismissTimer = null

function getToastEl() {
  if (!toastEl) {
    toastEl = document.getElementById('toast')
    toastEl?.addEventListener('click', hideToast)
  }
  return toastEl
}

function hideToast() {
  clearTimeout(dismissTimer)
  dismissTimer = null
  const el = getToastEl()
  if (el) el.hidden = true
}

export function showToast(message) {
  const el = getToastEl()
  if (!el) return
  el.textContent = message
  el.hidden = false
  clearTimeout(dismissTimer)
  dismissTimer = setTimeout(hideToast, DISMISS_DELAY_MS)
}
