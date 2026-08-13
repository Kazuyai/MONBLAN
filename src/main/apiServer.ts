import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
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
  error?: string
}

export interface ApiEnvironmentStatus {
  ai_available: boolean
  checks: ApiEnvironmentCheck[]
  missing: ApiEnvironmentCheck[]
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

export const setApiStatusListener = (listener: (status: ApiStatus) => void) => {
  statusListener = listener
}

export const getApiStatus = () => apiStatus

const updateStatus = (partial: Partial<ApiStatus>) => {
  apiStatus = { ...apiStatus, ...partial }
  statusListener?.(apiStatus)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const requestJson = <T>(url: string, timeoutMs = 3000): Promise<T> => {
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
  if (!options.force && apiStatus.status === 'ready' && apiStatus.environment) {
    return apiStatus
  }

  if (environmentRefreshPromise) {
    return environmentRefreshPromise
  }

  environmentRefreshPromise = refreshApiEnvironmentRequest().finally(() => {
    environmentRefreshPromise = null
  })

  return environmentRefreshPromise
}

const refreshApiEnvironmentRequest = async () => {
  const environment = await requestJson<ApiEnvironmentStatus>(
    `${API_BASE_URL}/environment/`
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
      await refreshApiEnvironment()
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

export const startApiServer = async (projectRoot: string) => {
  try {
    // 既にユーザーがAPIを起動している場合は、そのプロセスを再利用する。
    await refreshApiEnvironment()
    updateStatus({ managed: false })
    return apiStatus
  } catch {
    // 未起動ならElectron管理プロセスとして起動する。
  }

  if (apiProcess && !apiProcess.killed) {
    return waitForApiReady()
  }

  updateStatus({
    status: 'starting',
    managed: true,
    aiAvailable: null,
    environment: null,
    error: null
  })

  apiProcess = spawn(
    process.env.ANNOTATION_TOOL_PYTHON || 'python',
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
      env: process.env
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
    apiProcess.kill()
  }
  apiProcess = null
}

export const getProjectRoot = (appPath: string) => {
  return path.resolve(appPath)
}
