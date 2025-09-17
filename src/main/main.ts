import path from 'path'
import { app, dialog, BrowserWindow, shell, ipcMain } from 'electron'
import log from 'electron-log'

class AppUpdater {
  constructor() {
    log.transports.file.level = 'info'
  }
}

let mainWindow: BrowserWindow | null = null

ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`
  console.log(msgTemplate(arg))
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
  require('electron-debug')()
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
    .catch(console.log)
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

    app.exit()
  })

  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url)
    return { action: 'deny' }
  })

  new AppUpdater()
}

app.on('window-all-closed', () => {
  app.quit()
})

app
  .whenReady()
  .then(() => {
    createWindow()
    console.log('mainWindow:', mainWindow)
    ipcMain.on('open-file', openFile)
    app.on('activate', () => {
      if (mainWindow === null) createWindow()
    })
  })
  .catch(console.log)
