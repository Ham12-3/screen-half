import {
  ALL_FORMATS,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
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

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget()
  })
  const canvasSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: bitrateFor(s.width, s.height, fps),
    keyFrameInterval: 2
  })
  output.addVideoTrack(canvasSource, { frameRate: fps })
  await output.start()

  for (let i = 0; i < totalFrames; i++) {
    const tMs = trimIn + (i * 1000) / fps
    const tSec = tMs / 1000
    const [ss, ws] = await Promise.all([
      screenSink.getSample(tSec),
      webcamSink ? webcamSink.getSample(tSec) : Promise.resolve(null)
    ])
    const sFrame = ss ? ss.toVideoFrame() : null
    const wFrame = ws ? ws.toVideoFrame() : null

    drawComposite(ctx, {
      screen: sFrame
        ? {
            img: sFrame,
            w: screenW,
            h: screenH,
            region: project.region
          }
        : null,
      webcam: wFrame
        ? { img: wFrame, w: webcamW, h: webcamH }
        : null,
      layout: project.layout,
      segments: project.zoomSegments,
      tMs,
      outW: s.width,
      outH: s.height
    })

    await canvasSource.add(i / fps, 1 / fps)

    sFrame?.close()
    wFrame?.close()
    ss?.close()
    ws?.close()
    inputs.onProgress?.((i + 1) / totalFrames)
  }

  await output.finalize()
  await Promise.all([screenInput.dispose(), webcamInput.dispose()])

  const buffer = output.target.buffer
  if (!buffer) throw new Error('Muxer produced no output')

  const paths = await window.api.getSessionPaths(project.sessionId)
  const videoOnly = `${paths.dir}/render_video.mp4`
  const finalPath = `${paths.dir}/export.mp4`
  await window.api.saveBlob(videoOnly, buffer)
  return window.api.muxAudioToMp4({
    videoPath: videoOnly,
    audioPath: paths.webcamPath,
    outPath: finalPath
  })
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

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget()
  })
  const canvasSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: bitrateFor(s.width, s.height, fps),
    keyFrameInterval: 2
  })
  output.addVideoTrack(canvasSource, { frameRate: fps })
  await output.start()

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

  await output.finalize()
  const buffer = output.target.buffer
  if (!buffer) throw new Error('Muxer produced no output')

  const paths = await window.api.getSessionPaths(project.sessionId)
  const videoOnly = `${paths.dir}/render_video.mp4`
  const finalPath = `${paths.dir}/export.mp4`
  await window.api.saveBlob(videoOnly, buffer)
  return window.api.muxAudioToMp4({
    videoPath: videoOnly,
    audioPath: paths.webcamPath,
    outPath: finalPath
  })
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
