import { HOST_KEY_REJECTED } from './sshfs/ProcessHandlerWin.js'

// Options that, if the user set them by hand, mean they want to deal with host keys
// themselves
const OWN_HOST_KEY_OPTIONS = ['stricthostkeychecking', 'userknownhostsfile']

// Everything about starting and stopping connections: asking the user what is needed
// (password, whether to trust a host key), running sshfs, and keeping the connection's
// status up to date for the windows to show.
export default class Connections {
  constructor ({ store, processManager, hostKeys, windows, notify, log }) {
    this.store = store
    this.processManager = processManager
    this.hostKeys = hostKeys
    this.windows = windows
    this.notify = notify
    this.log = log

    // Connections that are in the middle of connecting
    this.busy = new Set()

    processManager.on('not-found', pid => {
      const conn = this.getByPid(pid)

      if (conn) {
        this.setRuntime(conn.uuid, { status: 'disconnected', pid: null })

        this.notify(`'${conn.name}' was disconnected due to a connection error.\nCheck your internet connection`, 'error')
      }
    })

    processManager.on('tracked-alternative', conn => {
      this.notify(`'${conn.name}' tracked using alternative method`)
    })
  }

  getByPid (pid) {
    return this.store.state.Data.connections.find(conn => conn.pid === pid)
  }

  setRuntime (uuid, fields) {
    this.store.commit('SET_CONNECTION_RUNTIME', { uuid, ...fields })
  }

  usesManagedHostKeys (conn) {
    if (conn.advanced.verifyHostKey === false) {
      return false
    }

    if (conn.advanced.customCmdlOptionsEnabled) {
      return !conn.advanced.customCmdlOptions.some(option => OWN_HOST_KEY_OPTIONS.includes(option.name.toLowerCase()))
    }

    return true
  }

  connectOnStartup () {
    this.store.state.Data.connections
      .filter(conn => conn.advanced.connectOnStartup)
      .forEach(conn => this.connect(conn.uuid))
  }

  async connect (uuid) {
    const saved = this.store.getConnection(uuid)

    if (!saved || saved.status !== 'disconnected' || this.busy.has(uuid)) {
      return
    }

    this.busy.add(uuid)

    this.setRuntime(uuid, { status: 'connecting' })

    try {
      // Work on a copy: the password the user types must never end up in the saved state
      const conn = JSON.parse(JSON.stringify(saved))

      if (conn.authType === 'password-ask') {
        const password = await this.windows.askPassword(conn)

        if (password === null) {
          this.setRuntime(uuid, { status: 'disconnected' })

          return
        }

        conn.password = password
      }

      const managedHostKeys = this.usesManagedHostKeys(conn)

      if (managedHostKeys && !(await this.trustNewHost(conn))) {
        this.setRuntime(uuid, { status: 'disconnected' })

        return
      }

      const options = { knownHostsFile: managedHostKeys ? this.hostKeys.file : null }

      let pid

      try {
        pid = await this.processManager.create(conn, options)
      } catch (error) {
        if (!managedHostKeys || error.code !== HOST_KEY_REJECTED) {
          throw error
        }

        // The server is not presenting the key that was trusted before
        if (!(await this.reviewHostKey(conn))) {
          this.setRuntime(uuid, { status: 'disconnected' })

          return
        }

        pid = await this.processManager.create(conn, options)
      }

      this.setRuntime(uuid, { status: 'connected', pid, preferredMountPoint: conn.preferredMountPoint })
    } catch (error) {
      this.log(`{${uuid}} connect failed:`, error.message)

      this.setRuntime(uuid, { status: 'disconnected', pid: null })

      this.notify(`Can't connect to '${saved.name}': ${error.message}`, 'error')
    } finally {
      this.busy.delete(uuid)
    }
  }

  // Asks the user whether to trust the key of a host that was never connected to before.
  // Resolves with false if they don't.
  async trustNewHost (conn) {
    if (this.hostKeys.lookup(conn.host, conn.port).length > 0) {
      return true
    }

    const scanned = await this.scan(conn)

    const trusted = await this.windows.askHostKey({
      status: 'unknown',
      name: conn.name,
      host: conn.host,
      port: conn.port,
      keyName: scanned.name,
      fingerprint: scanned.fingerprint
    })

    if (trusted) {
      this.hostKeys.trust(conn.host, conn.port, scanned)
    }

    return trusted
  }

  // The server's key is not the trusted one: this is either a legitimate change (the
  // server was reinstalled) or somebody in between. Lets the user decide, and resolves
  // with whether they accepted the new key.
  async reviewHostKey (conn) {
    const trusted = this.hostKeys.lookup(conn.host, conn.port)

    // Ask for the same kind of key first, so that the two can be compared
    const scanned = await this.scan(conn, trusted.map(entry => entry.type)).catch(() => this.scan(conn))

    if (trusted.some(entry => entry.fingerprint === scanned.fingerprint)) {
      throw new Error('The host key could not be verified, even though the server presents the trusted one. Try again')
    }

    const accepted = await this.windows.askHostKey({
      status: trusted.length > 0 ? 'changed' : 'unknown',
      name: conn.name,
      host: conn.host,
      port: conn.port,
      keyName: scanned.name,
      fingerprint: scanned.fingerprint,
      trustedKeyName: trusted.length > 0 ? trusted[0].name : null,
      trustedFingerprint: trusted.length > 0 ? trusted[0].fingerprint : null
    })

    if (accepted) {
      this.hostKeys.trust(conn.host, conn.port, scanned)
    }

    return accepted
  }

  async scan (conn, algorithms = []) {
    try {
      return await this.hostKeys.scan(conn.host, conn.port, conn.user, algorithms)
    } catch (error) {
      throw new Error(`Could not get the host key of ${conn.host}: ${error.message}`)
    }
  }

  async disconnect (uuid) {
    const conn = this.store.getConnection(uuid)

    if (!conn || conn.status !== 'connected') {
      return
    }

    this.setRuntime(uuid, { status: 'disconnecting' })

    await this.processManager.terminate(conn.pid)

    this.setRuntime(uuid, { status: 'disconnected', pid: null })
  }

  async disconnectAll () {
    await Promise.all(this.store.state.Data.connections.map(conn => this.disconnect(conn.uuid)))
  }
}
