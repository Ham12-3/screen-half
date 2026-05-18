import { startRecorder, type ActiveRecorder } from './recorder'

export interface WebcamSelection {
  videoDeviceId?: string
  audioDeviceId?: string
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))

/**
 * Capture webcam video + mic audio. External webcams often refuse the
 * first request (device momentarily busy after enumeration, or it can't
 * start at the requested resolution/fps) and throw NotReadableError. So
 * try progressively looser constraints, with one retry for transient
 * "device busy" states, instead of giving up on the first failure.
 * Audio rides in the webcam file and is muxed onto the video at export.
 */
export async function captureWebcam(
  sel: WebcamSelection
): Promise<MediaStream> {
  const audio: MediaTrackConstraints | boolean = sel.audioDeviceId
    ? { deviceId: { exact: sel.audioDeviceId } }
    : true
  const vid = sel.videoDeviceId
    ? { deviceId: { exact: sel.videoDeviceId } }
    : {}

  const attempts: MediaStreamConstraints[] = [
    {
      video: {
        ...vid,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      },
      audio
    },
    // Drop resolution/fps — many external cams can't start at 720p30.
    { video: { ...vid }, audio },
    // Last resort: let the browser pick any camera/mic.
    { video: true, audio: true }
  ]

  let lastErr: unknown
  for (let i = 0; i < attempts.length; i++) {
    for (let tryNo = 0; tryNo < 2; tryNo++) {
      try {
        return await navigator.mediaDevices.getUserMedia(attempts[i])
      } catch (e) {
        lastErr = e
        const name = (e as DOMException)?.name
        // Retry once after a short wait only for transient busy errors.
        if (
          tryNo === 0 &&
          (name === 'NotReadableError' || name === 'AbortError')
        ) {
          await sleep(400)
          continue
        }
        break
      }
    }
  }
  throw lastErr
}

export function recordWebcam(
  stream: MediaStream,
  onChunk: (chunk: ArrayBuffer) => Promise<void>
): ActiveRecorder {
  return startRecorder(
    stream,
    [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ],
    6_000_000,
    onChunk
  )
}

export async function listDevices(): Promise<{
  cameras: MediaDeviceInfo[]
  mics: MediaDeviceInfo[]
}> {
  const all = await navigator.mediaDevices.enumerateDevices()
  return {
    cameras: all.filter((d) => d.kind === 'videoinput'),
    mics: all.filter((d) => d.kind === 'audioinput')
  }
}
