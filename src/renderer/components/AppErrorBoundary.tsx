import { Component, type ErrorInfo, type ReactNode } from 'react'
import './AppErrorBoundary.scss'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
}

class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Renderer error:', error, errorInfo)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="app-error-boundary" role="alert">
        <div className="app-error-boundary-card">
          <div className="app-error-boundary-brand">MONBLAN</div>
          <h1>画面の表示中に問題が発生しました</h1>
          <p>
            作業中の内容が保存されていない可能性があります。再読み込みしても解決しない場合は、表示された内容を添えて報告してください。
          </p>
          <pre>{this.state.error.message}</pre>
          <button type="button" onClick={() => window.location.reload()}>
            アプリを再読み込み
          </button>
        </div>
      </main>
    )
  }
}

export default AppErrorBoundary
