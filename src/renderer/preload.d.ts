import { ElectronHandler } from '../main/preload'

declare global {
  interface Window {
    electron: ElectronHandler
    electronAPI: {
      addCount: (callback: (_event: Electron.IpcRendererEvent, value: number) => void) => void
      fileOpen: (callback: (_event: Electron.IpcRendererEvent, filePath: string) => void) => void
      openFile: (url: string) => void
      sendFile: (callback: (url: string) => void) => void
    }
  }
}

export {}