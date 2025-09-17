import React, {
  useEffect,
  useRef,
  Dispatch,
  SetStateAction,
  useState
} from 'react'

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

  const [selectionEndTime, setSelectionEndTime] = useState<number>(0)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditing) return

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
            if (isEditing) return
            event.preventDefault()
            // if (video.paused) {
            //   video.play();
            // } else {
            //   video.pause();
            // }
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

    videoRefs.current.forEach((video) => {
      if (video) {
        video.addEventListener('loadedmetadata', handleLoadedMetadata)
      }
    })

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      videoRefs.current.forEach((video) => {
        if (video) {
          video.removeEventListener('loadedmetadata', handleLoadedMetadata)
        }
      })
    }
  }, [setVideoDuration, isEditing, videoSrcs])

  useEffect(() => {
    videoRefs.current.forEach((video) => {
      if (video && !isPlaying && !isPartiallyPlaying) {
        // 小数第1位までしか値がないときに、再生位置がずれる問題を解消するために、0.001を足している
        video.currentTime =
          Math.round(((currentFrame - 1) / frameRate) * 1000) / 1000 + 0.001
        // console.log('currentFrame : ' + currentFrame);
        // console.log('playPoint : ' + (currentFrame - 1) / frameRate);
      }
    })
  }, [currentFrame, isPlaying, isPartiallyPlaying, frameRate])

  useEffect(() => {
    if (!isPartiallyPlaying) return
    videoRefs.current.forEach((video) => {
      if (video) {
        const startTime = Math.round(
          (((selectionStartFrame - 1) / frameRate) * 1000) / 1000 + 0.001
        )
        video.playbackRate = playSpeed || 1
        video.currentTime = startTime
      }
    })
  }, [isPartiallyPlaying])

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

  // useEffect(() => {
  //   videoRefs.current.forEach((video) => {
  //     if (video) {
  //       if (isPlaying || isPartiallyPlaying) {
  //         video.playbackRate = playSpeed || 1;
  //         video.play();
  //       } else {
  //         video.pause();
  //       }
  //     }
  //   });
  // }, [isPlaying, isPartiallyPlaying]);

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

  // playSpeedが変更されたときに再生中なら再生速度を変更する
  useEffect(() => {
    videoRefs.current.forEach((video) => {
      if (video && isPlaying) {
        video.playbackRate = playSpeed || 1
      }
    })
  }, [playSpeed])

  useEffect(() => {
    console.log(
      'selectionStartFrame, selectionEndFrame',
      selectionStartFrame,
      selectionFrameWidth
    )
    const endTime =
      (((selectionStartFrame + selectionFrameWidth - 1) / frameRate) * 1000) /
        1000 +
      0.001
    console.log('endTime : ' + endTime)
    setSelectionEndTime(endTime)
  }, [selectionStartFrame, selectionFrameWidth])

  // 部分再生中のフラグが立っているときに、選択範囲を再生する
  // useEffect(() => {
  //   const startTime = (selectionStartFrame - 1) / frameRate;
  //   const endTime = (selectionStartFrame + selectionFrameWidth - 1) / frameRate;

  //   console.log("startFrame, width", selectionStartFrame, selectionFrameWidth);
  //   console.log("startTime + startTime", startTime, endTime);

  //   const cleanups: (() => void)[] = [];
  //     videoRefs.current.forEach(video => {
  //       if (!video) return;

  //       video.currentTime  = startTime + 0.001;
  //       video.play();

  //       const handleTimeUpdate = () => {
  //         console.log("currentTime : " + video.currentTime);
  //         if (video.currentTime >= endTime + 0.001) {
  //           video.pause();
  //           video.currentTime = endTime + 0.001;
  //           console.log("END");
  //           setIsPlaying?.(false);
  //           video.removeEventListener('timeupdate', handleTimeUpdate);
  //         }
  //       };

  //       video.addEventListener('timeupdate', handleTimeUpdate);
  //       cleanups.push(() => video.removeEventListener('timeupdate', handleTimeUpdate));
  //     }
  //   );

  //   return () => {
  //     cleanups.forEach(fn => fn());
  //   };
  // }, [isPartiallyPlaying]);

  // useEffect(() => {
  //   console.log("isPartiallyPlaying : " + isPartiallyPlaying);
  //   if (!isPartiallyPlaying) return;

  //   const startTime = (selectionStartFrame - 1) / frameRate;

  //   videoRefs.current.forEach((video) => {
  //     if (!video) return;

  //     video.currentTime = startTime + 0.001;
  //     video.play();
  //   });
  // }, [isPartiallyPlaying]);

  // useEffect(() => {
  //   console.log("isPartiallyPlaying : " + isPartiallyPlaying);
  //   console.log("isPlaying : " + isPlaying);
  //   if (!isPartiallyPlaying || !isPlaying) return;

  //   const endTime = (selectionStartFrame + selectionFrameWidth - 1) / frameRate;

  //   console.log("Looking for endTime : " + endTime);
  //   videoRefs.current.forEach((video) => {
  //     if (!video) return;

  //     if (video.currentTime >= endTime + 0.001) {
  //       video.pause();
  //       video.currentTime = endTime + 0.001;
  //       setIsPlaying?.(false);
  //     }
  //   });
  // }, [currentFrame]);

  useEffect(() => {
    const endTime =
      (((selectionStartFrame + selectionFrameWidth - 1) / frameRate) * 1000) /
        1000 +
      0.001
    setSelectionEndTime(endTime)
    const updateCurrentFrame = () => {
      videoRefs.current.forEach((video) => {
        if (video && !isEditing) {
          const frame = Math.round(video.currentTime * frameRate)
          // console.log('frame : ' + frame);
          setCurrentFrame(frame + 1)
          if (isPlaying) {
            if (frame == totalFrames) {
              console.log('END')
              setIsPlaying?.(false)
            }
          } else if (isPartiallyPlaying) {
            // const endTime = Math.round(((selectionStartFrame + selectionFrameWidth - 1) / frameRate * 1000) / 1000 + 0.001);
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
  }, [isPlaying, isPartiallyPlaying, isEditing, frameRate, setCurrentFrame])

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
