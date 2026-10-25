import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiStatus } from '../main/preload'
import type {
  AnalysisFrameRange,
  AnnotationProject,
  ProcessingTask,
  SimilarMotionCandidate,
  SelectedTimelineAnnotation,
  TimelineAnnotationResult
} from './types'
import { Video, Settings, Timeline, Processing } from './components'
import './App.scss'

const App = () => {
  const [processingTask, setProcessingTask] = useState<ProcessingTask | null>(
    null
  )
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null)
  const [videoSrcs, setVideoSrcs] = useState<string[]>([])
  const [videoDuration, setVideoDuration] = useState<number>(0)
  const [isEditing, setIsEditing] = useState<boolean>(false)
  const [frameRate, setFrameRate] = useState<number>(30)
  const [currentFrame, setCurrentFrame] = useState<number>(1)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [playSpeed, setPlaySpeed] = useState<number>(1)
  const [isPartiallyPlaying, setIsPartiallyPlaying] = useState<boolean>(false)
  const previousVideoSrcsRef = useRef<string[]>([])
  const [projectFilePath, setProjectFilePath] = useState<string | null>(null)

  const [selectionStartFrame, setSelectionStartFrame] = useState<number>(0)
  const [selectionFrameWidth, setSelectionFrameWidth] = useState<number>(0)
  const [analysisRangePreview, setAnalysisRangePreview] =
    useState<AnalysisFrameRange | null>(null)

  const [autoAnnotationResponseData, setAutoAnnotationResponseData] = useState<
    TimelineAnnotationResult[]
  >([])
  const [similarMotionCandidates, setSimilarMotionCandidates] = useState<
    SimilarMotionCandidate[]
  >([])
  const [selectedTimelineAnnotation, setSelectedTimelineAnnotation] =
    useState<SelectedTimelineAnnotation | null>(null)
  const [timelineLayerNames, setTimelineLayerNames] = useState<string[]>([
    'レイヤー1',
    'レイヤー2',
    'レイヤー3'
  ])

  const timelineRef = useRef<{
    exportCSV: () => Promise<void>
    exportEAF: () => Promise<void>
    saveProjectJson: (filePath?: string) => Promise<string | null>
    importProjectJson: (project: AnnotationProject) => void
    addLayer: (name: string) => number
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

  const refreshApiStatus = async () => {
    if (!window.electronAPI) {
      throw new Error('Electron APIを利用できません。')
    }
    const status = await window.electronAPI.refreshApiStatus()
    setApiStatus(status)
  }

  const restartApi = async () => {
    if (!window.electronAPI) {
      throw new Error('Electron APIを利用できません。')
    }
    const status = await window.electronAPI.restartApi()
    setApiStatus(status)
  }

  useEffect(() => {
    const previousVideoSrcs = previousVideoSrcsRef.current
    const currentVideoSrcs = new Set(videoSrcs)

    previousVideoSrcs
      .filter((src) => src.startsWith('blob:') && !currentVideoSrcs.has(src))
      .forEach((src) => URL.revokeObjectURL(src))

    previousVideoSrcsRef.current = videoSrcs
  }, [videoSrcs])

  useEffect(() => {
    return () => {
      previousVideoSrcsRef.current
        .filter((src) => src.startsWith('blob:'))
        .forEach((src) => URL.revokeObjectURL(src))
      previousVideoSrcsRef.current = []
    }
  }, [])

  const handleExportCSV = () => {
    if (timelineRef.current) {
      void timelineRef.current.exportCSV()
    }
  }

  const handleExportEAF = () => {
    if (timelineRef.current) {
      void timelineRef.current.exportEAF()
    }
  }

  const handleSaveProjectJson = useCallback(async () => {
    if (!timelineRef.current) return
    const savedPath = await timelineRef.current.saveProjectJson(
      projectFilePath ?? undefined
    )
    if (savedPath) setProjectFilePath(savedPath)
  }, [projectFilePath])

  const handleImportProjectJson = (
    project: AnnotationProject,
    sourceFilePath?: string
  ) => {
    if (!timelineRef.current) return

    setFrameRate(project.frameRate)
    setVideoDuration(project.videoDuration)
    setCurrentFrame(1)
    setIsPlaying(false)
    setIsPartiallyPlaying(false)
    setSelectionStartFrame(0)
    setSelectionFrameWidth(0)
    setAnalysisRangePreview(null)
    setAutoAnnotationResponseData([])
    setSimilarMotionCandidates([])
    setSelectedTimelineAnnotation(null)
    setProjectFilePath(sourceFilePath ?? null)

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

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 's'
      ) {
        return
      }
      event.preventDefault()
      if (event.repeat) return
      const activeElement = document.activeElement
      if (activeElement instanceof HTMLElement) activeElement.blur()
      window.setTimeout(() => void handleSaveProjectJson(), 0)
    }

    document.addEventListener('keydown', handleSaveShortcut)
    return () => document.removeEventListener('keydown', handleSaveShortcut)
  }, [handleSaveProjectJson])

  const handleCreateTimelineLayer = (name: string) => {
    return timelineRef.current?.addLayer(name) ?? null
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
          setProcessingTask={setProcessingTask}
          setVideoSrcs={setVideoSrcs}
          videoSrcs={videoSrcs}
          setIsEditing={setIsEditing}
          setFrameRate={setFrameRate}
          playSpeed={playSpeed}
          setPlaySpeed={setPlaySpeed}
          onExportCSV={handleExportCSV}
          onExportEAF={handleExportEAF}
          onSaveProject={handleSaveProjectJson}
          onImportProjectJson={handleImportProjectJson}
          setAutoAnnotationResponseData={setAutoAnnotationResponseData}
          setSimilarMotionCandidates={setSimilarMotionCandidates}
          apiStatus={apiStatus}
          frameRate={frameRate}
          videoDuration={videoDuration}
          currentFrame={currentFrame}
          selectionStartFrame={selectionStartFrame}
          selectionFrameWidth={selectionFrameWidth}
          selectedTimelineAnnotation={selectedTimelineAnnotation}
          timelineLayerNames={timelineLayerNames}
          onCreateTimelineLayer={handleCreateTimelineLayer}
          onRefreshApiStatus={refreshApiStatus}
          onRestartApi={restartApi}
          onAnalysisRangePreviewChange={setAnalysisRangePreview}
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
        analysisRangePreview={analysisRangePreview}
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
        onLayerNamesChange={setTimelineLayerNames}
        topHeight={topHeight}
      />
      {processingTask && <Processing task={processingTask} />}
    </div>
  )
}

export default App
