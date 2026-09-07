import { useEffect, useRef, useState } from 'react'
import type { ApiStatus } from '../main/preload'
import type {
  AnnotationProject,
  SimilarMotionCandidate,
  SelectedTimelineAnnotation,
  TimelineAnnotationResult
} from './types'
import { Video, Settings, Timeline, Processing } from './components'
import './App.scss'

const App = () => {
  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null)
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

  const [autoAnnotationResponseData, setAutoAnnotationResponseData] = useState<
    TimelineAnnotationResult[]
  >([])
  const [similarMotionCandidates, setSimilarMotionCandidates] = useState<
    SimilarMotionCandidate[]
  >([])
  const [selectedTimelineAnnotation, setSelectedTimelineAnnotation] =
    useState<SelectedTimelineAnnotation | null>(null)

  const timelineRef = useRef<{
    exportCSV: () => void
    exportEAF: () => void
    exportProjectJson: () => void
    importProjectJson: (project: AnnotationProject) => void
  }>(null)

  const MAX_HEIGHT = 80

  const containerRef = useRef<HTMLDivElement>(null)
  const [topHeight, setTopHeight] = useState<number>(55)
  const [isResizing, setIsResizing] = useState<boolean>(false)

  useEffect(() => {
    let isMounted = true
    const unsubscribe = window.electronAPI?.onApiStatusChanged(setApiStatus)

    const loadApiStatus = async () => {
      try {
        const status = await window.electronAPI?.getApiStatus()
        if (!isMounted || !status) return

        setApiStatus(status)

        if (status.status === 'starting' || status.aiAvailable === null) {
          const refreshedStatus = await window.electronAPI?.refreshApiStatus()
          if (isMounted && refreshedStatus) {
            setApiStatus(refreshedStatus)
          }
        }
      } catch (error) {
        console.error('Failed to get API status:', error)
      }
    }

    loadApiStatus()

    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [])

  const handleExportCSV = () => {
    if (timelineRef.current) {
      timelineRef.current.exportCSV()
    }
  }

  const handleExportEAF = () => {
    if (timelineRef.current) {
      timelineRef.current.exportEAF()
    }
  }

  const handleExportProjectJson = () => {
    if (timelineRef.current) {
      timelineRef.current.exportProjectJson()
    }
  }

  const handleImportProjectJson = (project: AnnotationProject) => {
    if (!timelineRef.current) return

    setFrameRate(project.frameRate)
    setVideoDuration(project.videoDuration)
    setCurrentFrame(1)
    setIsPlaying(false)
    setIsPartiallyPlaying(false)
    setSelectionStartFrame(0)
    setSelectionFrameWidth(0)
    setAutoAnnotationResponseData([])
    setSimilarMotionCandidates([])
    setSelectedTimelineAnnotation(null)

    localStorage.setItem(
      'videoFileNames',
      JSON.stringify(project.videos.map((video) => video.name))
    )
    localStorage.setItem(
      'videoFilePaths',
      JSON.stringify(project.videos.map((video) => video.path ?? ''))
    )
    setVideoSrcs(
      project.videos
        .map((video) => video.path)
        .filter((path): path is string => Boolean(path))
        .map((path) => `file:///${encodeURI(path.replace(/\\/g, '/'))}`)
    )

    timelineRef.current.importProjectJson(project)
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
          setIsProcessing={setIsProcessing}
          setVideoSrcs={setVideoSrcs}
          videoSrcs={videoSrcs}
          setIsEditing={setIsEditing}
          setFrameRate={setFrameRate}
          playSpeed={playSpeed}
          setPlaySpeed={setPlaySpeed}
          onExportCSV={handleExportCSV}
          onExportEAF={handleExportEAF}
          onExportProjectJson={handleExportProjectJson}
          onImportProjectJson={handleImportProjectJson}
          setAutoAnnotationResponseData={setAutoAnnotationResponseData}
          setSimilarMotionCandidates={setSimilarMotionCandidates}
          apiStatus={apiStatus}
          frameRate={frameRate}
          selectedTimelineAnnotation={selectedTimelineAnnotation}
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
        selectionFrameWidth={selectionFrameWidth}
        setSelectionStartFrame={setSelectionStartFrame}
        setSelectionFrameWidth={setSelectionFrameWidth}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        isPartiallyPlaying={isPartiallyPlaying}
        setIsPartiallyPlaying={setIsPartiallyPlaying}
        setPlaySpeed={setPlaySpeed}
        autoAnnotationResponseData={autoAnnotationResponseData}
        similarMotionCandidates={similarMotionCandidates}
        setSimilarMotionCandidates={setSimilarMotionCandidates}
        setSelectedTimelineAnnotation={setSelectedTimelineAnnotation}
        topHeight={topHeight}
      />
      {isProcessing && <Processing />}
    </div>
  )
}

export default App
