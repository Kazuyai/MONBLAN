import React, { useState } from 'react'

interface SettingsProps {
  setIsProcessing: (isProcessing: boolean) => void
  setVideoSrcs: (srcs: string[]) => void
  setFrameRate: (frameRate: number) => void
}

const FALLBACK_FRAME_RATE = 30

export const OpenFile: React.FC<SettingsProps> = ({
  setIsProcessing,
  setVideoSrcs,
  setFrameRate
}) => {
  const [hasSelectedFiles, setHasSelectedFiles] = useState(false)
  const [frameRateWarning, setFrameRateWarning] = useState<string | null>(null)
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
      return
    }

    setFrameRate(parsedFrameRate)
    setFrameRateWarning(`フレームレートを ${parsedFrameRate}fps に設定しました。`)
  }

  const getUploadedFrameRate = (file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    return fetch('http://127.0.0.1:8000/get_framerate/', {
      method: 'POST',
      body: formData
    })
  }

  const openFile = async () => {
    const input = document.getElementById('input') as HTMLInputElement
    const files = input.files
    if (files && files.length > 0) {
      setIsProcessing(true)
      setFrameRateWarning(null)
      const urls = Array.from(files).map((file) => URL.createObjectURL(file))

      // ファイル名を保存（EAFエクスポート用）
      const fileNames = Array.from(files).map((file) => file.name)
      localStorage.setItem('videoFileNames', JSON.stringify(fileNames))

      setVideoSrcs(urls)

      const file = files[0]

      try {
        // Electronでは動画全体のアップロードを避け、ローカルファイルパスからFPSを取得する。
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
        // ブラウザのmetadataからはfpsを信頼して取得できないため、推定値は明示して扱う。
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
      } finally {
        setIsProcessing(false)
      }
    }
  }

  return (
    <div id="open-file">
      <input
        type="file"
        id="input"
        accept="video/*"
        multiple
        onChange={(event) =>
          setHasSelectedFiles((event.currentTarget.files?.length ?? 0) > 0)
        }
      />
      <button disabled={!hasSelectedFiles} onClick={() => openFile()}>
        開く
      </button>
      {frameRateWarning && (
        <div className="frame-rate-warning">
          <p>{frameRateWarning}</p>
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
        </div>
      )}
    </div>
  )
}

export default OpenFile
