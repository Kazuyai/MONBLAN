import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiStatus } from '../../../main/preload'
import type { AnalysisFrameRange, ProcessingTask } from '../../types'
import { startProcessingProgress } from '../../utils/processingProgress'
import {
  AnalysisRangeSelector,
  type AnalysisRangeMode
} from './AnalysisRangeSelector'
import { AnalysisSteps } from './AnalysisSteps'

interface SettingsProps {
  setProcessingTask: (task: ProcessingTask | null) => void
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
  videoDuration: number
  videoSrcs: string[]
  currentFrame: number
  selectionStartFrame: number
  selectionFrameWidth: number
  timelineLayerNames: string[]
  onCreateTimelineLayer: (name: string) => number | null
  isActive: boolean
  onAnalysisRangePreviewChange: (range: AnalysisFrameRange | null) => void
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

const MIN_MOVEMENT_ANALYSIS_FRAMES = 5

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
  setProcessingTask,
  setIsEditing,
  setAutoAnnotationResponseData,
  apiStatus,
  frameRate,
  videoDuration,
  videoSrcs,
  currentFrame,
  selectionStartFrame,
  selectionFrameWidth,
  timelineLayerNames,
  onCreateTimelineLayer,
  isActive,
  onAnalysisRangePreviewChange
}) => {
  const videoSrc = videoSrcs[0]
  // 画像サイズ
  //   width : 170rem
  //   height: 300rem
  const [selectableKeyPoints] = useState<KeyPoint[]>([
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
  >([
    {
      index: 0,
      layerName: timelineLayerNames[0] ?? 'レイヤー1',
      humanId: 0,
      points: []
    }
  ])
  const [selectedLayerIndex, setSelectedLayerIndex] = useState<number>(0)
  const [newLayerName, setNewLayerName] = useState('')
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
  const previousTimelineLayerNames = useRef(timelineLayerNames)

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

  useEffect(() => {
    const previousNames = previousTimelineLayerNames.current
    previousTimelineLayerNames.current = timelineLayerNames
    if (previousNames === timelineLayerNames) return

    const layerWasDeleted = timelineLayerNames.length < previousNames.length
    const removedConfiguration =
      layerWasDeleted &&
      autoAnnotationLayer.some(
        (layer) => !timelineLayerNames.includes(layer.layerName)
      )
    setAutoAnnotationLayer((currentLayers) => {
      const remappedLayers = currentLayers.flatMap((layer) => {
        if (!layerWasDeleted) {
          if (layer.index >= timelineLayerNames.length) return []
          return [
            {
              ...layer,
              layerName: timelineLayerNames[layer.index]
            }
          ]
        }

        const destinationIndex = timelineLayerNames.indexOf(layer.layerName)
        if (destinationIndex < 0) {
          return []
        }
        return [{ ...layer, index: destinationIndex }]
      })

      if (remappedLayers.length > 0 || timelineLayerNames.length === 0) {
        return remappedLayers
      }
      return [
        {
          index: 0,
          layerName: timelineLayerNames[0],
          humanId: humanIds[0] ?? 0,
          points: []
        }
      ]
    })
    if (removedConfiguration) {
      setApiError({
        message:
          '挿入先の注釈層が削除されたため、対応する検出設定を取り除きました。'
      })
    }
  }, [autoAnnotationLayer, humanIds, timelineLayerNames])

  useEffect(() => {
    setSelectedLayerIndex((index) =>
      autoAnnotationLayer.length === 0
        ? -1
        : Math.max(0, Math.min(index, autoAnnotationLayer.length - 1))
    )
  }, [autoAnnotationLayer.length])

  const handleStepBack = (targetStep: number) => {
    peopleRequestId.current += 1
    if (step === 2) {
      setIsHumanCountSingle(null)
      setHumanImageUrls([])
      setHumanIds([])
      setAutoAnnotationLayer([
        {
          index: 0,
          layerName: timelineLayerNames[0] ?? 'レイヤー1',
          humanId: 0,
          points: []
        }
      ])
      setSelectedLayerIndex(0)
      setNewLayerName('')
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

  const addLayerParam = () => {
    const usedLayerIndices = new Set(
      autoAnnotationLayer.map((layer) => layer.index)
    )
    const destinationIndex = timelineLayerNames.findIndex(
      (_, index) => !usedLayerIndices.has(index)
    )
    if (destinationIndex < 0) {
      setApiError({
        message:
          '選択できる注釈層がありません。新しい注釈層を作成してください。'
      })
      return
    }
    const currentLayer = autoAnnotationLayer[selectedLayerIndex]
    setAutoAnnotationLayer([
      ...autoAnnotationLayer,
      {
        index: destinationIndex,
        layerName: timelineLayerNames[destinationIndex],
        humanId: currentLayer?.humanId ?? humanIds[0] ?? 0,
        points: []
      }
    ])
    setSelectedLayerIndex(autoAnnotationLayer.length)
    setApiError(null)
  }

  const deleteLayerParam = (index: number) => {
    const newLayers = autoAnnotationLayer.filter((_, i) => i !== index)

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

  const selectDestinationLayer = (
    configIndex: number,
    destinationIndex: number,
    destinationName = timelineLayerNames[destinationIndex]
  ) => {
    setAutoAnnotationLayer(
      autoAnnotationLayer.map((item, i) => {
        if (i === configIndex) {
          return {
            ...item,
            index: destinationIndex,
            layerName: destinationName
          }
        }
        return item
      })
    )
  }

  const createTimelineLayer = () => {
    const layerName = newLayerName.trim()
    if (!layerName) {
      setApiError({ message: '新しい注釈層の名前を入力してください。' })
      return
    }
    if (timelineLayerNames.includes(layerName)) {
      setApiError({ message: '同じ名前の注釈層が既に存在します。' })
      return
    }
    const destinationIndex = onCreateTimelineLayer(layerName)
    if (destinationIndex === null) {
      setApiError({ message: '新しい注釈層を作成できませんでした。' })
      return
    }
    if (selectedLayerIndex < 0) {
      setAutoAnnotationLayer([
        {
          index: destinationIndex,
          layerName,
          humanId: humanIds[0] ?? 0,
          points: []
        }
      ])
      setSelectedLayerIndex(0)
    } else {
      selectDestinationLayer(selectedLayerIndex, destinationIndex, layerName)
    }
    setNewLayerName('')
    setApiError(null)
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

  const getUploadedAutoAnnotation = (file: File, progressId: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append(
      'autoAnnotationLayer',
      JSON.stringify(getAutoAnnotationRequestLayers())
    )
    formData.append('singlePerson', String(isHumanCountSingle === true))
    formData.append('progressId', progressId)
    const analysisFrameRange = getAnalysisFrameRange()
    if (analysisFrameRange) {
      formData.append('analysisRange', JSON.stringify(analysisFrameRange))
    }

    return fetch('http://127.0.0.1:8000/items/', {
      method: 'POST',
      body: formData
    })
  }

  const getAutoAnnotationFromPath = (filePath: string, progressId: string) => {
    const analysisFrameRange = getAnalysisFrameRange()
    return fetch('http://127.0.0.1:8000/items_from_path/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file_path: filePath,
        autoAnnotationLayer: getAutoAnnotationRequestLayers(),
        analysisRange: analysisFrameRange,
        singlePerson: isHumanCountSingle === true,
        progressId
      })
    })
  }

  const getAutoAnnotationRequestLayers = () =>
    autoAnnotationLayer.map((layer) => ({
      ...layer,
      layerName: timelineLayerNames[layer.index] ?? layer.layerName
    }))

  const applyPeople = (
    data: { people?: { humanId: number; image: string }[]; images?: string[] },
    single: boolean
  ) => {
    const people =
      data.people ??
      (data.images ?? []).map((image, humanId) => ({ humanId, image }))
    if (people.length === 0) {
      setApiError({
        message: '指定区間に人物が見つかりません。分析区間を変更してください。'
      })
      return
    }
    setHumanIds(people.map((person) => person.humanId))
    setHumanImageUrls(
      people.map((person) => `data:image/jpeg;base64,${person.image}`)
    )
    setAutoAnnotationLayer((layers) =>
      layers.map((layer) => ({ ...layer, humanId: people[0].humanId }))
    )
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
      const progress = startProcessingProgress(
        {
          title: '人物候補を検出中',
          description: '分析範囲から人物画像を抽出しています。'
        },
        setProcessingTask
      )
      setApiError(null)

      try {
        const response = await getHumanImagesFromPath(
          storedVideoPath,
          single,
          progress.progressId
        )

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
        progress.stop()
        setProcessingTask(null)
      }
      return
    }
    if (files?.[0]) {
      const progress = startProcessingProgress(
        {
          title: '人物候補を検出中',
          description: '分析範囲から人物画像を抽出しています。'
        },
        setProcessingTask
      )
      setApiError(null)
      const file = files[0]

      try {
        const filePath = getElectronFilePath(file)
        let response = filePath
          ? await getHumanImagesFromPath(filePath, single, progress.progressId)
          : await getUploadedHumanImages(file, single, progress.progressId)

        if (filePath && response.status === 404) {
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
        progress.stop()
        setProcessingTask(null)
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
    if (
      autoAnnotationLayer.some(
        (layer) => layer.index < 0 || layer.index >= timelineLayerNames.length
      )
    ) {
      setApiError({
        message: '挿入先の注釈層を選び直してください。'
      })
      return
    }
    if (
      new Set(autoAnnotationLayer.map((layer) => layer.index)).size !==
      autoAnnotationLayer.length
    ) {
      setApiError({
        message: '同じ注釈層を複数の検出設定には指定できません。'
      })
      return
    }
    if (autoAnnotationLayer.some((layer) => layer.points.length === 0)) {
      setApiError({
        message: 'すべての検出設定で、使用する関節を1つ以上選択してください。'
      })
      return
    }
    const analysisFrameRange = getAnalysisFrameRange()
    if (analysisRangeMode === 'partial' && !analysisFrameRange) {
      setApiError({
        message: '分析範囲の開始位置と終了位置を設定してください。'
      })
      return
    }
    if (
      analysisFrameRange &&
      analysisFrameRange.endFrame - analysisFrameRange.startFrame + 1 <
        MIN_MOVEMENT_ANALYSIS_FRAMES
    ) {
      setApiError({
        message: `動作範囲検出には${MIN_MOVEMENT_ANALYSIS_FRAMES}フレーム以上の分析区間が必要です。`
      })
      return
    }

    const input = document.getElementById('input') as HTMLInputElement
    const files = input.files
    const storedVideoPath = getStoredVideoPath()
    if ((!files || files.length === 0) && storedVideoPath) {
      const progress = startProcessingProgress(
        {
          title: '動作範囲を検出中',
          description:
            '姿勢推定、3次元姿勢への変換、動作区間の検出を順番に実行しています。'
        },
        setProcessingTask
      )
      setApiError(null)

      try {
        const response = await getAutoAnnotationFromPath(
          storedVideoPath,
          progress.progressId
        )

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
        progress.stop()
        setProcessingTask(null)
      }
      return
    }
    if (files?.[0]) {
      const progress = startProcessingProgress(
        {
          title: '動作範囲を検出中',
          description:
            '姿勢推定、3次元姿勢への変換、動作区間の検出を順番に実行しています。'
        },
        setProcessingTask
      )
      setApiError(null)
      const file = files[0]

      try {
        const filePath = getElectronFilePath(file)
        let response = filePath
          ? await getAutoAnnotationFromPath(filePath, progress.progressId)
          : await getUploadedAutoAnnotation(file, progress.progressId)

        if (filePath && response.status === 404) {
          response = await getUploadedAutoAnnotation(file, progress.progressId)
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
        progress.stop()
        setProcessingTask(null)
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
            <strong>{'AI処理に失敗しました'}</strong>
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
        labels={['分析区間', '人物', '関節・レイヤーと検出']}
        currentStep={step}
        onBack={handleStepBack}
      />
      {step > 0 && (
        <p className="analysis-range-message">{getAnalysisRangeMessage()}</p>
      )}
      {step === 0 && (
        <>
          <AnalysisRangeSelector
            idPrefix="auto"
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
                range.endFrame - range.startFrame + 1 <
                  MIN_MOVEMENT_ANALYSIS_FRAMES
              ) {
                setApiError({
                  message: `動作範囲検出には${MIN_MOVEMENT_ANALYSIS_FRAMES}フレーム以上の分析区間が必要です。`
                })
                return
              }
              setApiError(null)
              setConfirmedAnalysisRange(range)
              setStep(1)
            }}
          >
            分析区間を確定して次へ
          </button>
        </>
      )}
      {/* isHumanCountSingleがnullならhuman-count-selectorを表示 */}
      {step === 1 && (
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
                      className={`human-img ${humanIds[index] === autoAnnotationLayer[selectedLayerIndex]?.humanId ? 'selected' : ''}`}
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
                        onMouseEnter={() =>
                          setHoveredKeyPointName(keyPoint.name)
                        }
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
                        <strong>{`設定 ${index + 1}`}</strong>
                        <label className="layer-destination">
                          <span>挿入先</span>
                          <select
                            aria-label={`検出設定${index + 1}の挿入先注釈層`}
                            value={layer.index}
                            onChange={(event) => {
                              selectDestinationLayer(
                                index,
                                Number(event.target.value)
                              )
                            }}
                          >
                            {timelineLayerNames.map((layerName, layerIndex) => (
                              <option
                                key={`${layerIndex}-${layerName}`}
                                value={layerIndex}
                                disabled={autoAnnotationLayer.some(
                                  (item, itemIndex) =>
                                    itemIndex !== index &&
                                    item.index === layerIndex
                                )}
                              >
                                {layerName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <small>{`人物 ${layer.humanId + 1}・関節 ${layer.points.length}個`}</small>
                      </div>
                      {autoAnnotationLayer.length > 1 && (
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
                  <div className="add-layer-item" onClick={addLayerParam}>
                    <span>＋</span>
                    <p>検出設定を追加</p>
                  </div>
                  <div className="new-timeline-layer">
                    <input
                      type="text"
                      value={newLayerName}
                      placeholder="新しい注釈層名"
                      onChange={(event) => setNewLayerName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') createTimelineLayer()
                      }}
                    />
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={createTimelineLayer}
                    >
                      注釈層を作成して選択
                    </button>
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
