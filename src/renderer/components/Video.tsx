import React, { useEffect, useRef, Dispatch, SetStateAction } from 'react'

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
  const totalFrames = Math.ceil(videoDuration * frameRate)

  const selectionEndTime =
    Math.round(
      ((selectionStartFrame + selectionFrameWidth - 1) / frameRate) * 1000
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

      videoRefs.current.forEach((video) => {
        if (!video) return

        switch (event.code) {
          case 'ArrowLeft':
            video.currentTime = Math.max(0, video.currentTime - 5)
            break
          case 'ArrowRight':
            video.currentTime = Math.min(video.duration, video.currentTime + 5)
            break
          case 'Space':
            event.preventDefault()
            setIsPlaying?.((prev) => !prev)
            setPlaySpeed?.(1)
            break
          default:
            break
        }
      })
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
  }, [setIsPlaying, setPlaySpeed, setVideoDuration, isEditing, videoSrcs])

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
    if (!isPartiallyPlaying) return

    const startTime =
      Math.round(((selectionStartFrame - 1) / frameRate) * 1000) / 1000 + 0.001

    videoRefs.current.forEach((video) => {
      if (!video) return
      video.currentTime = startTime
      video.playbackRate = playSpeed || 1
    })
  }, [isPartiallyPlaying, selectionStartFrame, frameRate, playSpeed])

  useEffect(() => {
    videoRefs.current.forEach((video) => {
      if (!video) return

      const shouldPlay = isPlaying || isPartiallyPlaying

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
            if (video.currentTime > selectionEndTime) {
              video.currentTime = selectionEndTime
              setIsPartiallyPlaying?.(false)
            }
          }
        }
      })
      animationFrameId.current = requestAnimationFrame(updateCurrentFrame)
    }

    if (isPlaying || isPartiallyPlaying) {
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
    isEditing,
    frameRate,
    selectionEndTime,
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
