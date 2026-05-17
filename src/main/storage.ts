import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { RecordingPaths } from '@shared/types'

function recordingsRoot(): string {
  return join(app.getPath('userData'), 'recordings')
}

export function getRecordingsRoot(): string {
  return recordingsRoot()
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
function assertInsideRecordings(absPath: string): void {
  const root = recordingsRoot()
  const normalized = join(absPath)
  if (!normalized.startsWith(root)) {
    throw new Error(`Refusing to write outside recordings dir: ${absPath}`)
  }
}

export async function saveBlob(
  absPath: string,
  data: ArrayBuffer
): Promise<void> {
  assertInsideRecordings(absPath)
  await fs.writeFile(absPath, Buffer.from(data))
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
