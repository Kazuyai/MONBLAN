// アノテーション関連の型定義

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface Label {
  id: string
  name: string
  color: string
}

export interface Annotation {
  id: string
  labelId: string
  boundingBox: BoundingBox
  confidence?: number
  metadata?: Record<string, unknown>
}

export interface AnnotationData {
  imageId: string
  imagePath: string
  imageSize: {
    width: number
    height: number
  }
  annotations: Annotation[]
  createdAt: string
  updatedAt: string
}

// FastAPI通信関連の型定義
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface HealthCheckResponse {
  status: string
  timestamp: string
}

// アプリケーション状態の型定義
export interface AppConfig {
  apiBaseUrl: string
  autoSave: boolean
  defaultLabels: Label[]
}

export interface TimelineAnnotationResult {
  startFrame: number
  endFrame: number
  text: string
  layerName: string
  layerIndex: number
}

export interface AnalysisFrameRange {
  startFrame: number
  endFrame: number
}

export interface ProcessingTask {
  title: string
  description: string
  stage?: string
  step?: number
  totalSteps?: number
  currentItem?: number | null
  totalItems?: number | null
  cacheHit?: boolean | null
}

export interface SelectedTimelineAnnotation extends TimelineAnnotationResult {
  id: string
}

export interface SimilarMotionCandidate extends TimelineAnnotationResult {
  id: string
  humanId: number
  similarity: number
  dtwSimilarity: number
  templateId: number
  windowScale: number
  windowLength: number
  status: 'pending' | 'accepted' | 'rejected'
}

export interface ProjectVideo {
  name: string
  path?: string
}

export interface ProjectAnnotation {
  id: string
  startFrame: number
  endFrame: number
  text: string
  layerIndex: number
}

export interface AnnotationProject {
  version: 1
  createdAt?: string
  updatedAt: string
  videos: ProjectVideo[]
  frameRate: number
  videoDuration: number
  layerNames: string[]
  annotations: ProjectAnnotation[]
}
