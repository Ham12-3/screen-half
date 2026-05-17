import type { CaptureSource } from '@shared/types'
import { startRecorder, type ActiveRecorder } from './recorder'

/**
 * Capture a screen or window via Electron's legacy chromeMediaSource
 * constraint. Screens are pinned to their native pixel size; windows are
 * captured at their own size (capped) since their dimensions vary.
 */
export async function captureScreen(
  source: CaptureSource,
  fps: number
): Promise<MediaStream> {
  const mandatory: Record<string, unknown> = {
    chromeMediaSource: 'desktop',
    chromeMediaSourceId: source.sourceId,
    maxFrameRate: fps
  }
  if (source.kind === 'screen' && source.display) {
    mandatory.minWidth = source.display.pixelSize.width
    mandatory.maxWidth = source.display.pixelSize.width
    mandatory.minHeight = source.display.pixelSize.height
    mandatory.maxHeight = source.display.pixelSize.height
  } else {
    // Windows: don't force a size; just cap so a huge window can't blow up.
    mandatory.maxWidth = 3840
    mandatory.maxHeight = 3840
  }

  const constraints = {
    audio: false,
    video: { mandatory }
  } as unknown as MediaStreamConstraints

  return navigator.mediaDevices.getUserMedia(constraints)
}

/** Actual captured pixel size, read from the live track. */
export function streamSize(stream: MediaStream): {
  width: number
  height: number
} {
  const s = stream.getVideoTracks()[0]?.getSettings()
  return {
    width: s?.width ?? 1920,
    height: s?.height ?? 1080
  }
}

export function recordScreen(stream: MediaStream): ActiveRecorder {
  return startRecorder(
    stream,
    ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
    12_000_000
  )
}
