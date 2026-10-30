import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnnotationList from './AnnotationList'

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true

describe('AnnotationList', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('選択中の注釈層を開始時間順で表示し、行選択を通知する', () => {
    const onSelectLayer = vi.fn()
    const onSelectAnnotation = vi.fn()
    act(() => {
      root.render(
        <AnnotationList
          annotations={[
            {
              id: 'later',
              startFrame: 61,
              endFrame: 90,
              text: '後の注釈',
              layerIndex: 1
            },
            {
              id: 'other-layer',
              startFrame: 1,
              endFrame: 10,
              text: '別レイヤー',
              layerIndex: 0
            },
            {
              id: 'earlier',
              startFrame: 31,
              endFrame: 60,
              text: '先の注釈',
              layerIndex: 1
            }
          ]}
          layerNames={['動作', '発話']}
          selectedLayerIndex={1}
          selectedAnnotationId="earlier"
          frameRate={30}
          onSelectLayer={onSelectLayer}
          onSelectAnnotation={onSelectAnnotation}
        />
      )
    })

    expect(
      container.querySelector<HTMLSelectElement>('#annotation-list-layer')
        ?.value
    ).toBe('1')
    const rows = Array.from(
      container.querySelectorAll<HTMLTableRowElement>('tbody tr')
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('先の注釈')
    expect(rows[0].textContent).toContain('1.000s')
    expect(rows[0].textContent).toContain('1.967s')
    expect(rows[0].textContent).toContain('0.967s')
    expect(rows[0].classList.contains('selected')).toBe(true)

    act(() => rows[0].click())
    expect(onSelectAnnotation).toHaveBeenCalledWith('earlier')

    const layerSelect = container.querySelector<HTMLSelectElement>(
      '#annotation-list-layer'
    )!
    act(() => {
      layerSelect.value = '0'
      layerSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onSelectLayer).toHaveBeenCalledWith(0)
  })
})
