import {
  ALL_FORMATS,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
  UrlSource,
  VideoSampleSink
} from 'mediabunny'
import {
  DEFAULT_EXPORT,
  type ExportSettings,
  type ProjectFile
} from '@shared/types'
import { drawComposite } from './composite'
import { recordingUrl } from './recordingUrl'

export interface ExportInputs {
  project: ProjectFile
  /** Fallback decode path if the mediabunny pipeline fails. */
  screenVideo: HTMLVideoElement
  webcamVideo: HTMLVideoElement
  screenSize: { w: number; h: number }
  webcamSize: { w: number; h: number }
  onProgress?: (fraction: number) => void
}

function settingsOf(p: ProjectFile): ExportSettings {
  return p.exportSettings ?? DEFAULT_EXPORT
}

/** Quality-ish bitrate from pixel throughput, clamped to a sane range. */
function bitrateFor(w: number, h: number, fps: number): number {
  const bpp = 0.18
  return Math.min(60_000_000, Math.max(8_000_000, Math.round(w * h * fps * bpp)))
}

/**
 * Mux straight to a file on disk via a mediabunny StreamTarget instead of a
 * BufferTarget, so export RAM stays flat no matter how long the output is.
 * `chunked: true` batches writes (~16 MiB) to keep IPC chatter low, and the
 * main-process file handle accepts the muxer's occasional seek-backs (e.g.
 * patching the mdat size). The recorded mic audio is attached afterwards by
 * the existing FFmpeg step, exactly as before.
 */
async function streamingMp4(
  sessionId: string,
  canvas: HTMLCanvasElement,
  s: ExportSettings
): Promise<{ canvasSource: CanvasSource; finish: () => Promise<string> }> {
  const fps = s.fps || 30
  const paths = await window.api.getSessionPaths(sessionId)
  const videoOnly = `${paths.dir}/render_video.mp4`
  const handle = await window.api.exportOpen(videoOnly)

  let closed = false
  const closeFile = async (): Promise<void> => {
    if (closed) return
    closed = true
    await window.api.exportClose(handle)
  }

  const writable = new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      // slice() → an exactly-sized copy so IPC structured-clone doesn't
      // ship mediabunny's whole backing buffer.
      await window.api.exportWrite(
        handle,
        chunk.data.slice().buffer,
        chunk.position
      )
    },
    abort() {
      void closeFile()
    }
  })

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new StreamTarget(writable, { chunked: true })
  })
  const canvasSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: bitrateFor(s.width, s.height, fps),
    keyFrameInterval: 2
  })
  output.addVideoTrack(canvasSource, { frameRate: fps })
  await output.start()

  const finish = async (): Promise<string> => {
    try {
      await output.finalize()
    } finally {
      await closeFile()
    }
    const finalPath = await window.api.getDownloadsExportPath(
      `screen-half-${sessionId}.mp4`
    )
    return window.api.muxAudioToMp4({
      videoPath: videoOnly,
      audioPath: paths.webcamPath,
      outPath: finalPath
    })
  }

  return { canvasSource, finish }
}

/**
 * Fast, frame-exact export: mediabunny demuxes + decodes each recording
 * (hardware-accelerated, pipelined — no per-frame <video> seeking), the
 * shared compositor draws every frame, mediabunny encodes + muxes to MP4,
 * then FFmpeg attaches the recorded mic audio.
 */
async function exportViaMediabunny(inputs: ExportInputs): Promise<string> {
  const { project } = inputs
  const s = settingsOf(project)
  const fps = s.fps || 30
  const trimIn = project.trimInMs
  const trimOut = Math.max(trimIn + 200, project.trimOutMs)
  const totalFrames = Math.max(
    1,
    Math.floor(((trimOut - trimIn) / 1000) * fps)
  )

  const screenInput = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(recordingUrl(project.sessionId, 'screen.webm'))
  })
  const webcamInput = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(recordingUrl(project.sessionId, 'webcam.webm'))
  })

  const screenTrack = await screenInput.getPrimaryVideoTrack()
  const webcamTrack = await webcamInput.getPrimaryVideoTrack()
  if (!screenTrack) throw new Error('No screen video track')

  const screenSink = new VideoSampleSink(screenTrack)
  const webcamSink = webcamTrack ? new VideoSampleSink(webcamTrack) : null

  const screenW = await screenTrack.getDisplayWidth()
  const screenH = await screenTrack.getDisplayHeight()
  const webcamW = webcamTrack ? await webcamTrack.getDisplayWidth() : 0
  const webcamH = webcamTrack ? await webcamTrack.getDisplayHeight() : 0

  const canvas = document.createElement('canvas')
  canvas.width = s.width
  canvas.height = s.height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('2D canvas unavailable')

  const { canvasSource, finish } = await streamingMp4(
    project.sessionId,
    canvas,
    s
  )

  // Precompute every output timestamp (seconds). Feeding the whole sorted
  // list to samplesAtTimestamps lets mediabunny decode sequentially through
  // each track (every packet at most once) — robust for MediaRecorder WebM
  // which has no seek index, and fast. Per-frame getSample() instead does
  // fragile random access and was returning the same webcam frame forever.
  const timestamps: number[] = []
  for (let i = 0; i < totalFrames; i++) {
    timestamps.push((trimIn + (i * 1000) / fps) / 1000)
  }

  const screenIt = screenSink.samplesAtTimestamps(timestamps)
  const webcamIt = webcamSink
    ? webcamSink.samplesAtTimestamps(timestamps)
    : null

  // Hold the most recent decoded frame so a null (no new frame at this
  // timestamp) reuses the last one instead of dropping to black.
  let lastScreen: VideoFrame | null = null
  let lastWebcam: VideoFrame | null = null

  try {
    for (let i = 0; i < totalFrames; i++) {
      const tMs = trimIn + (i * 1000) / fps

      const sRes = await screenIt.next()
      const sSample = sRes.done ? null : sRes.value
      if (sSample) {
        lastScreen?.close()
        lastScreen = sSample.toVideoFrame()
        sSample.close()
      }

      const wRes = webcamIt ? await webcamIt.next() : null
      const wSample = wRes && !wRes.done ? wRes.value : null
      if (wSample) {
        lastWebcam?.close()
        lastWebcam = wSample.toVideoFrame()
        wSample.close()
      }

      drawComposite(ctx, {
        screen: lastScreen
          ? {
              img: lastScreen,
              w: screenW,
              h: screenH,
              region: project.region
            }
          : null,
        webcam: lastWebcam
          ? { img: lastWebcam, w: webcamW, h: webcamH }
          : null,
        layout: project.layout,
        segments: project.zoomSegments,
        tMs,
        outW: s.width,
        outH: s.height
      })

      await canvasSource.add(i / fps, 1 / fps)
      inputs.onProgress?.((i + 1) / totalFrames)
    }
  } finally {
    await screenIt.return?.(undefined)
    await webcamIt?.return?.(undefined)
    lastScreen?.close()
    lastWebcam?.close()
  }

  await Promise.all([screenInput.dispose(), webcamInput.dispose()])
  return finish()
}

// ---- Fallback: <video> seek path (slower, used only if mediabunny fails) ----

function waitMeta(v: HTMLVideoElement): Promise<void> {
  if (v.readyState >= 1) return Promise.resolve()
  return new Promise((res) => {
    const on = (): void => {
      v.removeEventListener('loadedmetadata', on)
      res()
    }
    v.addEventListener('loadedmetadata', on)
  })
}

function seekTo(v: HTMLVideoElement, sec: number): Promise<void> {
  return new Promise((res) => {
    if (Math.abs(v.currentTime - sec) < 1e-4) {
      res()
      return
    }
    const on = (): void => {
      v.removeEventListener('seeked', on)
      res()
    }
    v.addEventListener('seeked', on)
    v.currentTime = sec
  })
}

async function exportViaVideoSeek(inputs: ExportInputs): Promise<string> {
  const { project, screenVideo, webcamVideo } = inputs
  const s = settingsOf(project)
  const fps = s.fps || 30
  const trimIn = project.trimInMs
  const trimOut = Math.max(trimIn + 200, project.trimOutMs)
  const totalFrames = Math.max(
    1,
    Math.floor(((trimOut - trimIn) / 1000) * fps)
  )

  await Promise.all([waitMeta(screenVideo), waitMeta(webcamVideo)])
  screenVideo.pause()
  webcamVideo.pause()

  const canvas = document.createElement('canvas')
  canvas.width = s.width
  canvas.height = s.height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('2D canvas unavailable')

  const { canvasSource, finish } = await streamingMp4(
    project.sessionId,
    canvas,
    s
  )

  for (let i = 0; i < totalFrames; i++) {
    const tMs = trimIn + (i * 1000) / fps
    await Promise.all([
      seekTo(screenVideo, tMs / 1000),
      seekTo(webcamVideo, tMs / 1000)
    ])
    drawComposite(ctx, {
      screen: {
        img: screenVideo,
        w: inputs.screenSize.w,
        h: inputs.screenSize.h,
        region: project.region
      },
      webcam: {
        img: webcamVideo,
        w: inputs.webcamSize.w,
        h: inputs.webcamSize.h
      },
      layout: project.layout,
      segments: project.zoomSegments,
      tMs,
      outW: s.width,
      outH: s.height
    })
    await canvasSource.add(i / fps, 1 / fps)
    inputs.onProgress?.((i + 1) / totalFrames)
  }

  return finish()
}

export async function exportProject(
  inputs: ExportInputs
): Promise<string> {
  try {
    return await exportViaMediabunny(inputs)
  } catch (err) {
    console.warn(
      '[export] mediabunny pipeline failed, falling back to <video> seek:',
      err
    )
    return exportViaVideoSeek(inputs)
  }
}
