import React, { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { ApiStatus } from '../../../main/preload'
import type {
  AnalysisFrameRange,
  ProcessingTask,
  SelectedTimelineAnnotation,
  SimilarMotionCandidate
} from '../../types'
import { startProcessingProgress } from '../../utils/processingProgress'
import {
  AnalysisRangeSelector,
  type AnalysisRangeMode
} from './AnalysisRangeSelector'
import { AnalysisSteps } from './AnalysisSteps'

interface SimilarityCompletionProps {
  setProcessingTask: (task: ProcessingTask | null) => void
  setSimilarMotionCandidates: (candidates: SimilarMotionCandidate[]) => void
  apiStatus: ApiStatus | null
  frameRate: number
  videoDuration: number
  currentFrame: number
  selectedTimelineAnnotation: SelectedTimelineAnnotation | null
  videoSrcs: string[]
  selectionStartFrame: number
  selectionFrameWidth: number
  isActive: boolean
  onAnalysisRangePreviewChange: (range: AnalysisFrameRange | null) => void
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

const getApiStatusMessage = (apiStatus: ApiStatus | null) => {
  if (!apiStatus || apiStatus.status === 'starting') {
    return 'AI自動アノテーション環境を確認中です。'
  }

  if (apiStatus.status === 'failed') {
    return `AI APIの起動に失敗しました。${apiStatus.error ? ` ${apiStatus.error}` : ''}`
  }

  if (apiStatus.status === 'stopped' || apiStatus.status === 'unavailable') {
    return 'AI APIが起動していません。アプリを再起動するか、APIを手動で起動してください。'
  }

  if (apiStatus.aiAvailable === false) {
    return 'AI自動アノテーション環境が未セットアップです。'
  }

  return 'AI自動アノテーション環境を確認中です。'
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
  setProcessingTask,
  setSimilarMotionCandidates,
  apiStatus,
  frameRate,
  videoDuration,
  currentFrame,
  selectedTimelineAnnotation,
  videoSrcs,
  selectionStartFrame,
  selectionFrameWidth,
  isActive,
  onAnalysisRangePreviewChange
}) => {
  const videoSrc = videoSrcs[0]
  const [isHumanCountSingle, setIsHumanCountSingle] = useState<boolean | null>(
    null
  )
  const [humanId, setHumanId] = useState(0)
  const [humanImageUrls, setHumanImageUrls] = useState<string[]>([])
  const [humanIds, setHumanIds] = useState<number[]>([])
  const [step, setStep] = useState(0)
  const previousVideoSrc = useRef(videoSrc)
  const peopleRequestId = useRef(0)
  const [confirmedTemplate, setConfirmedTemplate] =
    useState<SelectedTimelineAnnotation | null>(null)
  const [confirmedAnalysisRange, setConfirmedAnalysisRange] = useState<
    { startFrame: number; endFrame: number } | null | undefined
  >(undefined)
  const [selectedJoints, setSelectedJoints] = useState<number[]>([14, 15])
  const [hoveredKeyPointName, setHoveredKeyPointName] = useState<string | null>(
    null
  )
  const [apiError, setApiError] = useState<ApiErrorPayload | null>(null)
  const [candidateCount, setCandidateCount] = useState<number | null>(null)
  const [analysisRangeMode, setAnalysisRangeMode] =
    useState<AnalysisRangeMode>('full')
  const [manualAnalysisStartFrame, setManualAnalysisStartFrame] = useState<
    number | null
  >(null)
  const [manualAnalysisEndFrame, setManualAnalysisEndFrame] = useState<
    number | null
  >(null)

  useEffect(() => {
    if (previousVideoSrc.current === videoSrc) return
    previousVideoSrc.current = videoSrc
    peopleRequestId.current += 1
    setStep(0)
    setConfirmedTemplate(null)
    setConfirmedAnalysisRange(undefined)
    setIsHumanCountSingle(null)
    setHumanImageUrls([])
    setHumanIds([])
    setManualAnalysisStartFrame(null)
    setManualAnalysisEndFrame(null)
    setCandidateCount(null)
    setSimilarMotionCandidates([])
  }, [videoSrc, setSimilarMotionCandidates])

  const handleStepBack = (targetStep: number) => {
    peopleRequestId.current += 1
    if (step === 3) {
      setIsHumanCountSingle(null)
      setHumanId(0)
      setHumanImageUrls([])
      setHumanIds([])
      setSelectedJoints([14, 15])
      setHoveredKeyPointName(null)
      setSimilarMotionCandidates([])
      setCandidateCount(null)
    }
    if (targetStep <= 1) {
      setConfirmedAnalysisRange(undefined)
    }
    if (targetStep === 0) {
      setConfirmedTemplate(null)
      setManualAnalysisStartFrame(null)
      setManualAnalysisEndFrame(null)
    }
    setApiError(null)
    setStep(targetStep)
  }

  const isAiReady =
    apiStatus?.status === 'ready' && apiStatus.aiAvailable === true

  const getElectronFilePath = (file: File) => {
    const electronFile = file as File & { path?: string }
    return electronFile.path || null
  }

  const getStoredVideoPath = () => {
    if (videoSrcs.length === 0) {
      return null
    }

    try {
      const storedPaths = JSON.parse(
        localStorage.getItem('videoFilePaths') || '[]'
      )
      if (!Array.isArray(storedPaths)) {
        return null
      }

      const filePath = storedPaths.find(
        (storedPath): storedPath is string =>
          typeof storedPath === 'string' && storedPath.length > 0
      )
      return filePath || null
    } catch {
      return null
    }
  }

  const getCurrentVideoFile = () => {
    const input = document.getElementById('input') as HTMLInputElement | null
    return input?.files?.[0] ?? null
  }

  const getCurrentVideoPath = () => {
    const file = getCurrentVideoFile()
    return file ? getElectronFilePath(file) : getStoredVideoPath()
  }

  const getAnalysisFrameRange = useCallback(() => {
    if (confirmedAnalysisRange !== undefined) {
      return confirmedAnalysisRange
    }
    if (analysisRangeMode === 'full') {
      return null
    }

    if (manualAnalysisStartFrame === null || manualAnalysisEndFrame === null) {
      return null
    }

    return {
      startFrame: Math.min(manualAnalysisStartFrame, manualAnalysisEndFrame),
      endFrame: Math.max(manualAnalysisStartFrame, manualAnalysisEndFrame)
    }
  }, [
    analysisRangeMode,
    confirmedAnalysisRange,
    manualAnalysisEndFrame,
    manualAnalysisStartFrame
  ])

  const getAnalysisRangeMessage = () => {
    const analysisFrameRange = getAnalysisFrameRange()
    if (analysisRangeMode === 'full') {
      return '分析範囲: 動画全体'
    }
    if (analysisFrameRange) {
      return `分析範囲: ${formatFrameTime(analysisFrameRange.startFrame)}–${formatAnalysisEndTime(analysisFrameRange.endFrame)}（${analysisFrameRange.startFrame}–${analysisFrameRange.endFrame}f）`
    }
    return '分析範囲: 開始位置と終了位置を指定してください'
  }

  useEffect(() => {
    if (!isActive) return
    onAnalysisRangePreviewChange(
      analysisRangeMode === 'partial' ? getAnalysisFrameRange() : null
    )
  }, [
    analysisRangeMode,
    confirmedAnalysisRange,
    getAnalysisFrameRange,
    isActive,
    manualAnalysisEndFrame,
    manualAnalysisStartFrame,
    onAnalysisRangePreviewChange
  ])

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
    if (
      error.stderr?.includes(
        'An attempt has been made to start a new process'
      ) ||
      error.stderr?.includes('DataLoader worker')
    ) {
      return 'MotionBERTのデータ読み込み処理を開始できませんでした。アプリを再起動してから、もう一度実行してください。'
    }

    return (
      error.error ||
      error.stderr?.trim().split(/\r?\n/).filter(Boolean).at(-1) ||
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

  const formatAnalysisEndTime = (frame: number) => {
    if (!Number.isFinite(frameRate) || frameRate <= 0) {
      return '-'
    }
    return `${(frame / frameRate).toFixed(3)}s`
  }

  const selectKeyPoint = (keyPointNumber: number) => {
    setSelectedJoints((current) =>
      current.includes(keyPointNumber)
        ? current.filter((point) => point !== keyPointNumber)
        : [...current, keyPointNumber]
    )
  }

  const getUploadedHumanImages = (
    file: File,
    single: boolean,
    progressId: string
  ) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('singlePerson', String(single))
    formData.append('progressId', progressId)
    if (confirmedAnalysisRange) {
      formData.append('analysisRange', JSON.stringify(confirmedAnalysisRange))
    }

    return fetch('http://127.0.0.1:8000/get_human_images/', {
      method: 'POST',
      body: formData
    })
  }

  const getHumanImagesFromPath = (
    filePath: string,
    single: boolean,
    progressId: string
  ) => {
    return fetch('http://127.0.0.1:8000/get_human_images_from_path/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file_path: filePath,
        analysisRange: confirmedAnalysisRange,
        singlePerson: single,
        progressId
      })
    })
  }

  const getHumanImages = async (single: boolean) => {
    if (!isAiReady) {
      return
    }
    const requestId = ++peopleRequestId.current

    const file = getCurrentVideoFile()
    const filePath = getCurrentVideoPath()
    if (!file && !filePath) {
      setApiError({
        message: '動画を開いてから人物画像を取得してください。'
      })
      return
    }

    const progress = startProcessingProgress(
      {
        title: '人物候補を検出中',
        description: '分析範囲から人物画像を抽出しています。'
      },
      setProcessingTask
    )
    setApiError(null)

    try {
      let response = filePath
        ? await getHumanImagesFromPath(filePath, single, progress.progressId)
        : await getUploadedHumanImages(
            file as File,
            single,
            progress.progressId
          )

      if (file && filePath && response.status === 404) {
        response = await getUploadedHumanImages(
          file,
          single,
          progress.progressId
        )
      }

      if (!response.ok) {
        setApiError(await readApiError(response))
        return
      }

      const data = await response.json()
      if (requestId !== peopleRequestId.current) return
      const people: { humanId: number; image: string }[] =
        data.people ??
        (data.images ?? []).map((image: string, humanId: number) => ({
          humanId,
          image
        }))
      if (people.length === 0) {
        setApiError({
          message:
            '指定区間に人物が見つかりません。分析区間を変更してください。'
        })
        return
      }
      setHumanIds(people.map((person) => person.humanId))
      setHumanImageUrls(
        people.map((person) => `data:image/jpeg;base64,${person.image}`)
      )
      setHumanId(people[0].humanId)
      setIsHumanCountSingle(single)
      setStep(3)
    } catch (error) {
      setApiError({
        message:
          error instanceof Error ? error.message : 'APIとの通信に失敗しました。'
      })
    } finally {
      progress.stop()
      setProcessingTask(null)
    }
  }

  const detectSimilarMotion = async () => {
    if (!isAiReady) {
      return
    }
    if (step !== 3) {
      return
    }
    if (analysisRangeMode === 'partial' && !getAnalysisFrameRange()) {
      setApiError({
        message: '分析範囲の開始位置と終了位置を設定してください。'
      })
      return
    }

    const filePath = getCurrentVideoPath()

    if (!filePath) {
      setApiError({
        message:
          'Electron上で開いた動画ファイルのパスが必要です。動画を開いてから実行してください。'
      })
      return
    }

    if (!confirmedTemplate) {
      setApiError({
        message: 'テンプレートにする注釈をタイムライン上で1つ選択してください。'
      })
      return
    }

    if (selectedJoints.length === 0) {
      setApiError({ message: '少なくとも1つの関節を選択してください。' })
      return
    }

    const progress = startProcessingProgress(
      {
        title: '類似動作を検出中',
        description:
          '姿勢推定結果を使い、テンプレートに近い動作区間を検索しています。'
      },
      setProcessingTask
    )
    setApiError(null)
    setCandidateCount(null)

    try {
      const analysisFrameRange = getAnalysisFrameRange()
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
                startFrame: confirmedTemplate.startFrame,
                endFrame: confirmedTemplate.endFrame
              }
            ],
            analysisRange: analysisFrameRange,
            singlePerson: isHumanCountSingle === true,
            layerName: confirmedTemplate.layerName,
            layerIndex: confirmedTemplate.layerIndex,
            progressId: progress.progressId
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
      progress.stop()
      setProcessingTask(null)
    }
  }

  return (
    <div id="similarity-completion">
      {!isAiReady && (
        <div className="api-status-message">
          {getApiStatusMessage(apiStatus)}
          {apiStatus?.environment?.missing?.length ? (
            <ul>
              {apiStatus.environment.missing.map((item) => (
                <li key={item.name}>{item.name}</li>
              ))}
            </ul>
          ) : null}
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
      <AnalysisSteps
        labels={['テンプレート', '分析区間', '人物', '関節と検索']}
        currentStep={step}
        onBack={handleStepBack}
      />
      {step > 1 && (
        <p className="analysis-range-message">{getAnalysisRangeMessage()}</p>
      )}
      {step === 0 && (
        <div className="template-annotation-card">
          <h3>テンプレート注釈を選択</h3>
          {selectedTimelineAnnotation ? (
            <p>
              {selectedTimelineAnnotation.text}（
              {formatFrameTime(selectedTimelineAnnotation.startFrame)}–
              {formatFrameTime(selectedTimelineAnnotation.endFrame)}）
            </p>
          ) : (
            <p className="empty">
              タイムライン上で注釈を1つクリックしてください。
            </p>
          )}
          <button
            className="primary-action analysis-next"
            type="button"
            disabled={!selectedTimelineAnnotation}
            onClick={() => {
              setConfirmedTemplate(selectedTimelineAnnotation)
              setConfirmedAnalysisRange(undefined)
              setSimilarMotionCandidates([])
              setCandidateCount(null)
              setStep(1)
            }}
          >
            テンプレートを確定して次へ
          </button>
        </div>
      )}
      {step === 1 && (
        <>
          <AnalysisRangeSelector
            idPrefix="similarity"
            mode={analysisRangeMode}
            onModeChange={setAnalysisRangeMode}
            frameRate={frameRate}
            videoDuration={videoDuration}
            currentFrame={currentFrame}
            selectionStartFrame={selectionStartFrame}
            selectionFrameWidth={selectionFrameWidth}
            startFrame={manualAnalysisStartFrame}
            endFrame={manualAnalysisEndFrame}
            onRangeChange={(startFrame, endFrame) => {
              setManualAnalysisStartFrame(startFrame)
              setManualAnalysisEndFrame(endFrame)
            }}
          />
          <button
            className="primary-action analysis-next"
            type="button"
            onClick={() => {
              const range = getAnalysisFrameRange()
              if (analysisRangeMode === 'partial' && !range) {
                setApiError({ message: '分析区間を指定してください。' })
                return
              }
              if (
                range &&
                confirmedTemplate &&
                (confirmedTemplate.startFrame < range.startFrame ||
                  confirmedTemplate.endFrame > range.endFrame)
              ) {
                setApiError({
                  message:
                    '分析区間にはテンプレート注釈の全体を含めてください。'
                })
                return
              }
              setApiError(null)
              setConfirmedAnalysisRange(range)
              setStep(2)
            }}
          >
            分析区間を確定して次へ
          </button>
        </>
      )}
      {step === 2 && (
        <div className="human-count-selector">
          <p>指定区間に映る人物は1人ですか？複数人ですか？</p>
          <div className="button-container">
            <button
              className="secondary-action"
              disabled={!isAiReady}
              onClick={() => getHumanImages(true)}
            >
              1人
            </button>
            <button
              className="secondary-action"
              disabled={!isAiReady}
              onClick={() => getHumanImages(false)}
            >
              複数人
            </button>
          </div>
        </div>
      )}
      {step === 3 && (
        <>
          <div className="similarity-param-editor">
            {isHumanCountSingle === false && (
              <div className="human-selector">
                <p>人物選択</p>
                <div className="human-img-container">
                  {humanImageUrls.map((url, index) => (
                    <div
                      key={humanIds[index]}
                      className={`human-img ${humanIds[index] === humanId ? 'selected' : ''}`}
                    >
                      <div
                        className="icon"
                        style={{ backgroundImage: `url(${url})` }}
                        onClick={() => setHumanId(humanIds[index])}
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
                {confirmedTemplate ? (
                  <>
                    <p>{confirmedTemplate.text}</p>
                    <dl>
                      <dt>レイヤー</dt>
                      <dd>{confirmedTemplate.layerName}</dd>
                      <dt>範囲</dt>
                      <dd>
                        {`${confirmedTemplate.startFrame}–${confirmedTemplate.endFrame}f`}
                      </dd>
                      <dt>時間</dt>
                      <dd>
                        {`${formatFrameTime(confirmedTemplate.startFrame)}–${formatFrameTime(confirmedTemplate.endFrame)}`}
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
                  className="primary-action"
                  disabled={!isAiReady || !confirmedTemplate}
                  onClick={detectSimilarMotion}
                >
                  類似候補を検出
                </button>
                <button
                  className="danger-action"
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
        </>
      )}
    </div>
  )
}

export default SimilarityCompletion
