import { ChildProcessWithoutNullStreams, spawn, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import http from 'http'
import path from 'path'
import log from 'electron-log'

export type ApiStatusName =
  | 'starting'
  | 'ready'
  | 'unavailable'
  | 'failed'
  | 'stopped'

export interface ApiEnvironmentCheck {
  name: string
  path?: string
  kind?: string
  exists?: boolean
  ok: boolean
  available?: boolean
  required?: boolean
  error?: string
}

export interface ApiEnvironmentStatus {
  ai_available: boolean
  checks: ApiEnvironmentCheck[]
  missing: ApiEnvironmentCheck[]
  warnings?: ApiEnvironmentCheck[]
}

export interface ApiStatus {
  status: ApiStatusName
  baseUrl: string
  managed: boolean
  aiAvailable: boolean | null
  environment: ApiEnvironmentStatus | null
  error: string | null
}

const API_HOST = '127.0.0.1'
const API_PORT = 8000
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`
const API_START_TIMEOUT_MS = 30000
const API_POLL_INTERVAL_MS = 500
const API_REQUEST_TIMEOUT_MS = 3000
const API_ENVIRONMENT_TIMEOUT_MS = 120000

let apiProcess: ChildProcessWithoutNullStreams | null = null
let apiStatus: ApiStatus = {
  status: 'stopped',
  baseUrl: API_BASE_URL,
  managed: false,
  aiAvailable: null,
  environment: null,
  error: null
}
let statusListener: ((status: ApiStatus) => void) | null = null
let environmentRefreshPromise: Promise<ApiStatus> | null = null

const terminateApiProcess = (childProcess: ChildProcessWithoutNullStreams) => {
  if (process.platform === 'win32' && childProcess.pid) {
    spawnSync('taskkill.exe', ['/pid', String(childProcess.pid), '/t', '/f'], {
      windowsHide: true
    })
    return
  }
  childProcess.kill()
}

export const setApiStatusListener = (listener: (status: ApiStatus) => void) => {
  statusListener = listener
}

export const getApiStatus = () => apiStatus

const updateStatus = (partial: Partial<ApiStatus>) => {
  apiStatus = { ...apiStatus, ...partial }
  statusListener?.(apiStatus)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const requestJson = <T>(
  url: string,
  timeoutMs = API_REQUEST_TIMEOUT_MS
): Promise<T> => {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        if (
          !response.statusCode ||
          response.statusCode < 200 ||
          response.statusCode >= 300
        ) {
          reject(new Error(`HTTP ${response.statusCode}: ${body}`))
          return
        }

        try {
          resolve(JSON.parse(body) as T)
        } catch (error) {
          reject(error)
        }
      })
    })

    request.on('timeout', () => {
      request.destroy(new Error(`Request timed out: ${url}`))
    })
    request.on('error', reject)
  })
}

export const refreshApiEnvironment = async (options = { force: false }) => {
  if (apiStatus.status === 'starting') {
    await waitForApiReady()
  }

  if (!options.force && apiStatus.status === 'ready' && apiStatus.environment) {
    return apiStatus
  }

  if (environmentRefreshPromise) {
    return environmentRefreshPromise
  }

  environmentRefreshPromise = refreshApiEnvironmentRequest(
    options.force
  ).finally(() => {
    environmentRefreshPromise = null
  })

  return environmentRefreshPromise
}

const refreshApiEnvironmentRequest = async (force: boolean) => {
  const refreshQuery = force ? '?refresh=true' : ''
  const environment = await requestJson<ApiEnvironmentStatus>(
    `${API_BASE_URL}/environment/${refreshQuery}`,
    API_ENVIRONMENT_TIMEOUT_MS
  )
  updateStatus({
    status: 'ready',
    aiAvailable: environment.ai_available,
    environment,
    error: null
  })
  return apiStatus
}

const waitForApiReady = async () => {
  const startedAt = Date.now()
  let lastError: unknown = null

  while (Date.now() - startedAt < API_START_TIMEOUT_MS) {
    try {
      await requestJson<{ status: string }>(`${API_BASE_URL}/health/`)
      updateStatus({ status: 'ready', error: null })
      return apiStatus
    } catch (error) {
      lastError = error
      await sleep(API_POLL_INTERVAL_MS)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('API startup timed out')
}

const getManagedApiRuntime = (aiRoot?: string) => {
  const configuredPython =
    process.env.MONBLAN_PYTHON || process.env.ANNOTATION_TOOL_PYTHON
  if (!aiRoot) {
    return { python: configuredPython || 'python', env: process.env }
  }

  const venvPython = path.join(aiRoot, 'venv', 'Scripts', 'python.exe')
  const requiredPaths = [
    path.join(aiRoot, '.dependencies-installed'),
    venvPython
  ]
  const dedicatedEnvironmentReady = requiredPaths.every(existsSync)
  if (!dedicatedEnvironmentReady) {
    return { python: configuredPython || 'python', env: process.env }
  }

  const python = configuredPython || venvPython
  return {
    python,
    env: {
      ...process.env,
      MONBLAN_AI_HOME: aiRoot,
      MONBLAN_PYTHON: python,
      ANNOTATION_TOOL_AI_HOME: aiRoot,
      ANNOTATION_TOOL_PYTHON: python
    }
  }
}

export const startApiServer = async (projectRoot: string, aiRoot?: string) => {
  updateStatus({
    status: 'starting',
    managed: false,
    aiAvailable: null,
    environment: null,
    error: null
  })

  try {
    // 既にユーザーがAPIを起動している場合は、そのプロセスを再利用する。
    await requestJson<{ status: string }>(`${API_BASE_URL}/health/`)
    updateStatus({
      status: 'ready',
      managed: false,
      aiAvailable: null,
      environment: null,
      error: null
    })
    return apiStatus
  } catch {
    // 未起動ならElectron管理プロセスとして起動する。
  }

  if (apiProcess && !apiProcess.killed) {
    updateStatus({ managed: true })
    return waitForApiReady()
  }

  updateStatus({
    status: 'starting',
    managed: true,
    aiAvailable: null,
    environment: null,
    error: null
  })

  const runtime = getManagedApiRuntime(aiRoot)
  apiProcess = spawn(
    runtime.python,
    [
      '-m',
      'uvicorn',
      'API.api:app',
      '--host',
      API_HOST,
      '--port',
      String(API_PORT)
    ],
    {
      cwd: projectRoot,
      env: runtime.env
    }
  )

  apiProcess.stdout.on('data', (data) => {
    log.info(`[api] ${data.toString().trim()}`)
  })

  apiProcess.stderr.on('data', (data) => {
    log.warn(`[api] ${data.toString().trim()}`)
  })

  apiProcess.on('error', (error) => {
    updateStatus({ status: 'failed', error: error.message })
  })

  apiProcess.on('exit', (code, signal) => {
    const expectedStop = apiStatus.status === 'stopped'
    if (!expectedStop) {
      updateStatus({
        status: 'failed',
        managed: false,
        error: `API process exited: code=${code ?? 'null'}, signal=${signal ?? 'null'}`
      })
    }
    apiProcess = null
  })

  try {
    return await waitForApiReady()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateStatus({ status: 'failed', error: message })
    return apiStatus
  }
}

export const stopApiServer = () => {
  updateStatus({ status: 'stopped' })

  if (apiProcess && !apiProcess.killed) {
    terminateApiProcess(apiProcess)
  }
  apiProcess = null
}

export const restartApiServer = async (
  projectRoot: string,
  aiRoot?: string
) => {
  const runningProcess = apiProcess
  updateStatus({ status: 'stopped' })
  if (runningProcess && !runningProcess.killed) {
    const processExited = new Promise<void>((resolve) =>
      runningProcess.once('exit', () => resolve())
    )
    terminateApiProcess(runningProcess)
    apiProcess = null
    await Promise.race([processExited, sleep(3000)])
  }
  return startApiServer(projectRoot, aiRoot)
}
