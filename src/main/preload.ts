// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

export type Channels = 'ipc-example'
const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args)
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args)
      ipcRenderer.on(channel, subscription)

      return () => {
        ipcRenderer.removeListener(channel, subscription)
      }
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args))
    },
    invoke(channel: Channels, ...args: unknown[]) {
      return ipcRenderer.invoke(channel, ...args)
    }
  }
}

contextBridge.exposeInMainWorld('electron', electronHandler)

contextBridge.exposeInMainWorld('electronAPI', {
  addCount: (
    callback: (_event: Electron.IpcRendererEvent, value: number) => void
  ) => {
    ipcRenderer.on('add-count', callback)
  },
  fileOpen: (
    callback: (_event: Electron.IpcRendererEvent, filePath: string) => void
  ) => {
    ipcRenderer.on('file-open', callback)
  },
  openFile: (url: string) => ipcRenderer.send('open-file', url),
  sendFile: (callback: (url: string) => void) =>
    ipcRenderer.on('send-file', (_event, url) => callback(url))
})

export type ElectronHandler = typeof electronHandler
