import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'

export type SnackbarType = 'info' | 'success' | 'warning' | 'error'

interface SnackbarOptions {
  type?: SnackbarType
  duration?: number
}

interface SnackbarState {
  id: number
  message: string
  type: SnackbarType
  duration: number
}

interface SnackbarContextValue {
  showSnackbar: (message: string, options?: SnackbarOptions) => void
}

const SnackbarContext = createContext<SnackbarContextValue | null>(null)

export const SnackbarProvider: React.FC<React.PropsWithChildren> = ({
  children
}) => {
  const [snackbarQueue, setSnackbarQueue] = useState<SnackbarState[]>([])
  const nextSnackbarIdRef = useRef(1)
  const snackbar = snackbarQueue[0] ?? null

  useEffect(() => {
    if (!snackbar || snackbar.duration <= 0) return
    const timeout = window.setTimeout(() => {
      setSnackbarQueue((current) =>
        current.filter((item) => item.id !== snackbar.id)
      )
    }, snackbar.duration)
    return () => window.clearTimeout(timeout)
  }, [snackbar])

  const showSnackbar = useCallback(
    (message: string, options: SnackbarOptions = {}) => {
      const type = options.type ?? 'info'
      setSnackbarQueue((current) => {
        if (
          current.some((item) => item.message === message && item.type === type)
        ) {
          return current
        }
        const nextQueue = [
          ...current,
          {
            id: nextSnackbarIdRef.current++,
            message,
            type,
            duration: options.duration ?? 5000
          }
        ]
        return nextQueue.length <= 5
          ? nextQueue
          : [nextQueue[0], ...nextQueue.slice(-4)]
      })
    },
    []
  )
  const contextValue = useMemo(() => ({ showSnackbar }), [showSnackbar])

  return (
    <SnackbarContext.Provider value={contextValue}>
      {children}
      {snackbar &&
        createPortal(
          <div
            key={snackbar.id}
            className={`app-snackbar ${snackbar.type}`}
            role={snackbar.type === 'error' ? 'alert' : 'status'}
            aria-live={snackbar.type === 'error' ? 'assertive' : 'polite'}
          >
            <span>{snackbar.message}</span>
            {snackbarQueue.length > 1 && (
              <span className="app-snackbar-queue-count">
                残り{snackbarQueue.length - 1}件
              </span>
            )}
            <button
              type="button"
              aria-label="通知を閉じる"
              onClick={() =>
                setSnackbarQueue((current) =>
                  current.filter((item) => item.id !== snackbar.id)
                )
              }
            >
              &times;
            </button>
          </div>,
          document.body
        )}
    </SnackbarContext.Provider>
  )
}

export const useSnackbar = (): SnackbarContextValue => {
  const context = useContext(SnackbarContext)
  if (!context) {
    throw new Error('useSnackbar must be used within SnackbarProvider')
  }
  return context
}
