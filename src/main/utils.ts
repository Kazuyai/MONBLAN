import { app } from 'electron'

/**
 * 開発環境かどうかを判定する
 */
export const isDev = (): boolean => {
  return process.env.NODE_ENV === 'development' || !app.isPackaged
}

/**
 * アプリケーションのバージョンを取得する
 */
export const getAppVersion = (): string => {
  return app.getVersion()
}

/**
 * アプリケーション名を取得する
 */
export const getAppName = (): string => {
  return app.getName()
}

/**
 * ユーザーデータディレクトリのパスを取得する
 */
export const getUserDataPath = (): string => {
  return app.getPath('userData')
}

/**
 * ドキュメントディレクトリのパスを取得する
 */
export const getDocumentsPath = (): string => {
  return app.getPath('documents')
}

/**
 * 一時ディレクトリのパスを取得する
 */
export const getTempPath = (): string => {
  return app.getPath('temp')
}
