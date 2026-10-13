import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { AnalysisFrameRange } from '../../types'

export type AnalysisRangeMode = 'full' | 'partial'

interface AnalysisRangeSelectorProps {
  idPrefix: string
  mode: AnalysisRangeMode
  onModeChange: (mode: AnalysisRangeMode) => void
  frameRate: number
  videoDuration: number
  currentFrame: number
  selectionStartFrame: number
  selectionFrameWidth: number
  startFrame: number | null
  endFrame: number | null
  onRangeChange: (startFrame: number | null, endFrame: number | null) => void
}

const formatSeconds = (seconds: number) => `${seconds.toFixed(3)}s`

export const AnalysisRangeSelector: React.FC<
  AnalysisRangeSelectorProps
> = ({
  idPrefix,
  mode,
  onModeChange,
  frameRate,
  videoDuration,
  currentFrame,
  selectionStartFrame,
  selectionFrameWidth,
  startFrame,
  endFrame,
  onRangeChange
}) => {
  const hasValidFrameRate = Number.isFinite(frameRate) && frameRate > 0
  const totalFrames = hasValidFrameRate
    ? Math.max(1, Math.ceil(videoDuration * frameRate))
    : 1
  const startFrameToSeconds = useCallback(
    (frame: number) => (hasValidFrameRate ? (frame - 1) / frameRate : 0),
    [frameRate, hasValidFrameRate]
  )
  const endFrameToSeconds = useCallback(
    (frame: number) => (hasValidFrameRate ? frame / frameRate : 0),
    [frameRate, hasValidFrameRate]
  )
  const frameToInput = useCallback(
    (target: 'start' | 'end', frame: number | null) =>
      frame === null
        ? ''
        : (target === 'start'
            ? startFrameToSeconds(frame)
            : endFrameToSeconds(frame)
          ).toFixed(3),
    [endFrameToSeconds, startFrameToSeconds]
  )
  const [startSecondsInput, setStartSecondsInput] = useState(
    frameToInput('start', startFrame)
  )
  const [endSecondsInput, setEndSecondsInput] = useState(
    frameToInput('end', endFrame)
  )

  useEffect(() => {
    setStartSecondsInput(frameToInput('start', startFrame))
  }, [frameToInput, startFrame])

  useEffect(() => {
    setEndSecondsInput(frameToInput('end', endFrame))
  }, [endFrame, frameToInput])

  const normalizedRange = useMemo<AnalysisFrameRange | null>(() => {
    if (startFrame === null || endFrame === null) return null
    return {
      startFrame: Math.min(startFrame, endFrame),
      endFrame: Math.max(startFrame, endFrame)
    }
  }, [endFrame, startFrame])

  const selectionRange = useMemo<AnalysisFrameRange | null>(() => {
    if (selectionStartFrame <= 0 || selectionFrameWidth <= 0) return null
    return {
      startFrame: selectionStartFrame,
      endFrame: selectionStartFrame + selectionFrameWidth - 1
    }
  }, [selectionFrameWidth, selectionStartFrame])

  const secondsToFrame = (target: 'start' | 'end', seconds: number) => {
    const nearestFrame =
      Math.round(seconds * frameRate) + (target === 'start' ? 1 : 0)
    return Math.max(1, Math.min(totalFrames, nearestFrame))
  }

  const commitSeconds = (target: 'start' | 'end', value: string) => {
    const seconds = Number(value)
    if (!hasValidFrameRate || value.trim() === '' || !Number.isFinite(seconds)) {
      if (target === 'start') {
        setStartSecondsInput(frameToInput('start', startFrame))
      } else {
        setEndSecondsInput(frameToInput('end', endFrame))
      }
      return
    }

    const nextFrame = secondsToFrame(target, Math.max(0, seconds))
    if (target === 'start') {
      onRangeChange(nextFrame, endFrame)
      setStartSecondsInput(frameToInput('start', nextFrame))
    } else {
      onRangeChange(startFrame, nextFrame)
      setEndSecondsInput(frameToInput('end', nextFrame))
    }
  }

  const selectPartialMode = () => {
    onModeChange('partial')
    if (startFrame === null && endFrame === null && selectionRange) {
      onRangeChange(selectionRange.startFrame, selectionRange.endFrame)
    }
  }

  const setCurrentPosition = (target: 'start' | 'end') => {
    const clampedCurrentFrame = Math.max(1, Math.min(totalFrames, currentFrame))
    if (target === 'start') {
      onRangeChange(clampedCurrentFrame, endFrame)
    } else {
      onRangeChange(startFrame, Math.max(1, clampedCurrentFrame - 1))
    }
  }

  const rangeDuration = normalizedRange && hasValidFrameRate
    ? (normalizedRange.endFrame - normalizedRange.startFrame + 1) / frameRate
    : null

  return (
    <div className="analysis-range-selector">
      <div className="analysis-range-mode-options">
        <label className={mode === 'full' ? 'selected' : ''}>
          <input
            type="radio"
            name={`${idPrefix}-analysis-range-mode`}
            checked={mode === 'full'}
            onChange={() => onModeChange('full')}
          />
          <span>
            <strong>動画全体</strong>
            <small>動画の先頭から末尾まで分析します</small>
          </span>
        </label>
        <label className={mode === 'partial' ? 'selected' : ''}>
          <input
            type="radio"
            name={`${idPrefix}-analysis-range-mode`}
            checked={mode === 'partial'}
            onChange={selectPartialMode}
          />
          <span>
            <strong>部分分析</strong>
            <small>必要な時間範囲だけを分析します</small>
          </span>
        </label>
      </div>

      {mode === 'partial' && (
        <div className="partial-analysis-range-editor">
          <div className="analysis-time-inputs">
            <div className="analysis-time-input">
              <label htmlFor={`${idPrefix}-analysis-start-seconds`}>
                開始
              </label>
              <div>
                <input
                  id={`${idPrefix}-analysis-start-seconds`}
                  type="number"
                  min="0"
                  max={Math.max(0, videoDuration)}
                  step="0.001"
                  inputMode="decimal"
                  value={startSecondsInput}
                  placeholder="0.000"
                  onChange={(event) => setStartSecondsInput(event.target.value)}
                  onBlur={(event) => commitSeconds('start', event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
                <span>秒</span>
              </div>
              <button
                type="button"
                className="secondary-action"
                onClick={() => setCurrentPosition('start')}
              >
                現在位置を設定
              </button>
            </div>

            <span className="analysis-range-separator" aria-hidden="true">
              →
            </span>

            <div className="analysis-time-input">
              <label htmlFor={`${idPrefix}-analysis-end-seconds`}>終了</label>
              <div>
                <input
                  id={`${idPrefix}-analysis-end-seconds`}
                  type="number"
                  min="0"
                  max={Math.max(0, videoDuration)}
                  step="0.001"
                  inputMode="decimal"
                  value={endSecondsInput}
                  placeholder="0.000"
                  onChange={(event) => setEndSecondsInput(event.target.value)}
                  onBlur={(event) => commitSeconds('end', event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
                <span>秒</span>
              </div>
              <button
                type="button"
                className="secondary-action"
                onClick={() => setCurrentPosition('end')}
              >
                現在位置を設定
              </button>
            </div>
          </div>

          <div className="analysis-range-editor-actions">
            <button
              type="button"
              className="secondary-action"
              disabled={!selectionRange}
              onClick={() =>
                selectionRange &&
                onRangeChange(
                  selectionRange.startFrame,
                  selectionRange.endFrame
                )
              }
            >
              タイムラインの選択範囲を反映
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={startFrame === null && endFrame === null}
              onClick={() => onRangeChange(null, null)}
            >
              クリア
            </button>
          </div>

          {normalizedRange ? (
            <div className="analysis-range-summary" role="status">
              <strong>
                {formatSeconds(
                  startFrameToSeconds(normalizedRange.startFrame)
                )}{' '}
                – {formatSeconds(endFrameToSeconds(normalizedRange.endFrame))}
              </strong>
              <span>
                {rangeDuration === null
                  ? '処理時間を計算できません'
                  : `処理対象 約${rangeDuration.toFixed(3)}秒`}
              </span>
              <small>{`${normalizedRange.startFrame}–${normalizedRange.endFrame}フレーム`}</small>
            </div>
          ) : (
            <p className="analysis-range-empty">
              開始と終了を秒数・現在位置・タイムライン選択のいずれかで指定してください。
            </p>
          )}
          <p className="analysis-range-help">
            秒数は動画のフレームレートに合わせ、最も近いフレーム位置へ自動補正されます。
          </p>
        </div>
      )}
    </div>
  )
}
