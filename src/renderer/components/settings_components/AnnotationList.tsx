import React, { useEffect, useMemo, useState } from 'react'
import type { ProjectAnnotation } from '../../types'

interface AnnotationListProps {
  annotations: ProjectAnnotation[]
  layerNames: string[]
  selectedLayerIndex: number | null
  selectedAnnotationId?: string
  frameRate: number
  onSelectAnnotation: (annotationId: string) => void
}

const formatSeconds = (seconds: number) => `${seconds.toFixed(3)}s`

const AnnotationList: React.FC<AnnotationListProps> = ({
  annotations,
  layerNames,
  selectedLayerIndex,
  selectedAnnotationId,
  frameRate,
  onSelectAnnotation
}) => {
  const [displayedLayerIndex, setDisplayedLayerIndex] = useState(0)

  useEffect(() => {
    if (layerNames.length === 0) {
      setDisplayedLayerIndex(0)
      return
    }
    if (selectedLayerIndex !== null && selectedLayerIndex < layerNames.length) {
      setDisplayedLayerIndex(selectedLayerIndex)
      return
    }
    setDisplayedLayerIndex((current) =>
      Math.min(current, layerNames.length - 1)
    )
  }, [layerNames.length, selectedLayerIndex])

  const displayedAnnotations = useMemo(
    () =>
      annotations
        .filter((annotation) => annotation.layerIndex === displayedLayerIndex)
        .sort(
          (first, second) =>
            first.startFrame - second.startFrame ||
            first.endFrame - second.endFrame
        ),
    [annotations, displayedLayerIndex]
  )

  return (
    <div className="annotation-list-panel">
      <div className="annotation-list-toolbar">
        <label htmlFor="annotation-list-layer">注釈層</label>
        <select
          id="annotation-list-layer"
          value={displayedLayerIndex}
          disabled={layerNames.length === 0}
          onChange={(event) =>
            setDisplayedLayerIndex(Number(event.target.value))
          }
        >
          {layerNames.map((layerName, layerIndex) => (
            <option key={layerIndex} value={layerIndex}>
              {layerName}
            </option>
          ))}
        </select>
        <span>{displayedAnnotations.length}件</span>
      </div>

      <div className="annotation-list-table-container">
        <table className="annotation-list-table">
          <thead>
            <tr>
              <th scope="col">番号</th>
              <th scope="col">注釈</th>
              <th scope="col">開始</th>
              <th scope="col">終了</th>
              <th scope="col">長さ</th>
            </tr>
          </thead>
          <tbody>
            {displayedAnnotations.map((annotation, index) => {
              const startTime = (annotation.startFrame - 1) / frameRate
              const endTime = (annotation.endFrame - 1) / frameRate
              const duration =
                (annotation.endFrame - annotation.startFrame) / frameRate
              return (
                <tr
                  key={annotation.id}
                  className={
                    annotation.id === selectedAnnotationId ? 'selected' : ''
                  }
                  tabIndex={0}
                  onClick={() => onSelectAnnotation(annotation.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelectAnnotation(annotation.id)
                    }
                  }}
                >
                  <td>{index + 1}</td>
                  <td title={annotation.text}>{annotation.text || '（空欄）'}</td>
                  <td>{formatSeconds(startTime)}</td>
                  <td>{formatSeconds(endTime)}</td>
                  <td>{formatSeconds(duration)}</td>
                </tr>
              )
            })}
            {displayedAnnotations.length === 0 && (
              <tr className="empty">
                <td colSpan={5}>この注釈層には注釈がありません。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default AnnotationList
