export function isRecordingSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia
}

export function formatRecordingLabel(date = new Date()) {
  const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `Recording — ${datePart}, ${timePart}`
}

export async function startRecording() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  const audioTracks = stream.getAudioTracks()

  if (audioTracks.length === 0) {
    stream.getTracks().forEach((track) => track.stop())
    throw new Error("No audio track — check 'share audio' in the picker.")
  }

  stream.getVideoTracks().forEach((track) => track.stop())

  const audioStream = new MediaStream(audioTracks)
  const chunks = []
  const recorder = new MediaRecorder(audioStream)
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const stopped = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }))
  })

  recorder.start()

  return {
    stop: () => {
      recorder.stop()
      stream.getTracks().forEach((track) => track.stop())
      return stopped
    },
  }
}
