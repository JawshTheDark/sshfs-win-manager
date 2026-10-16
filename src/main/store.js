import { EventEmitter } from 'node:events'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { DEFAULT_SETTINGS, RUNTIME_FIELDS, createInitialState, mutations, normalizeConnection } from '../shared/state.js'

const PERSIST_DELAY = 250

// The one authoritative copy of the application state. Windows only get to read it
// and to ask for mutations, which are applied here and then broadcast to every window.
//
// The file format is the one the old (vuex-electron based) versions used, so the saved
// connections carry over.
export default class Store extends EventEmitter {
  constructor (file, log = console.log) {
    super()

    this.file = file
    this.log = log
    this.rev = 0
    this.persistTimer = null
    this.state = this.load()
  }

  load () {
    const state = createInitialState()

    if (!existsSync(this.file)) {
      return state
    }

    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')).state || {}

      const connections = saved.Data && Array.isArray(saved.Data.connections) ? saved.Data.connections : []

      state.Data.connections = connections
        .filter(conn => conn && typeof conn === 'object' && conn.uuid)
        // Nothing is running yet, whatever the file says
        .map(conn => normalizeConnection({ ...conn, status: 'disconnected', pid: null }))

      if (saved.Settings && saved.Settings.settings) {
        state.Settings.settings = { ...DEFAULT_SETTINGS, ...saved.Settings.settings }
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

  persist () {
    clearTimeout(this.persistTimer)

    this.persistTimer = null

    const connections = this.state.Data.connections.map(conn => {
      const copy = { ...conn }

      RUNTIME_FIELDS.forEach(field => delete copy[field])

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
