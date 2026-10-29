import { describe, expect, it } from 'vitest'
import { moveArrayItem, remapLayerIndex } from './timelineLayers'

describe('timelineLayers', () => {
  it('レイヤーと対応情報を同じ順序で移動できる', () => {
    expect(moveArrayItem(['A', 'B', 'C'], 0, 2)).toEqual(['B', 'C', 'A'])
    expect(moveArrayItem(['a-id', 'b-id', 'c-id'], 0, 2)).toEqual([
      'b-id',
      'c-id',
      'a-id'
    ])
  })

  it('下方向への移動に合わせてレイヤー番号を変換する', () => {
    expect([0, 1, 2, 3].map((index) => remapLayerIndex(index, 0, 2))).toEqual([
      2, 0, 1, 3
    ])
  })

  it('上方向への移動に合わせてレイヤー番号を変換する', () => {
    expect([0, 1, 2, 3].map((index) => remapLayerIndex(index, 3, 1))).toEqual([
      0, 2, 3, 1
    ])
  })
})
