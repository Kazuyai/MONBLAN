import { createRoot } from 'react-dom/client'
import App from './App'
import { SnackbarProvider } from './components/SnackbarProvider'

const container = document.getElementById('root') as HTMLElement
const root = createRoot(container)
root.render(
  <SnackbarProvider>
    <App />
  </SnackbarProvider>
)
