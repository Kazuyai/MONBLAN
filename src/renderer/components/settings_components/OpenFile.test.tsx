import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SnackbarProvider } from '../SnackbarProvider'
import OpenFile from './OpenFile'

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const eafWithFrameRate = `<?xml version="1.0" encoding="UTF-8"?>
<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT FORMAT="3.0" VERSION="3.0">
  <HEADER TIME_UNITS="milliseconds">
    <PROPERTY NAME="MONBLAN_FRAME_RATE">25</PROPERTY>
  </HEADER>
  <TIME_ORDER>
    <TIME_SLOT TIME_SLOT_ID="ts1" TIME_VALUE="0"/>
    <TIME_SLOT TIME_SLOT_ID="ts2" TIME_VALUE="1000"/>
  </TIME_ORDER>
  <TIER TIER_ID="動作" LINGUISTIC_TYPE_REF="default-lt">
    <ANNOTATION>
      <ALIGNABLE_ANNOTATION ANNOTATION_ID="a1" TIME_SLOT_REF1="ts1" TIME_SLOT_REF2="ts2">
        <ANNOTATION_VALUE>テスト</ANNOTATION_VALUE>
      </ALIGNABLE_ANNOTATION>
    </ANNOTATION>
  </TIER>
  <LINGUISTIC_TYPE LINGUISTIC_TYPE_ID="default-lt" TIME_ALIGNABLE="true"/>
</ANNOTATION_DOCUMENT>`

describe('OpenFile', () => {
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
    vi.restoreAllMocks()
  })

  it('EAF内のfpsを使用し、動画APIや手入力なしで読み込む', async () => {
    const setFrameRate = vi.fn()
    const onImportProjectJson = vi.fn().mockResolvedValue(undefined)
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await act(async () => {
      root.render(
        <SnackbarProvider>
          <OpenFile
            setProcessingTask={vi.fn()}
            setVideoSrcs={vi.fn()}
            setFrameRate={setFrameRate}
            frameRate={30}
            onOpenVideos={vi.fn()}
            onImportProjectJson={onImportProjectJson}
          />
        </SnackbarProvider>
      )
    })

    const input = container.querySelector<HTMLInputElement>('#project-input')
    const file = new File([eafWithFrameRate], 'sample.eaf', {
      type: 'application/xml'
    })
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: vi.fn().mockResolvedValue(eafWithFrameRate)
    })
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file]
    })

    await act(async () => {
      input?.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(setFrameRate).toHaveBeenCalledWith(25)
    expect(onImportProjectJson).toHaveBeenCalledOnce()
    expect(onImportProjectJson.mock.calls[0][0]).toMatchObject({
      frameRate: 25,
      layerNames: ['動作']
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.querySelector('#manual-frame-rate')).toBeNull()
  })

  it('XMLが壊れたEAFをfps不足として扱わない', async () => {
    const onImportProjectJson = vi.fn().mockResolvedValue(undefined)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await act(async () => {
      root.render(
        <SnackbarProvider>
          <OpenFile
            setProcessingTask={vi.fn()}
            setVideoSrcs={vi.fn()}
            setFrameRate={vi.fn()}
            frameRate={30}
            onOpenVideos={vi.fn()}
            onImportProjectJson={onImportProjectJson}
          />
        </SnackbarProvider>
      )
    })

    const input = container.querySelector<HTMLInputElement>('#project-input')
    const file = new File(['<broken>'], 'broken.eaf', {
      type: 'application/xml'
    })
    Object.defineProperty(file, 'text', {
      configurable: true,
      value: vi.fn().mockResolvedValue('<broken>')
    })
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file]
    })

    await act(async () => {
      input?.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onImportProjectJson).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.querySelector('#manual-frame-rate')).toBeNull()
    expect(container.textContent).toContain('EAFのXML形式が正しくありません。')
  })
})
