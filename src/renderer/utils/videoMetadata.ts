import type { ProjectVideo } from '../types'

const fileUrlToPath = (source: string): string | undefined => {
  if (!source.startsWith('file:///')) return undefined
  return decodeURIComponent(source.replace('file:///', '')).replace(/\//g, '\\')
}

export const buildStoredVideoMetadata = (
  videoSrcs: string[],
  fileNames: string[],
  filePaths: string[]
): ProjectVideo[] => {
  const videoCount = Math.max(
    videoSrcs.length,
    fileNames.length,
    filePaths.length
  )

  return Array.from({ length: videoCount }, (_, index) => {
    const videoSrc = videoSrcs[index] ?? ''
    return {
      name:
        fileNames[index] ||
        videoSrc
          .split(/[/\\]/)
          .pop()
          ?.replace(/^file:/, '') ||
        `video${index + 1}`,
      path: filePaths[index] || fileUrlToPath(videoSrc)
    }
  })
}
