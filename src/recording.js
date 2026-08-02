export function isRecordingSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia
}

export function formatRecordingLabel(date = new Date()) {
  const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `Recording — ${datePart}, ${timePart}`
}

export async function startRecording() {
  // Passing `audio: true` (a bare boolean) lets the browser apply its default
  // voice-call audio processing (echo cancellation, noise suppression,
  // auto-gain control) to the captured stream. Those algorithms assume a
  // mic-and-speaker feedback loop - run against music/system audio (which
  // has no such echo to cancel) they produce muffled ("tin can") output and
  // comb-filter-like phasing artifacts as the adaptive filters fight content
  // that isn't actually an echo. Explicitly disabling them is required to
  // get a clean capture of tab/system audio.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  })
  const audioTracks = stream.getAudioTracks()

  if (audioTracks.length === 0) {
    stream.getTracks().forEach((track) => track.stop())
    throw new Error("No audio track — check 'share audio' in the picker.")
  }

  stream.getVideoTracks().forEach((track) => track.stop())

  const audioStream = new MediaStream(audioTracks)
  const chunks = []
  let recorder
  try {
    recorder = new MediaRecorder(audioStream)
  } catch (err) {
    audioTracks.forEach((track) => track.stop())
    throw err
  }
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const stopped = new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }))
  })

  recorder.start()

  return {
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop()
      stream.getTracks().forEach((track) => track.stop())
      return stopped
    },
  }
}
