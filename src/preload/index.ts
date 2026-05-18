import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '@shared/types'

const api: Api = {
  getSources: () => ipcRenderer.invoke('sources:get'),
  startInputTracking: (displayId, eventsPath) =>
    ipcRenderer.invoke('input:start', displayId, eventsPath),
  stopInputTracking: () => ipcRenderer.invoke('input:stop'),
  createSession: () => ipcRenderer.invoke('session:create'),
  getSessionPaths: (sessionId) =>
    ipcRenderer.invoke('session:paths', sessionId),
  writeJson: (absPath, value) =>
    ipcRenderer.invoke('fs:writeJson', absPath, value),
  readJson: (absPath) => ipcRenderer.invoke('fs:readJson', absPath),
  listSessions: () => ipcRenderer.invoke('session:list'),
  recordOpen: (absPath) => ipcRenderer.invoke('record:open', absPath),
  recordAppend: (handle, chunk) =>
    ipcRenderer.invoke('record:append', handle, chunk),
  recordClose: (handle) => ipcRenderer.invoke('record:close', handle),
  exportOpen: (absPath) => ipcRenderer.invoke('export:open', absPath),
  exportWrite: (handle, data, position) =>
    ipcRenderer.invoke('export:write', handle, data, position),
  exportClose: (handle) => ipcRenderer.invoke('export:close', handle),
  getFreeDiskBytes: () => ipcRenderer.invoke('fs:freeDisk'),
  muxAudioToMp4: (args) => ipcRenderer.invoke('ffmpeg:mux', args),
  getDownloadsExportPath: (fileName) =>
    ipcRenderer.invoke('export:downloadsPath', fileName)
}

contextBridge.exposeInMainWorld('api', api)
