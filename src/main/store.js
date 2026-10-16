import { EventEmitter } from 'node:events'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { DEFAULT_SETTINGS, RUNTIME_FIELDS, createInitialState, mutations, normalizeConnection } from '../shared/state.js'

const PERSIST_DELAY = 250

// The one authoritative copy of the application state. Windows only get to read it
// and to ask for mutations, which are applied here and then broadcast to every window.
//
// The file format is the one the old (vuex-electron based) versions used, so the saved
// connections carry over. The one difference is that passwords are not written as they
// are: with a cipher at hand they are saved encrypted, in `passwordEncrypted`.
//
// cipher: { isAvailable (), encrypt (text) => string, decrypt (string) => text }
export default class Store extends EventEmitter {
  constructor (file, log = console.log, cipher = null) {
    super()

    this.file = file
    this.log = log
    this.cipher = cipher
    this.rev = 0
    this.persistTimer = null
    this.state = createInitialState()
  }

  canEncrypt () {
    return !!this.cipher && this.cipher.isAvailable()
  }

  // Reads the saved state. Call it once the cipher can be used.
  load () {
    this.state = this.read()
  }

  read () {
    const state = createInitialState()

    if (!existsSync(this.file)) {
      return state
    }

    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')).state || {}

      const connections = saved.Data && Array.isArray(saved.Data.connections) ? saved.Data.connections : []

      // Whether the file still holds passwords in the clear
      let plaintext = false

      state.Data.connections = connections
        .filter(conn => conn && typeof conn === 'object' && conn.uuid)
        // Nothing is running yet, whatever the file says
        .map(conn => {
          const connection = normalizeConnection({ ...conn, status: 'disconnected', pid: null })

          if (connection.passwordEncrypted) {
            try {
              connection.password = this.cipher.decrypt(connection.passwordEncrypted)

              delete connection.passwordEncrypted
            } catch (error) {
              // Kept as it is, so that it isn't lost should this only be a passing problem
              connection.password = ''

              this.log(`Could not decrypt the saved password of '${connection.name}' (${error.message}), it has to be entered again`)
            }
          } else if (connection.password) {
            plaintext = true
          }

          return connection
        })

      if (saved.Settings && saved.Settings.settings) {
        state.Settings.settings = { ...DEFAULT_SETTINGS, ...saved.Settings.settings }
      }

      if (plaintext && this.canEncrypt()) {
        this.state = state

        this.encryptSavedPasswords()
      }
    } catch (error) {
      const backup = `${this.file}.corrupt-${Date.now()}`

      this.log(`Could not read ${this.file} (${error.message}), keeping a copy at ${backup}`)

      try {
        copyFileSync(this.file, backup)
      } catch (e) {
        // Nothing more can be done about it
      }
    }

    return state
  }

  // Passwords saved by earlier versions are in the clear: write them again, encrypted, and
  // get rid of the copies the old versions left lying around while saving
  encryptSavedPasswords () {
    this.persist()

    let removed = 0

    try {
      const prefix = `${basename(this.file)}.`

      readdirSync(dirname(this.file))
        .filter(name => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)))
        .forEach(name => {
          rmSync(join(dirname(this.file), name), { force: true })

          removed++
        })
    } catch (error) {
      this.log(`Could not remove the old copies of ${this.file} (${error.message})`)
    }

    this.log(`Encrypted the saved passwords${removed > 0 ? ` and removed ${removed} old copy(ies) of the file` : ''}`)
  }

  // The encrypted form of a password, or null if it can't be had (or doesn't decrypt back)
  encrypt (password) {
    try {
      const encrypted = this.cipher.encrypt(password)

      if (this.cipher.decrypt(encrypted) !== password) {
        throw new Error('did not decrypt back to the same text')
      }

      return encrypted
    } catch (error) {
      this.log(`Could not encrypt a password, saving it as it is (${error.message})`)

      return null
    }
  }

  snapshot () {
    return {
      rev: this.rev,
      state: JSON.parse(JSON.stringify(this.state))
    }
  }

  commit (type, payload) {
    if (typeof mutations[type] !== 'function') {
      throw new Error(`Unknown mutation "${type}"`)
    }

    mutations[type](this.state, payload)

    this.rev++

    if (type !== 'SET_CONNECTION_RUNTIME') {
      this.schedulePersist()
    } else if (payload.preferredMountPoint !== undefined) {
      this.schedulePersist()
    }

    this.emit('mutation', { rev: this.rev, type, payload })
  }

  getConnection (uuid) {
    return this.state.Data.connections.find(conn => conn.uuid === uuid)
  }

  getSettings () {
    return this.state.Settings.settings
  }

  schedulePersist () {
    if (!this.persistTimer) {
      this.persistTimer = setTimeout(() => this.persist(), PERSIST_DELAY)
    }
  }

  // Saves right now if a change is waiting to be saved
  flush () {
    if (this.persistTimer) {
      this.persist()
    }
  }

  persist () {
    clearTimeout(this.persistTimer)

    this.persistTimer = null

    const encrypting = this.canEncrypt()

    const connections = this.state.Data.connections.map(conn => {
      const copy = { ...conn }

      RUNTIME_FIELDS.forEach(field => delete copy[field])

      if (encrypting && copy.password) {
        const encrypted = this.encrypt(copy.password)

        if (encrypted) {
          copy.passwordEncrypted = encrypted
          copy.password = ''
        } else {
          // Saved as it is, and the older encrypted one must not win over it when read
          delete copy.passwordEncrypted
        }
      }

      return copy
    })

    const data = JSON.stringify({
      state: {
        Data: { connections },
        Settings: this.state.Settings
      }
    }, null, 2)

    const temporaryFile = `${this.file}.tmp`

    try {
      mkdirSync(dirname(this.file), { recursive: true })

      writeFileSync(temporaryFile, data, 'utf8')
      renameSync(temporaryFile, this.file)
    } catch (error) {
      this.log(`Could not save ${this.file}: ${error.message}`)
    }
  }
}
