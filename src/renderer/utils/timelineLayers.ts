export const moveArrayItem = <T>(
  items: T[],
  fromIndex: number,
  toIndex: number
): T[] => {
  const nextItems = [...items]
  const [movedItem] = nextItems.splice(fromIndex, 1)
  nextItems.splice(toIndex, 0, movedItem)
  return nextItems
}

export const insertArrayItem = <T>(
  items: T[],
  index: number,
  item: T
): T[] => [...items.slice(0, index), item, ...items.slice(index)]

export const shiftLayerIndexForInsertion = (
  layerIndex: number,
  insertionIndex: number
): number => (layerIndex >= insertionIndex ? layerIndex + 1 : layerIndex)

export const remapLayerIndex = (
  layerIndex: number,
  fromIndex: number,
  toIndex: number
): number => {
  if (layerIndex === fromIndex) return toIndex
  if (fromIndex < toIndex && layerIndex > fromIndex && layerIndex <= toIndex) {
    return layerIndex - 1
  }
  if (fromIndex > toIndex && layerIndex >= toIndex && layerIndex < fromIndex) {
    return layerIndex + 1
  }
  return layerIndex
}

export const getVerticalAutoScrollDelta = (
  pointerY: number,
  visibleTop: number,
  visibleBottom: number,
  edgeSize = 72,
  maxSpeed = 18
): number => {
  const visibleHeight = visibleBottom - visibleTop
  if (visibleHeight <= 0 || edgeSize <= 0 || maxSpeed <= 0) return 0

  const effectiveEdgeSize = Math.min(edgeSize, visibleHeight / 2)
  if (pointerY < visibleTop + effectiveEdgeSize) {
    const ratio = Math.min(
      1,
      Math.max(
        0,
        (visibleTop + effectiveEdgeSize - pointerY) / effectiveEdgeSize
      )
    )
    return -maxSpeed * ratio
  }
  if (pointerY > visibleBottom - effectiveEdgeSize) {
    const ratio = Math.min(
      1,
      Math.max(
        0,
        (pointerY - (visibleBottom - effectiveEdgeSize)) / effectiveEdgeSize
      )
    )
    return maxSpeed * ratio
  }
  return 0
}

export const getScrollOffsetToRevealRange = (
  currentOffset: number,
  visibleStart: number,
  visibleEnd: number,
  itemStart: number,
  itemEnd: number,
  maxOffset: number
): number => {
  let nextOffset = currentOffset
  if (itemStart < visibleStart) {
    nextOffset += itemStart - visibleStart
  } else if (itemEnd > visibleEnd) {
    nextOffset += itemEnd - visibleEnd
  }
  return Math.max(0, Math.min(maxOffset, nextOffset))
}
