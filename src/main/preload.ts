import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  AiSetupModel,
  AiSetupComponent,
  AiSetupOperation,
  AiSetupStatus
} from './aiSetup'

export type {
  AiSetupComponent,
  AiSetupModel,
  AiSetupOperation,
  AiSetupStatus
} from './aiSetup'

export interface ApiEnvironmentCheck {
  name: string
  path?: string
  kind?: string
  category?: 'runtime' | 'external' | 'bundled'
  group?: string
  exists?: boolean
  ok: boolean
  available?: boolean
  required?: boolean
  error?: string
  torch_version?: string | null
  cuda_version?: string | null
  device_count?: number
}

export interface ApiEnvironmentStatus {
  ai_available: boolean
  checks: ApiEnvironmentCheck[]
  missing: ApiEnvironmentCheck[]
  warnings?: ApiEnvironmentCheck[]
}

export interface ApiStatus {
  status: 'starting' | 'ready' | 'unavailable' | 'failed' | 'stopped'
  baseUrl: string
  managed: boolean
  aiAvailable: boolean | null
  environment: ApiEnvironmentStatus | null
  error: string | null
}

export interface SaveTextFileResult {
  canceled: boolean
  filePath: string | null
}

contextBridge.exposeInMainWorld('electronAPI', {
  getApiStatus: (): Promise<ApiStatus> => ipcRenderer.invoke('api:get-status'),
  refreshApiStatus: (): Promise<ApiStatus> =>
    ipcRenderer.invoke('api:refresh-status'),
  restartApi: (): Promise<ApiStatus> => ipcRenderer.invoke('api:restart'),
  exportAnnotationFile: (request: {
    content: string
    format: 'csv' | 'eaf'
    filePath?: string
    defaultName?: string
    forceDialog?: boolean
  }): Promise<SaveTextFileResult> =>
    ipcRenderer.invoke('annotation:export', request),
  getAiSetupStatus: (): Promise<AiSetupStatus> =>
    ipcRenderer.invoke('ai-setup:get-status'),
  runAiSetupOperation: (operation: AiSetupOperation): Promise<AiSetupStatus> =>
    ipcRenderer.invoke('ai-setup:run-operation', operation),
  cancelAiSetupOperation: (): Promise<AiSetupStatus> =>
    ipcRenderer.invoke('ai-setup:cancel'),
  acceptAiSetupLicense: (component: AiSetupComponent): Promise<AiSetupStatus> =>
    ipcRenderer.invoke('ai-setup:accept-license', component),
  openAiSetupLicensePage: (component: AiSetupComponent): Promise<void> =>
    ipcRenderer.invoke('ai-setup:open-license-page', component),
  installAiSetupModel: (model: AiSetupModel): Promise<AiSetupStatus> =>
    ipcRenderer.invoke('ai-setup:install-model', model),
  openAiSetupModelPage: (model: AiSetupModel): Promise<void> =>
    ipcRenderer.invoke('ai-setup:open-model-page', model),
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
