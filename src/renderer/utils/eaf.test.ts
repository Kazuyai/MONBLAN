import { describe, expect, it } from 'vitest'
import { generateEafContent, parseEafProject, readEafFrameRate } from './eaf'

const generateSampleEaf = () =>
  generateEafContent({
    annotations: [
      {
        id: 'annotation-1',
        startFrame: 121,
        endFrame: 181,
        text: 'じゃんけん',
        layerIndex: 0
      }
    ],
    layerNames: ['動作'],
    eafTierIds: [null],
    eafSource: null,
    frameRate: 30,
    videos: [{ name: 'sample.mp4', path: 'C:\\videos\\sample.mp4' }]
  })

describe('EAF round trip', () => {
  it('MONBLANのfpsを保持し、フレーム境界をずらさない', () => {
    const eaf = generateSampleEaf()

    expect(readEafFrameRate(eaf)).toBe(30)

    const project = parseEafProject(eaf, {
      frameRate: 30,
      fileName: 'sample.eaf',
      sourceFilePath: 'C:\\annotations\\sample.eaf'
    })

    expect(project.annotations).toHaveLength(1)
    expect(project.annotations[0]).toMatchObject({
      startFrame: 121,
      endFrame: 181,
      text: 'じゃんけん',
      layerIndex: 0
    })
    expect(project.eafSource?.warnings).toEqual([])
  })

  it('未対応のPROPERTYを保持したまま注釈と動画参照を更新する', () => {
    const sourceEaf = generateSampleEaf().replace(
      '</HEADER>',
      '<PROPERTY NAME="CUSTOM_METADATA">preserved</PROPERTY></HEADER>'
    )
    const project = parseEafProject(sourceEaf, {
      frameRate: 30,
      fileName: 'sample.eaf',
      sourceFilePath: 'C:\\annotations\\sample.eaf'
    })
    project.annotations[0].text = '更新後'

    const updatedEaf = generateEafContent({
      annotations: project.annotations,
      layerNames: project.layerNames,
      eafTierIds: project.eafTierIds ?? [null],
      eafSource: project.eafSource ?? null,
      frameRate: project.frameRate,
      videos: [{ name: 'replacement.mp4', path: 'D:\\data\\replacement.mp4' }]
    })

    expect(updatedEaf).toContain(
      '<PROPERTY NAME="CUSTOM_METADATA">preserved</PROPERTY>'
    )
    expect(updatedEaf).toContain('<ANNOTATION_VALUE>更新後</ANNOTATION_VALUE>')
    expect(updatedEaf).toContain('file:///D:/data/replacement.mp4')
  })
})
