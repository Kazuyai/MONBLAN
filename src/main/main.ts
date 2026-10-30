import path from 'path'
import { app, dialog, BrowserWindow, shell, ipcMain } from 'electron'
import log from 'electron-log'
import {
  cancelAiSetupOperation,
  acceptAiSetupLicense,
  getAiSetupRoot,
  getAiSetupStatus,
  installAiSetupModel,
  runAiSetupOperation,
  setAiSetupStatusListener,
  type AiSetupModel,
  type AiSetupComponent,
  type AiSetupOperation
} from './aiSetup'
import {
  getApiStatus,
  refreshApiEnvironment,
  restartApiServer,
  setApiStatusListener,
  startApiServer,
  stopApiServer
} from './apiServer'
import { APP_ID, getRuntimePaths } from './runtimePaths'
import {
  createLocalMediaUrl,
  installLocalMediaProtocol,
  registerLocalMediaScheme
} from './localMediaProtocol'
import { writeTextFileAtomically } from './safeFileSave'

registerLocalMediaScheme()

class AppUpdater {
  constructor() {
    log.transports.file.level = 'info'
  }
}

let mainWindow: BrowserWindow | null = null
let documentDirty = false
let allowWindowClose = false
let closeDialogOpen = false
let nextSaveRequestId = 1
const pendingSaveRequests = new Map<number, (saved: boolean) => void>()

const runtimePaths = getRuntimePaths(
  app.isPackaged,
  app.getAppPath(),
  process.resourcesPath
)

const getAssetPath = (...paths: string[]): string => {
  return path.join(runtimePaths.assetsRoot, ...paths)
}

const getWindowIconPath = (): string => {
  return getAssetPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png')
}

interface SaveTextFileResult {
  canceled: boolean
  filePath: string | null
}

ipcMain.handle('media:create-url', (_event, filePath: string) =>
  createLocalMediaUrl(filePath)
)

ipcMain.on('document:set-dirty', (event, isDirty: boolean) => {
  if (event.sender !== mainWindow?.webContents) return
  documentDirty = isDirty === true
  mainWindow.setDocumentEdited(documentDirty)
})

ipcMain.on(
  'document:save-result',
  (event, result: { requestId?: number; saved?: boolean }) => {
    if (event.sender !== mainWindow?.webContents) return
    if (!Number.isInteger(result?.requestId)) return
    const resolve = pendingSaveRequests.get(result.requestId!)
    if (!resolve) return
    pendingSaveRequests.delete(result.requestId!)
    resolve(result.saved === true)
  }
)

ipcMain.handle('document:confirm-replace', async (event) => {
  if (event.sender !== mainWindow?.webContents) return 'cancel'
  if (!mainWindow) return 'cancel'
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['保存して続行', '保存せず続行', 'キャンセル'],
    defaultId: 0,
    cancelId: 2,
    title: '未保存の変更',
    message: '保存されていない変更があります。',
    detail: '別のファイルを開く前に変更を保存しますか？'
  })
  return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel'
})

const requestDocumentSave = async (): Promise<boolean> => {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  const requestId = nextSaveRequestId++
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingSaveRequests.delete(requestId)
      resolve(false)
    }, 60_000)
    pendingSaveRequests.set(requestId, (saved) => {
      clearTimeout(timeout)
      resolve(saved)
    })
    mainWindow?.webContents.send('document:save-requested', requestId)
  })
}

const showSaveDialog = async (
  options: Electron.SaveDialogOptions
): Promise<Electron.SaveDialogReturnValue> =>
  mainWindow
    ? dialog.showSaveDialog(mainWindow, options)
    : dialog.showSaveDialog(options)

ipcMain.handle(
  'annotation:export',
  async (
    _event,
    request: {
      content: string
      format: 'csv' | 'eaf'
      filePath?: string
      defaultName?: string
      forceDialog?: boolean
    }
  ): Promise<SaveTextFileResult> => {
    if (
      typeof request?.content !== 'string' ||
      (request.format !== 'csv' && request.format !== 'eaf')
    ) {
      throw new Error('書き出す注釈データが不正です。')
    }

    const expectedExtension = `.${request.format}`
    let targetPath = request.forceDialog ? undefined : request.filePath
    if (
      targetPath &&
      path.extname(targetPath).toLowerCase() !== expectedExtension
    ) {
      throw new Error(
        `保存先は${expectedExtension}ファイルである必要があります。`
      )
    }
    if (!targetPath) {
      const result = await showSaveDialog({
        title: request.format === 'eaf' ? 'EAFを保存' : 'CSVを書き出す',
        defaultPath:
          request.filePath ||
          request.defaultName ||
          (request.format === 'eaf' ? 'annotations.eaf' : 'annotations.csv'),
        filters: [
          request.format === 'eaf'
            ? { name: 'ELAN annotation', extensions: ['eaf'] }
            : { name: 'CSV', extensions: ['csv'] }
        ]
      })
      if (result.canceled || !result.filePath) {
        return { canceled: true, filePath: null }
      }
      targetPath = result.filePath
    }

    await writeTextFileAtomically(targetPath, request.content)
    return { canceled: false, filePath: targetPath }
  }
)

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
    runtimePaths.runtimeRoot,
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
      runtimePaths.runtimeRoot
    )
)
ipcMain.handle('ai-setup:cancel', async () =>
  cancelAiSetupOperation(app.getPath('userData'))
)
ipcMain.handle(
  'ai-setup:accept-license',
  async (_event, component: AiSetupComponent) => {
    if (component !== 'alphapose' && component !== 'motionbert') {
      throw new Error(`Unsupported AI component: ${String(component)}`)
    }
    return acceptAiSetupLicense(
      component,
      app.getPath('userData'),
      runtimePaths.runtimeRoot
    )
  }
)
ipcMain.handle(
  'ai-setup:open-license-page',
  async (_event, component: AiSetupComponent) => {
    const licensePages: Record<AiSetupComponent, string> = {
      alphapose:
        'https://github.com/MVIG-SJTU/AlphaPose/blob/c60106d19afb443e964df6f06ed1842962f5f1f7/LICENSE',
      motionbert:
        'https://github.com/Walter0807/MotionBERT/blob/1839f099ce9f128342c8f5499478ace328c0df4a/LICENSE'
    }
    if (component !== 'alphapose' && component !== 'motionbert') {
      throw new Error(`Unsupported AI component: ${String(component)}`)
    }
    await shell.openExternal(licensePages[component])
  }
)
ipcMain.handle(
  'ai-setup:install-model',
  async (_event, model: AiSetupModel) => {
    if (
      model !== 'alphapose' &&
      model !== 'alphapose-detector' &&
      model !== 'alphapose-tracker' &&
      model !== 'motionbert'
    ) {
      throw new Error(`Unsupported AI model: ${String(model)}`)
    }
    const dialogOptions: Electron.OpenDialogOptions = {
      title:
        model === 'alphapose'
          ? 'AlphaPoseモデルを選択'
          : model === 'alphapose-detector'
            ? 'AlphaPose人物検出モデルを選択'
            : model === 'alphapose-tracker'
              ? 'AlphaPose人物追跡モデルを選択'
              : 'MotionBERTモデルを選択',
      properties: ['openFile'],
      filters: [
        model === 'motionbert'
          ? { name: 'MotionBERT model', extensions: ['bin'] }
          : model === 'alphapose-detector'
            ? { name: 'AlphaPose detector model', extensions: ['weights'] }
            : { name: 'AlphaPose model', extensions: ['pth'] }
      ]
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || result.filePaths.length === 0) {
      return getAiSetupStatus(app.getPath('userData'))
    }
    return installAiSetupModel(
      model,
      result.filePaths[0],
      app.getPath('userData'),
      runtimePaths.runtimeRoot
    )
  }
)
ipcMain.handle(
  'ai-setup:open-model-page',
  async (_event, model: AiSetupModel) => {
    const modelPages: Record<AiSetupModel, string> = {
      alphapose:
        'https://drive.google.com/file/d/1S-ROA28de-1zvLv-hVfPFJ5tFBYOSITb/view?usp=sharing',
      'alphapose-detector':
        'https://drive.google.com/open?id=1D47msNOOiJKvPOXlnpyzdKA3k6E97NTC',
      'alphapose-tracker':
        'https://drive.google.com/file/d/1myNKfr2cXqiHZVXaaG8ZAq_U2UpeOLfG/view?usp=share_link',
      motionbert:
        'https://huggingface.co/walterzhu/MotionBERT/blob/main/checkpoint/pose3d/FT_MB_lite_MB_ft_h36m_global_lite/best_epoch.bin'
    }
    if (
      model !== 'alphapose' &&
      model !== 'alphapose-detector' &&
      model !== 'alphapose-tracker' &&
      model !== 'motionbert'
    ) {
      throw new Error(`Unsupported AI model: ${String(model)}`)
    }
    await shell.openExternal(modelPages[model])
  }
)

setApiStatusListener((status) => {
  mainWindow?.webContents.send('api:status-changed', status)
})
setAiSetupStatusListener((status) => {
  mainWindow?.webContents.send('ai-setup:status-changed', status)
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

  mainWindow = new BrowserWindow({
    show: false,
    width: 1600,
    height: 900,
    autoHideMenuBar: true,
    icon: getWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  mainWindow.removeMenu()

  if (process.platform === 'win32') {
    mainWindow.setAppDetails({
      appId: APP_ID,
      appIconPath: getAssetPath('icon.ico'),
      appIconIndex: 0
    })
  }

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
    if (allowWindowClose || !documentDirty) {
      stopApiServer()
      return
    }

    e.preventDefault()
    if (closeDialogOpen) return
    closeDialogOpen = true

    try {
      const { response } = await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        buttons: ['保存', '保存せず終了', 'キャンセル'],
        defaultId: 0,
        cancelId: 2,
        title: '未保存の変更',
        message: '保存されていない変更があります。',
        detail: '終了する前に変更を保存しますか？'
      })

      if (response === 2) return
      if (response === 0 && !(await requestDocumentSave())) return

      documentDirty = false
      allowWindowClose = true
      stopApiServer()
      mainWindow?.close()
    } finally {
      closeDialogOpen = false
    }
  })

  mainWindow.webContents.setWindowOpenHandler((edata) => {
    try {
      const url = new URL(edata.url)
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        void shell.openExternal(url.toString())
      } else {
        log.warn(`Blocked unsupported external URL: ${edata.url}`)
      }
    } catch {
      log.warn(`Blocked invalid external URL: ${edata.url}`)
    }
    return { action: 'deny' }
  })

  new AppUpdater()
}

app.on('before-quit', (event) => {
  if (documentDirty && !allowWindowClose) {
    event.preventDefault()
    mainWindow?.close()
    return
  }
  stopApiServer()
})

app.on('window-all-closed', () => {
  app.quit()
})

app
  .whenReady()
  .then(async () => {
    app.setAppUserModelId(APP_ID)
    await installLocalMediaProtocol()
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(getAssetPath('icon.png'))
    }
    startApiServer(
      runtimePaths.runtimeRoot,
      getAiSetupRoot(app.getPath('userData'))
    ).catch((error) => {
      log.error('Failed to start API server', error)
    })
    createWindow()
    app.on('activate', () => {
      if (mainWindow === null) createWindow()
    })
  })
  .catch((error: unknown) => log.error('Failed to initialize app', error))
