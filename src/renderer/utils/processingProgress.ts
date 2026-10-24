import type { ProcessingTask } from '../types'

interface ProcessingProgressResponse {
  stage?: string
  description?: string
  step?: number
  totalSteps?: number
  currentItem?: number | null
  totalItems?: number | null
  cacheHit?: boolean | null
}

interface ProcessingProgressController {
  progressId: string
  stop: () => void
}

const createProgressId = () => {
  const values = new Uint32Array(4)
  window.crypto.getRandomValues(values)
  return Array.from(values, (value) =>
    value.toString(16).padStart(8, '0')
  ).join('')
}

export const startProcessingProgress = (
  initialTask: ProcessingTask,
  setProcessingTask: (task: ProcessingTask | null) => void
): ProcessingProgressController => {
  const progressId = createProgressId()
  let active = true
  let polling = false

  setProcessingTask(initialTask)

  const poll = async () => {
    if (!active || polling) return
    polling = true
    try {
      const response = await fetch(
        `http://127.0.0.1:8000/processing/${progressId}`
      )
      if (!response.ok || !active) return
      const progress = (await response.json()) as ProcessingProgressResponse
      if (!active) return
      setProcessingTask({
        ...initialTask,
        ...progress,
        description: progress.description ?? initialTask.description
      })
    } catch {
      // The main API request remains authoritative if progress polling fails.
    } finally {
      polling = false
    }
  }

  void poll()
  const timer = window.setInterval(() => void poll(), 1000)

  return {
    progressId,
    stop: () => {
      active = false
      window.clearInterval(timer)
    }
  }
}
