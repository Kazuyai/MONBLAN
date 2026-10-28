import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SnackbarProvider, useSnackbar } from './SnackbarProvider'

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const SnackbarTestControls = () => {
  const { showSnackbar } = useSnackbar()
  return (
    <>
      <button
        id="first-notice"
        onClick={() => showSnackbar('最初の通知', { duration: 0 })}
      >
        最初
      </button>
      <button
        id="second-notice"
        onClick={() => showSnackbar('次の通知', { duration: 0 })}
      >
        次
      </button>
    </>
  )
}

describe('SnackbarProvider', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(
        <SnackbarProvider>
          <SnackbarTestControls />
        </SnackbarProvider>
      )
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('複数通知をキューに保持して順番に表示する', () => {
    act(() => {
      document.getElementById('first-notice')?.click()
      document.getElementById('second-notice')?.click()
    })

    const firstSnackbar = document.querySelector('.app-snackbar')
    expect(firstSnackbar?.textContent).toContain('最初の通知')
    expect(firstSnackbar?.textContent).toContain('残り1件')

    act(() => {
      firstSnackbar
        ?.querySelector<HTMLButtonElement>('button[aria-label="通知を閉じる"]')
        ?.click()
    })

    expect(document.querySelector('.app-snackbar')?.textContent).toContain(
      '次の通知'
    )
  })

  it('同じ種類・内容の通知を重複して追加しない', () => {
    act(() => {
      document.getElementById('first-notice')?.click()
      document.getElementById('first-notice')?.click()
    })

    expect(document.querySelectorAll('.app-snackbar')).toHaveLength(1)
    expect(document.querySelector('.app-snackbar')?.textContent).not.toContain(
      '残り'
    )
  })
})
