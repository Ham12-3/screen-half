import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '@shared/types'

const api: Api = {
  getSources: () => ipcRenderer.invoke('sources:get'),
  startInputTracking: (displayId) =>
    ipcRenderer.invoke('input:start', displayId),
  stopInputTracking: () => ipcRenderer.invoke('input:stop'),
  createSession: () => ipcRenderer.invoke('session:create'),
  getSessionPaths: (sessionId) =>
    ipcRenderer.invoke('session:paths', sessionId),
  saveBlob: (absPath, data) =>
    ipcRenderer.invoke('fs:saveBlob', absPath, data),
  writeJson: (absPath, value) =>
    ipcRenderer.invoke('fs:writeJson', absPath, value),
  readJson: (absPath) => ipcRenderer.invoke('fs:readJson', absPath),
  listSessions: () => ipcRenderer.invoke('session:list'),
  muxAudioToMp4: (args) => ipcRenderer.invoke('ffmpeg:mux', args)
}

contextBridge.exposeInMainWorld('api', api)
