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

const referencedEaf = `<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT AUTHOR="tester" DATE="2026-10-28T00:00:00.000Z" FORMAT="3.0" VERSION="3.0">
  <HEADER TIME_UNITS="milliseconds">
    <MEDIA_DESCRIPTOR MEDIA_URL="file:///C:/videos/front.mp4" RELATIVE_MEDIA_URL="./front.mp4" MIME_TYPE="video/mp4"/>
    <MEDIA_DESCRIPTOR MEDIA_URL="file:///C:/videos/side.mp4" RELATIVE_MEDIA_URL="./side.mp4" MIME_TYPE="video/mp4"/>
    <PROPERTY NAME="CUSTOM_METADATA">preserved</PROPERTY>
  </HEADER>
  <TIME_ORDER>
    <TIME_SLOT TIME_SLOT_ID="ts1" TIME_VALUE="1000"/>
    <TIME_SLOT TIME_SLOT_ID="ts2" TIME_VALUE="2000"/>
  </TIME_ORDER>
  <TIER TIER_ID="動作" LINGUISTIC_TYPE_REF="default-lt">
    <ANNOTATION><ALIGNABLE_ANNOTATION ANNOTATION_ID="a1" TIME_SLOT_REF1="ts1" TIME_SLOT_REF2="ts2"><ANNOTATION_VALUE>親注釈</ANNOTATION_VALUE></ALIGNABLE_ANNOTATION></ANNOTATION>
  </TIER>
  <TIER TIER_ID="分類" LINGUISTIC_TYPE_REF="symbolic" PARENT_REF="動作">
    <ANNOTATION><REF_ANNOTATION ANNOTATION_ID="a2" ANNOTATION_REF="a1"><ANNOTATION_VALUE>子注釈</ANNOTATION_VALUE></REF_ANNOTATION></ANNOTATION>
  </TIER>
  <LINGUISTIC_TYPE GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="default-lt" TIME_ALIGNABLE="true"/>
  <LINGUISTIC_TYPE CONSTRAINTS="Symbolic_Association" GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="symbolic" TIME_ALIGNABLE="false"/>
  <CONSTRAINT DESCRIPTION="1-1 association with a parent annotation" STEREOTYPE="Symbolic_Association"/>
</ANNOTATION_DOCUMENT>`

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
    expect(updatedEaf).toContain('TIME_SLOT_REF1="ts1"')
    expect(updatedEaf).toContain('TIME_SLOT_REF2="ts2"')
  })

  it('参照注釈・複数メディア・未知要素を保持する', () => {
    const project = parseEafProject(referencedEaf, {
      frameRate: 30,
      fileName: 'referenced.eaf',
      sourceFilePath: 'C:\\annotations\\referenced.eaf'
    })

    expect(project.annotations).toHaveLength(1)
    expect(project.videos.map((video) => video.name)).toEqual([
      'front.mp4',
      'side.mp4'
    ])
    expect(project.eafSource?.warnings).toContain(
      '1件の参照注釈は編集対象外ですが、元の構造を保って再出力します。'
    )

    project.annotations[0].text = '更新した親注釈'
    const updatedEaf = generateEafContent({
      annotations: project.annotations,
      layerNames: project.layerNames,
      eafTierIds: project.eafTierIds ?? [],
      eafSource: project.eafSource ?? null,
      frameRate: project.frameRate,
      videos: project.videos
    })

    expect(updatedEaf).toContain('ANNOTATION_REF="a1"')
    expect(updatedEaf).toContain('PARENT_REF="動作"')
    expect(updatedEaf).toContain('STEREOTYPE="Symbolic_Association"')
    expect(updatedEaf).toContain(
      '<PROPERTY NAME="CUSTOM_METADATA">preserved</PROPERTY>'
    )
    expect(updatedEaf.match(/MEDIA_DESCRIPTOR/g)).toHaveLength(2)
  })

  it('参照注釈の親になっている注釈は削除を拒否する', () => {
    const project = parseEafProject(referencedEaf, {
      frameRate: 30,
      fileName: 'referenced.eaf'
    })

    expect(() =>
      generateEafContent({
        annotations: [],
        layerNames: project.layerNames,
        eafTierIds: project.eafTierIds ?? [],
        eafSource: project.eafSource ?? null,
        frameRate: project.frameRate,
        videos: project.videos
      })
    ).toThrow('注釈「a1」は参照注釈の親であるため削除できません。')
  })
})
