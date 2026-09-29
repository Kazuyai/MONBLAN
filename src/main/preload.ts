// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { AiSetupOperation, AiSetupStatus } from './aiSetup'

export type { AiSetupOperation, AiSetupStatus } from './aiSetup'

export type Channels = 'ipc-example'

export interface ApiEnvironmentCheck {
  name: string
  path?: string
  kind?: string
  category?: 'runtime' | 'external' | 'bundled'
  group?: string
  exists?: boolean
  ok: boolean
  available?: boolean
  error?: string
  torch_version?: string | null
  cuda_version?: string | null
  device_count?: number
}

export interface ApiEnvironmentStatus {
  ai_available: boolean
  checks: ApiEnvironmentCheck[]
  missing: ApiEnvironmentCheck[]
}

export interface ApiStatus {
  status: 'starting' | 'ready' | 'unavailable' | 'failed' | 'stopped'
  baseUrl: string
  managed: boolean
  aiAvailable: boolean | null
  environment: ApiEnvironmentStatus | null
  error: string | null
}
const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args)
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args)
      ipcRenderer.on(channel, subscription)

      return () => {
        ipcRenderer.removeListener(channel, subscription)
      }
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args))
    },
    invoke(channel: Channels, ...args: unknown[]) {
      return ipcRenderer.invoke(channel, ...args)
    }
  }
}

contextBridge.exposeInMainWorld('electron', electronHandler)

contextBridge.exposeInMainWorld('electronAPI', {
  addCount: (
    callback: (_event: Electron.IpcRendererEvent, value: number) => void
  ) => {
    ipcRenderer.on('add-count', callback)
  },
  fileOpen: (
    callback: (_event: Electron.IpcRendererEvent, filePath: string) => void
  ) => {
    ipcRenderer.on('file-open', callback)
  },
  openFile: (url: string) => ipcRenderer.send('open-file', url),
  sendFile: (callback: (url: string) => void) =>
    ipcRenderer.on('send-file', (_event, url) => callback(url)),
  getApiStatus: (): Promise<ApiStatus> => ipcRenderer.invoke('api:get-status'),
  refreshApiStatus: (): Promise<ApiStatus> =>
    ipcRenderer.invoke('api:refresh-status'),
  restartApi: (): Promise<ApiStatus> => ipcRenderer.invoke('api:restart'),
  getAiSetupStatus: (): Promise<AiSetupStatus> =>
    ipcRenderer.invoke('ai-setup:get-status'),
  runAiSetupOperation: (
    operation: AiSetupOperation
  ): Promise<AiSetupStatus> =>
    ipcRenderer.invoke('ai-setup:run-operation', operation),
  onAiSetupStatusChanged: (callback: (status: AiSetupStatus) => void) => {
    const subscription = (_event: IpcRendererEvent, status: AiSetupStatus) =>
      callback(status)
    ipcRenderer.on('ai-setup:status-changed', subscription)

    return () => {
      ipcRenderer.removeListener('ai-setup:status-changed', subscription)
    }
  },
  onApiStatusChanged: (callback: (status: ApiStatus) => void) => {
    const subscription = (_event: IpcRendererEvent, status: ApiStatus) =>
      callback(status)
    ipcRenderer.on('api:status-changed', subscription)

    return () => {
      ipcRenderer.removeListener('api:status-changed', subscription)
    }
  }
})

export type ElectronHandler = typeof electronHandler
