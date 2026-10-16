import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { DEFAULT_SETTINGS, createInitialState, mutations, normalizeConnection } from '../src/shared/state.js'
import Store from '../src/main/store.js'

const conn = (uuid, over = {}) => normalizeConnection({ uuid, name: uuid, host: 'h', port: 22, user: 'u', ...over })

function open (file, log, cipher = null) {
  const store = new Store(file, log, cipher)

  store.load()

  return store
}

function tempFile () {
  return join(mkdtempSync(join(tmpdir(), 'state test-')), 'vuex.json')
}

test('connections saved by older versions get what they lack, with host key checking on', () => {
  const old = normalizeConnection({ uuid: 'a', advanced: { customCmdlOptionsEnabled: false, customCmdlOptions: [] } })

  assert.equal(old.advanced.verifyHostKey, true)
  assert.equal(old.advanced.connectOnStartup, false)
  assert.equal(old.status, 'disconnected')
  assert.equal(old.preferredMountPoint, null)

  assert.equal(normalizeConnection({ uuid: 'b' }).advanced.reconnect, false)
  assert.equal(normalizeConnection({ uuid: 'c', advanced: { verifyHostKey: false } }).advanced.verifyHostKey, false)
})

test('editing a connection leaves what is running alone', () => {
  const state = createInitialState()

  mutations.ADD_CONNECTION(state, conn('a'))
  mutations.SET_CONNECTION_RUNTIME(state, { uuid: 'a', status: 'connected', pid: 42 })
  mutations.UPDATE_CONNECTION(state, { ...conn('a'), name: 'renamed', status: 'disconnected', pid: null })

  assert.equal(state.Data.connections[0].name, 'renamed')
  assert.equal(state.Data.connections[0].status, 'connected')
  assert.equal(state.Data.connections[0].pid, 42)
})

test('reordering keeps every connection, even ones the list did not mention', () => {
  const state = createInitialState()

  ;['a', 'b', 'c'].forEach(uuid => mutations.ADD_CONNECTION(state, conn(uuid)))
  mutations.REORDER_CONNECTIONS(state, ['c', 'a'])

  assert.deepEqual(state.Data.connections.map(c => c.uuid), ['c', 'a', 'b'])
})

test('deleting and resetting', () => {
  const state = createInitialState()

  mutations.ADD_CONNECTION(state, conn('a'))
  mutations.ADD_CONNECTION(state, conn('b'))
  mutations.DELETE_CONNECTION(state, { uuid: 'a' })
  mutations.UPDATE_SETTINGS(state, { processTrackTimeout: 30 })

  assert.deepEqual(state.Data.connections.map(c => c.uuid), ['b'])
  assert.equal(state.Settings.settings.processTrackTimeout, 30)
  assert.equal(state.Settings.settings.sshfsBinary, DEFAULT_SETTINGS.sshfsBinary)

  mutations.RESET_SETTINGS(state)

  assert.equal(state.Settings.settings.processTrackTimeout, DEFAULT_SETTINGS.processTrackTimeout)
})

test('the file of the old versions is read, and nothing is running at startup', () => {
  const file = tempFile()

  writeFileSync(file, JSON.stringify({
    state: {
      Data: { connections: [{ uuid: 'a', name: 'old', status: 'connected', pid: 99, mountPoint: 'D:', advanced: {} }, { name: 'no uuid' }] },
      Settings: { settings: { sshfsBinary: 'D:\\sshfs.exe', startupWithOS: false } }
    }
  }))

  const store = open(file, () => {})

  assert.equal(store.state.Data.connections.length, 1)
  assert.equal(store.state.Data.connections[0].status, 'disconnected')
  assert.equal(store.state.Data.connections[0].pid, null)
  assert.equal(store.state.Data.connections[0].advanced.verifyHostKey, true)
  assert.equal(store.getSettings().sshfsBinary, 'D:\\sshfs.exe')
  assert.equal(store.getSettings().processTrackTimeout, DEFAULT_SETTINGS.processTrackTimeout)
})

test('saving writes the same file format, without what is only running right now', () => {
  const file = tempFile()
  const store = open(file, () => {})

  store.commit('ADD_CONNECTION', conn('a'))
  store.commit('SET_CONNECTION_RUNTIME', { uuid: 'a', status: 'connected', pid: 7 })
  store.persist()

  const saved = JSON.parse(readFileSync(file, 'utf8'))

  assert.equal(saved.state.Data.connections.length, 1)
  assert.ok(!('status' in saved.state.Data.connections[0]))
  assert.ok(!('pid' in saved.state.Data.connections[0]))
  assert.ok('settings' in saved.state.Settings)
})

test('windows are told about every mutation, in order', () => {
  const store = open(tempFile(), () => {})
  const seen = []

  store.on('mutation', message => seen.push(message))
  store.commit('ADD_CONNECTION', conn('a'))
  store.commit('DELETE_CONNECTION', { uuid: 'a' })

  assert.deepEqual(seen.map(m => [m.rev, m.type]), [[1, 'ADD_CONNECTION'], [2, 'DELETE_CONNECTION']])
  assert.throws(() => store.commit('NOT_A_MUTATION'), /Unknown mutation/)
})

test('an unreadable file is kept aside rather than lost', () => {
  const file = tempFile()

  writeFileSync(file, '{ this is not json')

  const messages = []
  const store = open(file, message => messages.push(message))

  assert.equal(store.state.Data.connections.length, 0)
  assert.match(messages[0], /keeping a copy/)
})
