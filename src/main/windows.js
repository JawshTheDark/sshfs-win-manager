import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { BrowserWindow } from 'electron'

import appIcon from '../../resources/app-icon.png?asset'

const BACKGROUND_COLOR = '#21252b'

// The windows the app has, what route they show and how big they are
const WINDOWS = {
  main: { route: '/', width: 900, height: 500, modal: false },
  'add-connection': { route: '/add-new-connection', width: 500, height: 770 },
  'edit-connection': { route: '/edit-connection', width: 500, height: 770 },
  settings: { route: '/settings', width: 500, height: 365 },
  about: { route: '/about', width: 550, height: 380 },
  'password-prompt': { route: '/password-prompt', width: 350, height: 190 },
  'host-key-prompt': { route: '/host-key-prompt', width: 520, height: 400 }
}

export default class Windows {
  constructor () {
    this.windows = new Map()
    this.prompts = new Map()
    this.quitting = false
  }

  get main () {
    const window = this.windows.get('main')

    return window && !window.isDestroyed() ? window : null
  }

  // Whether this is one of our windows, showing our own content
  isOwnContent (webContents) {
    const url = webContents.getURL()

    return url.startsWith('file://') || (process.env.ELECTRON_RENDERER_URL !== undefined && url.startsWith(process.env.ELECTRON_RENDERER_URL))
  }

  getFromWebContents (webContents) {
    return BrowserWindow.fromWebContents(webContents)
  }

  // key: an entry of WINDOWS, id: tells apart several windows of the same kind (they are
  // reused when asked for again)
  open (key, id = '', { showOnReady = true } = {}) {
    const definition = WINDOWS[key]
    const name = id ? `${key}/${id}` : key
    const existing = this.windows.get(name)

    if (existing && !existing.isDestroyed()) {
      existing.show()
      existing.focus()

      return existing
    }

    const parent = definition.modal === false ? null : this.main
    const attached = parent && parent.isVisible()

    const window = new BrowserWindow({
      title: 'SSHFS-Win Manager',
      icon: appIcon,
      width: definition.width,
      height: definition.height,
      useContentSize: true,
      frame: false,
      show: false,
      maximizable: false,
      minimizable: false,
      resizable: false,
      fullscreenable: false,
      backgroundColor: BACKGROUND_COLOR,
      // Dialogs belong to the main window when it's on screen, otherwise they have to
      // look after being noticed themselves
      ...(definition.modal === false ? {} : attached ? { parent, modal: true } : { alwaysOnTop: true }),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    })

    this.windows.set(name, window)

    window.on('closed', () => this.windows.delete(name))

    // The windows only ever show our own pages
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => {
      if (!this.isOwnContent(window.webContents)) {
        event.preventDefault()
      }
    })

    const hash = id ? `${definition.route}/${id}` : definition.route

    if (process.env.ELECTRON_RENDERER_URL) {
      window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
    } else {
      window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    }

    if (showOnReady) {
      window.once('ready-to-show', () => window.show())
    }

    return window
  }

  openMain ({ show }) {
    const window = this.open('main', '', { showOnReady: show })

    // Closing the main window only hides it, the app lives on in the tray
    window.on('close', event => {
      if (!this.quitting) {
        event.preventDefault()

        window.hide()

        this.onMainHidden()
      }
    })

    return window
  }

  broadcast (channel, payload) {
    for (const window of this.windows.values()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(channel, payload)
      }
    }
  }

  // Shows a dialog window and resolves with what the user answered, or null if the
  // window was closed without answering
  ask (key, id, payload) {
    return new Promise(resolve => {
      const requestId = `${id}-${randomUUID()}`

      const window = this.open(key, requestId)

      this.prompts.set(requestId, { payload, resolve })

      window.on('closed', () => {
        if (this.prompts.has(requestId)) {
          this.prompts.delete(requestId)

          resolve(null)
        }
      })
    })
  }

  getPrompt (requestId) {
    const prompt = this.prompts.get(requestId)

    return prompt ? prompt.payload : null
  }

  answerPrompt (requestId, answer) {
    const prompt = this.prompts.get(requestId)

    if (prompt) {
      this.prompts.delete(requestId)

      prompt.resolve(answer)
    }
  }

  // Resolves with the password, or null if cancelled
  askPassword (conn) {
    return this.ask('password-prompt', conn.uuid, { user: conn.user, host: conn.host })
  }

  // Resolves with true if the user trusts the key
  async askHostKey (payload) {
    return (await this.ask('host-key-prompt', payload.host, payload)) === true
  }
}
