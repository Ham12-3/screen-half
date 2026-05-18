import { app } from 'electron'
import { createWriteStream, promises as fs, type WriteStream } from 'fs'
import { basename, extname, join } from 'path'
import { randomUUID } from 'crypto'
import type { RecordingPaths } from '@shared/types'

function recordingsRoot(): string {
  return join(app.getPath('userData'), 'recordings')
}

export function getRecordingsRoot(): string {
  return recordingsRoot()
}

/**
 * Resolve a path in the OS Downloads folder for the final export. Only the
 * basename of `fileName` is used (no path traversal); if a file with that
 * name already exists, a numeric suffix is added so exports never silently
 * overwrite each other.
 */
export async function downloadsExportPath(
  fileName: string
): Promise<string> {
  const dir = app.getPath('downloads')
  const ext = extname(fileName) || '.mp4'
  const stem = basename(fileName, ext).replace(/[/\\]/g, '_') || 'export'
  let candidate = join(dir, `${stem}${ext}`)
  let n = 2
  for (;;) {
    try {
      await fs.access(candidate)
      candidate = join(dir, `${stem} (${n})${ext}`)
      n += 1
    } catch {
      return candidate
    }
  }
}

export function sessionDir(sessionId: string): string {
  return join(recordingsRoot(), sessionId)
}

export function sessionPaths(sessionId: string): RecordingPaths {
  const dir = sessionDir(sessionId)
  return {
    sessionId,
    dir,
    screenPath: join(dir, 'screen.webm'),
    webcamPath: join(dir, 'webcam.webm'),
    eventsPath: join(dir, 'events.json'),
    metaPath: join(dir, 'meta.json'),
    projectPath: join(dir, 'project.json')
  }
}

export async function createSession(): Promise<RecordingPaths> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const sessionId = `${stamp}_${randomUUID().slice(0, 8)}`
  const paths = sessionPaths(sessionId)
  await fs.mkdir(paths.dir, { recursive: true })
  return paths
}

/** Reject paths that escape the recordings root (defense against IPC abuse). */
export function assertInsideRecordings(absPath: string): void {
  const root = recordingsRoot()
  const normalized = join(absPath)
  if (!normalized.startsWith(root)) {
    throw new Error(`Refusing to write outside recordings dir: ${absPath}`)
  }
}

// ---- Append-only recording streams (screen.webm / webcam.webm) ----------
//
// MediaRecorder with rec.start(1000) emits sequential byte segments of one
// WebM stream, so appending chunks in arrival order yields a valid file —
// and a partial file from a crash is still mostly playable. We await each
// write's completion before accepting the next chunk, which both preserves
// ordering and applies disk backpressure so the renderer never buffers
// more than one in-flight chunk.

const recordStreams = new Map<number, WriteStream>()
let nextRecordHandle = 1

export async function openRecordStream(absPath: string): Promise<number> {
  assertInsideRecordings(absPath)
  const id = nextRecordHandle++
  const stream = createWriteStream(absPath)
  await new Promise<void>((resolve, reject) => {
    stream.once('open', () => resolve())
    stream.once('error', reject)
  })
  recordStreams.set(id, stream)
  return id
}

export function appendRecordStream(
  id: number,
  data: ArrayBuffer
): Promise<void> {
  const stream = recordStreams.get(id)
  if (!stream) throw new Error(`Unknown record stream ${id}`)
  return new Promise<void>((resolve, reject) => {
    stream.write(Buffer.from(data), (err) =>
      err ? reject(err) : resolve()
    )
  })
}

export async function closeRecordStream(id: number): Promise<void> {
  const stream = recordStreams.get(id)
  if (!stream) return
  recordStreams.delete(id)
  await new Promise<void>((resolve, reject) => {
    stream.once('error', reject)
    stream.end(() => resolve())
  })
}

// ---- Seekable export files (streaming muxer output) ---------------------
//
// mediabunny's MP4 muxer is mostly forward-only but seeks back to patch box
// size headers (e.g. the monolithic mdat). A positioned file handle handles
// both, keeping export RAM flat regardless of output length.

const exportFiles = new Map<number, fs.FileHandle>()
let nextExportHandle = 1

export async function openExportFile(absPath: string): Promise<number> {
  assertInsideRecordings(absPath)
  const id = nextExportHandle++
  const fh = await fs.open(absPath, 'w')
  exportFiles.set(id, fh)
  return id
}

export async function writeExportFile(
  id: number,
  data: ArrayBuffer,
  position: number
): Promise<void> {
  const fh = exportFiles.get(id)
  if (!fh) throw new Error(`Unknown export file ${id}`)
  const buf = Buffer.from(data)
  await fh.write(buf, 0, buf.byteLength, position)
}

export async function closeExportFile(id: number): Promise<void> {
  const fh = exportFiles.get(id)
  if (!fh) return
  exportFiles.delete(id)
  await fh.close()
}

/**
 * Free bytes on the volume that holds recordings. Probes userData (always
 * present, same volume as recordings). Returns +Infinity if unsupported so
 * a probe failure never blocks recording.
 */
export async function freeDiskBytes(): Promise<number> {
  try {
    const s = await fs.statfs(app.getPath('userData'))
    return s.bavail * s.bsize
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export async function writeJson(
  absPath: string,
  value: unknown
): Promise<void> {
  assertInsideRecordings(absPath)
  await fs.writeFile(absPath, JSON.stringify(value, null, 2), 'utf8')
}

export async function readJson<T>(absPath: string): Promise<T> {
  const raw = await fs.readFile(absPath, 'utf8')
  return JSON.parse(raw) as T
}

export async function listSessions(): Promise<string[]> {
  try {
    const entries = await fs.readdir(recordingsRoot(), { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse()
  } catch {
    return []
  }
}
