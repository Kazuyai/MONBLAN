import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ApiStatus } from '../../main/preload'
import type {
  AnalysisFrameRange,
  AnnotationProject,
  ProcessingTask,
  SimilarMotionCandidate,
  SelectedTimelineAnnotation,
  TimelineAnnotationResult
} from '../types'
import {
  OpenFile,
  AutoAnnotation,
  AudioVideoControls,
  ExportFile,
  SimilarityCompletion,
  AiEnvironmentSetup
} from './settings_components'

type SettingsTabId =
  | 'open-file'
  | 'auto-annotation'
  | 'similarity-completion'
  | 'play-speed'
  | 'export-file'
  | 'ai-environment'

interface SettingsTab {
  id: SettingsTabId
  label: string
  component: () => React.ReactNode
}

interface SettingsProps {
  setProcessingTask: (task: ProcessingTask | null) => void
  setVideoSrcs: (srcs: string[]) => void
  videoSrcs: string[]
  setIsEditing: (isEditing: boolean) => void
  setFrameRate: (frameRate: number) => void
  playSpeed: number
  setPlaySpeed: (playSpeed: number) => void
  onExportCSV: () => void
  onExportEAF: () => void
  onExportProjectJson: () => void
  onImportProjectJson: (project: AnnotationProject) => void
  setAutoAnnotationResponseData: (data: TimelineAnnotationResult[]) => void
  setSimilarMotionCandidates: (candidates: SimilarMotionCandidate[]) => void
  apiStatus: ApiStatus | null
  frameRate: number
  videoDuration: number
  currentFrame: number
  selectionStartFrame: number
  selectionFrameWidth: number
  selectedTimelineAnnotation: SelectedTimelineAnnotation | null
  timelineLayerNames: string[]
  onCreateTimelineLayer: (name: string) => number | null
  onRefreshApiStatus: () => Promise<void>
  onRestartApi: () => Promise<void>
  onAnalysisRangePreviewChange: (range: AnalysisFrameRange | null) => void
}

const PanelSizeIcon: React.FC<{ expanded: boolean }> = ({ expanded }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {expanded ? (
      <path d="M4 4l6 6m0 0V6m0 4H6m14-6-6 6m0 0V6m0 4h4M4 20l6-6m0 0v4m0-4H6m14 6-6-6m0 0v4m0-4h4" />
    ) : (
      <path d="M10 10 4 4m0 0h5M4 4v5m10 1 6-6m0 0h-5m5 0v5M10 14l-6 6m0 0h5m-5 0v-5m10-1 6 6m0 0h-5m5 0v-5" />
    )}
  </svg>
)

export const Settings: React.FC<SettingsProps> = ({
  setProcessingTask,
  setVideoSrcs,
  videoSrcs,
  setIsEditing,
  setFrameRate,
  playSpeed,
  setPlaySpeed,
  onExportCSV,
  onExportEAF,
  onExportProjectJson,
  onImportProjectJson,
  setAutoAnnotationResponseData,
  setSimilarMotionCandidates,
  apiStatus,
  frameRate,
  videoDuration,
  currentFrame,
  selectionStartFrame,
  selectionFrameWidth,
  selectedTimelineAnnotation,
  timelineLayerNames,
  onCreateTimelineLayer,
  onRefreshApiStatus,
  onRestartApi,
  onAnalysisRangePreviewChange
}) => {
  const [selectedTabId, setSelectedTabId] = useState<SettingsTabId>('open-file')
  const [expandedTabId, setExpandedTabId] = useState<SettingsTabId | null>(null)
  const tabHeaderRef = useRef<HTMLDivElement>(null)
  const aiAvailable =
    apiStatus?.status === 'ready' && apiStatus.aiAvailable === true

  const openFileTab: SettingsTab = {
    label: 'ファイルを開く',
    id: 'open-file',
    component: () => (
      <OpenFile
        setProcessingTask={setProcessingTask}
        setVideoSrcs={setVideoSrcs}
        setFrameRate={setFrameRate}
        frameRate={frameRate}
        onImportProjectJson={onImportProjectJson}
      />
    )
  }
  const autoAnnotationTab: SettingsTab = {
    label: '動作範囲検出',
    id: 'auto-annotation',
    component: () => (
      <AutoAnnotation
        setProcessingTask={setProcessingTask}
        setIsEditing={setIsEditing}
        setAutoAnnotationResponseData={setAutoAnnotationResponseData}
        apiStatus={apiStatus}
        frameRate={frameRate}
        videoDuration={videoDuration}
        videoSrcs={videoSrcs}
        currentFrame={currentFrame}
        selectionStartFrame={selectionStartFrame}
        selectionFrameWidth={selectionFrameWidth}
        timelineLayerNames={timelineLayerNames}
        onCreateTimelineLayer={onCreateTimelineLayer}
        isActive={selectedTabId === 'auto-annotation'}
        onAnalysisRangePreviewChange={onAnalysisRangePreviewChange}
      />
    )
  }
  const similarityCompletionTab: SettingsTab = {
    label: '注釈補完',
    id: 'similarity-completion',
    component: () => (
      <SimilarityCompletion
        setProcessingTask={setProcessingTask}
        setSimilarMotionCandidates={setSimilarMotionCandidates}
        apiStatus={apiStatus}
        frameRate={frameRate}
        videoDuration={videoDuration}
        currentFrame={currentFrame}
        selectedTimelineAnnotation={selectedTimelineAnnotation}
        videoSrcs={videoSrcs}
        selectionStartFrame={selectionStartFrame}
        selectionFrameWidth={selectionFrameWidth}
        isActive={selectedTabId === 'similarity-completion'}
        onAnalysisRangePreviewChange={onAnalysisRangePreviewChange}
      />
    )
  }
  const playSpeedTab: SettingsTab = {
    label: '再生速度',
    id: 'play-speed',
    component: () => (
      <AudioVideoControls playSpeed={playSpeed} setPlaySpeed={setPlaySpeed} />
    )
  }
  const exportFileTab: SettingsTab = {
    label: 'ファイルをエクスポート',
    id: 'export-file',
    component: () => (
      <ExportFile
        onExportCSV={onExportCSV}
        onExportEAF={onExportEAF}
        onExportProjectJson={onExportProjectJson}
      />
    )
  }
  const aiEnvironmentTab: SettingsTab = {
    id: 'ai-environment',
    label: aiAvailable ? 'AI環境' : 'AI環境セットアップ',
    component: () => (
      <AiEnvironmentSetup
        apiStatus={apiStatus}
        onRefresh={onRefreshApiStatus}
        onRestart={onRestartApi}
      />
    )
  }
  const tabs: SettingsTab[] = aiAvailable
    ? [
        openFileTab,
        autoAnnotationTab,
        similarityCompletionTab,
        playSpeedTab,
        exportFileTab,
        aiEnvironmentTab
      ]
    : [openFileTab, aiEnvironmentTab, playSpeedTab, exportFileTab]
  const tabIds = tabs.map((tab) => tab.id).join(',')

  useEffect(() => {
    const visibleTabIds = new Set(tabIds.split(','))
    if (!visibleTabIds.has(selectedTabId)) {
      setSelectedTabId('ai-environment')
    }
    if (expandedTabId !== null && !visibleTabIds.has(expandedTabId)) {
      setExpandedTabId(null)
    }
  }, [expandedTabId, selectedTabId, tabIds])

  useEffect(() => {
    if (
      selectedTabId !== 'auto-annotation' &&
      selectedTabId !== 'similarity-completion'
    ) {
      onAnalysisRangePreviewChange(null)
    }
  }, [onAnalysisRangePreviewChange, selectedTabId])

  useEffect(() => {
    const tabHeader = tabHeaderRef.current

    // タブヘッダーのスクロール幅を取得してCSS変数に設定
    const updateScrollWidth = () => {
      if (tabHeader) {
        const scrollWidth = tabHeader.scrollWidth // スクロール可能な幅
        tabHeader.style.setProperty(
          '--tab-header-scroll-width',
          `${scrollWidth}px`
        )
      }
    }

    // 初期化
    updateScrollWidth()

    // ウィンドウリサイズ時に再計算
    window.addEventListener('resize', updateScrollWidth)

    // クリーンアップ処理
    return () => {
      window.removeEventListener('resize', updateScrollWidth)
    }
  }, [tabIds])

  useEffect(() => {
    if (expandedTabId === null) return
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !document.querySelector('.analysis-step-dialog-backdrop')
      ) {
        setExpandedTabId(null)
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [expandedTabId])

  const keepFocusInExpandedTab = (
    event: React.KeyboardEvent<HTMLDivElement>
  ) => {
    if (event.key !== 'Tab') return
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [tabindex]'
      )
    ).filter(
      (control) =>
        !control.hasAttribute('disabled') && control.getClientRects().length > 0
    )
    const firstControl = controls[0]
    const lastControl = controls[controls.length - 1]
    if (!firstControl || !lastControl) return
    if (event.shiftKey && document.activeElement === firstControl) {
      event.preventDefault()
      lastControl.focus()
    } else if (!event.shiftKey && document.activeElement === lastControl) {
      event.preventDefault()
      firstControl.focus()
    }
  }

  useEffect(() => {
    const tabHeader = tabHeaderRef.current

    const handleWheel = (event: WheelEvent) => {
      if (tabHeader) {
        event.preventDefault() // デフォルトのスクロールを防ぐ
        tabHeader.scrollLeft += event.deltaY // 横スクロールを実行
      }
    }

    // カスタムイベントリスナーを追加（passive: false を指定）
    tabHeader?.addEventListener('wheel', handleWheel, { passive: false })

    // クリーンアップ処理
    return () => {
      tabHeader?.removeEventListener('wheel', handleWheel)
    }
  }, [])

  return (
    <>
      <section className="settings">
        {/* タブのヘッダー */}
        <div className="tab-header" ref={tabHeaderRef}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`tab-button ${selectedTabId === tab.id ? 'active' : ''}`}
              onClick={() => setSelectedTabId(tab.id)}
            >
              {tab.label}
            </div>
          ))}
        </div>

        {/* タブのコンテンツ */}
        <div className="tab-content">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`tab-panel${expandedTabId === tab.id ? ' expanded' : ''}`}
              style={{ display: selectedTabId === tab.id ? 'flex' : 'none' }}
              role={expandedTabId === tab.id ? 'dialog' : undefined}
              aria-modal={expandedTabId === tab.id ? true : undefined}
              aria-labelledby={
                expandedTabId === tab.id
                  ? `settings-tab-title-${tab.id}`
                  : undefined
              }
              onKeyDown={
                expandedTabId === tab.id ? keepFocusInExpandedTab : undefined
              }
            >
              <div className="tab-panel-toolbar">
                {expandedTabId === tab.id && (
                  <h2 id={`settings-tab-title-${tab.id}`}>{tab.label}</h2>
                )}
                <button
                  type="button"
                  className="tab-panel-expand-button"
                  aria-label={
                    expandedTabId === tab.id
                      ? `${tab.label}を元の表示に戻す`
                      : `${tab.label}のパネルを拡大する`
                  }
                  title={
                    expandedTabId === tab.id ? '元の表示に戻す' : 'パネルを拡大'
                  }
                  onClick={() =>
                    setExpandedTabId(expandedTabId === tab.id ? null : tab.id)
                  }
                >
                  <PanelSizeIcon expanded={expandedTabId === tab.id} />
                </button>
              </div>
              <div className="tab-panel-body">{tab.component()}</div>
            </div>
          ))}
        </div>
      </section>
      {expandedTabId !== null &&
        createPortal(
          <div
            className="tab-panel-backdrop"
            onMouseDown={() => setExpandedTabId(null)}
            aria-hidden="true"
          />,
          document.body
        )}
    </>
  )
}

export default Settings
