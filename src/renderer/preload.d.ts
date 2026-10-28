import {
  AiSetupModel,
  AiSetupComponent,
  AiSetupOperation,
  AiSetupStatus,
  ApiStatus,
  SaveTextFileResult
} from '../main/preload'

declare global {
  interface Window {
    electronAPI: {
      getApiStatus: () => Promise<ApiStatus>
      refreshApiStatus: () => Promise<ApiStatus>
      restartApi: () => Promise<ApiStatus>
      exportAnnotationFile: (request: {
        content: string
        format: 'csv' | 'eaf'
        filePath?: string
        defaultName?: string
        forceDialog?: boolean
      }) => Promise<SaveTextFileResult>
      getAiSetupStatus: () => Promise<AiSetupStatus>
      runAiSetupOperation: (
        operation: AiSetupOperation
      ) => Promise<AiSetupStatus>
      cancelAiSetupOperation: () => Promise<AiSetupStatus>
      acceptAiSetupLicense: (
        component: AiSetupComponent
      ) => Promise<AiSetupStatus>
      openAiSetupLicensePage: (component: AiSetupComponent) => Promise<void>
      installAiSetupModel: (model: AiSetupModel) => Promise<AiSetupStatus>
      openAiSetupModelPage: (model: AiSetupModel) => Promise<void>
      onAiSetupStatusChanged: (
        callback: (status: AiSetupStatus) => void
      ) => () => void
      onApiStatusChanged: (callback: (status: ApiStatus) => void) => () => void
    }
  }
}

export {}
