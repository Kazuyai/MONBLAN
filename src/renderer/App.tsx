import { useEffect, useRef, useState } from 'react'
import { Video, Settings, Timeline, Processing } from './components'
import './App.scss'

const App = () => {
  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [videoSrcs, setVideoSrcs] = useState<string[]>([])
  const [videoDuration, setVideoDuration] = useState<number>(0)
  const [isEditing, setIsEditing] = useState<boolean>(false)
  const [frameRate, setFrameRate] = useState<number>(30)
  const [currentFrame, setCurrentFrame] = useState<number>(1)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [playSpeed, setPlaySpeed] = useState<number>(1)
  const [isPartiallyPlaying, setIsPartiallyPlaying] = useState<boolean>(false)

  const [selectionStartFrame, setSelectionStartFrame] = useState<number>(0)
  const [selectionFrameWidth, setSelectionFrameWidth] = useState<number>(0)

  const [autoAnnotationResponseData, setAutoAnnotationResponseData] = useState<{
    startFrame: number
    endFrame: number
    text: string
    layerName: string
    layerIndex: number
  }[]>([])

  const timelineRef = useRef<{ exportCSV: () => void }>(null)

  const MAX_HEIGHT = 80

  const containerRef = useRef<HTMLDivElement>(null)
  const [topHeight, setTopHeight] = useState<number>(55)
  const [isResizing, setIsResizing] = useState<boolean>(false)

  const handleExportCSV = () => {
    if (timelineRef.current) {
      timelineRef.current.exportCSV()
    }
  }

  const startVerticalResizing = (e: React.MouseEvent) => {
    setIsResizing(true)
    e.preventDefault()
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const percent = ((e.clientY - rect.top) / rect.height) * 100
      setTopHeight(Math.max(100 - MAX_HEIGHT, Math.min(MAX_HEIGHT, percent)))
    }
    const stopResizing = () => setIsResizing(false)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', stopResizing)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', stopResizing)
    }
  }, [isResizing])

  return (
    <div ref={containerRef}>
      <div id="up" style={{ height: `calc(${topHeight}% - 1.5rem)` }}>
        <Video
          videoSrcs={videoSrcs}
          videoDuration={videoDuration}
          setVideoDuration={setVideoDuration}
          isEditing={isEditing}
          currentFrame={currentFrame}
          setCurrentFrame={setCurrentFrame}
          frameRate={frameRate}
          isPlaying={isPlaying}
          setIsPlaying={setIsPlaying}
          playSpeed={playSpeed}
          setPlaySpeed={setPlaySpeed}
          isPartiallyPlaying={isPartiallyPlaying}
          setIsPartiallyPlaying={setIsPartiallyPlaying}
          selectionStartFrame={selectionStartFrame}
          selectionFrameWidth={selectionFrameWidth}
        />
        <Settings
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          setVideoSrcs={setVideoSrcs}
          setIsEditing={setIsEditing}
          setFrameRate={setFrameRate}
          playSpeed={playSpeed}
          setPlaySpeed={setPlaySpeed}
          onExportCSV={handleExportCSV}
          setAutoAnnotationResponseData={setAutoAnnotationResponseData}
        />
      </div>
      <div id="divider" onMouseDown={startVerticalResizing}></div>
      <Timeline
        ref={timelineRef}
        videoSrcs={videoSrcs}
        videoDuration={videoDuration}
        isEditing={isEditing}
        setIsEditing={setIsEditing}
        frameRate={frameRate}
        currentFrame={currentFrame}
        setCurrentFrame={setCurrentFrame}
        selectionStartFrame={selectionStartFrame}
        setSelectionStartFrame={setSelectionStartFrame}
        setSelectionFrameWidth={setSelectionFrameWidth}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        isPartiallyPlaying={isPartiallyPlaying}
        setIsPartiallyPlaying={setIsPartiallyPlaying}
        setPlaySpeed={setPlaySpeed}
        autoAnnotationResponseData={autoAnnotationResponseData}
        topHeight={topHeight}
      />
      {isProcessing && <Processing />}
    </div>
  )
}

export default App