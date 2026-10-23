import { existsSync } from 'fs'
import path from 'path'

export const APP_ID = 'com.monblan.app'
export const APP_NAME = 'MONBLAN'

export interface RuntimePaths {
  runtimeRoot: string
  apiRoot: string
  scriptsRoot: string
  configRoot: string
  licensesRoot: string
  assetsRoot: string
}

export const getRuntimePaths = (
  isPackaged: boolean,
  appPath: string,
  resourcesPath: string
): RuntimePaths => {
  const runtimeRoot = isPackaged
    ? path.join(resourcesPath, 'runtime')
    : path.resolve(appPath)

  return {
    runtimeRoot,
    apiRoot: path.join(runtimeRoot, 'API'),
    scriptsRoot: path.join(runtimeRoot, 'scripts'),
    configRoot: path.join(runtimeRoot, 'config'),
    licensesRoot: isPackaged
      ? path.join(resourcesPath, 'licenses')
      : path.join(runtimeRoot, 'licenses'),
    assetsRoot: isPackaged
      ? path.join(resourcesPath, 'assets')
      : path.join(runtimeRoot, 'assets')
  }
}

export const getAiHome = (fallbackUserDataPath: string) => {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return path.join(fallbackUserDataPath, 'ai')

  const monblanHome = path.join(localAppData, APP_NAME, 'ai')
  const legacyHome = path.join(localAppData, 'Annotation Tool', 'ai')

  if (!existsSync(monblanHome) && existsSync(legacyHome)) {
    return legacyHome
  }
  return monblanHome
}
