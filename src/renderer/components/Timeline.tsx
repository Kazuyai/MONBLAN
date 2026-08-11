import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
  Dispatch,
  SetStateAction
} from 'react'
import { v4 as uuidv4 } from 'uuid'
import Annotation from './Annotation'

interface TimelineProps {
  videoSrcs: string[]
  videoDuration: number
  isEditing: boolean
  setIsEditing: Dispatch<SetStateAction<boolean>>
  frameRate: number
  currentFrame: number
  setCurrentFrame: Dispatch<SetStateAction<number>>
  selectionStartFrame: number
  selectionFrameWidth: number
  setSelectionStartFrame: Dispatch<SetStateAction<number>>
  setSelectionFrameWidth: Dispatch<SetStateAction<number>>
  isPlaying?: boolean
  setIsPlaying?: Dispatch<SetStateAction<boolean>>
  isPartiallyPlaying: boolean
  setIsPartiallyPlaying: Dispatch<SetStateAction<boolean>>
  setPlaySpeed?: Dispatch<SetStateAction<number>>
  autoAnnotationResponseData?: {
    startFrame: number
    endFrame: number
    text: string
    layerName: string
    layerIndex: number
  }[]
  topHeight: number
}

interface TimelineHandle {
  exportCSV: () => void
  exportEAF: () => void
}

interface AnnotationType {
  id: string
  startFrame: number
  endFrame: number
  text: string
  layerIndex: number
}

interface TimelineState {
  annotations: AnnotationType[]
  layerNames: string[]
}

const Timeline = forwardRef<TimelineHandle, TimelineProps>(
  (
    {
      videoSrcs,
      videoDuration,
      isEditing,
      setIsEditing,
      frameRate,
      currentFrame,
      setCurrentFrame,
      selectionStartFrame,
      selectionFrameWidth,
      setSelectionStartFrame,
      setSelectionFrameWidth,
      isPlaying,
      setIsPlaying,
      isPartiallyPlaying,
      setIsPartiallyPlaying,
      setPlaySpeed,
      autoAnnotationResponseData,
      topHeight
    },
    ref
  ) => {
    const containerRefs = useRef<React.RefObject<HTMLDivElement>[]>([])
    const timelineContainerRef = useRef<HTMLTableElement>(null)
    const timelinesRef = useRef<HTMLTableRowElement>(null)
    const timeBarRef = useRef<HTMLTableCellElement>(null)

    // 状態を統合
    const [state, setState] = useState<TimelineState>({
      annotations: [],
      layerNames: ['レイヤー1', 'レイヤー2', 'レイヤー3']
    })

    // 総フレーム数を計算
    const totalFrames = Math.ceil(videoDuration * frameRate)

    const defaultZoomLevel = 1

    const [undoStack, setUndoStack] = useState<TimelineState[]>([])
    const [redoStack, setRedoStack] = useState<TimelineState[]>([])

    const [zoomLevel, setZoomLevel] = useState(defaultZoomLevel)
    const [minZoomLevel, setMinZoomLevel] = useState(0.5)
    const frameWidth = 10 * zoomLevel
    const timelineWidth = frameWidth * Math.max(totalFrames - 1, 0)
    const [focusedAnnotationId, setFocusedAnnotationId] = useState<
      string | null
    >(null)
    const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<
      string[]
    >([])
    const [timelineNotice, setTimelineNotice] = useState<string | null>(null)
    const [editingLayerIndex, setEditingLayerIndex] = useState<number | null>(
      null
    )
    const [editingLayerName, setEditingLayerName] = useState('')
    const cancelLayerNameEditRef = useRef(false)
    const [selectedLayerIndex, setSelectedLayerIndex] = useState<number | null>(
      0
    )
    const [playheadLeft, setPlayheadLeft] = useState(0)
    const [isDragging, setIsDragging] = useState<boolean>(false)

    const showTimelineNotice = (message: string) => {
      setTimelineNotice(message)
    }

    // 選択範囲の状態を追加
    const [isSelecting, setIsSelecting] = useState<boolean>(false)
    const [selectionStart, setSelectionStart] = useState<number>(0)
    const [selectionWidth, setSelectionWidth] = useState<number>(0)
    const selectionAnchorFrameRef = useRef<number>(1)

    const annotations = state.annotations
    const layerNames = state.layerNames

    // 状態の深いコピーを作成する関数
    const deepCopyState = (state: TimelineState): TimelineState => {
      return {
        annotations: state.annotations.map((annotation) => ({ ...annotation })),
        layerNames: [...state.layerNames]
      }
    }

    // Undoスタックに現在の状態を保存し、Redoスタックをクリアする関数
    const pushToUndoStack = (stateToSave: TimelineState) => {
      setUndoStack((prevStack) => [...prevStack, deepCopyState(stateToSave)])
      setRedoStack([])
    }

    const updateContainerRefs = (layerNames: string[]) => {
      containerRefs.current = layerNames.map(() =>
        React.createRef<HTMLDivElement>()
      )
    }

    const clampLayerIndex = (
      index: number | null,
      layerNames: string[]
    ): number | null => {
      if (layerNames.length === 0) {
        return null
      }
      if (index === null) {
        return 0
      }
      return Math.min(Math.max(index, 0), layerNames.length - 1)
    }

    const removeInvalidAnnotationSelection = (nextState: TimelineState) => {
      const annotationIds = new Set(nextState.annotations.map(({ id }) => id))
      setFocusedAnnotationId((id) => (id && annotationIds.has(id) ? id : null))
      setSelectedAnnotationIds((ids) =>
        ids.filter((id) => annotationIds.has(id))
      )
    }

    // 動画を再生/停止する関数
    const play = (playSpeed?: number) => {
      setIsPlaying?.((prev) => !prev)
      setIsPartiallyPlaying(false)
      if (playSpeed !== undefined) {
        setPlaySpeed?.(playSpeed)
      }
    }

    // アノテーションの重なりをチェックする関数を追加
    const canInsertAnnotation = (
      newAnnotation: AnnotationType,
      layerAnnotations: AnnotationType[]
    ): boolean => {
      for (const annotation of layerAnnotations) {
        if (annotation.id !== newAnnotation.id) {
          if (
            newAnnotation.startFrame < annotation.endFrame &&
            newAnnotation.endFrame > annotation.startFrame
          ) {
            // 重なりがある
            return false
          }
        }
      }
      return true
    }

    // 位置からフレームインデックスを計算する関数を追加
    const getFrameIndexFromPositionX = (positionX: number): number => {
      const remInPixels = parseFloat(
        getComputedStyle(document.documentElement).fontSize
      )
      const offset = 140 * remInPixels // 左側のオフセット

      const relativeX = positionX - offset
      const frameIndex = Math.round(relativeX / frameWidth) + 1
      const clampedFrameIndex = Math.max(1, Math.min(totalFrames, frameIndex))
      return clampedFrameIndex
    }

    // 注釈の追加
    const addAnnotation = () => {
      if (selectedLayerIndex !== null) {
        if (selectionWidth === 0) {
          showTimelineNotice('アノテーションを追加する範囲を選択してください。')
          return
        }

        const startFrame = getFrameIndexFromPositionX(selectionStart)
        const endFrame = getFrameIndexFromPositionX(
          selectionStart + selectionWidth
        )

        if (endFrame <= startFrame) {
          showTimelineNotice('選択範囲が無効です。')
          return
        }

        const newAnnotation: AnnotationType = {
          id: uuidv4(),
          startFrame: startFrame,
          endFrame: endFrame,
          text: '',
          layerIndex: selectedLayerIndex
        }

        const layerAnnotations = state.annotations.filter(
          (a) => a.layerIndex === selectedLayerIndex
        )

        if (canInsertAnnotation(newAnnotation, layerAnnotations)) {
          setState((prevState) => {
            pushToUndoStack(prevState) // Undoスタックに保存
            return {
              ...prevState,
              annotations: [...prevState.annotations, newAnnotation]
            }
          })
          // アノテーションを追加した後、選択範囲をクリア
          setSelectionWidth(0)
        } else {
          showTimelineNotice('アノテーションが重なっています。')
        }
      }
    }

    // 注釈の削除
    const deleteAnnotation = () => {
      if (focusedAnnotationId) {
        setState((prevState) => {
          pushToUndoStack(prevState) // Undoスタックに保存
          return {
            ...prevState,
            annotations: prevState.annotations.filter(
              (annotation) => !selectedAnnotationIds.includes(annotation.id)
            )
          }
        })
        setFocusedAnnotationId(null)
      }
    }

    // Undo関数を修正
    const undo = () => {
      if (undoStack.length > 0) {
        const previousState = undoStack[undoStack.length - 1]
        setUndoStack((prevStack) => prevStack.slice(0, prevStack.length - 1))
        setRedoStack((prevStack) => [...prevStack, deepCopyState(state)])
        setState(previousState)
        setSelectedLayerIndex((index) =>
          clampLayerIndex(index, previousState.layerNames)
        )
        setEditingLayerIndex(null)
        removeInvalidAnnotationSelection(previousState)
        updateContainerRefs(previousState.layerNames)
      }
    }

    // Redo関数を修正
    const redo = () => {
      if (redoStack.length > 0) {
        const nextState = redoStack[redoStack.length - 1]
        setRedoStack((prevStack) => prevStack.slice(0, prevStack.length - 1))
        setUndoStack((prevStack) => [...prevStack, deepCopyState(state)])
        setState(nextState)
        setSelectedLayerIndex((index) =>
          clampLayerIndex(index, nextState.layerNames)
        )
        setEditingLayerIndex(null)
        removeInvalidAnnotationSelection(nextState)
        updateContainerRefs(nextState.layerNames)
      }
    }

    // 注釈層の追加
    const addLayer = () => {
      pushToUndoStack(state)
      const newLayerNames = [
        ...state.layerNames,
        `レイヤー${state.layerNames.length + 1}`
      ]
      setState({
        ...state,
        layerNames: newLayerNames
      })
      setSelectedLayerIndex(newLayerNames.length - 1)
      setEditingLayerIndex(null)
    }

    // 注釈層の削除
    const deleteLayer = () => {
      if (
        selectedLayerIndex === null ||
        selectedLayerIndex < 0 ||
        selectedLayerIndex >= state.layerNames.length
      ) {
        return
      }

      pushToUndoStack(state)
      const targetLayerIndex = selectedLayerIndex
      const newLayerNames = state.layerNames.filter(
        (_, index) => index !== targetLayerIndex
      )
      const updatedAnnotations = state.annotations
        .filter((annotation) => annotation.layerIndex !== targetLayerIndex)
        .map((annotation) => {
          if (annotation.layerIndex > targetLayerIndex) {
            return { ...annotation, layerIndex: annotation.layerIndex - 1 }
          }
          return annotation
        })
      const nextState = {
        layerNames: newLayerNames,
        annotations: updatedAnnotations
      }

      setState(nextState)
      setSelectedLayerIndex(clampLayerIndex(targetLayerIndex, newLayerNames))
      setEditingLayerIndex(null)
      removeInvalidAnnotationSelection(nextState)
    }

    // 注釈層名のダブルクリックで編集開始
    const handleLayerNameDoubleClick = (index: number) => {
      setEditingLayerIndex(index)
      setEditingLayerName(layerNames[index] ?? '')
    }

    // 注釈層名の変更
    const handleLayerNameChange = (newName: string) => {
      setEditingLayerName(newName)
    }

    const commitLayerNameEdit = () => {
      if (cancelLayerNameEditRef.current) {
        cancelLayerNameEditRef.current = false
        setEditingLayerIndex(null)
        return
      }

      if (
        editingLayerIndex === null ||
        editingLayerIndex < 0 ||
        editingLayerIndex >= state.layerNames.length
      ) {
        setEditingLayerIndex(null)
        return
      }

      const currentName = state.layerNames[editingLayerIndex]
      if (editingLayerName !== currentName) {
        pushToUndoStack(state)
        const updatedLayerNames = [...state.layerNames]
        updatedLayerNames[editingLayerIndex] = editingLayerName
        setState({
          ...state,
          layerNames: updatedLayerNames
        })
      }
      setEditingLayerIndex(null)
    }

    const cancelLayerNameEdit = () => {
      cancelLayerNameEditRef.current = true
      setEditingLayerIndex(null)
    }

    // 編集終了処理
    const handleLayerNameBlur = () => {
      commitLayerNameEdit()
    }

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.currentTarget.blur()
      } else if (e.key === 'Escape') {
        cancelLayerNameEdit()
      }
    }

    // レイヤーの選択処理
    const handleLayerClick = (index: number) => {
      setSelectedLayerIndex(index)
    }

    // ズーム処理
    const maxZoomLevel = 5

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault()
        setZoomLevel((prevZoom) => {
          const newZoom = prevZoom + e.deltaY * -0.01
          return Math.max(minZoomLevel, Math.min(maxZoomLevel, newZoom))
        })
      }
    }

    useEffect(() => {
      const timelines = timelinesRef.current
      timelines?.addEventListener('wheel', handleWheel)
      return () => {
        timelines?.removeEventListener('wheel', handleWheel)
      }
    }, [minZoomLevel]) // minZoomLevelの変更を監視

    useEffect(() => {
      const remInPixels = parseFloat(
        getComputedStyle(document.documentElement).fontSize
      )
      const offset = 140 * remInPixels
      setPlayheadLeft(offset + (currentFrame - 1) * frameWidth)
    }, [currentFrame, frameWidth])

    useEffect(() => {
      if (selectionFrameWidth === 0) {
        setSelectionWidth(0)
        return
      }

      const remInPixels = parseFloat(
        getComputedStyle(document.documentElement).fontSize
      )
      const offset = 140 * remInPixels
      const nextSelectionStart = (selectionStartFrame - 1) * frameWidth + offset
      setSelectionStart(nextSelectionStart)
      setSelectionWidth(selectionFrameWidth * frameWidth)
    }, [frameWidth, selectionFrameWidth, selectionStartFrame])

    useEffect(() => {
      if (timelineContainerRef.current) {
        const container = timelineContainerRef.current
        if (container) {
          document.documentElement.style.setProperty(
            '--timeline-container-height',
            `${container.getBoundingClientRect().height}px`
          )
        }
      }
    })

    // プレイヘッドの位置を更新する関数
    const updatePlayheadPosition = (clientX: number) => {
      const remInPixels = parseFloat(
        getComputedStyle(document.documentElement).fontSize
      )
      const offset = 140 * remInPixels

      const timeBarRect = timeBarRef.current?.getBoundingClientRect()
      if (!timeBarRect) return

      const relativeX = clientX - timeBarRect.left - (0.05 + 10) * remInPixels

      const frameIndex = Math.round(relativeX / frameWidth) + 1
      const clampedFrameIndex = Math.max(1, Math.min(totalFrames, frameIndex))

      const newPlayheadLeft = offset + (clampedFrameIndex - 1) * frameWidth
      setCurrentFrame(clampedFrameIndex)
      setPlayheadLeft(newPlayheadLeft)
    }

    const handlePlayheadMoveDown = (clientX: number) => {
      setIsDragging(true)
      updatePlayheadPosition(clientX)
    }

    const handlePlayheadMove = (clientX: number) => {
      if (isDragging) {
        updatePlayheadPosition(clientX)
      }
    }

    // 選択範囲の開始処理
    const handleSelectionMouseDown = (clientX: number) => {
      setIsSelecting(true)
      const containerRect = timelinesRef.current?.getBoundingClientRect()
      if (!containerRect) return

      const remInPixels = parseFloat(
        getComputedStyle(document.documentElement).fontSize
      )
      const offset = 140 * remInPixels
      const startX = clientX - containerRect.left - offset
      const frameIndex = Math.round(startX / frameWidth) + 1
      const clampedFrameIndex = Math.max(1, Math.min(totalFrames, frameIndex))
      selectionAnchorFrameRef.current = clampedFrameIndex
      setSelectionStartFrame(clampedFrameIndex)
      setSelectionStart((clampedFrameIndex - 1) * frameWidth + offset)
      setSelectionFrameWidth(0)
      setSelectionWidth(0)
    }

    // タイムバーでのマウスダウン処理
    const handleTimeBarMouseDown = (
      e: React.MouseEvent<HTMLTableCellElement>
    ) => {
      e.preventDefault()
      handlePlayheadMoveDown(e.clientX)
      handleSelectionMouseDown(e.clientX)
    }

    const isAnnotationEventTarget = (target: EventTarget | null): boolean => {
      return (
        target instanceof Element &&
        target.closest('[data-annotation-id]') !== null
      )
    }

    // タイムラインでのマウスダウン処理
    const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
      if (isAnnotationEventTarget(e.target)) {
        return // Annotation 上でのクリックは無視
      }
      handlePlayheadMoveDown(e.clientX)
      handleSelectionMouseDown(e.clientX)
    }

    // 選択範囲のマウス移動処理
    const handleSelectionMouseMove = (e: MouseEvent) => {
      if (isSelecting) {
        const containerRect = timelinesRef.current?.getBoundingClientRect()
        if (!containerRect) return

        const remInPixels = parseFloat(
          getComputedStyle(document.documentElement).fontSize
        )
        const offset = 140 * remInPixels
        const relativeX = e.clientX - containerRect.left - offset
        const frameIndex = Math.round(relativeX / frameWidth) + 1
        const clampedFrameIndex = Math.max(1, Math.min(totalFrames, frameIndex))
        const anchorFrameIndex = selectionAnchorFrameRef.current
        const startFrame = Math.min(anchorFrameIndex, clampedFrameIndex)
        const frameWidthCount = Math.abs(anchorFrameIndex - clampedFrameIndex)

        setSelectionStartFrame(startFrame)
        setSelectionStart((startFrame - 1) * frameWidth + offset)
        setSelectionFrameWidth(frameWidthCount)
        setSelectionWidth(frameWidthCount * frameWidth)
      }
    }

    // 選択範囲の終了処理
    const handleSelectionMouseUp = () => {
      if (isSelecting) {
        setIsSelecting(false)
        // 選択範囲が確定した後の処理をここに追加できます
      }
    }

    // アノテーションの更新を処理する関数
    const handleAnnotationChange = (
      id: string,
      updatedData: { startFrame: number; endFrame: number; text: string },
      shouldPushToUndoStack: boolean = true
    ) => {
      setState((prevState) => {
        const newAnnotations = [...prevState.annotations]
        const annotationIndex = newAnnotations.findIndex(
          (annotation) => annotation.id === id
        )

        if (annotationIndex !== -1) {
          const oldAnnotation = newAnnotations[annotationIndex]

          // 状態が変化していない場合は何もしない
          if (
            oldAnnotation.startFrame === updatedData.startFrame &&
            oldAnnotation.endFrame === updatedData.endFrame &&
            oldAnnotation.text === updatedData.text
          ) {
            return prevState
          }

          const updatedAnnotation = {
            ...oldAnnotation,
            ...updatedData
          }

          const layerAnnotations = newAnnotations.filter(
            (annotation) =>
              annotation.layerIndex === updatedAnnotation.layerIndex &&
              annotation.id !== id
          )

          if (canInsertAnnotation(updatedAnnotation, layerAnnotations)) {
            newAnnotations[annotationIndex] = updatedAnnotation

            if (shouldPushToUndoStack) {
              pushToUndoStack(prevState) // Undoスタックに保存
            }

            return {
              ...prevState,
              annotations: newAnnotations
            }
          } else {
            showTimelineNotice('アノテーションが重なっています。')
            return prevState // 変更なし
          }
        }
        return prevState
      })
    }

    // 結合機能の実装
    const mergeAnnotations = () => {
      if (selectedAnnotationIds.length < 2) {
        showTimelineNotice('結合するアノテーションを2つ以上選択してください。')
        return
      }

      // 選択されたアノテーションを取得
      const selectedAnnotations = annotations.filter((annotation) =>
        selectedAnnotationIds.includes(annotation.id)
      )

      // 同じレイヤーのアノテーションのみ結合可能にする
      const layerIndex = selectedAnnotations[0].layerIndex
      const allSameLayer = selectedAnnotations.every(
        (annotation) => annotation.layerIndex === layerIndex
      )

      if (!allSameLayer) {
        showTimelineNotice('異なるレイヤーのアノテーションは結合できません。')
        return
      }

      // 結合後の開始フレームと終了フレームを決定
      const startFrame = Math.min(
        ...selectedAnnotations.map((a) => a.startFrame)
      )
      const endFrame = Math.max(...selectedAnnotations.map((a) => a.endFrame))

      // 新しいアノテーションを作成
      const newAnnotation: AnnotationType = {
        id: uuidv4(),
        startFrame,
        endFrame,
        text: '', // 必要に応じてテキストを結合
        layerIndex
      }

      // 重なりのチェック
      const layerAnnotations = annotations.filter(
        (a) =>
          a.layerIndex === layerIndex && !selectedAnnotationIds.includes(a.id)
      )

      if (!canInsertAnnotation(newAnnotation, layerAnnotations)) {
        showTimelineNotice(
          '選択されていないアノテーションと重なるため、結合できません。'
        )
        return
      }

      // 結合を実行
      setState((prevState) => {
        pushToUndoStack(prevState) // Undo スタックに保存

        const remainingAnnotations = prevState.annotations.filter(
          (annotation) => !selectedAnnotationIds.includes(annotation.id)
        )

        return {
          ...prevState,
          annotations: [...remainingAnnotations, newAnnotation]
        }
      })

      // 結合後のアノテーションを選択状態にする
      setSelectedAnnotationIds([newAnnotation.id])
    }

    // 分割機能の実装
    const splitAnnotations = () => {
      if (selectedAnnotationIds.length === 0) {
        showTimelineNotice('分割するアノテーションを選択してください。')
        return
      }

      if (selectionWidth === 0) {
        // 方法1：プレイヘッドの位置で分割
        const playheadFrame = currentFrame

        // プレイヘッド位置にある選択されたアノテーションを取得
        const annotationsToSplit = annotations.filter(
          (annotation) =>
            selectedAnnotationIds.includes(annotation.id) &&
            annotation.startFrame < playheadFrame &&
            annotation.endFrame > playheadFrame
        )

        if (annotationsToSplit.length === 0) {
          showTimelineNotice(
            'プレイヘッドの位置に分割可能なアノテーションがありません。'
          )
          return
        }

        setState((prevState) => {
          pushToUndoStack(prevState) // Undo スタックに保存

          let newAnnotations = [...prevState.annotations]

          annotationsToSplit.forEach((annotation) => {
            // 元のアノテーションを削除
            newAnnotations = newAnnotations.filter(
              (a) => a.id !== annotation.id
            )

            // 分割されたアノテーションを作成
            const firstPart: AnnotationType = {
              ...annotation,
              id: uuidv4(),
              endFrame: playheadFrame
            }

            const secondPart: AnnotationType = {
              ...annotation,
              id: uuidv4(),
              startFrame: playheadFrame
            }

            newAnnotations.push(firstPart, secondPart)
          })

          return {
            ...prevState,
            annotations: newAnnotations
          }
        })
      } else {
        // 方法2：選択範囲で分割
        const selectionStartFrame = getFrameIndexFromPositionX(selectionStart)
        const selectionEndFrame = getFrameIndexFromPositionX(
          selectionStart + selectionWidth
        )

        // 選択範囲と重なる選択されたアノテーションを取得
        const annotationsToSplit = annotations.filter(
          (annotation) =>
            selectedAnnotationIds.includes(annotation.id) &&
            annotation.endFrame > selectionStartFrame &&
            annotation.startFrame < selectionEndFrame
        )

        if (annotationsToSplit.length === 0) {
          showTimelineNotice(
            '選択範囲内に分割可能なアノテーションがありません。'
          )
          return
        }

        setState((prevState) => {
          pushToUndoStack(prevState) // Undo スタックに保存

          let newAnnotations = [...prevState.annotations]

          annotationsToSplit.forEach((annotation) => {
            // 元のアノテーションを削除
            newAnnotations = newAnnotations.filter(
              (a) => a.id !== annotation.id
            )

            // 分割されたアノテーションを作成
            const newParts: AnnotationType[] = []

            // 選択範囲の前の部分
            if (annotation.startFrame < selectionStartFrame) {
              newParts.push({
                ...annotation,
                id: uuidv4(),
                endFrame: selectionStartFrame
              })
            }

            // 選択範囲内の部分
            const overlapStart = Math.max(
              annotation.startFrame,
              selectionStartFrame
            )
            const overlapEnd = Math.min(annotation.endFrame, selectionEndFrame)
            newParts.push({
              ...annotation,
              id: uuidv4(),
              startFrame: overlapStart,
              endFrame: overlapEnd
            })

            // 選択範囲の後の部分
            if (annotation.endFrame > selectionEndFrame) {
              newParts.push({
                ...annotation,
                id: uuidv4(),
                startFrame: selectionEndFrame
              })
            }

            newAnnotations.push(...newParts)
          })

          return {
            ...prevState,
            annotations: newAnnotations
          }
        })
      }
    }

    const escapeCsvCell = (value: string | number): string => {
      const text = String(value)
      if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`
      }
      return text
    }

    const createCsvRow = (values: (string | number)[]): string => {
      return values.map(escapeCsvCell).join(',')
    }

    // 注釈付けしたものをCSVで出力する関数
    const exportCSV = () => {
      const headers = [
        '注釈層名',
        '開始フレーム',
        '終了フレーム',
        '開始時間(hh:mm:ss.SSS)',
        '終了時間(hh:mm:ss.SSS)',
        '注釈名'
      ]
      const rows = annotations.map((annotation) => {
        const layerName = layerNames[annotation.layerIndex] ?? ''
        const startTime = convertFrameToTime(annotation.startFrame)
        const endTime = convertFrameToTime(annotation.endFrame)
        return createCsvRow([
          layerName,
          annotation.startFrame,
          annotation.endFrame,
          startTime,
          endTime,
          annotation.text
        ])
      })
      const csvContent = `\uFEFF${[createCsvRow(headers), ...rows].join('\n')}\n`

      // CSVファイルの作成とダウンロード
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.setAttribute('download', 'annotations.csv')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }

    const exportEAF = () => {
      // EAF XMLの生成
      const eafContent = generateEAFContent()

      // EAFファイルの作成とダウンロード
      const blob = new Blob([eafContent], {
        type: 'application/xml;charset=utf-8;'
      })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.setAttribute('download', 'annotations.eaf')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }

    const generateEAFContent = (): string => {
      const currentDate = new Date().toISOString()

      // Time slot IDを生成
      let timeSlotId = 1
      const timeSlots: { id: string; value: number }[] = []
      const annotationElements: string[] = []

      // タイムスロットとアノテーションを生成
      annotations.forEach((annotation, index) => {
        const startSlotId = `ts${timeSlotId++}`
        const endSlotId = `ts${timeSlotId++}`

        // フレームを秒に変換 (EAFは秒単位で時間を表現)
        const startTimeSeconds = (annotation.startFrame - 1) / frameRate
        const endTimeSeconds = (annotation.endFrame - 1) / frameRate

        timeSlots.push(
          { id: startSlotId, value: Math.round(startTimeSeconds * 1000) }, // ミリ秒に変換
          { id: endSlotId, value: Math.round(endTimeSeconds * 1000) }
        )

        const layerName = layerNames[annotation.layerIndex]
        annotationElements.push(
          `      <ANNOTATION>
        <ALIGNABLE_ANNOTATION ANNOTATION_ID="a${index + 1}" TIME_SLOT_REF1="${startSlotId}" TIME_SLOT_REF2="${endSlotId}">
          <ANNOTATION_VALUE>${escapeXml(annotation.text)}</ANNOTATION_VALUE>
        </ALIGNABLE_ANNOTATION>
      </ANNOTATION>`
        )
      })

      // ユニークなレイヤー名を取得
      const uniqueLayers = [
        ...new Set(annotations.map((a) => layerNames[a.layerIndex]))
      ]

      // ティア（レイヤー）を生成
      const tierElements = uniqueLayers.map((layerName, layerIndex) => {
        const layerAnnotations = annotations
          .filter(
            (annotation) => layerNames[annotation.layerIndex] === layerName
          )
          .map((annotation, index) => {
            const globalIndex = annotations.indexOf(annotation)
            return annotationElements[globalIndex]
          })

        return `    <TIER LINGUISTIC_TYPE_REF="default-lt" TIER_ID="${escapeXml(layerName)}">
${layerAnnotations.join('\n')}
    </TIER>`
      })

      // メディアファイル情報を生成
      // localStorageから実際のファイル名を取得
      const storedFileNames = localStorage.getItem('videoFileNames')
      const actualFileNames = storedFileNames ? JSON.parse(storedFileNames) : []

      const mediaDescriptors = videoSrcs
        .map((videoSrc, index) => {
          // blob URLの場合はlocalStorageから実際のファイル名を使用、通常のパスの場合はそのまま使用
          let fileName: string
          let mediaUrl: string

          if (videoSrc.startsWith('blob:')) {
            // blob URLの場合、localStorageから実際のファイル名を取得
            fileName = actualFileNames[index] || `video${index + 1}.mp4`
            // 相対パスとして設定（ELANで手動選択を想定）
            mediaUrl = `./${fileName}`
          } else {
            // 通常のファイルパスの場合
            fileName = videoSrc.split(/[/\\]/).pop() || `video${index + 1}.mp4`
            mediaUrl = videoSrc.startsWith('file://')
              ? videoSrc
              : `file:///${videoSrc.replace(/\\/g, '/')}`
          }

          const mimeType = fileName.toLowerCase().endsWith('.mp4')
            ? 'video/mp4'
            : fileName.toLowerCase().endsWith('.webm')
              ? 'video/webm'
              : fileName.toLowerCase().endsWith('.mov')
                ? 'video/quicktime'
                : 'video/mp4'

          return `    <MEDIA_DESCRIPTOR MEDIA_URL="${escapeXml(mediaUrl)}" MIME_TYPE="${mimeType}" RELATIVE_MEDIA_URL="${escapeXml(fileName)}"/>`
        })
        .join('\n')

      return `<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT AUTHOR="" DATE="${currentDate}" FORMAT="3.0" VERSION="3.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.mpi.nl/tools/elan/EAFv3.0.xsd">
  <HEADER TIME_UNITS="milliseconds">
${mediaDescriptors}
    <PROPERTY NAME="URN">urn:nl-mpi-tools-elan-eaf:${uuidv4()}</PROPERTY>
    <PROPERTY NAME="lastUsedAnnotationId">${annotations.length}</PROPERTY>
  </HEADER>
  <TIME_ORDER>
${timeSlots.map((slot) => `    <TIME_SLOT TIME_SLOT_ID="${slot.id}" TIME_VALUE="${slot.value}"/>`).join('\n')}
  </TIME_ORDER>
${tierElements.join('\n')}
  <LINGUISTIC_TYPE GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="default-lt" TIME_ALIGNABLE="true"/>
  <CONSTRAINT DESCRIPTION="Time subdivision of parent annotation's time interval, no time gaps allowed within this interval" STEREOTYPE="Time_Subdivision"/>
  <CONSTRAINT DESCRIPTION="Symbolic subdivision of a parent annotation. Annotations refering to the same parent are ordered" STEREOTYPE="Symbolic_Subdivision"/>
  <CONSTRAINT DESCRIPTION="1-1 association with a parent annotation" STEREOTYPE="Symbolic_Association"/>
  <CONSTRAINT DESCRIPTION="Time alignable annotations within the parent annotation's time interval, gaps are allowed" STEREOTYPE="Included_In"/>
</ANNOTATION_DOCUMENT>`
    }

    const escapeXml = (text: string): string => {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
    }

    // フレームを時間形式に変換する関数（hh:mm:ss.SSS）
    const convertFrameToTime = (frame: number) => {
      const totalSeconds = (frame - 1) / frameRate
      const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
      const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(
        2,
        '0'
      )
      const seconds = String(Math.floor(totalSeconds % 60)).padStart(2, '0')
      const milliseconds = String(
        Math.floor((totalSeconds % 1) * 1000)
      ).padStart(3, '0')

      return `${hours}:${minutes}:${seconds}.${milliseconds}`
    }

    useEffect(() => {
      if (autoAnnotationResponseData?.length === 0) return
      // autoAnnotationResponseDataの中にあるlayerNameでlayerNamesを書き換え
      const newLayerNames = [
        ...new Set(
          autoAnnotationResponseData?.map((data) => data.layerName) ?? []
        )
      ]
      setState((prevState) => ({
        ...prevState,
        layerNames: newLayerNames,
        annotations: (autoAnnotationResponseData ?? []).map((data) => ({
          id: uuidv4(),
          startFrame: data.startFrame,
          endFrame: data.endFrame,
          text: data.text,
          layerIndex: data.layerIndex
        }))
      }))

      // レイヤー数に合わせて containerRefs を初期化
      updateContainerRefs(newLayerNames)
      setSelectedLayerIndex(clampLayerIndex(0, newLayerNames))
    }, [autoAnnotationResponseData])

    // ドキュメント全体でマウスイベントを監視
    useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
        if (isDragging) {
          updatePlayheadPosition(e.clientX)
        }
        if (isSelecting) {
          handleSelectionMouseMove(e)
        }
      }

      const handleMouseUp = () => {
        if (isDragging) {
          setIsDragging(false)
        }
        if (isSelecting) {
          handleSelectionMouseUp()
        }
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)

      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }, [isDragging, isSelecting])

    // ドキュメント全体でUndo/Redoのキーボードショートカットを監視
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.ctrlKey && e.key === 'z') {
          e.preventDefault()
          undo()
        } else if (
          (e.ctrlKey && e.key === 'y') ||
          (e.ctrlKey && e.shiftKey && e.key === 'z')
        ) {
          e.preventDefault()
          redo()
        }
      }

      document.addEventListener('keydown', handleKeyDown)

      return () => {
        document.removeEventListener('keydown', handleKeyDown)
      }
    })

    // useImperativeHandleを使用してexportCSVとexportEAFを公開
    useImperativeHandle(ref, () => ({
      exportCSV,
      exportEAF
    }))

    // レイヤー数に合わせて containerRefs を初期化
    useEffect(() => {
      containerRefs.current = layerNames.map(() =>
        React.createRef<HTMLDivElement>()
      )
    }, [layerNames])

    return (
      <section
        id="editor"
        className={`${videoSrcs.length == 0 ? 'hide' : ''}`}
        style={{ height: `calc(${100 - topHeight}% - 1.5rem)` }}
      >
        <div className="controls">
          <button onClick={() => setCurrentFrame(1)}>
            <img src="./skip_start.svg" alt="" />
          </button>
          <button
            onClick={() => setCurrentFrame((frame) => Math.max(1, frame - 1))}
          >
            <img src="./1f_left.svg" alt="< 1f" />
          </button>
          <button onClick={() => play()}>
            <img
              src={isPlaying ? './pause.svg' : './play.svg'}
              alt={isPlaying ? 'pause' : 'play'}
            />
          </button>
          <button
            onClick={() =>
              setCurrentFrame((frame) => Math.min(totalFrames, frame + 1))
            }
          >
            <img src="./1f_right.svg" alt="1f >" />
          </button>
          <button onClick={() => setCurrentFrame(totalFrames)}>
            <img src="./skip_end.svg" alt="" />
          </button>
          <button
            onClick={() => {
              setIsPartiallyPlaying(!isPartiallyPlaying)
              setIsPlaying?.(false)
            }}
          >
            部分再生
          </button>
          <button onClick={addLayer}>注釈層追加</button>
          <button onClick={deleteLayer}>注釈層削除</button>
          <button onClick={addAnnotation}>注釈追加</button>
          <button onClick={deleteAnnotation}>注釈削除</button>
          <button onClick={mergeAnnotations}>結合</button>
          <button onClick={splitAnnotations}>分割</button>
          <button onClick={undo} disabled={undoStack.length === 0}>
            戻す
          </button>
          <button onClick={redo} disabled={redoStack.length === 0}>
            進める
          </button>
        </div>
        {timelineNotice && (
          <div className="timeline-notice">
            <span>{timelineNotice}</span>
            <button
              type="button"
              aria-label="通知を閉じる"
              title="通知を閉じる"
              onClick={() => setTimelineNotice(null)}
            >
              &times;
            </button>
          </div>
        )}
        <div className="timeline-container">
          {videoSrcs.length == 0 ? (
            <></>
          ) : (
            <table ref={timelineContainerRef}>
              <tr className="timelines" ref={timelinesRef}>
                <td></td>
                <th
                  ref={timeBarRef}
                  className="time-bar"
                  style={{
                    width: `calc(${timelineWidth}px + ${videoDuration !== 0 ? 20 : 0}rem)`
                  }}
                  onMouseDown={handleTimeBarMouseDown}
                >
                  {/* 長い目盛りとタイムラベルをレンダリング */}
                  {(() => {
                    const remInPixels = parseFloat(
                      getComputedStyle(document.documentElement).fontSize
                    )
                    const offset = 10 * remInPixels // 10remのオフセット
                    const totalSeconds = Math.floor(videoDuration)
                    const secondMarkers: { second: number; index: number }[] =
                      []

                    for (let second = 0; second <= totalSeconds; second++) {
                      const index = second * frameRate
                      secondMarkers.push({ second, index })
                    }

                    // 秒のマーカーのインデックスをセットにして高速な検索を可能にする
                    const secondMarkerSet = new Set(
                      secondMarkers.map(({ index }) => index)
                    )

                    return (
                      <>
                        {secondMarkers.map(({ second, index }) => (
                          <React.Fragment key={`second-${second}`}>
                            <div
                              className="time-marker"
                              style={{
                                position: 'absolute',
                                left: `calc(${index * frameWidth}px + ${offset}px)`,
                                height: '50%'
                              }}
                            ></div>
                            <div
                              className="time-label"
                              style={{
                                position: 'absolute',
                                left: `calc(${index * frameWidth}px + ${offset}px)`,
                                top: '0',
                                transform: 'translateX(-50%)',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {second}s
                            </div>
                          </React.Fragment>
                        ))}
                        {/* 短い目盛りをレンダリング */}
                        {[...Array(totalFrames)].map((_, index) => {
                          if (secondMarkerSet.has(index)) {
                            return null // 秒の区切りは既にレンダリング済み
                          }
                          return (
                            <div
                              key={`frame-${index}`}
                              className="time-marker"
                              style={{
                                position: 'absolute',
                                left: `calc(${index * frameWidth}px + ${offset}px)`,
                                height: '20%'
                              }}
                            ></div>
                          )
                        })}
                      </>
                    )
                  })()}
                </th>
                <div
                  className="playhead"
                  style={{ left: `${playheadLeft}px` }}
                ></div>
                {/* 選択範囲を表示 */}
                {selectionWidth !== 0 && (
                  <div
                    className="selected-area"
                    style={{
                      left: `${selectionStart}px`,
                      width: `${selectionWidth}px`
                    }}
                  ></div>
                )}
              </tr>

              {layerNames.map((name, layerIndex) => {
                // 各レイヤーに対応する containerRef を取得
                const containerRef = containerRefs.current[layerIndex]
                return (
                  <tr
                    key={layerIndex}
                    className={`layer ${selectedLayerIndex === layerIndex ? 'selected' : ''}`}
                  >
                    <th
                      onClick={() => handleLayerClick(layerIndex)}
                      onDoubleClick={() =>
                        handleLayerNameDoubleClick(layerIndex)
                      }
                    >
                      <div key={layerIndex} className={`layer-name`}>
                        {editingLayerIndex === layerIndex ? (
                          <input
                            type="text"
                            value={editingLayerName}
                            onChange={(e) =>
                              handleLayerNameChange(e.target.value)
                            }
                            onBlur={handleLayerNameBlur}
                            onKeyDown={handleInputKeyDown}
                            autoFocus
                          />
                        ) : (
                          <div>{name}</div>
                        )}
                      </div>
                    </th>
                    <div
                      className="timeline"
                      ref={containerRef} // 各レイヤーの containerRef を割り当て
                      style={{
                        width: `${timelineWidth}px`,
                        position: 'relative'
                      }}
                      onMouseDown={handleTimelineMouseDown}
                    >
                      {annotations
                        .filter(
                          (annotation) => annotation.layerIndex === layerIndex
                        )
                        .map((annotation) => (
                          <Annotation
                            key={annotation.id}
                            id={annotation.id}
                            containerRef={containerRef}
                            layerIndex={annotation.layerIndex}
                            frameWidth={frameWidth}
                            startFrame={annotation.startFrame}
                            endFrame={annotation.endFrame}
                            focused={annotation.id === focusedAnnotationId}
                            setFocusedAnnotationId={setFocusedAnnotationId}
                            selectedAnnotationIds={selectedAnnotationIds}
                            setSelectedAnnotationIds={setSelectedAnnotationIds}
                            setSelectedLayerIndex={setSelectedLayerIndex}
                            onEditing={setIsEditing}
                            onChange={(
                              updatedAnnotation,
                              shouldPushToUndoStack
                            ) =>
                              handleAnnotationChange(
                                annotation.id,
                                updatedAnnotation,
                                shouldPushToUndoStack
                              )
                            }
                            text={annotation.text}
                            handlePlayheadMoveDown={handlePlayheadMoveDown}
                            handlePlayheadMove={handlePlayheadMove}
                            setCurrentFrame={setCurrentFrame}
                            timelineWidth={timelineWidth}
                            canUpdateAnnotation={(
                              id,
                              newStartFrame,
                              newEndFrame
                            ) => {
                              const layerAnnotations = annotations.filter(
                                (a) =>
                                  a.layerIndex === annotation.layerIndex &&
                                  a.id !== id
                              )
                              const newAnnotation = {
                                id,
                                startFrame: newStartFrame,
                                endFrame: newEndFrame,
                                text: annotation.text,
                                layerIndex: annotation.layerIndex
                              }
                              return canInsertAnnotation(
                                newAnnotation,
                                layerAnnotations
                              )
                            }}
                          />
                        ))}
                    </div>
                  </tr>
                )
              })}
            </table>
          )}
        </div>
        <div className="zoom-controls">
          <button
            onClick={() => {
              setZoomLevel(defaultZoomLevel)
            }}
          >
            <img src="./reset.svg" alt="" />
          </button>
          <input
            type="range"
            min={minZoomLevel}
            max={maxZoomLevel}
            step={0.1}
            value={zoomLevel}
            onChange={(e) => {
              const newZoomLevel = parseFloat(e.target.value)
              setZoomLevel(newZoomLevel)
            }}
          />
        </div>
      </section>
    )
  }
)

Timeline.displayName = 'Timeline'

export default Timeline
