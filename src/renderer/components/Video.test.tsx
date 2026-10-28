import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Video from './Video'

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}
reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true

describe('Video', () => {
  let container: HTMLDivElement
  let root: Root
  let currentTime = 0
  let mediaEvents: string[]
  let completeSeekAutomatically = true
  let completePendingSeek: (() => void) | null = null
  let requestAnimationFrameMock: ReturnType<typeof vi.fn>
  let seekResultTimes: number[]

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    currentTime = 0
    mediaEvents = []
    completeSeekAutomatically = true
    completePendingSeek = null
    seekResultTimes = []
    requestAnimationFrameMock = vi.fn().mockReturnValue(1)
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(
      async () => {
        mediaEvents.push('play')
      }
    )
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(
      HTMLMediaElement.HAVE_METADATA
    )
    vi.spyOn(
      HTMLMediaElement.prototype,
      'currentTime',
      'get'
    ).mockImplementation(() => currentTime)
    vi.spyOn(
      HTMLMediaElement.prototype,
      'currentTime',
      'set'
    ).mockImplementation(function setCurrentTime(
      this: HTMLMediaElement,
      value: number
    ) {
      currentTime = seekResultTimes.shift() ?? value
      mediaEvents.push(`seek:${value}`)
      if (completeSeekAutomatically) {
        this.dispatchEvent(new Event('seeked'))
      } else {
        completePendingSeek = () => this.dispatchEvent(new Event('seeked'))
      }
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('選択範囲の開始位置へシークしてから部分再生する', async () => {
    await act(async () => {
      root.render(
        <Video
          videoSrcs={['test.mp4']}
          videoDuration={10}
          setVideoDuration={vi.fn()}
          isEditing={false}
          currentFrame={1}
          setCurrentFrame={vi.fn()}
          frameRate={30}
          isPlaying={false}
          setIsPlaying={vi.fn()}
          playSpeed={1}
          setPlaySpeed={vi.fn()}
          isPartiallyPlaying
          setIsPartiallyPlaying={vi.fn()}
          selectionStartFrame={121}
          selectionFrameWidth={60}
        />
      )
    })

    expect(currentTime).toBeCloseTo(4.001, 3)
    expect(mediaEvents).toEqual(['seek:4.001', 'play'])
  })

  it('選択範囲がない場合は部分再生を開始しない', async () => {
    const setIsPartiallyPlaying = vi.fn()

    await act(async () => {
      root.render(
        <Video
          videoSrcs={['test.mp4']}
          videoDuration={10}
          setVideoDuration={vi.fn()}
          isEditing={false}
          currentFrame={1}
          setCurrentFrame={vi.fn()}
          frameRate={30}
          isPlaying={false}
          setIsPlaying={vi.fn()}
          playSpeed={1}
          setPlaySpeed={vi.fn()}
          isPartiallyPlaying
          setIsPartiallyPlaying={setIsPartiallyPlaying}
          selectionStartFrame={0}
          selectionFrameWidth={0}
        />
      )
    })

    expect(mediaEvents).not.toContain('play')
    expect(setIsPartiallyPlaying).toHaveBeenCalledWith(false)
  })

  it('シーク完了前は0秒の再生位置で現在フレームを上書きしない', async () => {
    completeSeekAutomatically = false
    const setCurrentFrame = vi.fn()

    await act(async () => {
      root.render(
        <Video
          videoSrcs={['test.mp4']}
          videoDuration={10}
          setVideoDuration={vi.fn()}
          isEditing={false}
          currentFrame={121}
          setCurrentFrame={setCurrentFrame}
          frameRate={30}
          isPlaying={false}
          setIsPlaying={vi.fn()}
          playSpeed={1}
          setPlaySpeed={vi.fn()}
          isPartiallyPlaying
          setIsPartiallyPlaying={vi.fn()}
          selectionStartFrame={121}
          selectionFrameWidth={60}
        />
      )
    })

    expect(currentTime).toBeCloseTo(4.001, 3)
    expect(requestAnimationFrameMock).not.toHaveBeenCalled()
    expect(setCurrentFrame).not.toHaveBeenCalled()

    await act(async () => {
      completePendingSeek?.()
      await Promise.resolve()
    })

    expect(mediaEvents).toContain('play')
    expect(requestAnimationFrameMock).toHaveBeenCalledOnce()
  })

  it('古いseekedイベントで0秒が返った場合は選択開始位置へ再シークする', async () => {
    seekResultTimes = [0, 4.001]

    await act(async () => {
      root.render(
        <Video
          videoSrcs={['test.mp4']}
          videoDuration={10}
          setVideoDuration={vi.fn()}
          isEditing={false}
          currentFrame={121}
          setCurrentFrame={vi.fn()}
          frameRate={30}
          isPlaying={false}
          setIsPlaying={vi.fn()}
          playSpeed={1}
          setPlaySpeed={vi.fn()}
          isPartiallyPlaying
          setIsPartiallyPlaying={vi.fn()}
          selectionStartFrame={121}
          selectionFrameWidth={60}
        />
      )
    })

    expect(currentTime).toBeCloseTo(4.001, 3)
    expect(mediaEvents.filter((event) => event === 'seek:4.001')).toHaveLength(
      2
    )
    expect(mediaEvents.at(-1)).toBe('play')
  })

  it('通常停止中は指定フレームへ移動し、通常再生を開始できる', async () => {
    const renderVideo = (isPlaying: boolean) => (
      <Video
        videoSrcs={['test.mp4']}
        videoDuration={10}
        setVideoDuration={vi.fn()}
        isEditing={false}
        currentFrame={61}
        setCurrentFrame={vi.fn()}
        frameRate={30}
        isPlaying={isPlaying}
        setIsPlaying={vi.fn()}
        playSpeed={1}
        setPlaySpeed={vi.fn()}
        isPartiallyPlaying={false}
        setIsPartiallyPlaying={vi.fn()}
        selectionStartFrame={0}
        selectionFrameWidth={0}
      />
    )

    await act(async () => {
      root.render(renderVideo(false))
    })
    expect(currentTime).toBeCloseTo(2.001, 3)
    expect(mediaEvents).not.toContain('play')

    mediaEvents = []
    await act(async () => {
      root.render(renderVideo(true))
    })
    expect(mediaEvents).toContain('play')
  })

  it('複数動画でもSpaceによる再生状態の反転は1回だけ行う', async () => {
    const setIsPlaying = vi.fn()

    await act(async () => {
      root.render(
        <Video
          videoSrcs={['front.mp4', 'side.mp4']}
          videoDuration={10}
          setVideoDuration={vi.fn()}
          isEditing={false}
          currentFrame={1}
          setCurrentFrame={vi.fn()}
          frameRate={30}
          isPlaying={false}
          setIsPlaying={setIsPlaying}
          playSpeed={1}
          setPlaySpeed={vi.fn()}
          isPartiallyPlaying={false}
          setIsPartiallyPlaying={vi.fn()}
          selectionStartFrame={0}
          selectionFrameWidth={0}
        />
      )
    })

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))

    expect(setIsPlaying).toHaveBeenCalledOnce()
    const update = setIsPlaying.mock.calls[0][0] as (value: boolean) => boolean
    expect(update(false)).toBe(true)
  })

  it('部分再生中のSpaceは通常再生へ移行せず停止する', async () => {
    const setIsPlaying = vi.fn()
    const setIsPartiallyPlaying = vi.fn()

    await act(async () => {
      root.render(
        <Video
          videoSrcs={['test.mp4']}
          videoDuration={10}
          setVideoDuration={vi.fn()}
          isEditing={false}
          currentFrame={121}
          setCurrentFrame={vi.fn()}
          frameRate={30}
          isPlaying={false}
          setIsPlaying={setIsPlaying}
          playSpeed={1}
          setPlaySpeed={vi.fn()}
          isPartiallyPlaying
          setIsPartiallyPlaying={setIsPartiallyPlaying}
          selectionStartFrame={121}
          selectionFrameWidth={60}
        />
      )
    })

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))

    expect(setIsPartiallyPlaying).toHaveBeenCalledWith(false)
    expect(setIsPlaying).toHaveBeenCalledWith(false)
  })

  it('停止中の左右キー操作を現在フレームへ反映する', async () => {
    const setCurrentFrame = vi.fn()

    await act(async () => {
      root.render(
        <Video
          videoSrcs={['test.mp4']}
          videoDuration={10}
          setVideoDuration={vi.fn()}
          isEditing={false}
          currentFrame={1}
          setCurrentFrame={setCurrentFrame}
          frameRate={30}
          isPlaying={false}
          setIsPlaying={vi.fn()}
          playSpeed={1}
          setPlaySpeed={vi.fn()}
          isPartiallyPlaying={false}
          setIsPartiallyPlaying={vi.fn()}
          selectionStartFrame={0}
          selectionFrameWidth={0}
        />
      )
    })

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }))

    expect(currentTime).toBeCloseTo(5.001, 3)
    expect(setCurrentFrame).toHaveBeenCalledWith(151)
  })
})
