import { ipcMain } from 'electron'
import { getSources } from './capture'
import {
  appendRecordStream,
  closeExportFile,
  closeRecordStream,
  createSession,
  downloadsExportPath,
  freeDiskBytes,
  listSessions,
  openExportFile,
  openRecordStream,
  readJson,
  sessionPaths,
  writeExportFile,
  writeJson
} from './storage'
import { startInputTracking, stopInputTracking } from './input-tracker'
import { muxAudioToMp4 } from './ffmpeg'

export function registerIpc(): void {
  ipcMain.handle('sources:get', () => getSources())

  ipcMain.handle(
    'input:start',
    (_e, displayId: number, eventsPath: string) =>
      startInputTracking(displayId, eventsPath)
  )
  ipcMain.handle('input:stop', () => stopInputTracking())

  ipcMain.handle('session:create', () => createSession())
  ipcMain.handle('session:paths', (_e, sessionId: string) =>
    sessionPaths(sessionId)
  )
  ipcMain.handle('session:list', () => listSessions())

  ipcMain.handle('fs:writeJson', (_e, absPath: string, value: unknown) =>
    writeJson(absPath, value)
  )
  ipcMain.handle('fs:readJson', (_e, absPath: string) => readJson(absPath))

  ipcMain.handle('record:open', (_e, absPath: string) =>
    openRecordStream(absPath)
  )
  ipcMain.handle(
    'record:append',
    (_e, handle: number, chunk: ArrayBuffer) =>
      appendRecordStream(handle, chunk)
  )
  ipcMain.handle('record:close', (_e, handle: number) =>
    closeRecordStream(handle)
  )

  ipcMain.handle('export:open', (_e, absPath: string) =>
    openExportFile(absPath)
  )
  ipcMain.handle(
    'export:write',
    (_e, handle: number, data: ArrayBuffer, position: number) =>
      writeExportFile(handle, data, position)
  )
  ipcMain.handle('export:close', (_e, handle: number) =>
    closeExportFile(handle)
  )

  ipcMain.handle('fs:freeDisk', () => freeDiskBytes())

  ipcMain.handle('export:downloadsPath', (_e, fileName: string) =>
    downloadsExportPath(fileName)
  )

  ipcMain.handle(
    'ffmpeg:mux',
    (_e, args: { videoPath: string; audioPath: string; outPath: string }) =>
      muxAudioToMp4(args)
  )
}
