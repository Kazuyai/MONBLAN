import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const [expandedTabIndex, setExpandedTabIndex] = useState<number | null>(null)
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
    if (expandedTabIndex === null) return
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !document.querySelector('.analysis-step-dialog-backdrop')
      ) {
        setExpandedTabIndex(null)
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [expandedTabIndex])

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
              className={`tab-panel${expandedTabIndex === index ? ' expanded' : ''}`}
              style={{ display: selectedTabIndex === index ? 'flex' : 'none' }}
              role={expandedTabIndex === index ? 'dialog' : undefined}
              aria-modal={expandedTabIndex === index ? true : undefined}
              aria-labelledby={expandedTabIndex === index ? `settings-tab-title-${index}` : undefined}
              onKeyDown={expandedTabIndex === index ? keepFocusInExpandedTab : undefined}
            >
              <div className="tab-panel-toolbar">
                {expandedTabIndex === index && (
                  <h2 id={`settings-tab-title-${index}`}>{tab.label}</h2>
                )}
                <button
                  type="button"
                  className="tab-panel-expand-button"
                  aria-label={
                    expandedTabIndex === index
                      ? `${tab.label}の拡大表示を閉じる`
                      : `${tab.label}を拡大表示`
                  }
                  onClick={() =>
                    setExpandedTabIndex(expandedTabIndex === index ? null : index)
                  }
                >
                  {expandedTabIndex === index ? '×' : '拡大表示'}
                </button>
              </div>
              <div className="tab-panel-body">{tab.component()}</div>
            </div>
          ))}
        </div>
      </section>
      {expandedTabIndex !== null &&
        createPortal(
          <div
            className="tab-panel-backdrop"
            onMouseDown={() => setExpandedTabIndex(null)}
            aria-hidden="true"
          />,
          document.body
        )}
    </>
  )
}

export default Settings
