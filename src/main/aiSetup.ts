import {
  ChildProcessWithoutNullStreams,
  spawn
} from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'

export type AiSetupOperation =
  | 'prepare-storage'
  | 'check-python'
  | 'create-python-environment'
  | 'install-python-dependencies'
export type AiSetupPhase = 'idle' | 'running' | 'completed' | 'failed'

export interface AiSetupPythonStatus {
  available: boolean
  command: string | null
  version: string | null
}

export interface AiSetupStatus {
  rootPath: string
  prepared: boolean
  venvPath: string
  venvReady: boolean
  dependenciesReady: boolean
  python: AiSetupPythonStatus
  phase: AiSetupPhase
  operation: AiSetupOperation | null
  message: string | null
  error: string | null
  logs: string[]
}

interface PythonCommand {
  command: string
  version: string
  pythonVersion: string
}

const MAX_LOG_LINES = 300
const DEPENDENCIES_MARKER = '.dependencies-installed'

let setupPhase: AiSetupPhase = 'idle'
let currentOperation: AiSetupOperation | null = null
let setupMessage: string | null = null
let setupError: string | null = null
let setupLogs: string[] = []
let detectedPython: PythonCommand | null = null
let statusListener: ((status: AiSetupStatus) => void) | null = null
let activeSetupProcess: ChildProcessWithoutNullStreams | null = null
let cancelRequested = false

export const getAiSetupRoot = (fallbackUserDataPath: string) => {
  const localAppData = process.env.LOCALAPPDATA
  return localAppData
    ? path.join(localAppData, 'Annotation Tool', 'ai')
    : path.join(fallbackUserDataPath, 'ai')
}

const pathExists = async (targetPath: string) => {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

const getVenvPythonPath = (rootPath: string) =>
  process.platform === 'win32'
    ? path.join(rootPath, 'venv', 'Scripts', 'python.exe')
    : path.join(rootPath, 'venv', 'bin', 'python')

export const getAiSetupStatus = async (
  fallbackUserDataPath: string
): Promise<AiSetupStatus> => {
  const rootPath = getAiSetupRoot(fallbackUserDataPath)
  const venvPath = path.join(rootPath, 'venv')
  return {
    rootPath,
    prepared: await pathExists(rootPath),
    venvPath,
    venvReady: await pathExists(getVenvPythonPath(rootPath)),
    dependenciesReady: await pathExists(
      path.join(rootPath, DEPENDENCIES_MARKER)
    ),
    python: {
      available: detectedPython !== null,
      command: detectedPython?.command ?? null,
      version: detectedPython?.version ?? null
    },
    phase: setupPhase,
    operation: currentOperation,
    message: setupMessage,
    error: setupError,
    logs: [...setupLogs]
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

const stripAnsi = (value: string) =>
  value.replace(
    new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'),
    ''
  )

const appendLog = (value: string, fallbackUserDataPath: string) => {
  const lines = stripAnsi(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return
  setupLogs = [...setupLogs, ...lines].slice(-MAX_LOG_LINES)
  void notifyStatus(fallbackUserDataPath)
}

const runCommand = (
  command: string,
  args: string[],
  fallbackUserDataPath: string,
  cwd?: string
) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      windowsHide: true
    })
    activeSetupProcess = child
    child.stdout.on('data', (data) =>
      appendLog(data.toString(), fallbackUserDataPath)
    )
    child.stderr.on('data', (data) =>
      appendLog(data.toString(), fallbackUserDataPath)
    )
    child.on('error', reject)
    child.on('exit', (code) => {
      activeSetupProcess = null
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} が終了コード ${code ?? '不明'} で終了しました。`))
    })
  })

const probeCommand = (command: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      windowsHide: true
    })
    let output = ''
    child.stdout.on('data', (data) => {
      output += data.toString()
    })
    child.stderr.on('data', (data) => {
      output += data.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stripAnsi(output).trim())
        return
      }
      reject(new Error(`${command} exited with code ${code ?? 'unknown'}`))
    })
  })

const detectPython = async (): Promise<PythonCommand> => {
  const candidates = [
    ...(process.env.ANNOTATION_TOOL_PYTHON
      ? [
          {
            command: process.env.ANNOTATION_TOOL_PYTHON,
            args: ['--version']
          }
        ]
      : []),
    { command: 'py', args: ['-3.11', '--version'] },
    { command: 'py', args: ['-3.12', '--version'] },
    { command: 'python', args: ['--version'] }
  ]

  for (const candidate of candidates) {
    try {
      const output = await probeCommand(candidate.command, candidate.args)
      const match = output.match(/Python\s+(3\.(11|12)\.\d+)/i)
      if (!match) continue
      return {
        command: candidate.command,
        version: match[1],
        pythonVersion: `3.${match[2]}`
      }
    } catch {
      continue
    }
  }

  throw new Error(
    'Python 3.11または3.12が見つかりません。Pythonをインストールしてから再確認してください。'
  )
}

const runSetupScript = async (
  rootPath: string,
  projectRoot: string,
  fallbackUserDataPath: string,
  skipInstall: boolean
) => {
  if (process.platform !== 'win32') {
    throw new Error('AI環境の自動セットアップは現在Windowsのみ対応しています。')
  }
  detectedPython = detectedPython ?? (await detectPython())
  const scriptPath = path.join(projectRoot, 'scripts', 'setup-python-env.ps1')
  if (!(await pathExists(scriptPath))) {
    throw new Error(`セットアップスクリプトが見つかりません: ${scriptPath}`)
  }

  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-AiRoot',
    rootPath,
    '-PythonPath',
    detectedPython.command,
    '-PythonVersion',
    detectedPython.pythonVersion
  ]
  if (skipInstall) args.push('-SkipInstall')
  await runCommand('powershell.exe', args, fallbackUserDataPath, projectRoot)
}

const operationMessages: Record<AiSetupOperation, string> = {
  'prepare-storage': 'AI環境の保存先を準備しています。',
  'check-python': 'Python 3.11または3.12を確認しています。',
  'create-python-environment': '専用Python環境を作成しています。',
  'install-python-dependencies': 'AI機能に必要な依存関係をインストールしています。'
}

export const runAiSetupOperation = async (
  operation: AiSetupOperation,
  fallbackUserDataPath: string,
  projectRoot: string
) => {
  const supportedOperations: AiSetupOperation[] = [
    'prepare-storage',
    'check-python',
    'create-python-environment',
    'install-python-dependencies'
  ]
  if (!supportedOperations.includes(operation)) {
    throw new Error(`Unsupported AI setup operation: ${String(operation)}`)
  }
  if (setupPhase === 'running') {
    throw new Error('別のAI環境セットアップ処理を実行中です。')
  }

  const rootPath = getAiSetupRoot(fallbackUserDataPath)
  setupPhase = 'running'
  currentOperation = operation
  setupMessage = operationMessages[operation]
  setupError = null
  setupLogs = []
  cancelRequested = false
  await notifyStatus(fallbackUserDataPath)

  try {
    if (operation === 'prepare-storage') {
      await fs.mkdir(rootPath, { recursive: true })
    } else if (operation === 'check-python') {
      detectedPython = await detectPython()
      appendLog(
        `Python ${detectedPython.version} を確認しました。`,
        fallbackUserDataPath
      )
    } else if (operation === 'create-python-environment') {
      await fs.mkdir(rootPath, { recursive: true })
      await runSetupScript(rootPath, projectRoot, fallbackUserDataPath, true)
    } else {
      if (!(await pathExists(getVenvPythonPath(rootPath)))) {
        throw new Error('先に専用Python環境を作成してください。')
      }
      await fs.rm(path.join(rootPath, DEPENDENCIES_MARKER), { force: true })
      await runSetupScript(rootPath, projectRoot, fallbackUserDataPath, false)
      await fs.writeFile(
        path.join(rootPath, DEPENDENCIES_MARKER),
        new Date().toISOString(),
        'utf8'
      )
    }

    setupPhase = 'completed'
    currentOperation = null
    setupMessage = '処理が完了しました。'
    return await notifyStatus(fallbackUserDataPath)
  } catch (error) {
    if (cancelRequested) {
      setupPhase = 'idle'
      currentOperation = null
      setupMessage = '処理を中止しました。'
      setupError = null
      appendLog('セットアップ処理を中止しました。', fallbackUserDataPath)
      return await notifyStatus(fallbackUserDataPath)
    }
    setupPhase = 'failed'
    currentOperation = null
    setupMessage = null
    setupError = error instanceof Error ? error.message : String(error)
    appendLog(setupError, fallbackUserDataPath)
    await notifyStatus(fallbackUserDataPath)
    throw error
  }
}

export const cancelAiSetupOperation = async (
  fallbackUserDataPath: string
) => {
  if (setupPhase !== 'running' || !activeSetupProcess) {
    return getAiSetupStatus(fallbackUserDataPath)
  }

  cancelRequested = true
  setupMessage = 'セットアップ処理を中止しています。'
  await notifyStatus(fallbackUserDataPath)

  if (process.platform === 'win32' && activeSetupProcess.pid) {
    await new Promise<void>((resolve) => {
      const taskkill = spawn(
        'taskkill.exe',
        ['/pid', String(activeSetupProcess?.pid), '/t', '/f'],
        { windowsHide: true }
      )
      taskkill.on('error', () => resolve())
      taskkill.on('exit', () => resolve())
    })
  } else {
    activeSetupProcess.kill()
  }

  return getAiSetupStatus(fallbackUserDataPath)
}
