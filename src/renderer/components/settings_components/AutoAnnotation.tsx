import React, { useEffect, useRef, useState } from 'react'
import type { ApiStatus } from '../../../main/preload'
import { AnalysisSteps } from './AnalysisSteps'

interface SettingsProps {
  setIsProcessing: (isProcessing: boolean) => void
  setIsEditing: (isEditing: boolean) => void
  setAutoAnnotationResponseData: (
    data: {
      startFrame: number
      endFrame: number
      text: string
      layerName: string
      layerIndex: number
    }[]
  ) => void
  apiStatus: ApiStatus | null
  frameRate: number
  videoSrcs: string[]
  currentFrame: number
  selectionStartFrame: number
  selectionFrameWidth: number
}

interface KeyPoint {
  name: string
  number: number
  x: number
  y: number
}

interface AutoAnnotationLayerParam {
  index: number
  layerName: string
  humanId: number
  points: number[]
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

type AnalysisRangeMode = 'full' | 'selection' | 'manual'

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

export const AutoAnnotation: React.FC<SettingsProps> = ({
  setIsProcessing,
  setIsEditing,
  setAutoAnnotationResponseData,
  apiStatus,
  frameRate,
  videoSrcs,
  currentFrame,
  selectionStartFrame,
  selectionFrameWidth
}) => {
  const videoSrc = videoSrcs[0]
  // 画像サイズ
  //   width : 170rem
  //   height: 300rem
  const [selectableKeyPoints, setSelectableKeyPoints] = useState<KeyPoint[]>([
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
  ])

  const [isHumanCountSingle, setIsHumanCountSingle] = useState<boolean | null>(
    null
  )
  const [humanImageUrls, setHumanImageUrls] = useState<string[]>([])
  const [humanIds, setHumanIds] = useState<number[]>([])
  const [step, setStep] = useState(0)
  const previousVideoSrc = useRef(videoSrc)
  const peopleRequestId = useRef(0)
  const [confirmedAnalysisRange, setConfirmedAnalysisRange] = useState<
    { startFrame: number; endFrame: number } | null | undefined
  >(undefined)
  const [autoAnnotationLayer, setAutoAnnotationLayer] = useState<
    AutoAnnotationLayerParam[]
  >([{ index: 0, layerName: 'レイヤー1', humanId: 0, points: [] }])
  const [selectedLayerIndex, setSelectedLayerIndex] = useState<number>(0)
  const [isLayerNameEdit, setIsLayerNameEdit] = useState<boolean>(false)
  const [hoveredKeyPointName, setHoveredKeyPointName] = useState<string | null>(
    null
  )
  const [apiError, setApiError] = useState<ApiErrorPayload | null>(null)
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
    setConfirmedAnalysisRange(undefined)
    setIsHumanCountSingle(null)
    setHumanImageUrls([])
    setHumanIds([])
    setManualAnalysisStartFrame(null)
    setManualAnalysisEndFrame(null)
  }, [videoSrc])

  const handleStepBack = (targetStep: number) => {
    peopleRequestId.current += 1
    if (step === 2) {
      setIsHumanCountSingle(null)
      setHumanImageUrls([])
      setHumanIds([])
      setAutoAnnotationLayer([{ index: 0, layerName: 'レイヤー1', humanId: 0, points: [] }])
      setSelectedLayerIndex(0)
      setIsLayerNameEdit(false)
      setIsEditing(false)
    }
    if (targetStep === 0) {
      setConfirmedAnalysisRange(undefined)
    }
    setApiError(null)
    setStep(targetStep)
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
      'AI自動アノテーション処理に失敗しました。'
    )
  }

  const selectHuman = (humanId: number) => {
    setAutoAnnotationLayer(
      autoAnnotationLayer.map((layer, i) => {
        if (i === selectedLayerIndex) {
          return {
            index: layer.index,
            layerName: layer.layerName,
            humanId: humanId,
            points: layer.points
          }
        } else {
          return layer
        }
      })
    )
  }

  const selectKeyPoint = (keyPointNumber: number) => {
    if (
      selectedLayerIndex < 0 ||
      selectedLayerIndex >= autoAnnotationLayer.length
    ) {
      return // 無効な選択状態の場合は何もしない
    }
    setAutoAnnotationLayer(
      autoAnnotationLayer.map((layer, i) => {
        if (i === selectedLayerIndex) {
          // レイヤーのポイントに選択したキーポイントを追加、すでに追加されている場合は削除
          if (layer.points.includes(keyPointNumber)) {
            return {
              index: layer.index,
              layerName: layer.layerName,
              humanId: layer.humanId,
              points: layer.points.filter((point) => point !== keyPointNumber)
            }
          } else {
            return {
              index: layer.index,
              layerName: layer.layerName,
              humanId: layer.humanId,
              points: [...layer.points, keyPointNumber]
            }
          }
        } else {
          return layer
        }
      })
    )
  }

  const addLayerParam = (
    index: number,
    layerName: string,
    humanId: number,
    points: number[]
  ) => {
    setAutoAnnotationLayer([
      ...autoAnnotationLayer,
      { index: index, layerName: layerName, humanId: humanId, points: points }
    ])
    setSelectedLayerIndex(autoAnnotationLayer.length)
  }

  const deleteLayerParam = (index: number) => {
    const newLayers = autoAnnotationLayer
      .filter((layer, i) => i !== index)
      .map((layer, i) => {
        if (i > index) {
          return {
            index: i - 1,
            layerName: layer.layerName,
            humanId: layer.humanId,
            points: layer.points
          }
        } else {
          return {
            index: i,
            layerName: layer.layerName,
            humanId: layer.humanId,
            points: layer.points
          }
        }
      })

    setAutoAnnotationLayer(newLayers)

    // selectedLayerIndex を更新
    if (newLayers.length === 0) {
      // レイヤーが無くなった場合
      setSelectedLayerIndex(-1)
    } else if (selectedLayerIndex >= newLayers.length) {
      // 削除後のインデックスが範囲外の場合
      setSelectedLayerIndex(newLayers.length - 1)
    } else if (selectedLayerIndex > index) {
      // 削除したレイヤーより後のレイヤーを選択していた場合
      setSelectedLayerIndex(selectedLayerIndex - 1)
    } else if (selectedLayerIndex === index) {
      // 削除したレイヤーを選択していた場合
      setSelectedLayerIndex(0)
    }
  }

  const updateLayerParam = (
    index: number,
    layerName: string,
    humanId: number,
    points: number[]
  ) => {
    setAutoAnnotationLayer(
      autoAnnotationLayer.map((item, i) => {
        if (i === index) {
          return {
            index: index,
            layerName: layerName,
            humanId: humanId,
            points: points
          }
        } else {
          return item
        }
      })
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      setIsEditing(false)
      setIsLayerNameEdit(false)
    }
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

  const getAnalysisFrameRange = () => {
    if (confirmedAnalysisRange !== undefined) {
      return confirmedAnalysisRange
    }
    if (analysisRangeMode === 'full') {
      return null
    }

    if (analysisRangeMode === 'manual') {
      if (manualAnalysisStartFrame === null || manualAnalysisEndFrame === null) {
        return null
      }

      return {
        startFrame: Math.min(manualAnalysisStartFrame, manualAnalysisEndFrame),
        endFrame: Math.max(manualAnalysisStartFrame, manualAnalysisEndFrame)
      }
    }

    if (selectionStartFrame <= 0 || selectionFrameWidth <= 0) {
      return null
    }

    return {
      startFrame: selectionStartFrame,
      endFrame: selectionStartFrame + selectionFrameWidth - 1
    }
  }

  const formatFrameTime = (frame: number) => {
    if (!Number.isFinite(frameRate) || frameRate <= 0) {
      return '-'
    }
    return `${((frame - 1) / frameRate).toFixed(3)}s`
  }

  const getAnalysisRangeMessage = () => {
    const analysisFrameRange = getAnalysisFrameRange()
    if (analysisRangeMode === 'full') {
      return '分析対象: 動画全体'
    }
    if (analysisFrameRange) {
      return `分析対象: ${formatFrameTime(analysisFrameRange.startFrame)}–${formatFrameTime(analysisFrameRange.endFrame)}（${analysisFrameRange.startFrame}–${analysisFrameRange.endFrame}f）`
    }
    return analysisRangeMode === 'selection'
      ? '分析対象: タイムライン上で範囲を選択してください'
      : '分析対象: 再生位置から開始と終了を設定してください'
  }

  const getUploadedHumanImages = (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    if (confirmedAnalysisRange) {
      formData.append('analysisRange', JSON.stringify(confirmedAnalysisRange))
    }

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
      body: JSON.stringify({ file_path: filePath, analysisRange: confirmedAnalysisRange })
    })
  }

  const getUploadedAutoAnnotation = (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('autoAnnotationLayer', JSON.stringify(autoAnnotationLayer))
    const analysisFrameRange = getAnalysisFrameRange()
    if (analysisFrameRange) {
      formData.append('analysisRange', JSON.stringify(analysisFrameRange))
    }

    return fetch('http://127.0.0.1:8000/items/', {
      method: 'POST',
      body: formData
    })
  }

  const getAutoAnnotationFromPath = (filePath: string) => {
    const analysisFrameRange = getAnalysisFrameRange()
    return fetch('http://127.0.0.1:8000/items_from_path/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file_path: filePath,
        autoAnnotationLayer,
        analysisRange: analysisFrameRange
      })
    })
  }

  const applyPeople = (data: { people?: { humanId: number; image: string }[]; images?: string[] }, single: boolean) => {
    const people = data.people ?? (data.images ?? []).map((image, humanId) => ({ humanId, image }))
    if (people.length === 0) {
      setApiError({ message: '指定区間に人物が見つかりません。分析区間を変更してください。' })
      return
    }
    setHumanIds(people.map((person) => person.humanId))
    setHumanImageUrls(people.map((person) => `data:image/jpeg;base64,${person.image}`))
    setAutoAnnotationLayer((layers) => layers.map((layer) => ({ ...layer, humanId: people[0].humanId })))
    setIsHumanCountSingle(single)
    setStep(2)
  }

  const getHumanImages = async (single: boolean) => {
    if (!isAiReady) {
      return
    }
    const requestId = ++peopleRequestId.current
    const input = document.getElementById('input') as HTMLInputElement
    const files = input.files
    const storedVideoPath = getStoredVideoPath()
    if ((!files || files.length === 0) && storedVideoPath) {
      setIsProcessing(true)
      setApiError(null)

      try {
        const response = await getHumanImagesFromPath(storedVideoPath)

        if (!response.ok) {
          setApiError(await readApiError(response))
          return
        }
        const data = await response.json()
        if (requestId !== peopleRequestId.current) return
        applyPeople(data, single)
      } catch (error) {
        console.error('Error:', error)
        setApiError({
          message:
            error instanceof Error
              ? error.message
              : 'APIとの通信に失敗しました。'
        })
      } finally {
        setIsProcessing(false)
      }
      return
    }
    if (files?.[0]) {
      setIsProcessing(true)
      setApiError(null)
      const file = files[0]

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
        if (requestId !== peopleRequestId.current) return
        applyPeople(data, single)
      } catch (error) {
        console.error('Error:', error)
        setApiError({
          message:
            error instanceof Error
              ? error.message
              : 'APIとの通信に失敗しました。'
        })
      } finally {
        setIsProcessing(false)
      }
      return
    }

    setApiError({
      message: '動画を開くか、動画パスを含むプロジェクトを読み込んでください。'
    })
  }

  const autoAnnotation = async () => {
    if (!isAiReady) {
      return
    }
    if (step !== 2) {
      return
    }
    if (analysisRangeMode !== 'full' && !getAnalysisFrameRange()) {
      setApiError({
        message:
          analysisRangeMode === 'selection'
            ? 'タイムライン上で分析範囲を選択してください。'
            : '分析範囲の開始位置と終了位置を設定してください。'
      })
      return
    }

    const input = document.getElementById('input') as HTMLInputElement
    const files = input.files
    const storedVideoPath = getStoredVideoPath()
    if ((!files || files.length === 0) && storedVideoPath) {
      setIsProcessing(true)
      setApiError(null)

      try {
        const response = await getAutoAnnotationFromPath(storedVideoPath)

        if (!response.ok) {
          setApiError(await readApiError(response))
          return
        }
        const data = await response.json()
        setAutoAnnotationResponseData(data)
      } catch (error) {
        console.error('Error:', error)
        setApiError({
          message:
            error instanceof Error
              ? error.message
              : 'APIとの通信に失敗しました。'
        })
      } finally {
        setIsProcessing(false)
      }
      return
    }
    if (files?.[0]) {
      setIsProcessing(true)
      setApiError(null)
      const file = files[0]

      try {
        const filePath = getElectronFilePath(file)
        let response = filePath
          ? await getAutoAnnotationFromPath(filePath)
          : await getUploadedAutoAnnotation(file)

        if (filePath && response.status === 404) {
          response = await getUploadedAutoAnnotation(file)
        }

        if (!response.ok) {
          setApiError(await readApiError(response))
          return
        }
        const data = await response.json()
        setAutoAnnotationResponseData(data)
      } catch (error) {
        console.error('Error:', error)
        setApiError({
          message:
            error instanceof Error
              ? error.message
              : 'APIとの通信に失敗しました。'
        })
      } finally {
        setIsProcessing(false)
      }
      return
    }

    setApiError({
      message: '動画を開くか、動画パスを含むプロジェクトを読み込んでください。'
    })
  }

  return (
    <div id="auto-annotation">
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
        <div className="api-error-message">
          <div className="api-error-header">
            <strong>
              {'AI処理に失敗しました'}
            </strong>
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
          {apiError.job_dir && (
            <p>{`詳細ログ: ${apiError.job_dir}`}</p>
          )}
        </div>
      )}
      <AnalysisSteps
        labels={['分析区間', '人物', '関節・レイヤーと検出']}
        currentStep={step}
        onBack={handleStepBack}
      />
      {step > 0 && <p className="analysis-range-message">{getAnalysisRangeMessage()}</p>}
      {step === 0 && <>
      <p className="analysis-range-message">
        {getAnalysisRangeMessage()}
      </p>
      <div className="analysis-range-controls">
        <label>
          <input
            type="radio"
            name="auto-analysis-range-mode"
            checked={analysisRangeMode === 'full'}
            onChange={() => setAnalysisRangeMode('full')}
          />
          動画全体
        </label>
        <label>
          <input
            type="radio"
            name="auto-analysis-range-mode"
            checked={analysisRangeMode === 'selection'}
            onChange={() => setAnalysisRangeMode('selection')}
          />
          タイムラインの選択範囲
        </label>
        <label>
          <input
            type="radio"
            name="auto-analysis-range-mode"
            checked={analysisRangeMode === 'manual'}
            onChange={() => setAnalysisRangeMode('manual')}
          />
          再生位置で開始・終了
        </label>
        {analysisRangeMode === 'manual' && (
          <div className="manual-analysis-range-controls">
            <button
              className="secondary-action"
              type="button"
              onClick={() => setManualAnalysisStartFrame(currentFrame)}
            >
              現在位置を開始に設定
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => setManualAnalysisEndFrame(currentFrame)}
            >
              現在位置を終了に設定
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                setManualAnalysisStartFrame(null)
                setManualAnalysisEndFrame(null)
              }}
            >
              クリア
            </button>
            <span>
              {manualAnalysisStartFrame !== null
                ? `開始: ${formatFrameTime(manualAnalysisStartFrame)}（${manualAnalysisStartFrame}f）`
                : '開始: 未設定'}
              {' / '}
              {manualAnalysisEndFrame !== null
                ? `終了: ${formatFrameTime(manualAnalysisEndFrame)}（${manualAnalysisEndFrame}f）`
                : '終了: 未設定'}
            </span>
          </div>
        )}
      </div>
      <button className="primary-action analysis-next" type="button" onClick={() => {
        const range = getAnalysisFrameRange()
        if (analysisRangeMode !== 'full' && !range) {
          setApiError({ message: '分析区間を指定してください。' })
          return
        }
        setApiError(null)
        setConfirmedAnalysisRange(range)
        setStep(1)
      }}>分析区間を確定して次へ</button>
      </>}
      {/* isHumanCountSingleがnullならhuman-count-selectorを表示 */}
      {step === 1 && (
        <div className="human-count-selector">
          <p>指定区間に映る人物は1人ですか？複数人ですか？</p>
          <div className="button-container">
            <button
              className="primary-action"
              disabled={!isAiReady}
              onClick={() => getHumanImages(true)}
            >
              1人
            </button>
            <button
              className="primary-action"
              disabled={!isAiReady}
              onClick={() => getHumanImages(false)}
            >
              複数人
            </button>
          </div>
        </div>
      )}
      {step === 2 && (
        <>
        <div className="auto-annotation-param-editor">
          {isHumanCountSingle === false && (
            <div className="human-selector">
              <p>人物選択</p>
              <div className="human-img-container">
                {humanImageUrls.map((url, index) => (
                  <div
                    key={humanIds[index]}
                    className={`human-img ${humanIds[index] === autoAnnotationLayer[selectedLayerIndex].humanId ? 'selected' : ''}`}
                  >
                    <div
                      className="icon"
                      style={{ backgroundImage: `url(${url})` }}
                      onClick={() => selectHuman(humanIds[index])}
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
              {selectableKeyPoints.map(
                (keyPoint, index) =>
                  autoAnnotationLayer[selectedLayerIndex] && (
                    <div
                      key={index}
                      onClick={() => selectKeyPoint(keyPoint.number)}
                      onMouseEnter={() => setHoveredKeyPointName(keyPoint.name)}
                      onMouseLeave={() => setHoveredKeyPointName(null)}
                      className={`key-point ${autoAnnotationLayer[selectedLayerIndex].points.includes(keyPoint.number) ? 'selected' : ''}`}
                      style={{
                        left: `${keyPoint.x}rem`,
                        top: `${keyPoint.y}rem`
                      }}
                    ></div>
                  )
              )}
              <p>{hoveredKeyPointName}</p>
            </div>
          </div>
          <div className="edit-param">
            <div className="edit-layer-param">
              <div className="edit-layer-list">
                {autoAnnotationLayer.map((layer, index) => (
                  <div
                    key={index}
                    className={
                      'edit-layer-item ' +
                      (index === selectedLayerIndex ? 'selected' : '')
                    }
                    onClick={() => setSelectedLayerIndex(index)}
                  >
                    <div className="layer-info">
                      <span>{index + 1}.</span>
                      {index === selectedLayerIndex && isLayerNameEdit ? (
                        <input
                          type="text"
                          name="layerName"
                          value={layer.layerName}
                          onChange={(e) =>
                            updateLayerParam(
                              index,
                              e.target.value,
                              layer.humanId,
                              layer.points
                            )
                          }
                          onBlur={() => {
                            ;(setIsEditing(false), setIsLayerNameEdit(false))
                          }}
                          onKeyDown={(e) => handleKeyDown(e)}
                          autoFocus
                        />
                      ) : (
                        <p
                          onDoubleClick={() => {
                            setIsEditing(true)
                            setSelectedLayerIndex(index)
                            setIsLayerNameEdit(true)
                          }}
                        >
                          {layer.layerName}
                        </p>
                      )}
                    </div>
                    {index !== 0 && (
                      <div
                        className="delete"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteLayerParam(index)
                        }}
                      >
                        ✕
                      </div>
                    )}
                  </div>
                ))}
                <div
                  className="add-layer-item"
                  onClick={() =>
                    addLayerParam(autoAnnotationLayer.length, 'レイヤー', autoAnnotationLayer[selectedLayerIndex].humanId, [])
                  }
                >
                  <span>＋</span>
                  <p>追加</p>
                </div>
              </div>
            </div>
            <button
              className="primary-action"
              disabled={!isAiReady}
              onClick={() => autoAnnotation()}
            >
              実行
            </button>
          </div>
        </div>
        </>
      )}
    </div>
  )
}

export default AutoAnnotation
