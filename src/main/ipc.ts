import { ipcMain } from 'electron'
import { getSources } from './capture'
import {
  createSession,
  listSessions,
  readJson,
  saveBlob,
  sessionPaths,
  writeJson
} from './storage'
import { startInputTracking, stopInputTracking } from './input-tracker'
import { muxAudioToMp4 } from './ffmpeg'

export function registerIpc(): void {
  ipcMain.handle('sources:get', () => getSources())

  ipcMain.handle('input:start', (_e, displayId: number) =>
    startInputTracking(displayId)
  )
  ipcMain.handle('input:stop', () => stopInputTracking())

  ipcMain.handle('session:create', () => createSession())
  ipcMain.handle('session:paths', (_e, sessionId: string) =>
    sessionPaths(sessionId)
  )
  ipcMain.handle('session:list', () => listSessions())

  ipcMain.handle('fs:saveBlob', (_e, absPath: string, data: ArrayBuffer) =>
    saveBlob(absPath, data)
  )
  ipcMain.handle('fs:writeJson', (_e, absPath: string, value: unknown) =>
    writeJson(absPath, value)
  )
  ipcMain.handle('fs:readJson', (_e, absPath: string) => readJson(absPath))

  ipcMain.handle(
    'ffmpeg:mux',
    (_e, args: { videoPath: string; audioPath: string; outPath: string }) =>
      muxAudioToMp4(args)
  )
}
