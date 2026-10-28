import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CandidateToolbar from './CandidateToolbar'

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true

describe('CandidateToolbar', () => {
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

  it('件数を表示して挿入・破棄操作を委譲する', () => {
    const onInsertAll = vi.fn()
    const onDiscardAll = vi.fn()
    act(() => {
      root.render(
        <CandidateToolbar
          title="類似候補"
          totalCount={3}
          insertableCount={2}
          conflictingCount={1}
          onInsertAll={onInsertAll}
          onDiscardAll={onDiscardAll}
        />
      )
    })

    expect(container.textContent).toContain('類似候補: 3件')
    expect(container.textContent).toContain('挿入可能: 2件')
    expect(container.textContent).toContain('重複: 1件')

    const buttons = container.querySelectorAll('button')
    act(() => {
      buttons[0].click()
      buttons[1].click()
    })
    expect(onInsertAll).toHaveBeenCalledOnce()
    expect(onDiscardAll).toHaveBeenCalledOnce()
  })

  it('挿入可能な候補がなければ一括挿入を無効化する', () => {
    act(() => {
      root.render(
        <CandidateToolbar
          title="動作検出候補"
          totalCount={1}
          insertableCount={0}
          conflictingCount={1}
          movement
          onInsertAll={vi.fn()}
          onDiscardAll={vi.fn()}
        />
      )
    })

    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(
      true
    )
    expect(
      container.querySelector('.movement-candidate-toolbar')
    ).not.toBeNull()
  })
})
