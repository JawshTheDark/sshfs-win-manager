import { join } from 'node:path'

import { BrowserWindow, Menu, Notification, Tray, app, clipboard, dialog, ipcMain, nativeImage, safeStorage, shell } from 'electron'

import appIcon from '../../resources/app-icon.png?asset'
import errorIcon from '../../resources/error-icon.png?asset'
import trayIcon from '../../resources/tray-icon.ico?asset'

import { RENDERER_MUTATIONS } from '../shared/state.js'

import Connections from './connections.js'
import Store from './store.js'
import Windows from './windows.js'
import HostKeyStore from './sshfs/hostKeys.js'
import ProcessHandlerWin from './sshfs/ProcessHandlerWin.js'
import ProcessManager from './sshfs/ProcessManager.js'

const LOGIN_ITEM_ARGS = ['--systray']

// For trying things out without touching the real configuration
if (process.env.SSHFS_WIN_MANAGER_DATA) {
  app.setPath('userData', process.env.SSHFS_WIN_MANAGER_DATA)
}

const isSecondInstance = !app.requestSingleInstanceLock()

// Windows ties the taskbar button and the notifications to the shortcut of the installer,
// which carries the app id of the build configuration
app.setAppUserModelId(app.isPackaged ? 'dev.babum.apps.sshfs-win-manager' : 'SSHFS-Win Manager')

if (isSecondInstance) {
  app.quit()
} else {
  start()
}

function start () {
  const windows = new Windows()

  let tray = null
  let runningInBackgroundNotificationShowed = false

  // What happens in the main process is shown in the debug panel of the main window
  const log = (...args) => {
    console.log(...args)

    if (windows.main) {
      windows.main.webContents.send('debug:log', args.join(' '))
    }
  }

  const notify = (text, icon = 'app') => {
    if (Notification.isSupported()) {
      new Notification({
        title: 'SSHFS-Win Manager',
        body: text,
        icon: nativeImage.createFromPath(icon === 'error' ? errorIcon : appIcon)
      }).show()
    }
  }

  // Saved passwords are encrypted with the Windows account of whoever is logged in
  const cipher = {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: text => safeStorage.encryptString(text).toString('base64'),
    decrypt: encrypted => safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }

  const store = new Store(join(app.getPath('userData'), 'vuex.json'), log, cipher)

  const processHandler = new ProcessHandlerWin({ getSettings: () => store.getSettings(), log })
  const processManager = new ProcessManager(processHandler)

  const hostKeys = new HostKeyStore({
    file: join(app.getPath('userData'), 'known_hosts'),
    // ssh.exe lives next to sshfs.exe
    getSshBinary: () => processHandler.getBinary().replace(/sshfs\.exe$/i, 'ssh.exe'),
    log
  })

  const connections = new Connections({ store, processManager, hostKeys, windows, notify, log })

  windows.onMainHidden = () => {
    if (!runningInBackgroundNotificationShowed && store.getSettings().displayTrayMessageOnClose) {
      notify('Program still running in the system tray')

      runningInBackgroundNotificationShowed = true
    }
  }

  const quit = async () => {
    windows.quitting = true

    await connections.disconnectAll()
    await processManager.terminateAll()

    app.quit()
  }

  store.on('mutation', message => windows.broadcast('store:mutation', message))

  // Windows only get to ask for what the app means to let them do
  const trusted = event => windows.isOwnContent(event.sender)

  ipcMain.handle('store:get', event => {
    if (trusted(event)) {
      return store.snapshot()
    }
  })

  ipcMain.handle('store:commit', (event, type, payload) => {
    if (!trusted(event) || !RENDERER_MUTATIONS.includes(type)) {
      throw new Error(`Not allowed: ${type}`)
    }

    const running = store.state.Data.connections.filter(conn => conn.status !== 'disconnected')

    if ((type === 'DELETE_CONNECTION' && running.some(conn => conn.uuid === payload.uuid)) || (type === 'CLEAR_CONNECTIONS' && running.length > 0)) {
      throw new Error('Disconnect before deleting a connection')
    }

    store.commit(type, payload)
  })

  ipcMain.handle('connection:connect', (event, uuid) => trusted(event) && connections.connect(uuid))
  ipcMain.handle('connection:disconnect', (event, uuid) => trusted(event) && connections.disconnect(uuid))

  ipcMain.handle('connection:open-folder', (event, uuid) => {
    const conn = trusted(event) && store.getConnection(uuid)

    if (conn && conn.status === 'connected') {
      const mountPoint = conn.mountPoint === 'auto' ? conn.preferredMountPoint : conn.mountPoint

      // "X:" alone would mean the current directory on that drive
      shell.openPath(/^[a-z]:$/i.test(mountPoint) ? mountPoint + '\\' : mountPoint)
    }
  })

  ipcMain.handle('window:open', (event, key, id) => {
    if (trusted(event) && ['add-connection', 'edit-connection', 'settings', 'about'].includes(key)) {
      windows.open(key, id)
    }
  })

  ipcMain.handle('window:close', event => {
    if (trusted(event)) {
      const window = windows.getFromWebContents(event.sender)

      if (window) {
        window.close()
      }
    }
  })

  ipcMain.handle('window:hide', event => {
    if (trusted(event)) {
      const window = windows.getFromWebContents(event.sender)

      if (window) {
        window.hide()

        if (window === windows.main) {
          windows.onMainHidden()
        }
      }
    }
  })

  ipcMain.handle('prompt:get', (event, id) => trusted(event) ? windows.getPrompt(id) : null)

  ipcMain.handle('prompt:answer', (event, id, answer) => {
    if (trusted(event)) {
      windows.answerPrompt(id, answer)
    }
  })

  ipcMain.handle('hostkeys:get', (event, host, port) => {
    return trusted(event)
      ? hostKeys.lookup(host, port).map(({ name, fingerprint }) => ({ name, fingerprint }))
      : []
  })

  ipcMain.handle('hostkeys:forget', (event, host, port) => {
    if (trusted(event)) {
      hostKeys.forget(host, port)
    }
  })

  ipcMain.handle('dialog:select-private-key', async (event) => {
    if (!trusted(event)) {
      return null
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Select private key',
      properties: ['openFile'],
      defaultPath: join(app.getPath('home'), '.ssh')
    })

    return canceled || filePaths.length === 0 ? null : filePaths[0]
  })

  ipcMain.handle('app:info', event => {
    if (trusted(event)) {
      return {
        version: app.getVersion(),
        isPackaged: app.isPackaged,
        home: app.getPath('home'),
        openAtLogin: app.getLoginItemSettings({ args: LOGIN_ITEM_ARGS }).openAtLogin
      }
    }
  })

  ipcMain.handle('app:open-external', (event, url) => {
    // Only ever web links, whatever a page asks for
    if (trusted(event) && /^https?:\/\//i.test(url)) {
      shell.openExternal(url)
    }
  })

  ipcMain.handle('app:copy-text', (event, text) => {
    if (trusted(event) && typeof text === 'string') {
      clipboard.writeText(text)

      notify('Debug output copied to clipboard')
    }
  })

  ipcMain.handle('app:set-open-at-login', (event, openAtLogin) => {
    if (!trusted(event)) {
      return
    }

    // A development run would otherwise register the bare Electron binary to start with Windows
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: !!openAtLogin, args: LOGIN_ITEM_ARGS })
    }
  })

  app.on('second-instance', () => {
    if (windows.main) {
      windows.main.show()
      windows.main.focus()
    }
  })

  app.whenReady().then(() => {
    // The encryption of the passwords only works once the app is ready
    store.load()

    windows.openMain({ show: !process.argv.includes('--systray') })

    tray = new Tray(nativeImage.createFromPath(trayIcon))

    tray.setToolTip('SSHFS-Win Manager')
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: 'Open',
        click: () => windows.main && windows.main.show()
      },
      {
        label: 'About',
        click: () => windows.open('about', '', { showOnReady: true })
      },
      {
        label: 'Quit',
        click: quit
      }
    ]))

    tray.on('click', () => windows.main && windows.main.show())

    connections.connectOnStartup()
  })

  // The tray keeps the app alive when every window is hidden
  app.on('window-all-closed', () => {})

  // Don't lose a change that is still waiting to be saved
  app.on('before-quit', () => store.flush())
}
