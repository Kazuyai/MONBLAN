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