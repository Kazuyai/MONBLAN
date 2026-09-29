import {
  AiSetupOperation,
  AiSetupStatus,
  ApiStatus,
  ElectronHandler
} from '../main/preload'

declare global {
  interface Window {
    electron: ElectronHandler
    electronAPI: {
      addCount: (
        callback: (_event: Electron.IpcRendererEvent, value: number) => void
      ) => void
      fileOpen: (
        callback: (_event: Electron.IpcRendererEvent, filePath: string) => void
      ) => void
      openFile: (url: string) => void
      sendFile: (callback: (url: string) => void) => void
      getApiStatus: () => Promise<ApiStatus>
      refreshApiStatus: () => Promise<ApiStatus>
      restartApi: () => Promise<ApiStatus>
      getAiSetupStatus: () => Promise<AiSetupStatus>
      runAiSetupOperation: (
        operation: AiSetupOperation
      ) => Promise<AiSetupStatus>
      onAiSetupStatusChanged: (
        callback: (status: AiSetupStatus) => void
      ) => () => void
      onApiStatusChanged: (callback: (status: ApiStatus) => void) => () => void
    }
  }
}

export {}
