// Single source of truth for data shared between main, preload, and renderer.

/** Final output canvas — vertical 9:16 for mobile/social. */
export const OUTPUT_WIDTH = 1080
export const OUTPUT_HEIGHT = 1920

/** A capturable display, as enumerated in the main process. */
export interface DisplayInfo {
  /** Electron desktopCapturer source id, e.g. "screen:0:0". */
  sourceId: string
  /** Electron display id (screen.getAllDisplays()). */
  displayId: number
  name: string
  /** Bounds in DIP screen coordinates. */
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  /** True pixel size = bounds * scaleFactor. */
  pixelSize: { width: number; height: number }
  isPrimary: boolean
}

/**
 * A capturable source for the picker — either a whole screen (with display
 * info for exact cursor→zoom mapping) or an individual application window
 * (no bounds available, so auto-zoom is best-effort).
 */
export interface CaptureSource {
  sourceId: string
  kind: 'screen' | 'window'
  name: string
  /** Small preview as a data URL. */
  thumbnail: string
  /** Present only for screen sources. */
  display?: DisplayInfo
}

/** A selectable webcam / audio input device. */
export interface MediaDeviceInfoLite {
  deviceId: string
  label: string
  kind: 'videoinput' | 'audioinput'
}

export type InputEventType = 'move' | 'down' | 'up' | 'wheel'

/**
 * A single global input event captured during recording.
 * x/y are normalized 0..1 relative to the captured display's pixel bounds.
 * t is milliseconds since recordingStartEpochMs.
 */
export interface InputEvent {
  t: number
  type: InputEventType
  x: number
  y: number
  /** Mouse button for down/up (1=left, 2=right, 3=middle). */
  button?: number
}

export interface EventLog {
  version: 1
  events: InputEvent[]
}

/** Recording metadata, written once when a recording completes. */
export interface Meta {
  version: 1
  sessionId: string
  createdAt: string
  /** Wall-clock epoch ms at the moment recording started (the t=0 reference). */
  recordingStartEpochMs: number
  durationMs: number
  screen: {
    fileName: string
    mimeType: string
    width: number
    height: number
    fps: number
  }
  webcam: {
    fileName: string
    mimeType: string
    width: number
    height: number
    fps: number
  }
  /** Source kind; 'window' means auto-zoom mapping is best-effort. */
  sourceKind: 'screen' | 'window'
  /** Present for screen sources (used for exact cursor→zoom mapping). */
  display?: DisplayInfo
  /** Whether global input hooks were active (false => degraded fallback). */
  inputTracked: boolean
}

export type Easing = 'linear' | 'easeInOut' | 'easeOut' | 'easeIn'

/**
 * One auto-zoom "moment" on the screen half. The compositor automatically
 * eases from 1.0 (whole desktop) up to `scale` at the start, holds, then
 * eases back to 1.0 at the end — so one segment is one intuitive,
 * editable block on the timeline. focusX/focusY are normalized 0..1
 * within the screen image (the point to zoom toward). scale > 1 zooms in;
 * scale 1.0 is a no-op.
 */
export interface ZoomSegment {
  id: string
  startMs: number
  endMs: number
  scale: number
  focusX: number
  focusY: number
  easing: Easing
}

export interface LayoutConfig {
  /** Fraction of output height given to the screen half (0..1). 0.5 = 50/50. */
  splitRatio: number
  /** If true, webcam goes on top and screen on the bottom. */
  swap: boolean
  /** How the webcam fills its half. */
  webcamFit: 'cover' | 'contain'
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  splitRatio: 0.5,
  swap: false,
  webcamFit: 'cover'
}

/** A rectangular sub-region of the captured screen image, in source pixels. */
export interface CropRegion {
  x: number
  y: number
  w: number
  h: number
}

/** Output encoding target chosen at export time. Aspect stays 9:16. */
export interface ExportSettings {
  width: number
  height: number
  fps: number
}

export const EXPORT_PRESETS: { label: string; width: number; height: number }[] =
  [
    { label: '1080 × 1920 (HD)', width: 1080, height: 1920 },
    { label: '1440 × 2560 (QHD)', width: 1440, height: 2560 },
    { label: '2160 × 3840 (4K)', width: 2160, height: 3840 }
  ]

export const DEFAULT_EXPORT: ExportSettings = {
  width: 1440,
  height: 2560,
  fps: 30
}

/** Editable project; persisted as project.json, drives preview + export. */
export interface ProjectFile {
  version: 1
  sessionId: string
  meta: Meta
  trimInMs: number
  trimOutMs: number
  layout: LayoutConfig
  zoomSegments: ZoomSegment[]
  /** Optional screen-source crop (screen sources only). */
  region?: CropRegion
  /** Output target; defaults applied if absent. */
  exportSettings?: ExportSettings
}

/** API surface exposed to the renderer via contextBridge (preload). */
export interface RecordingPaths {
  sessionId: string
  dir: string
  screenPath: string
  webcamPath: string
  eventsPath: string
  metaPath: string
  projectPath: string
}

export interface Api {
  getSources(): Promise<CaptureSource[]>
  startInputTracking(
    displayId: number,
    eventsPath: string
  ): Promise<{ ok: boolean; tracked: boolean; t0EpochMs: number }>
  /** Stops tracking; events were streamed to disk during recording. */
  stopInputTracking(): Promise<{ eventCount: number }>
  createSession(): Promise<RecordingPaths>
  getSessionPaths(sessionId: string): Promise<RecordingPaths>
  writeJson(absPath: string, value: unknown): Promise<void>
  readJson<T>(absPath: string): Promise<T>
  listSessions(): Promise<string[]>
  /**
   * Open an append-only write stream for a recording file. Returns an
   * opaque handle; chunks are streamed in with {@link recordAppend}.
   */
  recordOpen(absPath: string): Promise<number>
  /** Append the next MediaRecorder chunk; resolves once it is on disk. */
  recordAppend(handle: number, chunk: ArrayBuffer): Promise<void>
  /** Flush and close a recording stream. */
  recordClose(handle: number): Promise<void>
  /**
   * Open a seekable file for streaming muxer output (mediabunny may write
   * boxes out of order, e.g. patching the mdat size header).
   */
  exportOpen(absPath: string): Promise<number>
  /** Write muxer bytes at an absolute file offset. */
  exportWrite(
    handle: number,
    data: ArrayBuffer,
    position: number
  ): Promise<void>
  /** Close a streaming export file. */
  exportClose(handle: number): Promise<void>
  /** Free bytes on the volume that holds recordings. */
  getFreeDiskBytes(): Promise<number>
  muxAudioToMp4(args: {
    videoPath: string
    audioPath: string
    outPath: string
  }): Promise<string>
  /** Resolve a (collision-safe) path in the OS Downloads folder. */
  getDownloadsExportPath(fileName: string): Promise<string>
}

declare global {
  interface Window {
    api: Api
  }
}
