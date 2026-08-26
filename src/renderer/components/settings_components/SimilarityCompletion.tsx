import React, { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { ApiStatus } from '../../../main/preload'
import type {
  SelectedTimelineAnnotation,
  SimilarMotionCandidate
} from '../../types'

interface SimilarityCompletionProps {
  setIsProcessing: (isProcessing: boolean) => void
  setSimilarMotionCandidates: (candidates: SimilarMotionCandidate[]) => void
  apiStatus: ApiStatus | null
  frameRate: number
  selectedTimelineAnnotation: SelectedTimelineAnnotation | null
}

interface KeyPoint {
  name: string
  number: number
  x: number
  y: number
}

interface ApiErrorPayload {
  message?: string
  error?: string
  stderr?: string
  stdout?: string
  command?: string
  returncode?: number
  job_dir?: string
}

interface SimilarMotionApiCandidate {
  startFrame: number
  endFrame: number
  text: string
  layerName: string
  layerIndex: number
  humanId: number
  similarity: number
  dtwSimilarity: number
  templateId: number
  windowScale: number
  windowLength: number
}

interface SimilarMotionResponse {
  candidates: SimilarMotionApiCandidate[]
}

const selectableKeyPoints: KeyPoint[] = [
  { name: '右腰', number: 1, x: 51, y: 176 },
  { name: '右ひざ', number: 2, x: 51, y: 230 },
  { name: '左腰', number: 4, x: 119, y: 176 },
  { name: '左ひざ', number: 5, x: 119, y: 230 },
  { name: '背中', number: 7, x: 85, y: 115 },
  { name: '首', number: 8, x: 85, y: 70 },
  { name: '左肩', number: 11, x: 119, y: 70 },
  { name: '左ひじ', number: 12, x: 151, y: 105 },
  { name: '右肩', number: 14, x: 51, y: 70 },
  { name: '右ひじ', number: 15, x: 19, y: 105 }
]

export const SimilarityCompletion: React.FC<SimilarityCompletionProps> = ({
  setIsProcessing,
  setSimilarMotionCandidates,
  apiStatus,
  frameRate,
  selectedTimelineAnnotation
}) => {
  const [isHumanCountSingle, setIsHumanCountSingle] = useState<boolean | null>(
    null
  )
  const [humanId, setHumanId] = useState(0)
  const [humanImageUrls, setHumanImageUrls] = useState<string[]>([])
  const [selectedJoints, setSelectedJoints] = useState<number[]>([14, 15])
  const [hoveredKeyPointName, setHoveredKeyPointName] = useState<string | null>(
    null
  )
  const [apiError, setApiError] = useState<ApiErrorPayload | null>(null)
  const [candidateCount, setCandidateCount] = useState<number | null>(null)

  const isAiReady =
    apiStatus?.status === 'ready' && apiStatus.aiAvailable === true

  const getElectronFilePath = (file: File) => {
    const electronFile = file as File & { path?: string }
    return electronFile.path || null
  }

  const getCurrentVideoFile = () => {
    const input = document.getElementById('input') as HTMLInputElement | null
    return input?.files?.[0] ?? null
  }

  const readApiError = async (response: Response): Promise<ApiErrorPayload> => {
    try {
      return await response.json()
    } catch {
      return {
        message: `API request failed with status ${response.status}`
      }
    }
  }

  const formatApiErrorSummary = (error: ApiErrorPayload): string => {
    return (
      error.stderr ||
      error.error ||
      error.message ||
      '類似動作検出に失敗しました。'
    )
  }

  const formatFrameTime = (frame: number) => {
    if (!Number.isFinite(frameRate) || frameRate <= 0) {
      return '-'
    }
    return `${((frame - 1) / frameRate).toFixed(3)}s`
  }

  const selectKeyPoint = (keyPointNumber: number) => {
    setSelectedJoints((current) =>
      current.includes(keyPointNumber)
        ? current.filter((point) => point !== keyPointNumber)
        : [...current, keyPointNumber]
    )
  }

  const getUploadedHumanImages = (file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    return fetch('http://127.0.0.1:8000/get_human_images/', {
      method: 'POST',
      body: formData
    })
  }

  const getHumanImagesFromPath = (filePath: string) => {
    return fetch('http://127.0.0.1:8000/get_human_images_from_path/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file_path: filePath })
    })
  }

  const getHumanImages = async () => {
    if (!isAiReady) {
      return
    }

    const file = getCurrentVideoFile()
    if (!file) {
      setApiError({
        message: '動画を開いてから人物画像を取得してください。'
      })
      return
    }

    setIsProcessing(true)
    setApiError(null)

    try {
      const filePath = getElectronFilePath(file)
      let response = filePath
        ? await getHumanImagesFromPath(filePath)
        : await getUploadedHumanImages(file)

      if (filePath && response.status === 404) {
        response = await getUploadedHumanImages(file)
      }

      if (!response.ok) {
        setApiError(await readApiError(response))
        return
      }

      const data = await response.json()
      if (data.images) {
        setHumanImageUrls(
          data.images.map(
            (base64String: string) => `data:image/jpeg;base64,${base64String}`
          )
        )
      }
    } catch (error) {
      setApiError({
        message:
          error instanceof Error ? error.message : 'APIとの通信に失敗しました。'
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const detectSimilarMotion = async () => {
    if (!isAiReady) {
      return
    }

    const file = getCurrentVideoFile()
    const filePath = file ? getElectronFilePath(file) : null

    if (!filePath) {
      setApiError({
        message:
          'Electron上で開いた動画ファイルのパスが必要です。動画を開いてから実行してください。'
      })
      return
    }

    if (!selectedTimelineAnnotation) {
      setApiError({
        message: 'テンプレートにする注釈をタイムライン上で1つ選択してください。'
      })
      return
    }

    if (selectedJoints.length === 0) {
      setApiError({ message: '少なくとも1つの関節を選択してください。' })
      return
    }

    setIsProcessing(true)
    setApiError(null)
    setCandidateCount(null)

    try {
      const response = await fetch(
        'http://127.0.0.1:8000/similar_motion_from_path/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            file_path: filePath,
            humanId,
            selectedJoints,
            templateSegments: [
              {
                startFrame: selectedTimelineAnnotation.startFrame,
                endFrame: selectedTimelineAnnotation.endFrame
              }
            ],
            layerName: selectedTimelineAnnotation.layerName,
            layerIndex: selectedTimelineAnnotation.layerIndex
          })
        }
      )

      if (!response.ok) {
        setApiError(await readApiError(response))
        return
      }

      const data = (await response.json()) as SimilarMotionResponse
      const candidates = data.candidates.map((candidate) => ({
        ...candidate,
        id: uuidv4(),
        status: 'pending' as const
      }))
      setSimilarMotionCandidates(candidates)
      setCandidateCount(candidates.length)
    } catch (error) {
      setApiError({
        message:
          error instanceof Error ? error.message : 'APIとの通信に失敗しました。'
      })
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div id="similarity-completion">
      {!isAiReady && (
        <div className="api-status-message">
          AI自動アノテーション環境を確認中、または未セットアップです。
        </div>
      )}
      {apiError && (
        <div className="api-error-message compact">
          <div className="api-error-header">
            <strong>類似動作検出に失敗しました</strong>
            <button
              type="button"
              aria-label="エラー通知を閉じる"
              title="閉じる"
              onClick={() => setApiError(null)}
            >
              ×
            </button>
          </div>
          <p>{formatApiErrorSummary(apiError)}</p>
          {apiError.returncode !== undefined && (
            <p>{`終了コード: ${apiError.returncode}`}</p>
          )}
          {apiError.job_dir && <p>{`詳細ログ: ${apiError.job_dir}`}</p>}
        </div>
      )}
      {isHumanCountSingle === null ? (
        <div className="human-count-selector">
          <p>動画内に映る人物は1人ですか？複数人ですか？</p>
          <div className="button-container">
            <button
              onClick={() => {
                setIsHumanCountSingle(true)
                setHumanId(0)
              }}
            >
              1人
            </button>
            <button
              disabled={!isAiReady}
              onClick={() => {
                setIsHumanCountSingle(false)
                getHumanImages()
              }}
            >
              複数人
            </button>
          </div>
        </div>
      ) : (
        <div className="similarity-param-editor">
          {isHumanCountSingle === false && (
            <div className="human-selector">
              <p>人物選択</p>
              <div className="human-img-container">
                {humanImageUrls.map((url, index) => (
                  <div
                    key={index}
                    className={`human-img ${index === humanId ? 'selected' : ''}`}
                  >
                    <div
                      className="icon"
                      style={{ backgroundImage: `url(${url})` }}
                      onClick={() => setHumanId(index)}
                    ></div>
                    <img src={url} alt="" className="popup" />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="bone-img-container">
            <div className="bone-img">
              <img src="./bone.png" alt="bone" />
              {selectableKeyPoints.map((keyPoint) => (
                <div
                  key={keyPoint.number}
                  onClick={() => selectKeyPoint(keyPoint.number)}
                  onMouseEnter={() => setHoveredKeyPointName(keyPoint.name)}
                  onMouseLeave={() => setHoveredKeyPointName(null)}
                  className={`key-point ${selectedJoints.includes(keyPoint.number) ? 'selected' : ''}`}
                  style={{
                    left: `${keyPoint.x}rem`,
                    top: `${keyPoint.y}rem`
                  }}
                ></div>
              ))}
              <p>{hoveredKeyPointName}</p>
            </div>
          </div>
          <div className="similarity-config">
            <div className="template-annotation-card">
              <h3>テンプレート注釈</h3>
              {selectedTimelineAnnotation ? (
                <>
                  <p>{selectedTimelineAnnotation.text}</p>
                  <dl>
                    <dt>レイヤー</dt>
                    <dd>{selectedTimelineAnnotation.layerName}</dd>
                    <dt>範囲</dt>
                    <dd>
                      {`${selectedTimelineAnnotation.startFrame}–${selectedTimelineAnnotation.endFrame}f`}
                    </dd>
                    <dt>時間</dt>
                    <dd>
                      {`${formatFrameTime(selectedTimelineAnnotation.startFrame)}–${formatFrameTime(selectedTimelineAnnotation.endFrame)}`}
                    </dd>
                  </dl>
                </>
              ) : (
                <p className="empty">
                  タイムライン上でテンプレートにする注釈を1つ選択してください。
                </p>
              )}
            </div>
            <div className="similarity-actions">
              <button
                disabled={!isAiReady || !selectedTimelineAnnotation}
                onClick={detectSimilarMotion}
              >
                類似候補を検出
              </button>
              <button
                type="button"
                onClick={() => {
                  setSimilarMotionCandidates([])
                  setCandidateCount(null)
                }}
              >
                候補を消去
              </button>
            </div>
            {candidateCount !== null && (
              <p className="similarity-result-summary">
                {`候補を${candidateCount}件検出しました。タイムラインの候補レイヤーで確認できます。`}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default SimilarityCompletion
