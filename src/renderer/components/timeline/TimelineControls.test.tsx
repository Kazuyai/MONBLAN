import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TimelineControls from './TimelineControls'

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const noOperation = () => undefined

describe('TimelineControls', () => {
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

  const renderControls = (
    hasSelectionRange: boolean,
    isPartiallyPlaying: boolean,
    onTogglePartialPlayback: () => void
  ) => {
    act(() => {
      root.render(
        <TimelineControls
          isPlaying={false}
          isPartiallyPlaying={isPartiallyPlaying}
          hasSelectionRange={hasSelectionRange}
          undoDisabled
          redoDisabled
          onJumpToStart={noOperation}
          onPreviousFrame={noOperation}
          onTogglePlayback={noOperation}
          onNextFrame={noOperation}
          onJumpToEnd={noOperation}
          onTogglePartialPlayback={onTogglePartialPlayback}
          onAddLayer={noOperation}
          onDeleteLayer={noOperation}
          onAddAnnotation={noOperation}
          onDeleteAnnotation={noOperation}
          onMergeAnnotations={noOperation}
          onSplitAnnotations={noOperation}
          onUndo={noOperation}
          onRedo={noOperation}
        />
      )
    })
  }

  it('範囲未選択時は部分再生を開始できない', () => {
    const onToggle = vi.fn()
    renderControls(false, false, onToggle)

    const button = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent === '部分再生'
    )
    expect(button).toBeInstanceOf(HTMLButtonElement)
    expect((button as HTMLButtonElement).disabled).toBe(true)

    act(() => button?.click())
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('部分再生中は停止操作であることを表示する', () => {
    const onToggle = vi.fn()
    renderControls(true, true, onToggle)

    const button = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent === '部分再生を停止'
    )
    expect(button?.getAttribute('aria-pressed')).toBe('true')

    act(() => button?.click())
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('各操作ボタンを対応する処理へ委譲する', () => {
    const callbacks = {
      onJumpToStart: vi.fn(),
      onPreviousFrame: vi.fn(),
      onTogglePlayback: vi.fn(),
      onNextFrame: vi.fn(),
      onJumpToEnd: vi.fn(),
      onAddLayer: vi.fn(),
      onDeleteLayer: vi.fn(),
      onAddAnnotation: vi.fn(),
      onDeleteAnnotation: vi.fn(),
      onMergeAnnotations: vi.fn(),
      onSplitAnnotations: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn()
    }

    act(() => {
      root.render(
        <TimelineControls
          isPlaying={false}
          isPartiallyPlaying={false}
          hasSelectionRange
          undoDisabled={false}
          redoDisabled={false}
          onTogglePartialPlayback={noOperation}
          {...callbacks}
        />
      )
    })

    const click = (selector: string) => {
      act(() => container.querySelector<HTMLButtonElement>(selector)?.click())
    }
    const clickText = (text: string) => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (element) => element.textContent === text
      )
      act(() => button?.click())
    }

    click('button[aria-label="先頭へ移動"]')
    click('button[aria-label="1フレーム戻る"]')
    click('button[aria-label="再生"]')
    click('button[aria-label="1フレーム進む"]')
    click('button[aria-label="末尾へ移動"]')
    clickText('注釈層追加')
    clickText('注釈層削除')
    clickText('注釈追加')
    clickText('注釈削除')
    clickText('結合')
    clickText('分割')
    clickText('戻す')
    clickText('進める')

    Object.values(callbacks).forEach((callback) => {
      expect(callback).toHaveBeenCalledOnce()
    })
  })
})
