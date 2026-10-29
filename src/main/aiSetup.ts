import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { promises as fs } from 'fs'
import path from 'path'
import { getAiHome } from './runtimePaths'

export type AiSetupOperation =
  | 'prepare-storage'
  | 'check-python'
  | 'check-git'
  | 'create-python-environment'
  | 'install-python-dependencies'
  | 'fetch-alphapose'
  | 'fetch-motionbert'
  | 'install-alphapose-model'
  | 'install-alphapose-detector-model'
  | 'install-alphapose-tracker-model'
  | 'install-motionbert-model'
export type AiSetupPhase = 'idle' | 'running' | 'completed' | 'failed'
export type AiSetupModel =
  | 'alphapose'
  | 'alphapose-detector'
  | 'alphapose-tracker'
  | 'motionbert'
export type AiSetupComponent = 'alphapose' | 'motionbert'

export interface AiSetupPythonStatus {
  available: boolean
  command: string | null
  version: string | null
}

export interface AiSetupGitStatus {
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
  alphaPosePath: string
  alphaPoseReady: boolean
  alphaPoseModelPath: string
  alphaPoseModelReady: boolean
  alphaPoseDetectorModelPath: string
  alphaPoseDetectorModelReady: boolean
  alphaPoseTrackerModelPath: string
  alphaPoseTrackerModelReady: boolean
  motionBertPath: string
  motionBertReady: boolean
  motionBertModelPath: string
  motionBertModelReady: boolean
  alphaPoseLicenseAccepted: boolean
  motionBertLicenseAccepted: boolean
  python: AiSetupPythonStatus
  git: AiSetupGitStatus
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

interface GitCommand {
  command: string
  version: string
}

interface AiRepositoryDefinition {
  repositoryUrl: string
  revision: string
}

interface AiComponentsManifest {
  components: {
    alphapose: AiRepositoryDefinition
    motionbert: AiRepositoryDefinition
  }
  models: {
    alphapose: { sha256: string }
    alphaposeDetector: { sha256: string }
    alphaposeTracker: { sha256: string }
    motionbert: { sha256: string }
  }
}

interface AiEnvironmentState {
  schemaVersion: number
  acceptedLicenses?: Partial<
    Record<AiSetupComponent, { acceptedAt: string; revision: string }>
  >
  dependencies?: {
    installedAt: string
    schemaVersion: number
    pythonVersion: string
  }
  components?: Partial<
    Record<AiSetupComponent, { installedAt: string; revision: string }>
  >
  models?: Partial<
    Record<AiSetupModel, { installedAt: string; sha256: string }>
  >
}

const MAX_LOG_LINES = 300
const DEPENDENCIES_MARKER = '.dependencies-installed'
const ENVIRONMENT_FILE = 'environment.json'
let setupPhase: AiSetupPhase = 'idle'
let currentOperation: AiSetupOperation | null = null
let setupMessage: string | null = null
let setupError: string | null = null
let setupLogs: string[] = []
let detectedPython: PythonCommand | null = null
let detectedGit: GitCommand | null = null
let statusListener: ((status: AiSetupStatus) => void) | null = null
let activeSetupProcess: ChildProcessWithoutNullStreams | null = null
let cancelRequested = false

export const getAiSetupRoot = (fallbackUserDataPath: string) => {
  return getAiHome(fallbackUserDataPath)
}

const pathExists = async (targetPath: string) => {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

const readEnvironmentState = async (
  rootPath: string
): Promise<AiEnvironmentState> => {
  try {
    return JSON.parse(
      await fs.readFile(path.join(rootPath, ENVIRONMENT_FILE), 'utf8')
    ) as AiEnvironmentState
  } catch {
    return { schemaVersion: 1 }
  }
}

const writeEnvironmentState = async (
  rootPath: string,
  state: AiEnvironmentState
) => {
  const targetPath = path.join(rootPath, ENVIRONMENT_FILE)
  const temporaryPath = `${targetPath}.tmp`
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8'
  )
  await fs.rm(targetPath, { force: true })
  await fs.rename(temporaryPath, targetPath)
}

const readAiManifest = async (
  projectRoot: string
): Promise<AiComponentsManifest> => {
  const manifestPath = path.join(projectRoot, 'config', 'ai-components.json')
  if (!(await pathExists(manifestPath))) {
    throw new Error(`AI構成ファイルが見つかりません: ${manifestPath}`)
  }
  return JSON.parse(
    await fs.readFile(manifestPath, 'utf8')
  ) as AiComponentsManifest
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
  const alphaPosePath = path.join(rootPath, 'AlphaPose')
  const motionBertPath = path.join(rootPath, 'MotionBERT')
  const alphaPoseModelPath = path.join(
    alphaPosePath,
    'pretrained_models',
    'halpe26_fast_res50_256x192.pth'
  )
  const alphaPoseTrackerModelPath = path.join(
    alphaPosePath,
    'trackers',
    'weights',
    'osnet_ain_x1_0_msmt17_256x128_amsgrad_ep50_lr0.0015_coslr_b64_fb10_softmax_labsmth_flip_jitter.pth'
  )
  const alphaPoseDetectorModelPath = path.join(
    alphaPosePath,
    'detector',
    'yolo',
    'data',
    'yolov3-spp.weights'
  )
  const motionBertModelPath = path.join(
    motionBertPath,
    'checkpoint',
    'pose3d',
    'FT_MB_lite_MB_ft_h36m_global_lite',
    'best_epoch.bin'
  )
  const environmentState = await readEnvironmentState(rootPath)
  return {
    rootPath,
    prepared: await pathExists(rootPath),
    venvPath,
    venvReady: await pathExists(getVenvPythonPath(rootPath)),
    dependenciesReady: await pathExists(
      path.join(rootPath, DEPENDENCIES_MARKER)
    ),
    alphaPosePath,
    alphaPoseReady: await pathExists(
      path.join(alphaPosePath, 'scripts', 'demo_inference.py')
    ),
    alphaPoseModelPath,
    alphaPoseModelReady: await pathExists(alphaPoseModelPath),
    alphaPoseDetectorModelPath,
    alphaPoseDetectorModelReady: await pathExists(alphaPoseDetectorModelPath),
    alphaPoseTrackerModelPath,
    alphaPoseTrackerModelReady: await pathExists(alphaPoseTrackerModelPath),
    motionBertPath,
    motionBertReady: await pathExists(
      path.join(motionBertPath, 'infer_wild.py')
    ),
    motionBertModelPath,
    motionBertModelReady: await pathExists(motionBertModelPath),
    alphaPoseLicenseAccepted: Boolean(
      environmentState.acceptedLicenses?.alphapose
    ),
    motionBertLicenseAccepted: Boolean(
      environmentState.acceptedLicenses?.motionbert
    ),
    python: {
      available: detectedPython !== null,
      command: detectedPython?.command ?? null,
      version: detectedPython?.version ?? null
    },
    git: {
      available: detectedGit !== null,
      command: detectedGit?.command ?? null,
      version: detectedGit?.version ?? null
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
  value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')

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
      reject(
        new Error(`${command} が終了コード ${code ?? '不明'} で終了しました。`)
      )
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
    ...(process.env.MONBLAN_PYTHON || process.env.ANNOTATION_TOOL_PYTHON
      ? [
          {
            command:
              process.env.MONBLAN_PYTHON ||
              process.env.ANNOTATION_TOOL_PYTHON ||
              '',
            args: ['--version']
          }
        ]
      : []),
    { command: 'py', args: ['-3.11', '--version'] },
    { command: 'python', args: ['--version'] }
  ]

  for (const candidate of candidates) {
    try {
      const output = await probeCommand(candidate.command, candidate.args)
      const match = output.match(/Python\s+(3\.(11)\.\d+)/i)
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
    'Python 3.11が見つかりません。Python 3.11をインストールしてから再確認してください。'
  )
}

const detectGit = async (): Promise<GitCommand> => {
  try {
    const output = await probeCommand('git', ['--version'])
    const match = output.match(/git version\s+(.+)/i)
    if (!match) throw new Error('Gitのバージョンを取得できません。')
    return { command: 'git', version: match[1] }
  } catch {
    throw new Error(
      'Gitが見つかりません。Git for Windowsをインストールしてから再確認してください。'
    )
  }
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

const runRepositoryFetchScript = async (
  operation: 'fetch-alphapose' | 'fetch-motionbert',
  rootPath: string,
  projectRoot: string,
  fallbackUserDataPath: string
) => {
  if (process.platform !== 'win32') {
    throw new Error('AIリポジトリの自動取得は現在Windowsのみ対応しています。')
  }
  const scriptPath = path.join(projectRoot, 'scripts', 'fetch-ai-repos.ps1')
  if (!(await pathExists(scriptPath))) {
    throw new Error(`取得スクリプトが見つかりません: ${scriptPath}`)
  }

  const manifest = await readAiManifest(projectRoot)
  const component: AiSetupComponent =
    operation === 'fetch-alphapose' ? 'alphapose' : 'motionbert'
  const environmentState = await readEnvironmentState(rootPath)
  const acceptedLicense = environmentState.acceptedLicenses?.[component]
  if (
    !acceptedLicense ||
    acceptedLicense.revision !== manifest.components[component].revision
  ) {
    throw new Error('外部AIプログラムの利用条件を確認し、同意してください。')
  }

  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-AiRoot',
    rootPath,
    '-AlphaPoseUrl',
    manifest.components.alphapose.repositoryUrl,
    '-AlphaPoseRevision',
    manifest.components.alphapose.revision,
    '-MotionBertUrl',
    manifest.components.motionbert.repositoryUrl,
    '-MotionBertRevision',
    manifest.components.motionbert.revision,
    operation === 'fetch-alphapose' ? '-SkipMotionBert' : '-SkipAlphaPose'
  ]
  await runCommand('powershell.exe', args, fallbackUserDataPath, projectRoot)
}

export const acceptAiSetupLicense = async (
  component: AiSetupComponent,
  fallbackUserDataPath: string,
  projectRoot: string
) => {
  const rootPath = getAiSetupRoot(fallbackUserDataPath)
  await fs.mkdir(rootPath, { recursive: true })
  const manifest = await readAiManifest(projectRoot)
  const state = await readEnvironmentState(rootPath)
  const nextState: AiEnvironmentState = {
    ...state,
    schemaVersion: 1,
    acceptedLicenses: {
      ...state.acceptedLicenses,
      [component]: {
        acceptedAt: new Date().toISOString(),
        revision: manifest.components[component].revision
      }
    }
  }
  await writeEnvironmentState(rootPath, nextState)
  return notifyStatus(fallbackUserDataPath)
}

const operationMessages: Record<AiSetupOperation, string> = {
  'prepare-storage': 'AI環境の保存先を準備しています。',
  'check-python': 'Python 3.11を確認しています。',
  'check-git': 'Gitを確認しています。',
  'create-python-environment': '専用Python環境を作成しています。',
  'install-python-dependencies':
    'AI機能に必要な依存関係をインストールしています。',
  'fetch-alphapose': 'AlphaPose本体を公式リポジトリから取得しています。',
  'fetch-motionbert': 'MotionBERT本体を公式リポジトリから取得しています。',
  'install-alphapose-model': 'AlphaPoseモデルを専用AI環境へ配置しています。',
  'install-alphapose-detector-model':
    'AlphaPose人物検出モデルを専用AI環境へ配置しています。',
  'install-alphapose-tracker-model':
    'AlphaPose人物追跡モデルを専用AI環境へ配置しています。',
  'install-motionbert-model': 'MotionBERTモデルを専用AI環境へ配置しています。'
}

const getFileSha256 = (filePath: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) =>
      hash.update(typeof chunk === 'string' ? chunk : Uint8Array.from(chunk))
    )
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })

export const installAiSetupModel = async (
  model: AiSetupModel,
  sourcePath: string,
  fallbackUserDataPath: string,
  projectRoot: string
) => {
  if (setupPhase === 'running') {
    throw new Error('別のAI環境セットアップ処理を実行中です。')
  }

  const operation: AiSetupOperation =
    model === 'alphapose'
      ? 'install-alphapose-model'
      : model === 'alphapose-detector'
        ? 'install-alphapose-detector-model'
        : model === 'alphapose-tracker'
          ? 'install-alphapose-tracker-model'
          : 'install-motionbert-model'
  const status = await getAiSetupStatus(fallbackUserDataPath)
  const manifest = await readAiManifest(projectRoot)
  const expectedSha256 =
    model === 'alphapose'
      ? manifest.models.alphapose.sha256
      : model === 'alphapose-detector'
        ? manifest.models.alphaposeDetector.sha256
        : model === 'alphapose-tracker'
          ? manifest.models.alphaposeTracker.sha256
          : manifest.models.motionbert.sha256
  const modelDefinition =
    model === 'alphapose'
      ? {
          destination: status.alphaPoseModelPath,
          extension: '.pth',
          minimumBytes: 1024 * 1024,
          repositoryReady: status.alphaPoseReady
        }
      : model === 'alphapose-detector'
        ? {
            destination: status.alphaPoseDetectorModelPath,
            extension: '.weights',
            minimumBytes: 100 * 1024 * 1024,
            repositoryReady: status.alphaPoseReady
          }
        : model === 'alphapose-tracker'
          ? {
              destination: status.alphaPoseTrackerModelPath,
              extension: '.pth',
              minimumBytes: 10 * 1024 * 1024,
              repositoryReady: status.alphaPoseReady
            }
          : {
              destination: status.motionBertModelPath,
              extension: '.bin',
              minimumBytes: 10 * 1024 * 1024,
              repositoryReady: status.motionBertReady
            }

  setupPhase = 'running'
  currentOperation = operation
  setupMessage = operationMessages[operation]
  setupError = null
  setupLogs = []
  cancelRequested = false
  await notifyStatus(fallbackUserDataPath)

  const temporaryPath = `${modelDefinition.destination}.download-${Date.now()}`
  try {
    if (!modelDefinition.repositoryReady) {
      throw new Error('先に外部AIプログラム本体を取得してください。')
    }
    if (path.extname(sourcePath).toLowerCase() !== modelDefinition.extension) {
      throw new Error(
        `${modelDefinition.extension}形式のモデルファイルを選択してください。`
      )
    }
    const sourceStat = await fs.stat(sourcePath)
    if (
      !sourceStat.isFile() ||
      sourceStat.size < modelDefinition.minimumBytes
    ) {
      throw new Error('選択したファイルは有効なモデルファイルではありません。')
    }
    appendLog('モデルファイルの整合性を確認しています。', fallbackUserDataPath)
    const digest = await getFileSha256(sourcePath)
    if (digest !== expectedSha256) {
      throw new Error(
        'モデルのハッシュが検証済みの公式配布ファイルと一致しません。'
      )
    }

    await fs.mkdir(path.dirname(modelDefinition.destination), {
      recursive: true
    })
    await fs.copyFile(sourcePath, temporaryPath)
    await fs.rm(modelDefinition.destination, { force: true })
    await fs.rename(temporaryPath, modelDefinition.destination)
    const environmentState = await readEnvironmentState(status.rootPath)
    await writeEnvironmentState(status.rootPath, {
      ...environmentState,
      schemaVersion: 1,
      models: {
        ...environmentState.models,
        [model]: {
          installedAt: new Date().toISOString(),
          sha256: digest
        }
      }
    })
    appendLog(`配置先: ${modelDefinition.destination}`, fallbackUserDataPath)
    setupPhase = 'completed'
    currentOperation = null
    setupMessage = 'モデルの配置が完了しました。'
    return await notifyStatus(fallbackUserDataPath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true })
    setupPhase = 'failed'
    currentOperation = null
    setupMessage = null
    setupError = error instanceof Error ? error.message : String(error)
    appendLog(setupError, fallbackUserDataPath)
    await notifyStatus(fallbackUserDataPath)
    throw error
  }
}

export const runAiSetupOperation = async (
  operation: AiSetupOperation,
  fallbackUserDataPath: string,
  projectRoot: string
) => {
  const supportedOperations: AiSetupOperation[] = [
    'prepare-storage',
    'check-python',
    'check-git',
    'create-python-environment',
    'install-python-dependencies',
    'fetch-alphapose',
    'fetch-motionbert'
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
    } else if (operation === 'check-git') {
      detectedGit = await detectGit()
      appendLog(
        `Git ${detectedGit.version} を確認しました。`,
        fallbackUserDataPath
      )
    } else if (operation === 'create-python-environment') {
      await fs.mkdir(rootPath, { recursive: true })
      await runSetupScript(rootPath, projectRoot, fallbackUserDataPath, true)
    } else if (operation === 'install-python-dependencies') {
      if (!(await pathExists(getVenvPythonPath(rootPath)))) {
        throw new Error('先に専用Python環境を作成してください。')
      }
      await fs.rm(path.join(rootPath, DEPENDENCIES_MARKER), { force: true })
      await runSetupScript(rootPath, projectRoot, fallbackUserDataPath, false)
      await fs.writeFile(
        path.join(rootPath, DEPENDENCIES_MARKER),
        JSON.stringify({
          schemaVersion: 1,
          installedAt: new Date().toISOString()
        }),
        'utf8'
      )
      const environmentState = await readEnvironmentState(rootPath)
      await writeEnvironmentState(rootPath, {
        ...environmentState,
        schemaVersion: 1,
        dependencies: {
          installedAt: new Date().toISOString(),
          schemaVersion: 1,
          pythonVersion: detectedPython?.version ?? '3.11'
        }
      })
    } else if (
      operation === 'fetch-alphapose' ||
      operation === 'fetch-motionbert'
    ) {
      if (!(await pathExists(path.join(rootPath, DEPENDENCIES_MARKER)))) {
        throw new Error('先にAI依存パッケージをインストールしてください。')
      }
      await runRepositoryFetchScript(
        operation,
        rootPath,
        projectRoot,
        fallbackUserDataPath
      )
      const component: AiSetupComponent =
        operation === 'fetch-alphapose' ? 'alphapose' : 'motionbert'
      const manifest = await readAiManifest(projectRoot)
      const environmentState = await readEnvironmentState(rootPath)
      await writeEnvironmentState(rootPath, {
        ...environmentState,
        schemaVersion: 1,
        components: {
          ...environmentState.components,
          [component]: {
            installedAt: new Date().toISOString(),
            revision: manifest.components[component].revision
          }
        }
      })
    } else {
      throw new Error(`Unsupported AI setup operation: ${String(operation)}`)
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

export const cancelAiSetupOperation = async (fallbackUserDataPath: string) => {
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
