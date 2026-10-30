import { v4 as uuidv4 } from 'uuid'
import type {
  AnnotationProject,
  EafSourceDocument,
  ProjectAnnotation,
  ProjectVideo
} from '../types'

interface ParseEafOptions {
  frameRate: number
  fileName: string
  sourceFilePath?: string | null
}

interface GenerateEafOptions {
  annotations: ProjectAnnotation[]
  layerNames: string[]
  eafTierIds: (string | null)[]
  eafSource: EafSourceDocument | null
  frameRate: number
  videos: ProjectVideo[]
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'
const LEADING_XML_DECLARATIONS = /^(?:\uFEFF?\s*<\?xml\s+[^?]*\?>\s*)+/i
const MONBLAN_FRAME_RATE_PROPERTY = 'MONBLAN_FRAME_RATE'
const MONBLAN_FORMAT_VERSION_PROPERTY = 'MONBLAN_FORMAT_VERSION'
const MONBLAN_FORMAT_VERSION = '1'

const elementsByLocalName = (root: ParentNode, name: string): Element[] =>
  Array.from(root.querySelectorAll('*')).filter(
    (element) => element.localName === name
  )

const directChildrenByLocalName = (root: Element, name: string): Element[] =>
  Array.from(root.children).filter((element) => element.localName === name)

const firstDirectChild = (root: Element, name: string): Element | null =>
  directChildrenByLocalName(root, name)[0] ?? null

const parseXml = (xml: string): XMLDocument => {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('DOCTYPEまたはENTITYを含むEAFは安全のため読み込めません。')
  }

  const normalizedXml = xml.replace(
    LEADING_XML_DECLARATIONS,
    `${XML_DECLARATION}\n`
  )
  const document = new DOMParser().parseFromString(
    normalizedXml,
    'application/xml'
  )
  if (
    document.documentElement.localName === 'parsererror' ||
    elementsByLocalName(document, 'parsererror').length > 0
  ) {
    throw new Error('EAFのXML形式が正しくありません。')
  }
  if (document.documentElement.localName !== 'ANNOTATION_DOCUMENT') {
    throw new Error('ELAN EAF形式のファイルではありません。')
  }
  return document
}

const timeToFrame = (milliseconds: number, frameRate: number): number =>
  Math.round((milliseconds * frameRate) / 1000) + 1

const frameToTime = (frame: number, frameRate: number): number =>
  Math.round(((frame - 1) / frameRate) * 1000)

const fileUrlToPath = (url: string): string | undefined => {
  if (!url.startsWith('file:')) return undefined
  try {
    const parsed = new URL(url)
    const decodedPath = decodeURIComponent(parsed.pathname)
    return decodedPath.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\')
  } catch {
    return undefined
  }
}

const resolveRelativeMediaPath = (
  relativeUrl: string,
  sourceFilePath?: string | null
): string | undefined => {
  if (!relativeUrl || !sourceFilePath) return undefined
  const normalizedSource = sourceFilePath.replace(/\//g, '\\')
  const separatorIndex = normalizedSource.lastIndexOf('\\')
  if (separatorIndex < 0) return undefined
  const sourceDirectory = normalizedSource.slice(0, separatorIndex)
  return `${sourceDirectory}\\${relativeUrl.replace(/^\.\//, '').replace(/\//g, '\\')}`
}

const mediaFileName = (url: string): string => {
  const cleanUrl = url.split(/[?#]/)[0]
  return decodeURIComponent(cleanUrl.split(/[/\\]/).pop() || 'video')
}

const videoMimeType = (fileName: string): string => {
  const lowerName = fileName.toLowerCase()
  if (lowerName.endsWith('.webm')) return 'video/webm'
  if (lowerName.endsWith('.mov')) return 'video/quicktime'
  return 'video/mp4'
}

const updateMediaDescriptor = (descriptor: Element, video: ProjectVideo) => {
  const normalizedPath = video.path?.replace(/\\/g, '/')
  descriptor.setAttribute(
    'MEDIA_URL',
    normalizedPath ? `file:///${normalizedPath}` : `./${video.name}`
  )
  descriptor.setAttribute('RELATIVE_MEDIA_URL', `./${video.name}`)
  descriptor.setAttribute('MIME_TYPE', videoMimeType(video.name))
}

const updateMediaDescriptors = (
  document: XMLDocument,
  videos: ProjectVideo[]
) => {
  if (videos.length === 0) return
  const header = elementsByLocalName(document, 'HEADER')[0]
  if (!header) throw new Error('EAFにHEADERがありません。')
  const descriptors = directChildrenByLocalName(header, 'MEDIA_DESCRIPTOR')
  videos.forEach((video, index) => {
    let descriptor = descriptors[index]
    if (!descriptor) {
      descriptor = createElement(document, 'MEDIA_DESCRIPTOR')
      const insertionPoint = Array.from(header.children).find(
        (element) =>
          element.localName === 'LINKED_FILE_DESCRIPTOR' ||
          element.localName === 'PROPERTY'
      )
      header.insertBefore(descriptor, insertionPoint ?? null)
    }
    updateMediaDescriptor(descriptor, video)
  })
}

const parseVideos = (
  document: XMLDocument,
  sourceFilePath?: string | null
): ProjectVideo[] =>
  elementsByLocalName(document, 'MEDIA_DESCRIPTOR').map((descriptor) => {
    const mediaUrl = descriptor.getAttribute('MEDIA_URL') ?? ''
    const relativeUrl = descriptor.getAttribute('RELATIVE_MEDIA_URL') ?? ''
    return {
      name: mediaFileName(relativeUrl || mediaUrl),
      path:
        fileUrlToPath(mediaUrl) ??
        resolveRelativeMediaPath(relativeUrl, sourceFilePath)
    }
  })

export const readEafMediaDescriptors = (
  xml: string,
  sourceFilePath?: string | null
): ProjectVideo[] => parseVideos(parseXml(xml), sourceFilePath)

export const readEafFrameRate = (xml: string): number | null => {
  const document = parseXml(xml)
  const property = elementsByLocalName(document, 'PROPERTY').find(
    (element) => element.getAttribute('NAME') === MONBLAN_FRAME_RATE_PROPERTY
  )
  const frameRate = Number(property?.textContent)
  return Number.isFinite(frameRate) && frameRate > 0 ? frameRate : null
}

export const parseEafProject = (
  xml: string,
  options: ParseEafOptions
): AnnotationProject => {
  if (!Number.isFinite(options.frameRate) || options.frameRate <= 0) {
    throw new Error('EAFの読み込みには正しいフレームレートが必要です。')
  }

  const document = parseXml(xml)
  const header = elementsByLocalName(document, 'HEADER')[0]
  const timeUnits = header?.getAttribute('TIME_UNITS')
  if (timeUnits && timeUnits.toLowerCase() !== 'milliseconds') {
    throw new Error(`TIME_UNITS="${timeUnits}"のEAFには対応していません。`)
  }
  const embeddedFrameRate = readEafFrameRate(xml)
  const warnings = embeddedFrameRate
    ? []
    : [
        `EAFにMONBLANのフレームレート情報がないため、${options.frameRate}fpsとして読み込みました。`
      ]
  const format = document.documentElement.getAttribute('FORMAT')
  const version = document.documentElement.getAttribute('VERSION')
  if (
    (format && !format.startsWith('3.')) ||
    (version && !version.startsWith('3.'))
  ) {
    warnings.push(
      `EAF ${version || format || '不明'}を読み込みました。再出力前にELANで内容を確認してください。`
    )
  }

  const timeSlots = new Map<string, number>()
  elementsByLocalName(document, 'TIME_SLOT').forEach((slot) => {
    const id = slot.getAttribute('TIME_SLOT_ID')
    const rawValue = slot.getAttribute('TIME_VALUE')
    const value = rawValue === null || rawValue === '' ? NaN : Number(rawValue)
    if (!id) throw new Error('TIME_SLOT_IDのないタイムスロットがあります。')
    if (timeSlots.has(id)) {
      throw new Error(`TIME_SLOT_ID「${id}」が重複しています。`)
    }
    if (Number.isFinite(value)) timeSlots.set(id, value)
  })

  const tiers = elementsByLocalName(document, 'TIER')
  const seenTierIds = new Set<string>()
  const seenAnnotationIds = new Set<string>()
  elementsByLocalName(document, 'ALIGNABLE_ANNOTATION')
    .concat(elementsByLocalName(document, 'REF_ANNOTATION'))
    .forEach((annotation) => {
      const id = annotation.getAttribute('ANNOTATION_ID')
      if (!id) throw new Error('ANNOTATION_IDのない注釈があります。')
      if (seenAnnotationIds.has(id)) {
        throw new Error(`ANNOTATION_ID「${id}」が重複しています。`)
      }
      seenAnnotationIds.add(id)
    })
  const layerNames: string[] = []
  const eafTierIds: string[] = []
  const annotations: ProjectAnnotation[] = []
  const importedAnnotationIds: string[] = []
  let skippedAlignableCount = 0

  tiers.forEach((tier, layerIndex) => {
    const tierId = tier.getAttribute('TIER_ID')
    if (!tierId) throw new Error('TIER_IDのない注釈層があります。')
    if (seenTierIds.has(tierId)) {
      throw new Error(`TIER_ID「${tierId}」が重複しています。`)
    }
    seenTierIds.add(tierId)
    layerNames.push(tierId)
    eafTierIds.push(tierId)

    elementsByLocalName(tier, 'ALIGNABLE_ANNOTATION').forEach((element) => {
      const annotationId = element.getAttribute('ANNOTATION_ID')
      const startMilliseconds = timeSlots.get(
        element.getAttribute('TIME_SLOT_REF1') ?? ''
      )
      const endMilliseconds = timeSlots.get(
        element.getAttribute('TIME_SLOT_REF2') ?? ''
      )
      if (
        !annotationId ||
        startMilliseconds === undefined ||
        endMilliseconds === undefined ||
        endMilliseconds <= startMilliseconds
      ) {
        skippedAlignableCount += 1
        return
      }

      const value = firstDirectChild(element, 'ANNOTATION_VALUE')
      annotations.push({
        id: uuidv4(),
        startFrame: timeToFrame(startMilliseconds, options.frameRate),
        endFrame: timeToFrame(endMilliseconds, options.frameRate),
        text: value?.textContent ?? '',
        layerIndex,
        eafAnnotationId: annotationId,
        eafTierId: tierId,
        eafOriginalStartTime: startMilliseconds,
        eafOriginalEndTime: endMilliseconds,
        eafOriginalStartFrame: timeToFrame(
          startMilliseconds,
          options.frameRate
        ),
        eafOriginalEndFrame: timeToFrame(endMilliseconds, options.frameRate)
      })
      importedAnnotationIds.push(annotationId)
    })
  })

  const referenceAnnotationCount = elementsByLocalName(
    document,
    'REF_ANNOTATION'
  ).length
  if (referenceAnnotationCount > 0) {
    warnings.push(
      `${referenceAnnotationCount}件の参照注釈は編集対象外ですが、元の構造を保って再出力します。`
    )
  }
  if (skippedAlignableCount > 0) {
    warnings.push(
      `時間情報が不完全な${skippedAlignableCount}件の注釈は編集対象外として保持します。`
    )
  }

  const maxTime = Math.max(0, ...timeSlots.values())
  const now = new Date().toISOString()
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    videos: parseVideos(document, options.sourceFilePath),
    frameRate: options.frameRate,
    videoDuration: maxTime / 1000,
    layerNames: layerNames.length > 0 ? layerNames : ['レイヤー1'],
    eafTierIds: layerNames.length > 0 ? eafTierIds : [null],
    eafSource: {
      originalXml: xml,
      fileName: options.fileName,
      importedAnnotationIds,
      warnings
    },
    annotations
  }
}

const createElement = (document: XMLDocument, name: string): Element =>
  document.createElementNS(document.documentElement.namespaceURI, name)

const nextUniqueId = (prefix: string, usedIds: Set<string>): string => {
  let sequence = 1
  while (usedIds.has(`${prefix}${sequence}`)) sequence += 1
  const id = `${prefix}${sequence}`
  usedIds.add(id)
  return id
}

const appendTimeSlot = (
  document: XMLDocument,
  timeOrder: Element,
  usedTimeSlotIds: Set<string>,
  value: number
): string => {
  const id = nextUniqueId('ts', usedTimeSlotIds)
  const slot = createElement(document, 'TIME_SLOT')
  slot.setAttribute('TIME_SLOT_ID', id)
  slot.setAttribute('TIME_VALUE', String(value))
  timeOrder.appendChild(slot)
  return id
}

const annotationWrapper = (element: Element): Element => {
  const parent = element.parentElement
  return parent?.localName === 'ANNOTATION' ? parent : element
}

const setAnnotationValue = (
  document: XMLDocument,
  annotationElement: Element,
  value: string
) => {
  let valueElement = firstDirectChild(annotationElement, 'ANNOTATION_VALUE')
  if (!valueElement) {
    valueElement = createElement(document, 'ANNOTATION_VALUE')
    annotationElement.appendChild(valueElement)
  }
  valueElement.textContent = value
}

const assertUniqueLayerNames = (layerNames: string[]) => {
  const normalized = layerNames.map((name) => name.trim())
  if (normalized.some((name) => !name)) {
    throw new Error('EAF出力では空の注釈層名を使用できません。')
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('EAF出力では注釈層名を重複させることができません。')
  }
}

const updateLastUsedAnnotationId = (
  document: XMLDocument,
  usedAnnotationIds: Set<string>
) => {
  const numericIds = Array.from(usedAnnotationIds)
    .map((id) => /^a(\d+)$/.exec(id)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number)
  const lastUsed = numericIds.length > 0 ? Math.max(...numericIds) : 0
  let property = elementsByLocalName(document, 'PROPERTY').find(
    (element) => element.getAttribute('NAME') === 'lastUsedAnnotationId'
  )
  if (!property) {
    const header = elementsByLocalName(document, 'HEADER')[0]
    if (!header) return
    property = createElement(document, 'PROPERTY')
    property.setAttribute('NAME', 'lastUsedAnnotationId')
    header.appendChild(property)
  }
  property.textContent = String(lastUsed)
}

const setHeaderProperty = (
  document: XMLDocument,
  name: string,
  value: string
) => {
  const header = elementsByLocalName(document, 'HEADER')[0]
  if (!header) throw new Error('EAFにHEADERがありません。')
  let property = directChildrenByLocalName(header, 'PROPERTY').find(
    (element) => element.getAttribute('NAME') === name
  )
  if (!property) {
    property = createElement(document, 'PROPERTY')
    property.setAttribute('NAME', name)
    header.appendChild(property)
  }
  property.textContent = value
}

const updateMonblanProperties = (document: XMLDocument, frameRate: number) => {
  setHeaderProperty(document, MONBLAN_FRAME_RATE_PROPERTY, String(frameRate))
  setHeaderProperty(
    document,
    MONBLAN_FORMAT_VERSION_PROPERTY,
    MONBLAN_FORMAT_VERSION
  )
}

const serializeDocument = (document: XMLDocument): string => {
  const serialized = new XMLSerializer()
    .serializeToString(document)
    .replace(LEADING_XML_DECLARATIONS, '')
  return `${XML_DECLARATION}\n${serialized}`
}

const generateNewEaf = (options: GenerateEafOptions): string => {
  assertUniqueLayerNames(options.layerNames)
  const document = window.document.implementation.createDocument(
    '',
    'ANNOTATION_DOCUMENT',
    null
  )
  const root = document.documentElement
  root.setAttribute('AUTHOR', '')
  root.setAttribute('DATE', new Date().toISOString())
  root.setAttribute('FORMAT', '3.0')
  root.setAttribute('VERSION', '3.0')
  root.setAttributeNS(
    'http://www.w3.org/2000/xmlns/',
    'xmlns:xsi',
    'http://www.w3.org/2001/XMLSchema-instance'
  )
  root.setAttributeNS(
    'http://www.w3.org/2001/XMLSchema-instance',
    'xsi:noNamespaceSchemaLocation',
    'http://www.mpi.nl/tools/elan/EAFv3.0.xsd'
  )

  const header = createElement(document, 'HEADER')
  header.setAttribute('TIME_UNITS', 'milliseconds')
  options.videos.forEach((video) => {
    const descriptor = createElement(document, 'MEDIA_DESCRIPTOR')
    updateMediaDescriptor(descriptor, video)
    header.appendChild(descriptor)
  })
  const urn = createElement(document, 'PROPERTY')
  urn.setAttribute('NAME', 'URN')
  urn.textContent = `urn:nl-mpi-tools-elan-eaf:${uuidv4()}`
  header.appendChild(urn)
  root.appendChild(header)
  updateMonblanProperties(document, options.frameRate)

  const timeOrder = createElement(document, 'TIME_ORDER')
  root.appendChild(timeOrder)
  const usedTimeSlotIds = new Set<string>()
  const usedAnnotationIds = new Set<string>()
  const tiers = options.layerNames.map((name) => {
    const tier = createElement(document, 'TIER')
    tier.setAttribute('LINGUISTIC_TYPE_REF', 'default-lt')
    tier.setAttribute('TIER_ID', name)
    root.appendChild(tier)
    return tier
  })

  options.annotations.forEach((annotation) => {
    const startSlotId = appendTimeSlot(
      document,
      timeOrder,
      usedTimeSlotIds,
      frameToTime(annotation.startFrame, options.frameRate)
    )
    const endSlotId = appendTimeSlot(
      document,
      timeOrder,
      usedTimeSlotIds,
      frameToTime(annotation.endFrame, options.frameRate)
    )
    const wrapper = createElement(document, 'ANNOTATION')
    const alignable = createElement(document, 'ALIGNABLE_ANNOTATION')
    alignable.setAttribute(
      'ANNOTATION_ID',
      nextUniqueId('a', usedAnnotationIds)
    )
    alignable.setAttribute('TIME_SLOT_REF1', startSlotId)
    alignable.setAttribute('TIME_SLOT_REF2', endSlotId)
    setAnnotationValue(document, alignable, annotation.text)
    wrapper.appendChild(alignable)
    tiers[annotation.layerIndex]?.appendChild(wrapper)
  })

  const linguisticType = createElement(document, 'LINGUISTIC_TYPE')
  linguisticType.setAttribute('GRAPHIC_REFERENCES', 'false')
  linguisticType.setAttribute('LINGUISTIC_TYPE_ID', 'default-lt')
  linguisticType.setAttribute('TIME_ALIGNABLE', 'true')
  root.appendChild(linguisticType)
  updateLastUsedAnnotationId(document, usedAnnotationIds)
  return serializeDocument(document)
}

const updateSourceEaf = (options: GenerateEafOptions): string => {
  assertUniqueLayerNames(options.layerNames)
  const source = options.eafSource
  if (!source) return generateNewEaf(options)
  const document = parseXml(source.originalXml)
  const root = document.documentElement
  const timeOrder = elementsByLocalName(document, 'TIME_ORDER')[0]
  if (!timeOrder) throw new Error('EAFにTIME_ORDERがありません。')

  const originalTiers = new Map<string, Element>()
  elementsByLocalName(document, 'TIER').forEach((tier) => {
    const id = tier.getAttribute('TIER_ID')
    if (id) originalTiers.set(id, tier)
  })
  const mappedOriginalTierIds = new Set(
    options.eafTierIds.filter((id): id is string => Boolean(id))
  )
  const removedTierIds = Array.from(originalTiers.keys()).filter(
    (id) => !mappedOriginalTierIds.has(id)
  )

  removedTierIds.forEach((tierId) => {
    const hasChildTier = elementsByLocalName(document, 'TIER').some(
      (tier) => tier.getAttribute('PARENT_REF') === tierId
    )
    const annotationIds = new Set(
      elementsByLocalName(originalTiers.get(tierId)!, 'ALIGNABLE_ANNOTATION')
        .concat(
          elementsByLocalName(originalTiers.get(tierId)!, 'REF_ANNOTATION')
        )
        .map((element) => element.getAttribute('ANNOTATION_ID'))
        .filter((id): id is string => Boolean(id))
    )
    const hasReference = elementsByLocalName(document, 'REF_ANNOTATION').some(
      (element) =>
        annotationIds.has(element.getAttribute('ANNOTATION_REF') ?? '') ||
        annotationIds.has(element.getAttribute('PREVIOUS_ANNOTATION') ?? '')
    )
    if (hasChildTier || hasReference) {
      throw new Error(
        `注釈層「${tierId}」は他の注釈から参照されているため削除できません。`
      )
    }
    originalTiers.get(tierId)?.remove()
  })

  let alignableType = elementsByLocalName(document, 'LINGUISTIC_TYPE').find(
    (element) =>
      element.getAttribute('TIME_ALIGNABLE') !== 'false' &&
      !element.hasAttribute('CONSTRAINTS') &&
      Boolean(element.getAttribute('LINGUISTIC_TYPE_ID'))
  )
  if (!alignableType) {
    alignableType = createElement(document, 'LINGUISTIC_TYPE')
    alignableType.setAttribute('GRAPHIC_REFERENCES', 'false')
    alignableType.setAttribute('LINGUISTIC_TYPE_ID', 'monblan-default-lt')
    alignableType.setAttribute('TIME_ALIGNABLE', 'true')
    root.appendChild(alignableType)
  }
  const alignableTypeId =
    alignableType.getAttribute('LINGUISTIC_TYPE_ID') ?? 'monblan-default-lt'

  const tierByLayerIndex: Element[] = options.layerNames.map(
    (layerName, layerIndex) => {
      const originalId = options.eafTierIds[layerIndex]
      if (originalId) {
        const tier = originalTiers.get(originalId)
        if (!tier)
          throw new Error(`元の注釈層「${originalId}」が見つかりません。`)
        tier.setAttribute('TIER_ID', layerName)
        return tier
      }
      const tier = createElement(document, 'TIER')
      tier.setAttribute('TIER_ID', layerName)
      tier.setAttribute('LINGUISTIC_TYPE_REF', alignableTypeId)
      const firstLinguisticType = elementsByLocalName(
        document,
        'LINGUISTIC_TYPE'
      )[0]
      if (firstLinguisticType?.parentElement === root) {
        root.insertBefore(tier, firstLinguisticType)
      } else {
        root.appendChild(tier)
      }
      return tier
    }
  )

  const tierSlots = directChildrenByLocalName(root, 'TIER').map((tier) => {
    const slot = document.createComment('MONBLAN_TIER_SLOT')
    root.replaceChild(slot, tier)
    return slot
  })
  if (tierSlots.length !== tierByLayerIndex.length) {
    throw new Error('注釈層の並び順を更新できませんでした。')
  }
  tierByLayerIndex.forEach((tier, index) => {
    root.replaceChild(tier, tierSlots[index])
  })

  const renamedTiers = new Map<string, string>()
  options.eafTierIds.forEach((originalId, index) => {
    if (originalId) renamedTiers.set(originalId, options.layerNames[index])
  })
  elementsByLocalName(document, 'TIER').forEach((tier) => {
    const parentRef = tier.getAttribute('PARENT_REF')
    if (parentRef && renamedTiers.has(parentRef)) {
      tier.setAttribute('PARENT_REF', renamedTiers.get(parentRef)!)
    }
  })

  const alignableById = new Map<string, Element>()
  elementsByLocalName(document, 'ALIGNABLE_ANNOTATION').forEach((element) => {
    const id = element.getAttribute('ANNOTATION_ID')
    if (id) alignableById.set(id, element)
  })
  const usedAnnotationIds = new Set(
    elementsByLocalName(document, 'ALIGNABLE_ANNOTATION')
      .concat(elementsByLocalName(document, 'REF_ANNOTATION'))
      .map((element) => element.getAttribute('ANNOTATION_ID'))
      .filter((id): id is string => Boolean(id))
  )
  const usedTimeSlotIds = new Set(
    elementsByLocalName(document, 'TIME_SLOT')
      .map((element) => element.getAttribute('TIME_SLOT_ID'))
      .filter((id): id is string => Boolean(id))
  )
  const currentImportedIds = new Set(
    options.annotations
      .map((annotation) => annotation.eafAnnotationId)
      .filter((id): id is string => Boolean(id))
  )

  source.importedAnnotationIds.forEach((annotationId) => {
    if (currentImportedIds.has(annotationId)) return
    const isReferenced = elementsByLocalName(document, 'REF_ANNOTATION').some(
      (element) =>
        element.getAttribute('ANNOTATION_REF') === annotationId ||
        element.getAttribute('PREVIOUS_ANNOTATION') === annotationId
    )
    if (isReferenced) {
      throw new Error(
        `注釈「${annotationId}」は参照注釈の親であるため削除できません。`
      )
    }
    const element = alignableById.get(annotationId)
    if (!element) {
      throw new Error(`元の注釈「${annotationId}」が見つかりません。`)
    }
    annotationWrapper(element).remove()
    usedAnnotationIds.delete(annotationId)
  })

  options.annotations.forEach((annotation) => {
    let element = annotation.eafAnnotationId
      ? alignableById.get(annotation.eafAnnotationId)
      : undefined
    if (annotation.eafAnnotationId && !element) {
      throw new Error(
        `元の注釈「${annotation.eafAnnotationId}」が見つかりません。`
      )
    }
    const isNewAnnotation = !element
    if (!element) {
      element = createElement(document, 'ALIGNABLE_ANNOTATION')
      element.setAttribute(
        'ANNOTATION_ID',
        nextUniqueId('a', usedAnnotationIds)
      )
      const wrapper = createElement(document, 'ANNOTATION')
      wrapper.appendChild(element)
    }

    if (
      isNewAnnotation ||
      annotation.startFrame !== annotation.eafOriginalStartFrame
    ) {
      element.setAttribute(
        'TIME_SLOT_REF1',
        appendTimeSlot(
          document,
          timeOrder,
          usedTimeSlotIds,
          frameToTime(annotation.startFrame, options.frameRate)
        )
      )
    }
    if (
      isNewAnnotation ||
      annotation.endFrame !== annotation.eafOriginalEndFrame
    ) {
      element.setAttribute(
        'TIME_SLOT_REF2',
        appendTimeSlot(
          document,
          timeOrder,
          usedTimeSlotIds,
          frameToTime(annotation.endFrame, options.frameRate)
        )
      )
    }
    setAnnotationValue(document, element, annotation.text)
    const targetTier = tierByLayerIndex[annotation.layerIndex]
    const wrapper = annotationWrapper(element)
    if (targetTier && wrapper.parentElement !== targetTier) {
      targetTier.appendChild(wrapper)
    }
  })

  root.setAttribute('DATE', new Date().toISOString())
  updateMediaDescriptors(document, options.videos)
  updateLastUsedAnnotationId(document, usedAnnotationIds)
  updateMonblanProperties(document, options.frameRate)
  return serializeDocument(document)
}

export const generateEafContent = (options: GenerateEafOptions): string => {
  if (!Number.isFinite(options.frameRate) || options.frameRate <= 0) {
    throw new Error('EAF出力には正しいフレームレートが必要です。')
  }
  return options.eafSource ? updateSourceEaf(options) : generateNewEaf(options)
}
