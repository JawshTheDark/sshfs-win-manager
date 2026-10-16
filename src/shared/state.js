// State definition shared by the main process (which owns the state) and the
// renderer windows (which keep a read-only mirror of it, updated through mutations)

export const DEFAULT_SETTINGS = {
  sshfsBinary: 'C:\\Program Files\\SSHFS-Win\\bin\\sshfs.exe',
  startupWithOS: true,
  displayTrayMessageOnClose: true,
  processTrackTimeout: 15,
  showDebugPanel: false
}

// Only ever set by the main process, and never saved to disk
export const RUNTIME_FIELDS = ['status', 'pid']

export function createInitialState () {
  return {
    Data: {
      connections: []
    },
    Settings: {
      settings: { ...DEFAULT_SETTINGS }
    }
  }
}

function defined (value, fallback) {
  return value === undefined || value === null ? fallback : value
}

// Fills in whatever a connection saved by an older version doesn't have yet
export function normalizeConnection (conn) {
  const advanced = conn.advanced || {}

  return {
    ...conn,
    status: defined(conn.status, 'disconnected'),
    pid: defined(conn.pid, null),
    preferredMountPoint: defined(conn.preferredMountPoint, null),
    advanced: {
      ...advanced,
      customCmdlOptionsEnabled: defined(advanced.customCmdlOptionsEnabled, false),
      customCmdlOptions: defined(advanced.customCmdlOptions, []),
      connectOnStartup: defined(advanced.connectOnStartup, false),
      reconnect: defined(advanced.reconnect, false),
      verifyHostKey: defined(advanced.verifyHostKey, true)
    }
  }
}

export const mutations = {
  ADD_CONNECTION (state, conn) {
    state.Data.connections.push(normalizeConnection({ ...conn, status: 'disconnected', pid: null }))
  },

  UPDATE_CONNECTION (state, conn) {
    const index = state.Data.connections.findIndex(a => a.uuid === conn.uuid)

    if (index !== -1) {
      const current = state.Data.connections[index]

      // What's running right now is not up to the editor to change
      state.Data.connections.splice(index, 1, normalizeConnection({ ...conn, status: current.status, pid: current.pid }))
    }
  },

  DELETE_CONNECTION (state, { uuid }) {
    state.Data.connections = state.Data.connections.filter(a => a.uuid !== uuid)
  },

  REORDER_CONNECTIONS (state, uuids) {
    const byUuid = new Map(state.Data.connections.map(conn => [conn.uuid, conn]))
    const ordered = uuids.filter(uuid => byUuid.has(uuid)).map(uuid => byUuid.get(uuid))
    const rest = state.Data.connections.filter(conn => !uuids.includes(conn.uuid))

    state.Data.connections = [...ordered, ...rest]
  },

  CLEAR_CONNECTIONS (state) {
    state.Data.connections = []
  },

  MIGRATE_CONNECTIONS (state) {
    state.Data.connections = state.Data.connections.map(normalizeConnection)
  },

  SET_CONNECTION_RUNTIME (state, { uuid, ...fields }) {
    const conn = state.Data.connections.find(a => a.uuid === uuid)

    if (conn) {
      Object.assign(conn, fields)
    }
  },

  UPDATE_SETTINGS (state, settings) {
    state.Settings.settings = { ...DEFAULT_SETTINGS, ...settings }
  },

  RESET_SETTINGS (state) {
    state.Settings.settings = { ...DEFAULT_SETTINGS }
  }
}

// What a window is allowed to ask the main process to do
export const RENDERER_MUTATIONS = [
  'ADD_CONNECTION',
  'UPDATE_CONNECTION',
  'DELETE_CONNECTION',
  'REORDER_CONNECTIONS',
  'CLEAR_CONNECTIONS',
  'UPDATE_SETTINGS',
  'RESET_SETTINGS'
]
