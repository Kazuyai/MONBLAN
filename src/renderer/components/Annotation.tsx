import React, { useRef, useLayoutEffect, useState, useEffect } from 'react'

interface AnnotationProps {
  id: string
  containerRef: React.RefObject<HTMLDivElement>
  layerIndex: number
  frameWidth: number
  startFrame: number
  endFrame: number
  focused: boolean
  setFocusedAnnotationId: (id: string) => void
  selectedAnnotationIds: string[]
  setSelectedAnnotationIds: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedLayerIndex: (index: number) => void
  onEditing: (isEditing: boolean) => void
  onChange: (
    updatedAnnotation: { startFrame: number; endFrame: number; text: string },
    shouldPushToUndoStack?: boolean
  ) => void
  text: string
  setCurrentFrame: (frame: number) => void
  timelineWidth: number
  canUpdateAnnotation: (
    id: string,
    newStartFrame: number,
    newEndFrame: number
  ) => boolean
  onSelectRange: (startFrame: number, endFrame: number) => void
}

const Annotation: React.FC<AnnotationProps> = ({
  id,
  containerRef,
  layerIndex,
  frameWidth,
  startFrame,
  endFrame,
  focused,
  setFocusedAnnotationId,
  selectedAnnotationIds,
  setSelectedAnnotationIds,
  setSelectedLayerIndex,
  onEditing,
  onChange,
  text: initialText,
  setCurrentFrame,
  timelineWidth,
  canUpdateAnnotation,
  onSelectRange
}) => {
  const sliderRef = useRef<HTMLDivElement>(null)
  const [currentStartFrame, setCurrentStartFrame] = useState(startFrame)
  const [currentEndFrame, setCurrentEndFrame] = useState(endFrame)
  const [isEditing, setIsEditing] = useState(false)
  const [text, setText] = useState(initialText)
  const inputRef = useRef<HTMLInputElement>(null)

  // ドラッグ中の情報を保持するための変数
  const draggingRef = useRef<HTMLElement | null>(null)
  const dragOffsetRef = useRef<number>(0)
  const clickStartRef = useRef<{ x: number; y: number } | null>(null)
  const shouldSelectRangeOnClickRef = useRef(false)

  // 初期の位置と幅を保持
  const initialLeftRef = useRef<number>(0)
  const initialRightRef = useRef<number>(0)

  // 初期レンダリングかどうかを判定するフラグ
  const isInitialMount = useRef(true)

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
    } else {
      // 外部からの変更時のみステートを更新
      setCurrentStartFrame(startFrame)
      setCurrentEndFrame(endFrame)
      setText(initialText)
    }
  }, [startFrame, endFrame, initialText])

  useLayoutEffect(() => {
    const container = containerRef.current
    const slider = sliderRef.current

    if (!container || !slider) return

    const leftHandle = slider.querySelector<HTMLDivElement>('.left-handle')
    const rightHandle = slider.querySelector<HTMLDivElement>('.right-handle')

    if (!leftHandle || !rightHandle) return

    const snapToFrame = (value: number, frameWidth: number) => {
      return Math.round(value / frameWidth) * frameWidth
    }

    const onMouseDown = (e: MouseEvent) => {
      const sliderRect = slider.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()

      if (e.target === leftHandle || e.target === rightHandle) {
        clickStartRef.current = null
        shouldSelectRangeOnClickRef.current = false
        draggingRef.current = e.target as HTMLElement
        dragOffsetRef.current =
          e.clientX -
          (e.target === leftHandle ? sliderRect.left : sliderRect.right)
        initialLeftRef.current = sliderRect.left - containerRect.left
        initialRightRef.current = containerRect.right - sliderRect.right
        setCurrentFrame(
          e.target === leftHandle ? currentStartFrame : currentEndFrame
        )
      } else if (e.target === slider && !isEditing) {
        clickStartRef.current = { x: e.clientX, y: e.clientY }
        shouldSelectRangeOnClickRef.current = true
        draggingRef.current = slider
        dragOffsetRef.current = e.clientX - sliderRect.left
        initialLeftRef.current = sliderRect.left - containerRect.left
        initialRightRef.current = containerRect.right - sliderRect.right
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      if (draggingRef.current && e.buttons === 0) {
        finishDragging()
        return
      }

      if (draggingRef.current) {
        if (clickStartRef.current) {
          const moveDistance = Math.hypot(
            e.clientX - clickStartRef.current.x,
            e.clientY - clickStartRef.current.y
          )
          if (moveDistance > 4) {
            shouldSelectRangeOnClickRef.current = false
          }
        }

        const containerRect = container.getBoundingClientRect()

        if (draggingRef.current === slider) {
          // スライダー全体を移動
          const deltaX =
            e.clientX -
            containerRect.left -
            dragOffsetRef.current -
            initialLeftRef.current
          let newLeft = initialLeftRef.current + deltaX
          let newRight = initialRightRef.current - deltaX

          // スナップ処理
          newLeft = snapToFrame(newLeft, frameWidth)
          newRight = snapToFrame(newRight, frameWidth)

          const proposedStartFrame = Math.round(newLeft / frameWidth) + 1
          const proposedEndFrame =
            Math.round((containerRect.width - newRight) / frameWidth) + 1

          // 重なりをチェック
          if (canUpdateAnnotation(id, proposedStartFrame, proposedEndFrame)) {
            // 移動範囲を制限
            newLeft = Math.max(0, newLeft)
            newRight = Math.max(0, newRight)

            slider.style.left = newLeft + 'px'
            slider.style.right = newRight + 'px'
          }
        } else if (draggingRef.current === leftHandle) {
          // 左ハンドルを移動
          const deltaX =
            e.clientX -
            containerRect.left -
            dragOffsetRef.current -
            initialLeftRef.current
          let newLeft = initialLeftRef.current + deltaX

          // スナップ処理
          newLeft = snapToFrame(newLeft, frameWidth)

          const proposedStartFrame = Math.round(newLeft / frameWidth) + 1
          const proposedEndFrame = currentEndFrame

          if (
            proposedStartFrame < proposedEndFrame &&
            canUpdateAnnotation(id, proposedStartFrame, proposedEndFrame)
          ) {
            // 移動範囲を制限
            newLeft = Math.max(
              0,
              Math.min(
                containerRect.width - initialRightRef.current - frameWidth,
                newLeft
              )
            )

            slider.style.left = newLeft + 'px'
            setCurrentFrame(Math.round(newLeft / frameWidth) + 1)
          }
        } else if (draggingRef.current === rightHandle) {
          // 右ハンドルを移動
          const deltaX =
            e.clientX -
            containerRect.left -
            dragOffsetRef.current -
            (containerRect.width - initialRightRef.current)
          let newRight = initialRightRef.current - deltaX

          // スナップ処理
          newRight = snapToFrame(newRight, frameWidth)

          const proposedStartFrame = currentStartFrame
          const proposedEndFrame =
            Math.round((containerRect.width - newRight) / frameWidth) + 1

          if (
            proposedEndFrame > proposedStartFrame &&
            canUpdateAnnotation(id, proposedStartFrame, proposedEndFrame)
          ) {
            // 移動範囲を制限
            newRight = Math.max(
              0,
              Math.min(
                containerRect.width - initialLeftRef.current - frameWidth,
                newRight
              )
            )

            slider.style.right = newRight + 'px'
            setCurrentFrame(
              Math.round((containerRect.width - newRight) / frameWidth) + 1
            )
          }
        }
      }
    }

    const finishDragging = () => {
      // ドラッグ終了時にフレームを更新
      if (!draggingRef.current) {
        return
      }

      draggingRef.current = null
      const containerRect = container.getBoundingClientRect()
      const sliderRect = slider.getBoundingClientRect()

      const newLeft = sliderRect.left - containerRect.left
      const newRight = containerRect.right - sliderRect.right

      const newStartFrame = Math.round(newLeft / frameWidth) + 1
      const newEndFrame =
        Math.round((containerRect.width - newRight) / frameWidth) + 1

      setCurrentStartFrame(newStartFrame)
      setCurrentEndFrame(newEndFrame)

      if (
        newStartFrame !== startFrame ||
        newEndFrame !== endFrame
      ) {
        onChange(
          {
            startFrame: newStartFrame,
            endFrame: newEndFrame,
            text
          },
          true
        )
      }
    }

    const onMouseUp = () => {
      finishDragging()
    }

    const onDoubleClick = (e: MouseEvent) => {
      if (e.target !== leftHandle && e.target !== rightHandle) {
        setIsEditing(true)
        onEditing(true) // 編集状態の開始を通知
        setCurrentFrame(currentStartFrame)
      }
    }

    // イベントリスナーを追加
    slider.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onMouseUp)
    slider.addEventListener('dblclick', onDoubleClick)

    return () => {
      // クリーンアップ
      slider.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', onMouseUp)
      slider.removeEventListener('dblclick', onDoubleClick)
    }
  }, [
    containerRef,
    frameWidth,
    isEditing,
    onChange,
    onEditing,
    text,
    canUpdateAnnotation,
    id,
    startFrame,
    endFrame,
    currentStartFrame,
    currentEndFrame,
    setCurrentFrame,
    onSelectRange
  ])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value)
  }

  const handleInputBlur = () => {
    setIsEditing(false)
    onEditing(false) // 編集状態の終了を通知
    onChange(
      {
        startFrame: currentStartFrame,
        endFrame: currentEndFrame,
        text
      },
      true
    )
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      setIsEditing(false)
      onEditing(false) // 編集状態の終了を通知
      onChange(
        {
          startFrame: currentStartFrame,
          endFrame: currentEndFrame,
          text
        },
        true
      )
    }
  }

  const handleSetSelectedAnnotationIds = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      setSelectedAnnotationIds((prev: string[]) => {
        if (prev.includes(id)) {
          setFocusedAnnotationId('')
          return prev.filter((prevId) => prevId !== id)
        } else {
          setFocusedAnnotationId(id)
          return [...prev, id]
        }
      })
    } else {
      setFocusedAnnotationId(id)
      setSelectedAnnotationIds([id])
    }
  }

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditing])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isEditing &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsEditing(false)
        onEditing(false) // 編集状態の終了を通知
        onChange(
          {
            startFrame: currentStartFrame,
            endFrame: currentEndFrame,
            text
          },
          true
        )
      }
    }

    if (isEditing) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      if (isEditing) {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [isEditing, currentStartFrame, currentEndFrame, text, onEditing, onChange])

  return (
    <div
      className={`slider ${focused ? 'focused' : ''} ${selectedAnnotationIds.includes(id) ? 'selected' : ''}`}
      data-annotation-id={id}
      ref={sliderRef}
      onClick={(e) => {
        handleSetSelectedAnnotationIds(e)
        setSelectedLayerIndex(layerIndex)
        if (shouldSelectRangeOnClickRef.current) {
          onSelectRange(currentStartFrame, currentEndFrame)
        }
        clickStartRef.current = null
        shouldSelectRangeOnClickRef.current = false
      }}
      style={{
        left: `${(currentStartFrame - 1) * frameWidth}px`,
        right: `${timelineWidth - (currentEndFrame - 1) * frameWidth}px`,
        position: 'absolute',
        top: '0'
      }}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
          style={{ width: '100%' }}
        />
      ) : (
        <div className="annotation-text">{text}</div>
      )}
      <div className="handle left-handle"></div>
      <div className="handle right-handle"></div>
    </div>
  )
}

export default Annotation
