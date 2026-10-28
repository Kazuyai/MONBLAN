import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TimelineZoomControls from './TimelineZoomControls'

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true

describe('TimelineZoomControls', () => {
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

  it('リセットと倍率変更を委譲する', () => {
    const onReset = vi.fn()
    const onChange = vi.fn()
    act(() => {
      root.render(
        <TimelineZoomControls
          min={0.5}
          max={5}
          value={1}
          onReset={onReset}
          onChange={onChange}
        />
      )
    })

    act(() => {
      container.querySelector<HTMLButtonElement>('button')?.click()
    })
    const input = container.querySelector<HTMLInputElement>('input')
    if (!input) throw new Error('Zoom input was not rendered')
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set?.call(input, '2.5')
    act(() => input.dispatchEvent(new Event('change', { bubbles: true })))

    expect(onReset).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(2.5)
  })
})
