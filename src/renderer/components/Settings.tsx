import React, { useEffect, useRef, useState } from 'react'
import type { ApiStatus } from '../../main/preload'
import type {
  AnnotationProject,
  SimilarMotionCandidate,
  SelectedTimelineAnnotation,
  TimelineAnnotationResult
} from '../types'
import {
  OpenFile,
  AutoAnnotation,
  AudioVideoControls,
  ExportFile,
  SimilarityCompletion
} from './settings_components'

interface SettingsProps {
  setIsProcessing: (isProcessing: boolean) => void
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
  currentFrame: number
  selectionStartFrame: number
  selectionFrameWidth: number
  selectedTimelineAnnotation: SelectedTimelineAnnotation | null
}

export const Settings: React.FC<SettingsProps> = ({
  setIsProcessing,
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
  currentFrame,
  selectionStartFrame,
  selectionFrameWidth,
  selectedTimelineAnnotation
}) => {
  const [selectedTabIndex, setSelectedTabIndex] = useState(0)
  const tabHeaderRef = useRef<HTMLDivElement>(null)

  const tabs = [
    {
      label: 'ファイルを開く',
      component: () => (
        <OpenFile
          setIsProcessing={setIsProcessing}
          setVideoSrcs={setVideoSrcs}
          setFrameRate={setFrameRate}
          onImportProjectJson={onImportProjectJson}
        />
      )
    },
    {
      label: '動作範囲検出',
      component: () => (
        <AutoAnnotation
          setIsProcessing={setIsProcessing}
          setIsEditing={setIsEditing}
          setAutoAnnotationResponseData={setAutoAnnotationResponseData}
          apiStatus={apiStatus}
          frameRate={frameRate}
          videoSrcs={videoSrcs}
          currentFrame={currentFrame}
          selectionStartFrame={selectionStartFrame}
          selectionFrameWidth={selectionFrameWidth}
        />
      )
    },
    {
      label: '注釈補完',
      component: () => (
        <SimilarityCompletion
          setIsProcessing={setIsProcessing}
          setSimilarMotionCandidates={setSimilarMotionCandidates}
          apiStatus={apiStatus}
          frameRate={frameRate}
          currentFrame={currentFrame}
          selectedTimelineAnnotation={selectedTimelineAnnotation}
          videoSrcs={videoSrcs}
          selectionStartFrame={selectionStartFrame}
          selectionFrameWidth={selectionFrameWidth}
        />
      )
    },
    {
      label: '再生速度',
      component: () => (
        <AudioVideoControls playSpeed={playSpeed} setPlaySpeed={setPlaySpeed} />
      )
    },
    {
      label: 'ファイルをエクスポート',
      component: () => (
        <ExportFile
          onExportCSV={onExportCSV}
          onExportEAF={onExportEAF}
          onExportProjectJson={onExportProjectJson}
        />
      )
    }
  ]

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
  }, [])

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
    <section className="settings">
      {/* タブのヘッダー */}
      <div className="tab-header" ref={tabHeaderRef}>
        {tabs.map((tab, index) => (
          <div
            key={index}
            className={`tab-button ${selectedTabIndex === index ? 'active' : ''}`}
            onClick={() => setSelectedTabIndex(index)}
          >
            {tab.label}
          </div>
        ))}
      </div>

      {/* タブのコンテンツ */}
      <div className="tab-content">
        {tabs.map((tab, index) => (
          <div
            key={index}
            style={{ display: selectedTabIndex === index ? 'block' : 'none' }}
          >
            {tab.component()}
          </div>
        ))}
      </div>
    </section>
  )
}

export default Settings
