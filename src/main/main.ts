import path from 'path'
import { app, dialog, BrowserWindow, shell, ipcMain } from 'electron'
import log from 'electron-log'
import {
  cancelAiSetupOperation,
  getAiSetupRoot,
  getAiSetupStatus,
  runAiSetupOperation,
  setAiSetupStatusListener,
  type AiSetupOperation
} from './aiSetup'
import {
  getApiStatus,
  getProjectRoot,
  refreshApiEnvironment,
  restartApiServer,
  setApiStatusListener,
  startApiServer,
  stopApiServer
} from './apiServer'

class AppUpdater {
  constructor() {
    log.transports.file.level = 'info'
  }
}

let mainWindow: BrowserWindow | null = null

ipcMain.handle('api:get-status', async () => getApiStatus())
ipcMain.handle('api:refresh-status', async () => {
  try {
    return await refreshApiEnvironment({ force: true })
  } catch (error) {
    log.warn('Failed to refresh API environment status', error)
    return getApiStatus()
  }
})
ipcMain.handle('api:restart', async () =>
  restartApiServer(
    getProjectRoot(app.getAppPath()),
    getAiSetupRoot(app.getPath('userData'))
  )
)
ipcMain.handle('ai-setup:get-status', async () =>
  getAiSetupStatus(app.getPath('userData'))
)
ipcMain.handle(
  'ai-setup:run-operation',
  async (_event, operation: AiSetupOperation) =>
    runAiSetupOperation(
      operation,
      app.getPath('userData'),
      getProjectRoot(app.getAppPath())
    )
)
ipcMain.handle('ai-setup:cancel', async () =>
  cancelAiSetupOperation(app.getPath('userData'))
)

setApiStatusListener((status) => {
  mainWindow?.webContents.send('api:status-changed', status)
})
setAiSetupStatusListener((status) => {
  mainWindow?.webContents.send('ai-setup:status-changed', status)
})

ipcMain.on('ipc-example', async (event) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`
  event.reply('ipc-example', msgTemplate('pong'))
})

if (process.env.NODE_ENV === 'production') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sourceMapSupport = require('source-map-support')
  sourceMapSupport.install()
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true'

if (isDebug) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('electron-debug')({ showDevTools: false })
}

const openFile = (_event: unknown, url: string) => {
  mainWindow?.webContents.send('send-file', url)
}

const installExtensions = async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const installer = require('electron-devtools-installer')
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS
  const extensions = ['REACT_DEVELOPER_TOOLS']

  return installer
    .default(
      extensions.map((name: string) => installer[name]),
      forceDownload
    )
    .catch((error: unknown) => log.error('Failed to install extensions', error))
}

const createWindow = async () => {
  if (isDebug) {
    await installExtensions()
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets')

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths)
  }

  mainWindow = new BrowserWindow({
    show: false,
    width: 1600,
    height: 900,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, 'preload.js'),
      webSecurity: false
    }
  })

  mainWindow.maximize()

  if (isDebug) {
    mainWindow.loadURL('http://localhost:3001')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined')
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize()
    } else {
      mainWindow.show()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('close', async (e: Electron.Event) => {
    e.preventDefault()

    const { response: num } = await dialog.showMessageBox(mainWindow!, {
      type: 'info',
      buttons: ['キャンセル', '終了する'],
      defaultId: 0,
      cancelId: 0,
      title: '確認',
      message: '本当に終了しますか？'
    })

    if (num === 0) {
      return
    }

    stopApiServer()
    app.exit()
  })

  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url)
    return { action: 'deny' }
  })

  new AppUpdater()
}

app.on('before-quit', () => {
  stopApiServer()
})

app.on('window-all-closed', () => {
  app.quit()
})

app
  .whenReady()
  .then(() => {
    startApiServer(
      getProjectRoot(app.getAppPath()),
      getAiSetupRoot(app.getPath('userData'))
    ).catch((error) => {
      log.error('Failed to start API server', error)
    })
    createWindow()
    ipcMain.on('open-file', openFile)
    app.on('activate', () => {
      if (mainWindow === null) createWindow()
    })
  })
  .catch((error: unknown) => log.error('Failed to initialize app', error))
