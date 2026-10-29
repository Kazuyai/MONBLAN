import React, {
  useEffect,
  useRef,
  useState,
  Dispatch,
  SetStateAction
} from 'react'

const waitForMetadata = (video: HTMLVideoElement): Promise<void> => {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const handleLoadedMetadata = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error('動画のメタデータを読み込めませんでした。'))
    }
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('error', handleError)
    }
    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('error', handleError)
  })
}

const waitForSeeked = (video: HTMLVideoElement): Promise<void> =>
  new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('動画のシークがタイムアウトしました。'))
    }, 5000)
    const handleSeeked = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error('動画の再生位置を変更できませんでした。'))
    }
    const cleanup = () => {
      window.clearTimeout(timeoutId)
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('error', handleError)
    }
    video.addEventListener('seeked', handleSeeked)
    video.addEventListener('error', handleError)
  })

const seekVideo = async (
  video: HTMLVideoElement,
  targetTime: number
): Promise<void> => {
  await waitForMetadata(video)
  const toleranceSeconds = 0.05

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (Math.abs(video.currentTime - targetTime) <= toleranceSeconds) return

    const seeked = waitForSeeked(video)
    video.currentTime = targetTime
    await seeked
    if (Math.abs(video.currentTime - targetTime) <= toleranceSeconds) return
  }

  throw new Error(
    `動画を選択開始位置へ移動できませんでした（要求: ${targetTime.toFixed(3)}秒、実際: ${video.currentTime.toFixed(3)}秒）。`
  )
}

interface VideoProps {
  videoSrcs: string[]
  videoDuration: number
  setVideoDuration: (duration: number) => void
  isEditing: boolean
  currentFrame: number
  setCurrentFrame: (frame: number) => void
  frameRate: number
  isPlaying?: boolean
  setIsPlaying?: Dispatch<SetStateAction<boolean>>
  playSpeed?: number
  setPlaySpeed?: Dispatch<SetStateAction<number>>
  isPartiallyPlaying?: boolean
  setIsPartiallyPlaying?: Dispatch<SetStateAction<boolean>>
  selectionStartFrame: number
  selectionFrameWidth: number
}

export const Video: React.FC<VideoProps> = ({
  videoSrcs,
  videoDuration,
  setVideoDuration,
  isEditing,
  currentFrame,
  setCurrentFrame,
  frameRate,
  isPlaying,
  setIsPlaying,
  playSpeed,
  setPlaySpeed,
  isPartiallyPlaying,
  setIsPartiallyPlaying,
  selectionStartFrame,
  selectionFrameWidth
}) => {
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])
  const animationFrameId = useRef<number>()
  const [isPartialPlaybackReady, setIsPartialPlaybackReady] = useState(false)
  const totalFrames = Math.ceil(videoDuration * frameRate)

  const selectionStopFrame = selectionStartFrame + selectionFrameWidth
  const selectionEndBoundaryTime =
    Math.round(
      ((selectionStopFrame - 1) / frameRate) * 1000
    ) /
      1000 +
    0.001

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const eventTarget = event.target
      const isTextEntryTarget =
        eventTarget instanceof Element &&
        eventTarget.closest(
          'input, textarea, select, [contenteditable="true"]'
        ) !== null

      if (isEditing || isTextEntryTarget) return

      const videos = videoRefs.current.filter(
        (video): video is HTMLVideoElement => Boolean(video)
      )
      if (videos.length === 0) return

      if (event.code === 'Space') {
        event.preventDefault()
        setPlaySpeed?.(1)
        if (isPartiallyPlaying) {
          setIsPartiallyPlaying?.(false)
          setIsPlaying?.(false)
        } else {
          setIsPlaying?.((prev) => !prev)
        }
        return
      }

      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault()
        if (isPartiallyPlaying) {
          setIsPartiallyPlaying?.(false)
        }
        const primaryVideo = videos[0]
        const duration = Number.isFinite(primaryVideo.duration)
          ? primaryVideo.duration
          : videoDuration
        const offsetSeconds = event.code === 'ArrowLeft' ? -5 : 5
        const targetTime = Math.max(
          0,
          Math.min(duration, primaryVideo.currentTime + offsetSeconds)
        )
        videos.forEach((video) => {
          video.currentTime = targetTime
        })
        setCurrentFrame(
          Math.max(
            1,
            Math.min(totalFrames, Math.round(targetTime * frameRate) + 1)
          )
        )
      }
    }

    const handleLoadedMetadata = (event: Event) => {
      const video = event.currentTarget as HTMLVideoElement
      if (video) {
        setVideoDuration(video.duration)
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    const videos = [...videoRefs.current]
    videos.forEach((video) => {
      if (video) {
        video.addEventListener('loadedmetadata', handleLoadedMetadata)
      }
    })

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      videos.forEach((video) => {
        if (video) {
          video.removeEventListener('loadedmetadata', handleLoadedMetadata)
        }
      })
    }
  }, [
    setIsPlaying,
    setIsPartiallyPlaying,
    setPlaySpeed,
    setVideoDuration,
    setCurrentFrame,
    frameRate,
    isEditing,
    isPartiallyPlaying,
    totalFrames,
    videoDuration,
    videoSrcs
  ])

  useEffect(() => {
    videoRefs.current.forEach((video) => {
      if (video && !isPlaying && !isPartiallyPlaying) {
        // 小数第1位までしか値がないときに、再生位置がずれる問題を解消するために、0.001を足している
        video.currentTime =
          Math.round(((currentFrame - 1) / frameRate) * 1000) / 1000 + 0.001
      }
    })
  }, [currentFrame, isPlaying, isPartiallyPlaying, frameRate])

  useEffect(() => {
    if (!isPartiallyPlaying) {
      setIsPartialPlaybackReady(false)
      return
    }
    if (selectionStartFrame < 1 || selectionFrameWidth < 1) {
      setIsPartialPlaybackReady(false)
      setIsPartiallyPlaying?.(false)
      return
    }

    setIsPartialPlaybackReady(false)

    const startTime =
      Math.round(((selectionStartFrame - 1) / frameRate) * 1000) / 1000 + 0.001

    let canceled = false
    const startPartialPlayback = async () => {
      const videos = videoRefs.current.filter(
        (video): video is HTMLVideoElement => Boolean(video)
      )
      await Promise.all(
        videos.map(async (video) => {
          await seekVideo(video, startTime)
        })
      )
      if (canceled) return
      await Promise.all(
        videos.map(async (video) => {
          video.playbackRate = playSpeed || 1
          await video.play()
        })
      )
      if (!canceled) {
        setIsPartialPlaybackReady(true)
      }
    }

    void startPartialPlayback().catch((error) => {
      if (canceled) return
      console.error('Partial playback failed:', error)
      setIsPartialPlaybackReady(false)
      setIsPartiallyPlaying?.(false)
    })

    return () => {
      canceled = true
    }
  }, [
    isPartiallyPlaying,
    selectionStartFrame,
    selectionFrameWidth,
    frameRate,
    playSpeed,
    setIsPartiallyPlaying
  ])

  useEffect(() => {
    videoRefs.current.forEach((video) => {
      if (!video) return

      const shouldPlay = isPlaying || isPartiallyPlaying

      if (isPartiallyPlaying) {
        return
      }
      if (shouldPlay) {
        video.playbackRate = playSpeed || 1
        const p = video.play()
        if (p !== undefined) p.catch(() => {})
      } else {
        video.pause()
      }
    })
  }, [isPlaying, isPartiallyPlaying, playSpeed])

  useEffect(() => {
    const updateCurrentFrame = () => {
      videoRefs.current.forEach((video) => {
        if (video && !isEditing) {
          const frame = Math.round(video.currentTime * frameRate)
          setCurrentFrame(frame + 1)
          if (isPlaying) {
            if (frame == totalFrames) {
              setIsPlaying?.(false)
            }
          } else if (isPartiallyPlaying) {
            if (video.currentTime >= selectionEndBoundaryTime) {
              video.pause()
              video.currentTime = selectionEndBoundaryTime
              setCurrentFrame(selectionStopFrame)
              setIsPartiallyPlaying?.(false)
            }
          }
        }
      })
      animationFrameId.current = requestAnimationFrame(updateCurrentFrame)
    }

    if (isPlaying || (isPartiallyPlaying && isPartialPlaybackReady)) {
      animationFrameId.current = requestAnimationFrame(updateCurrentFrame)
    }

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current)
      }
    }
  }, [
    isPlaying,
    isPartiallyPlaying,
    isPartialPlaybackReady,
    isEditing,
    frameRate,
    selectionEndBoundaryTime,
    selectionStopFrame,
    totalFrames,
    setCurrentFrame,
    setIsPlaying,
    setIsPartiallyPlaying
  ])

  const getVideoStyle = (index: number) => {
    const totalVideos = videoSrcs.length
    if (totalVideos === 1) {
      return { height: '100%' }
    } else if (totalVideos === 2) {
      return { width: '50%' }
    } else if (totalVideos === 3) {
      if (index === 0) {
        return { width: '50%', height: '100%' }
      } else {
        return { width: '50%', height: '50%' }
      }
    }
    return { width: '100%' }
  }

  return (
    <section className="video">
      {videoSrcs.map((src, index) => (
        <video
          key={index}
          ref={(el) => (videoRefs.current[index] = el)}
          src={src}
          style={getVideoStyle(index)}
          controls={false}
        />
      ))}
      {!videoSrcs[0] && <video />}
    </section>
  )
}

export default Video
