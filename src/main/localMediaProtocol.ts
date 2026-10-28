import { randomUUID } from 'crypto'
import { existsSync, statSync } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { net, protocol } from 'electron'

const SCHEME = 'monblan-media'
const allowedExtensions = new Set([
  '.avi',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.ogv',
  '.webm',
  '.wmv'
])
const mediaPathsByToken = new Map<string, string>()
const tokensByMediaPath = new Map<string, string>()

export const registerLocalMediaScheme = () => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    }
  ])
}

export const installLocalMediaProtocol = async () => {
  await protocol.handle(SCHEME, (request) => {
    const token = new URL(request.url).pathname.slice(1)
    const mediaPath = mediaPathsByToken.get(token)
    if (!mediaPath) {
      return new Response('Media not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(mediaPath).toString())
  })
}

export const createLocalMediaUrl = (requestedPath: string): string => {
  if (typeof requestedPath !== 'string' || requestedPath.trim() === '') {
    throw new Error('動画ファイルのパスが不正です。')
  }

  const mediaPath = path.resolve(requestedPath)
  const extension = path.extname(mediaPath).toLowerCase()
  if (!allowedExtensions.has(extension)) {
    throw new Error('対応していない動画ファイル形式です。')
  }
  if (!existsSync(mediaPath) || !statSync(mediaPath).isFile()) {
    throw new Error('動画ファイルが見つかりません。')
  }

  const existingToken = tokensByMediaPath.get(mediaPath)
  if (existingToken) return `${SCHEME}://local/${existingToken}`

  const token = randomUUID()
  tokensByMediaPath.set(mediaPath, token)
  mediaPathsByToken.set(token, mediaPath)
  return `${SCHEME}://local/${token}`
}
