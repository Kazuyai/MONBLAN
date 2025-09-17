import React from 'react'

interface SettingsProps {
  playSpeed: number
  setPlaySpeed: (playSpeed: number) => void
}

export const AudioVideoControls: React.FC<SettingsProps> = ({
  playSpeed,
  setPlaySpeed
}) => {
  const handleValueChange = (value: string) => {
    // 入力を整数に変換し、100で割ってplaySpeedを計算
    const intValue = Math.round(parseInt(value, 10) / 10) * 10
    setPlaySpeed(intValue / 100) // 浮動小数点のずれを防ぐために整数を先に計算
  }

  return (
    <div id="audio-video-controls">
      <div className="play-speed-editor">
        <label>再生速度</label>
        <input
          type="number"
          step={10}
          value={Math.round(playSpeed * 100)} // 表示時に丸める
          onChange={(e) => {
            if (parseInt(e.target.value, 10) < 10) {
              e.target.value = '10'
            } else if (parseInt(e.target.value, 10) > 200) {
              e.target.value = '200'
            }
            handleValueChange(e.target.value)
          }}
          className="no-spin"
        />
        <input
          type="range"
          min="10"
          max="200"
          step="10"
          value={Math.round(playSpeed * 100)} // 表示時に丸める
          onChange={(e) => handleValueChange(e.target.value)}
        />
      </div>
    </div>
  )
}

export default AudioVideoControls
