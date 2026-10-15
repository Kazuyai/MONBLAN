import React, { useState } from 'react'
import type { AnnotationProject } from '../../types'

interface SettingsProps {
  setIsProcessing: (isProcessing: boolean) => void
  setVideoSrcs: (srcs: string[]) => void
  setFrameRate: (frameRate: number) => void
  onImportProjectJson: (project: AnnotationProject) => void
}

const FALLBACK_FRAME_RATE = 30
const NO_VIDEO_SELECTED_MESSAGE = '動画ファイルが選択されていません'

export const OpenFile: React.FC<SettingsProps> = ({
  setIsProcessing,
  setVideoSrcs,
  setFrameRate,
  onImportProjectJson
}) => {
  const [selectedVideoFiles, setSelectedVideoFiles] = useState<File[]>([])
  const [hasSelectedFiles, setHasSelectedFiles] = useState(false)
  const [selectedFileSummary, setSelectedFileSummary] = useState(
    NO_VIDEO_SELECTED_MESSAGE
  )
  const [isVideoDragActive, setIsVideoDragActive] = useState(false)
  const [isProjectDragActive, setIsProjectDragActive] = useState(false)
  const [frameRateWarning, setFrameRateWarning] = useState<string | null>(null)
  const [showManualFrameRateInput, setShowManualFrameRateInput] =
    useState(false)
  const [manualFrameRate, setManualFrameRate] = useState(
    String(FALLBACK_FRAME_RATE)
  )

  const getElectronFilePath = (file: File) => {
    const electronFile = file as File & { path?: string }
    return electronFile.path || null
  }

  const waitForVideoMetadata = (videoUrl: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        resolve()
      }
      video.onerror = () => reject(new Error('動画の読み込みに失敗しました'))
      video.src = videoUrl
    })
  }

  const applyFrameRate = (frameRate: number) => {
    setFrameRate(frameRate)
    setManualFrameRate(String(frameRate))
  }

  const applyManualFrameRate = () => {
    const parsedFrameRate = Number(manualFrameRate)
    if (!Number.isFinite(parsedFrameRate) || parsedFrameRate <= 0) {
      setFrameRateWarning('フレームレートには0より大きい数値を入力してください。')
      setShowManualFrameRateInput(true)
      return
    }

    setFrameRate(parsedFrameRate)
    setFrameRateWarning(`フレームレートを ${parsedFrameRate}fps に設定しました。`)
    setShowManualFrameRateInput(false)
  }

  const isAnnotationProject = (value: unknown): value is AnnotationProject => {
    if (!value || typeof value !== 'object') return false

    const project = value as Partial<AnnotationProject>
    const videos = project.videos as unknown[] | undefined
    const layerNames = project.layerNames as unknown[] | undefined
    const annotations = project.annotations as unknown[] | undefined

    return (
      project.version === 1 &&
      typeof project.frameRate === 'number' &&
      Number.isFinite(project.frameRate) &&
      project.frameRate > 0 &&
      typeof project.videoDuration === 'number' &&
      Number.isFinite(project.videoDuration) &&
      project.videoDuration >= 0 &&
      Array.isArray(videos) &&
      videos.every(
        (video) =>
          Boolean(video) &&
          typeof video === 'object' &&
          typeof (video as { name?: unknown }).name === 'string' &&
          ((video as { path?: unknown }).path === undefined ||
            typeof (video as { path?: unknown }).path === 'string')
      ) &&
      Array.isArray(layerNames) &&
      layerNames.every((layerName) => typeof layerName === 'string') &&
      Array.isArray(annotations) &&
      annotations.every(
        (annotation) =>
          Boolean(annotation) &&
          typeof annotation === 'object' &&
          typeof (annotation as { id?: unknown }).id === 'string' &&
          typeof (annotation as { startFrame?: unknown }).startFrame ===
            'number' &&
          typeof (annotation as { endFrame?: unknown }).endFrame === 'number' &&
          typeof (annotation as { text?: unknown }).text === 'string' &&
          typeof (annotation as { layerIndex?: unknown }).layerIndex ===
            'number'
      )
    )
  }

  const importProjectJson = async (file: File) => {
    setFrameRateWarning(null)
    setShowManualFrameRateInput(false)
    try {
      const text = await file.text()
      const project = JSON.parse(text)
      if (!isAnnotationProject(project)) {
        throw new Error('Unsupported project file format')
      }

      onImportProjectJson(project)
      setManualFrameRate(String(project.frameRate))
      setFrameRateWarning(
        'プロジェクトを読み込みました。動画が表示されない場合は、動画ファイルを開き直してください。'
      )
    } catch (error) {
      console.error('Project import failed:', error)
      setFrameRateWarning('プロジェクトファイルの読み込みに失敗しました。')
      setShowManualFrameRateInput(false)
    }
  }

  const getUploadedFrameRate = (file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    return fetch('http://127.0.0.1:8000/get_framerate/', {
      method: 'POST',
      body: formData
    })
  }

  const updateSelectedVideoFiles = (files: File[]) => {
    setSelectedVideoFiles(files)
    setHasSelectedFiles(files.length > 0)

    if (files.length === 0) {
      setSelectedFileSummary(NO_VIDEO_SELECTED_MESSAGE)
      return
    }

    const firstFileName = files[0].name
    setSelectedFileSummary(
      files.length === 1
        ? firstFileName
        : `${firstFileName} ほか ${files.length - 1}件`
    )
  }

  const setInputFiles = (inputId: string, files: File[]) => {
    const input = document.getElementById(inputId) as HTMLInputElement | null
    if (!input || files.length === 0) return

    const dataTransfer = new DataTransfer()
    files.forEach((file) => dataTransfer.items.add(file))
    input.files = dataTransfer.files
  }

  const getDroppedFiles = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    return Array.from(event.dataTransfer.files)
  }

  const openFile = async () => {
    const input = document.getElementById('input') as HTMLInputElement | null
    const files =
      selectedVideoFiles.length > 0
        ? selectedVideoFiles
        : Array.from(input?.files ?? [])
    if (files.length === 0) return

    setIsProcessing(true)
    setFrameRateWarning(null)
    setShowManualFrameRateInput(false)
    const urls = files.map((file) => URL.createObjectURL(file))

    const fileNames = files.map((file) => file.name)
    const filePaths = files.map((file) => getElectronFilePath(file) ?? '')
    localStorage.setItem('videoFileNames', JSON.stringify(fileNames))
    localStorage.setItem('videoFilePaths', JSON.stringify(filePaths))

    setVideoSrcs(urls)

    const file = files[0]

    try {
      const filePath = getElectronFilePath(file)
      let response = filePath
        ? await fetch('http://127.0.0.1:8000/get_framerate_from_path/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ file_path: filePath })
          })
        : await getUploadedFrameRate(file)

      if (filePath && !response.ok) {
        response = await getUploadedFrameRate(file)
      }

      if (response.ok) {
        const data = await response.json()
        const detectedFrameRate = Number(data.frame_rate)
        if (!Number.isFinite(detectedFrameRate) || detectedFrameRate <= 0) {
          throw new Error(`Invalid frame rate: ${data.frame_rate}`)
        }
        applyFrameRate(detectedFrameRate)
      } else {
        throw new Error('Server response not ok')
      }
    } catch (error) {
      try {
        await waitForVideoMetadata(urls[0])
      } catch (localError) {
        console.error('Local frame rate detection failed:', localError)
      }

      console.error('Frame rate detection failed:', error)
      applyFrameRate(FALLBACK_FRAME_RATE)
      setFrameRateWarning(
        `${FALLBACK_FRAME_RATE}fpsとして仮読み込みしました。実際のfpsと異なる場合は手動で修正してください。`
      )
      setShowManualFrameRateInput(true)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleVideoFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    updateSelectedVideoFiles(files)
  }

  const handleVideoDrop = (event: React.DragEvent<HTMLElement>) => {
    const files = getDroppedFiles(event).filter((file) =>
      file.type.startsWith('video/')
    )
    setIsVideoDragActive(false)
    updateSelectedVideoFiles(files)
    setInputFiles('input', files)
  }

  const handleProjectDrop = (event: React.DragEvent<HTMLElement>) => {
    const file = getDroppedFiles(event)[0]
    setIsProjectDragActive(false)
    if (!file) return

    setInputFiles('project-input', [file])
    importProjectJson(file)
  }

  return (
    <div id="open-file">
      <section className="file-open-card">
        <div className="file-open-card-text">
          <h2>動画を開く</h2>
          <p>アノテーション対象の動画ファイルを選択して開きます。</p>
        </div>
        <input
          className="file-input-hidden"
          type="file"
          id="input"
          accept="video/*"
          multiple
          onChange={handleVideoFileChange}
        />
        <label
          className={`file-drop-zone ${isVideoDragActive ? 'drag-active' : ''}`}
          htmlFor="input"
          onDragEnter={(event) => {
            event.preventDefault()
            setIsVideoDragActive(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault()
            setIsVideoDragActive(false)
          }}
          onDrop={handleVideoDrop}
        >
          <span className="file-drop-zone-icon">＋</span>
          <span className="file-drop-zone-title">
            動画ファイルをドラッグ＆ドロップ
          </span>
          <span className="file-drop-zone-subtitle">
            またはクリックしてファイルを選択
          </span>
        </label>
        <div className="file-open-actions">
          <button
            className="file-open-button primary-action"
            disabled={!hasSelectedFiles}
            onClick={() => openFile()}
          >
            開く
          </button>
        </div>
        <p
          className={`file-selection-summary ${
            hasSelectedFiles ? 'selected' : ''
          }`}
        >
          {selectedFileSummary}
        </p>
      </section>
      <section className="file-open-card">
        <div className="file-open-card-text">
          <h2>プロジェクトを読み込む</h2>
          <p>保存済みのプロジェクトJSONから作業を再開します。</p>
        </div>
        <input
          className="file-input-hidden"
          type="file"
          id="project-input"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) {
              importProjectJson(file)
            }
            event.currentTarget.value = ''
          }}
        />
        <label
          className={`file-drop-zone ${
            isProjectDragActive ? 'drag-active' : ''
          }`}
          htmlFor="project-input"
          onDragEnter={(event) => {
            event.preventDefault()
            setIsProjectDragActive(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault()
            setIsProjectDragActive(false)
          }}
          onDrop={handleProjectDrop}
        >
          <span className="file-drop-zone-icon">＋</span>
          <span className="file-drop-zone-title">
            プロジェクトJSONをドラッグ＆ドロップ
          </span>
          <span className="file-drop-zone-subtitle">
            またはクリックしてプロジェクトを選択
          </span>
        </label>
      </section>
      {frameRateWarning && (
        <div className="frame-rate-warning">
          <p>{frameRateWarning}</p>
          {showManualFrameRateInput && (
            <div className="manual-frame-rate">
              <label htmlFor="manual-frame-rate">fps</label>
              <input
                id="manual-frame-rate"
                type="number"
                min="0.001"
                step="0.001"
                value={manualFrameRate}
                onChange={(event) => setManualFrameRate(event.target.value)}
              />
              <button type="button" onClick={applyManualFrameRate}>
                適用
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default OpenFile
