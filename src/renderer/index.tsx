import { createRoot } from 'react-dom/client'
import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
import { SnackbarProvider } from './components/SnackbarProvider'

const container = document.getElementById('root') as HTMLElement
const root = createRoot(container)
root.render(
  <AppErrorBoundary>
    <SnackbarProvider>
      <App />
    </SnackbarProvider>
  </AppErrorBoundary>
)
