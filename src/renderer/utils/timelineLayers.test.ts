import { describe, expect, it } from 'vitest'
import {
  getScrollOffsetToRevealRange,
  getVerticalAutoScrollDelta,
  moveArrayItem,
  remapLayerIndex
} from './timelineLayers'

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

  it('ドラッグ位置が表示領域の端に近いほど速く自動スクロールする', () => {
    expect(getVerticalAutoScrollDelta(100, 100, 500)).toBe(-18)
    expect(getVerticalAutoScrollDelta(136, 100, 500)).toBe(-9)
    expect(getVerticalAutoScrollDelta(300, 100, 500)).toBe(0)
    expect(getVerticalAutoScrollDelta(464, 100, 500)).toBe(9)
    expect(getVerticalAutoScrollDelta(500, 100, 500)).toBe(18)
  })

  it('表示領域外では自動スクロール速度を最大値に制限する', () => {
    expect(getVerticalAutoScrollDelta(0, 100, 500)).toBe(-18)
    expect(getVerticalAutoScrollDelta(600, 100, 500)).toBe(18)
  })

  it('対象が表示範囲外にある場合だけ必要な距離をスクロールする', () => {
    expect(getScrollOffsetToRevealRange(200, 100, 500, 200, 250, 1000)).toBe(
      200
    )
    expect(getScrollOffsetToRevealRange(200, 100, 500, 60, 110, 1000)).toBe(
      160
    )
    expect(getScrollOffsetToRevealRange(200, 100, 500, 480, 540, 1000)).toBe(
      240
    )
  })

  it('表示用スクロール位置を有効範囲内に制限する', () => {
    expect(getScrollOffsetToRevealRange(10, 100, 500, 0, 50, 1000)).toBe(0)
    expect(
      getScrollOffsetToRevealRange(990, 100, 500, 550, 650, 1000)
    ).toBe(1000)
  })
})
