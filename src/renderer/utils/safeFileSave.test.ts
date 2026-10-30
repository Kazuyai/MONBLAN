import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeTextFileAtomically } from '../../main/safeFileSave'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    )
  )
})

const createTemporaryDirectory = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monblan-save-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('writeTextFileAtomically', () => {
  it('新規ファイルを保存して一時ファイルを残さない', async () => {
    const directory = await createTemporaryDirectory()
    const targetPath = path.join(directory, 'annotations.eaf')

    await writeTextFileAtomically(targetPath, '<ANNOTATION_DOCUMENT />')

    expect(await fs.readFile(targetPath, 'utf8')).toBe(
      '<ANNOTATION_DOCUMENT />'
    )
    expect(await fs.readdir(directory)).toEqual(['annotations.eaf'])
  })

  it('既存ファイルを置き換える', async () => {
    const directory = await createTemporaryDirectory()
    const targetPath = path.join(directory, 'annotations.eaf')
    await fs.writeFile(targetPath, 'before', 'utf8')

    await writeTextFileAtomically(targetPath, 'after')

    expect(await fs.readFile(targetPath, 'utf8')).toBe('after')
    expect(await fs.readdir(directory)).toEqual(['annotations.eaf'])
  })
})
