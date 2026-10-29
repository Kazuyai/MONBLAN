export const getElectronFilePath = (file: File): string | null => {
  const legacyPath = (file as File & { path?: string }).path

  try {
    const filePath = window.electronAPI?.getPathForFile?.(file)
    if (filePath) return filePath
  } catch {
    return legacyPath || null
  }

  return legacyPath || null
}
