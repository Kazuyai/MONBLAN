import React, { useState } from 'react'

interface SettingsProps {
  setIsProcessing: (isProcessing: boolean) => void
  setVideoSrcs: (srcs: string[]) => void
  setFrameRate: (frameRate: number) => void
}

export const OpenFile: React.FC<SettingsProps> = ({
  setIsProcessing,
  setVideoSrcs,
  setFrameRate
}) => {
  const [hasSelectedFiles, setHasSelectedFiles] = useState(false)
  const getElectronFilePath = (file: File) => {
    const electronFile = file as File & { path?: string }
    return electronFile.path || null
  }

  const getVideoFrameRate = (videoUrl: string): Promise<number> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        // デフォルトフレームレート（多くの動画は30fps）
        const defaultFrameRate = 30
        resolve(defaultFrameRate)
      }
      video.onerror = () => reject(new Error('動画の読み込みに失敗しました'))
      video.src = videoUrl
    })
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
          setFrameRate(data.frame_rate)
        } else {
          throw new Error('Server response not ok')
        }
      } catch (error) {
        // サーバーが利用できない場合、ローカルでフレームレートを推定
        try {
          const frameRate = await getVideoFrameRate(urls[0])
          setFrameRate(frameRate)
        } catch (localError) {
          console.error('Local frame rate detection failed:', localError)
          // 最終的なフォールバック
          setFrameRate(30)
        }
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
    </div>
  )
}

export default OpenFile
