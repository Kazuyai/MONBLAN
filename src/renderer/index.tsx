import { createRoot } from 'react-dom/client'
import App from './App'

const container = document.getElementById('root') as HTMLElement
const root = createRoot(container)
root.render(<App />)

// calling IPC exposed from preload script
try {
  if (window.electron?.ipcRenderer) {
    window.electron.ipcRenderer.once('ipc-example', (arg) => {
      console.log('IPC Response:', arg)
    })
    window.electron.ipcRenderer.sendMessage('ipc-example', ['ping'])
  } else {
    console.log('Electron IPC not available in this context')
  }
} catch (error) {
  console.error('Error accessing Electron IPC:', error)
}
