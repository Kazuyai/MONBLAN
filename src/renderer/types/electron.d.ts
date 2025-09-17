import { ElectronHandler, AppHandler, FileHandler } from '../main/preload'

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    electron: ElectronHandler
    electronApp: AppHandler
    electronFile: FileHandler
  }
}

export {}