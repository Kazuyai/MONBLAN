import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'

export const writeTextFileAtomically = async (
  targetPath: string,
  content: string
): Promise<void> => {
  const directory = path.dirname(targetPath)
  const fileName = path.basename(targetPath)
  const temporaryPath = path.join(
    directory,
    `.${fileName}.${process.pid}.${randomUUID()}.tmp`
  )

  let temporaryFile: fs.FileHandle | null = null
  try {
    temporaryFile = await fs.open(temporaryPath, 'wx')
    await temporaryFile.writeFile(content, 'utf8')
    await temporaryFile.sync()
    await temporaryFile.close()
    temporaryFile = null
    await fs.rename(temporaryPath, targetPath)
  } catch (error) {
    await temporaryFile?.close().catch(() => undefined)
    await fs.unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}
