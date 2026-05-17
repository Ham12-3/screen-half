import { startRecorder, type ActiveRecorder } from './recorder'

export interface WebcamSelection {
  videoDeviceId?: string
  audioDeviceId?: string
}

/** Capture webcam video + mic audio. Audio rides in the webcam file and is
 *  muxed onto the rendered video at export. */
export async function captureWebcam(
  sel: WebcamSelection
): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: sel.videoDeviceId
        ? { exact: sel.videoDeviceId }
        : undefined,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 }
    },
    audio: sel.audioDeviceId
      ? { deviceId: { exact: sel.audioDeviceId } }
      : true
  })
}

export function recordWebcam(stream: MediaStream): ActiveRecorder {
  return startRecorder(
    stream,
    [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ],
    6_000_000
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
