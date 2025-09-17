import React, { useEffect, useRef, useState } from 'react'
import {
  OpenFile,
  AutoAnnotation,
  AudioVideoControls,
  ExportFile
} from './settings_components'
import Processing from './Processing'

interface SettingsProps {
  isProcessing: boolean
  setIsProcessing: (isProcessing: boolean) => void
  setVideoSrcs: (srcs: string[]) => void
  setIsEditing: (isEditing: boolean) => void
  setFrameRate: (frameRate: number) => void
  playSpeed: number
  setPlaySpeed: (playSpeed: number) => void
  onExportCSV: () => void
  onExportEAF: () => void
  setAutoAnnotationResponseData: (
    data: {
      startFrame: number
      endFrame: number
      text: string
      layerName: string
      layerIndex: number
    }[]
  ) => void
}

export const Settings: React.FC<SettingsProps> = ({
  isProcessing,
  setIsProcessing,
  setVideoSrcs,
  setIsEditing,
  setFrameRate,
  playSpeed,
  setPlaySpeed,
  onExportCSV,
  onExportEAF,
  setAutoAnnotationResponseData
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
        <ExportFile onExportCSV={onExportCSV} onExportEAF={onExportEAF} />
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
      {isProcessing && <Processing />}
    </section>
  )
}

export default Settings
