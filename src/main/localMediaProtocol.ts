import { randomUUID } from 'crypto'
import { createReadStream, existsSync, statSync } from 'fs'
import { Readable } from 'stream'
import path from 'path'
import { protocol } from 'electron'

const SCHEME = 'monblan-media'
const allowedExtensions = new Set([
  '.3g2',
  '.3gp',
  '.aac',
  '.avi',
  '.flac',
  '.flv',
  '.m4v',
  '.m4a',
  '.m2ts',
  '.mkv',
  '.mov',
  '.mp4',
  '.mp3',
  '.mpeg',
  '.mpg',
  '.mts',
  '.ogg',
  '.ogv',
  '.opus',
  '.ts',
  '.vob',
  '.wav',
  '.webm',
  '.wmv'
])
const mediaPathsByToken = new Map<string, string>()
const tokensByMediaPath = new Map<string, string>()

const contentTypes = new Map([
  ['.3g2', 'video/3gpp2'],
  ['.3gp', 'video/3gpp'],
  ['.avi', 'video/x-msvideo'],
  ['.flv', 'video/x-flv'],
  ['.m4v', 'video/x-m4v'],
  ['.m2ts', 'video/mp2t'],
  ['.mkv', 'video/x-matroska'],
  ['.mov', 'video/quicktime'],
  ['.mp4', 'video/mp4'],
  ['.mpeg', 'video/mpeg'],
  ['.mpg', 'video/mpeg'],
  ['.mts', 'video/mp2t'],
  ['.ogv', 'video/ogg'],
  ['.ts', 'video/mp2t'],
  ['.vob', 'video/mpeg'],
  ['.webm', 'video/webm'],
  ['.wmv', 'video/x-ms-wmv'],
  ['.aac', 'audio/aac'],
  ['.flac', 'audio/flac'],
  ['.m4a', 'audio/mp4'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.wav', 'audio/wav']
])

const createStreamResponse = (
  mediaPath: string,
  extension: string,
  fileSize: number,
  rangeHeader: string | null
): Response => {
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': contentTypes.get(extension) ?? 'application/octet-stream'
  })
  let start = 0
  let end = Math.max(0, fileSize - 1)
  let status = 200

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
    if (!match || (!match[1] && !match[2])) {
      headers.set('Content-Range', `bytes */${fileSize}`)
      return new Response(null, { status: 416, headers })
    }

    if (match[1]) {
      start = Number(match[1])
      end = match[2] ? Number(match[2]) : end
    } else {
      const suffixLength = Number(match[2])
      start = Math.max(0, fileSize - suffixLength)
    }
    end = Math.min(end, fileSize - 1)
    if (start < 0 || start >= fileSize || end < start) {
      headers.set('Content-Range', `bytes */${fileSize}`)
      return new Response(null, { status: 416, headers })
    }
    status = 206
    headers.set('Content-Range', `bytes ${start}-${end}/${fileSize}`)
  }

  headers.set('Content-Length', String(end - start + 1))
  const stream = Readable.toWeb(createReadStream(mediaPath, { start, end }))
  return new Response(stream as never, { status, headers })
}

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
    const extension = path.extname(mediaPath).toLowerCase()
    if (!allowedExtensions.has(extension)) {
      return new Response('Unsupported media type', { status: 415 })
    }
    try {
      if (!existsSync(mediaPath)) {
        return new Response('Media not found', { status: 404 })
      }
      const mediaStat = statSync(mediaPath)
      if (!mediaStat.isFile() || mediaStat.size === 0) {
        return new Response('Media not found', { status: 404 })
      }
      return createStreamResponse(
        mediaPath,
        extension,
        mediaStat.size,
        request.headers.get('range')
      )
    } catch {
      return new Response('Media not found', { status: 404 })
    }
  })
}

export const createLocalMediaUrl = (requestedPath: string): string => {
  if (typeof requestedPath !== 'string' || requestedPath.trim() === '') {
    throw new Error('動画ファイルのパスが不正です。')
  }

  const mediaPath = path.resolve(requestedPath)
  const existingToken = tokensByMediaPath.get(mediaPath)
  if (existingToken) return `${SCHEME}://local/${existingToken}`

  const token = randomUUID()
  tokensByMediaPath.set(mediaPath, token)
  mediaPathsByToken.set(token, mediaPath)
  return `${SCHEME}://local/${token}`
}
