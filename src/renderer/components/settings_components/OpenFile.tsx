import React from 'react'

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

  const openFile = async () => {
    const input = document.getElementById('input') as HTMLInputElement
    const files = input.files
    if (files) {
      setIsProcessing(true)
      const urls = Array.from(files).map((file) => URL.createObjectURL(file))

      // ファイル名を保存（EAFエクスポート用）
      const fileNames = Array.from(files).map((file) => file.name)
      localStorage.setItem('videoFileNames', JSON.stringify(fileNames))

      setVideoSrcs(urls)

      const file = files[0]
      console.log('Selected file:', file.name)

      try {
        // まずFastAPIサーバーに接続を試行
        const formData = new FormData()
        formData.append('file', file)

        const response = await fetch('http://127.0.0.1:8000/get_framerate/', {
          method: 'POST',
          body: formData
        })

        if (response.ok) {
          const data = await response.json()
          console.log('Frame rate from server:', data.frame_rate)
          setFrameRate(data.frame_rate)
        } else {
          throw new Error('Server response not ok')
        }
      } catch (error) {
        console.log('FastAPI server not available, using local fallback')

        // サーバーが利用できない場合、ローカルでフレームレートを推定
        try {
          const frameRate = await getVideoFrameRate(urls[0])
          console.log('Frame rate from local analysis:', frameRate)
          setFrameRate(frameRate)
        } catch (localError) {
          console.error('Local frame rate detection failed:', localError)
          // 最終的なフォールバック
          setFrameRate(30)
          console.log('Using default frame rate: 30fps')
        }
      } finally {
        setIsProcessing(false)
      }
    }
  }

  return (
    <div id="open-file">
      <input type="file" id="input" accept="video/*" multiple />
      <button onClick={() => openFile()}>開く</button>
    </div>
  )
}

export default OpenFile
