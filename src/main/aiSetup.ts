import { promises as fs } from 'fs'
import path from 'path'

export type AiSetupOperation = 'prepare-storage'
export type AiSetupPhase = 'idle' | 'running' | 'completed' | 'failed'

export interface AiSetupStatus {
  rootPath: string
  prepared: boolean
  phase: AiSetupPhase
  operation: AiSetupOperation | null
  error: string | null
}

let setupPhase: AiSetupPhase = 'idle'
let currentOperation: AiSetupOperation | null = null
let setupError: string | null = null
let statusListener: ((status: AiSetupStatus) => void) | null = null

export const getAiSetupRoot = (fallbackUserDataPath: string) => {
  const localAppData = process.env.LOCALAPPDATA
  return localAppData
    ? path.join(localAppData, 'Annotation Tool', 'ai')
    : path.join(fallbackUserDataPath, 'ai')
}

const isPrepared = async (rootPath: string) => {
  try {
    return (await fs.stat(rootPath)).isDirectory()
  } catch {
    return false
  }
}

export const getAiSetupStatus = async (
  fallbackUserDataPath: string
): Promise<AiSetupStatus> => {
  const rootPath = getAiSetupRoot(fallbackUserDataPath)
  return {
    rootPath,
    prepared: await isPrepared(rootPath),
    phase: setupPhase,
    operation: currentOperation,
    error: setupError
  }
}

export const setAiSetupStatusListener = (
  listener: (status: AiSetupStatus) => void
) => {
  statusListener = listener
}

const notifyStatus = async (fallbackUserDataPath: string) => {
  const status = await getAiSetupStatus(fallbackUserDataPath)
  statusListener?.(status)
  return status
}

export const runAiSetupOperation = async (
  operation: AiSetupOperation,
  fallbackUserDataPath: string
) => {
  if (operation !== 'prepare-storage') {
    throw new Error(`Unsupported AI setup operation: ${String(operation)}`)
  }
  if (setupPhase === 'running') {
    throw new Error('別のAI環境セットアップ処理を実行中です。')
  }

  setupPhase = 'running'
  currentOperation = operation
  setupError = null
  await notifyStatus(fallbackUserDataPath)

  try {
    await fs.mkdir(getAiSetupRoot(fallbackUserDataPath), { recursive: true })
    setupPhase = 'completed'
    currentOperation = null
    return await notifyStatus(fallbackUserDataPath)
  } catch (error) {
    setupPhase = 'failed'
    currentOperation = null
    setupError = error instanceof Error ? error.message : String(error)
    await notifyStatus(fallbackUserDataPath)
    throw error
  }
}
