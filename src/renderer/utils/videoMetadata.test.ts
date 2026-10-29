import { describe, expect, it } from 'vitest'
import { buildStoredVideoMetadata } from './videoMetadata'

describe('buildStoredVideoMetadata', () => {
  it('再生URLがない動画を含めてもEAFの動画順を維持する', () => {
    expect(
      buildStoredVideoMetadata(
        ['monblan-media://local/second'],
        ['remote.mp4', 'local.mp4'],
        ['', 'C:\\videos\\local.mp4']
      )
    ).toEqual([
      { name: 'remote.mp4', path: undefined },
      { name: 'local.mp4', path: 'C:\\videos\\local.mp4' }
    ])
  })

  it('保存情報がない場合はfile URLから名前とパスを復元する', () => {
    expect(
      buildStoredVideoMetadata(['file:///C:/videos/sample%20video.mp4'], [], [])
    ).toEqual([
      {
        name: 'sample%20video.mp4',
        path: 'C:\\videos\\sample video.mp4'
      }
    ])
  })
})
