import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Annotation from './Annotation'

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true

describe('Annotation', () => {
  let container: HTMLDivElement
  let timeline: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    timeline = document.createElement('div')
    container.appendChild(timeline)
    document.body.appendChild(container)
    root = createRoot(timeline)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('focuses the input when immediate editing is requested', () => {
    const onEditing = vi.fn()
    const setCurrentFrame = vi.fn()
    const onAutoFocusHandled = vi.fn()
    const timelineRef = { current: timeline }

    act(() => {
      root.render(
        <Annotation
          id="new-annotation"
          containerRef={timelineRef}
          layerIndex={0}
          frameWidth={10}
          startFrame={10}
          endFrame={20}
          focused
          setFocusedAnnotationId={vi.fn()}
          selectedAnnotationIds={['new-annotation']}
          setSelectedAnnotationIds={vi.fn()}
          setSelectedLayerIndex={vi.fn()}
          onEditing={onEditing}
          onChange={vi.fn()}
          text=""
          setCurrentFrame={setCurrentFrame}
          timelineWidth={1000}
          canUpdateAnnotation={() => true}
          onSelectRange={vi.fn()}
          autoFocusOnMount
          onAutoFocusHandled={onAutoFocusHandled}
        />
      )
    })

    const input = timeline.querySelector('input')
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)
    expect(onEditing).toHaveBeenCalledWith(true)
    expect(setCurrentFrame).toHaveBeenCalledWith(10)
    expect(onAutoFocusHandled).toHaveBeenCalledOnce()
  })
})
