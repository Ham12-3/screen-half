import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { join, normalize, sep } from 'path'
import { pathToFileURL } from 'url'
import { registerIpc } from './ipc'
import { getRecordingsRoot } from './storage'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'recording',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

/** Serve recorded media to the renderer, sandboxed to the recordings dir. */
function registerRecordingProtocol(): void {
  const root = getRecordingsRoot()
  protocol.handle('recording', async (request) => {
    const url = new URL(request.url)
    // recording://<sessionId>/<file>
    const rel = decodeURIComponent(`${url.hostname}/${url.pathname}`)
    const target = normalize(join(root, rel))
    if (target !== root && !target.startsWith(root + sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    const range = request.headers.get('Range')
    const res = await net.fetch(pathToFileURL(target).toString(), {
      headers: range ? { Range: range } : {}
    })
    const headers = new Headers(res.headers)
    // Keep the canvas untainted so WebCodecs can read frames at export.
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers
    })
  })
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d12',
    title: 'screen-half',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerRecordingProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
