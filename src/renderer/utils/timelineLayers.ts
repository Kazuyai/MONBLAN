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
