import { afterEach, describe, expect, it } from 'vitest'
import { getElectronFilePath } from './electronFile'

const originalElectronApi = window.electronAPI

afterEach(() => {
  window.electronAPI = originalElectronApi
})

describe('getElectronFilePath', () => {
  it('ElectronのwebUtils経由でファイルパスを取得する', () => {
    window.electronAPI = {
      getPathForFile: () => 'C:\\videos\\sample.mp4'
    } as unknown as Window['electronAPI']

    expect(getElectronFilePath(new File([], 'sample.mp4'))).toBe(
      'C:\\videos\\sample.mp4'
    )
  })

  it('旧Electronのpathプロパティへフォールバックする', () => {
    window.electronAPI = undefined as unknown as Window['electronAPI']
    const file = new File([], 'sample.mp4') as File & { path?: string }
    file.path = 'C:\\legacy\\sample.mp4'

    expect(getElectronFilePath(file)).toBe('C:\\legacy\\sample.mp4')
  })
})
