import { contextBridge, ipcRenderer } from 'electron'

// The only things the windows can do besides drawing: ask the main process for them
contextBridge.exposeInMainWorld('api', {
  store: {
    get: () => ipcRenderer.invoke('store:get'),
    commit: (type, payload) => ipcRenderer.invoke('store:commit', type, payload),
    onMutation: callback => ipcRenderer.on('store:mutation', (event, message) => callback(message))
  },

  connection: {
    connect: uuid => ipcRenderer.invoke('connection:connect', uuid),
    disconnect: uuid => ipcRenderer.invoke('connection:disconnect', uuid),
    openFolder: uuid => ipcRenderer.invoke('connection:open-folder', uuid)
  },

  window: {
    open: (key, id) => ipcRenderer.invoke('window:open', key, id),
    close: () => ipcRenderer.invoke('window:close'),
    hide: () => ipcRenderer.invoke('window:hide')
  },

  prompt: {
    get: id => ipcRenderer.invoke('prompt:get', id),
    answer: (id, answer) => ipcRenderer.invoke('prompt:answer', id, answer)
  },

  hostKeys: {
    get: (host, port) => ipcRenderer.invoke('hostkeys:get', host, port),
    forget: (host, port) => ipcRenderer.invoke('hostkeys:forget', host, port)
  },

  dialog: {
    selectPrivateKey: () => ipcRenderer.invoke('dialog:select-private-key')
  },

  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openExternal: url => ipcRenderer.invoke('app:open-external', url),
    copyText: text => ipcRenderer.invoke('app:copy-text', text),
    setOpenAtLogin: openAtLogin => ipcRenderer.invoke('app:set-open-at-login', openAtLogin)
  },

  onDebugLog: callback => ipcRenderer.on('debug:log', (event, line) => callback(line))
})
