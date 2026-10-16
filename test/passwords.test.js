import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import Store from '../src/main/store.js'
import { normalizeConnection } from '../src/shared/state.js'

// Not real encryption, just something that keeps the text from showing in the file
const cipher = (over = {}) => ({
  isAvailable: () => true,
  encrypt: text => Buffer.from('enc:' + [...text].reverse().join('')).toString('base64'),
  decrypt: encrypted => {
    const plain = Buffer.from(encrypted, 'base64').toString()

    if (!plain.startsWith('enc:')) {
      throw new Error('not encrypted by this cipher')
    }

    return [...plain.slice(4)].reverse().join('')
  },
  ...over
})

const PASSWORD = 'hunter2-correct-horse'

function folder () {
  return mkdtempSync(join(tmpdir(), 'passwords test-'))
}

function open (file, cipherToUse, log = () => {}) {
  const store = new Store(file, log, cipherToUse)

  store.load()

  return store
}

function savedFile (file) {
  return readFileSync(file, 'utf8')
}

const savedConnections = file => JSON.parse(savedFile(file)).state.Data.connections

function legacyFile (file, password = PASSWORD) {
  writeFileSync(file, JSON.stringify({
    state: {
      Data: { connections: [{ uuid: 'a', name: 'old', host: 'h', port: 22, user: 'u', authType: 'password', password, advanced: {} }] },
      Settings: { settings: {} }
    }
  }))
}

test('passwords saved by older versions are encrypted when the file is first read', () => {
  const dir = folder()
  const file = join(dir, 'vuex.json')

  legacyFile(file)

  const store = open(file, cipher())

  // Still usable as ever...
  assert.equal(store.state.Data.connections[0].password, PASSWORD)
  // ...but no longer lying in the file
  assert.ok(!savedFile(file).includes(PASSWORD))
  assert.equal(savedConnections(file)[0].password, '')
  assert.ok(savedConnections(file)[0].passwordEncrypted)

  // And it comes back from the encrypted file
  assert.equal(open(file, cipher()).state.Data.connections[0].password, PASSWORD)
})

test('the stale copies the old versions left behind are removed along with it', () => {
  const dir = folder()
  const file = join(dir, 'vuex.json')

  legacyFile(file)
  writeFileSync(join(dir, 'vuex.json.1995884758'), JSON.stringify({ state: { Data: { connections: [{ password: PASSWORD }] } } }))
  writeFileSync(join(dir, 'vuex.json.2444321387'), '')
  writeFileSync(join(dir, 'vuex.json.corrupt-1'), 'something else')
  writeFileSync(join(dir, 'other.json.123'), 'not ours')

  open(file, cipher())

  assert.deepEqual(readdirSync(dir).sort(), ['other.json.123', 'vuex.json', 'vuex.json.corrupt-1'])
})

test('nothing is touched when there are no passwords to protect', () => {
  const dir = folder()
  const file = join(dir, 'vuex.json')

  legacyFile(file, '')
  writeFileSync(join(dir, 'vuex.json.123'), 'kept')

  open(file, cipher())

  assert.ok(existsSync(join(dir, 'vuex.json.123')))
})

test('saving never writes the password itself', () => {
  const file = join(folder(), 'vuex.json')
  const store = open(file, cipher())

  store.commit('ADD_CONNECTION', normalizeConnection({ uuid: 'b', name: 'new', password: PASSWORD }))
  store.persist()

  assert.ok(!savedFile(file).includes(PASSWORD))
  assert.equal(open(file, cipher()).state.Data.connections[0].password, PASSWORD)
})

test('connections without a password get no encrypted one', () => {
  const file = join(folder(), 'vuex.json')
  const store = open(file, cipher())

  store.commit('ADD_CONNECTION', normalizeConnection({ uuid: 'k', name: 'key', authType: 'key-default', password: '' }))
  store.persist()

  assert.ok(!('passwordEncrypted' in savedConnections(file)[0]))
})

test('changing the password replaces the saved one', () => {
  const file = join(folder(), 'vuex.json')
  const store = open(file, cipher())

  store.commit('ADD_CONNECTION', normalizeConnection({ uuid: 'b', name: 'n', password: PASSWORD }))
  store.commit('UPDATE_CONNECTION', normalizeConnection({ uuid: 'b', name: 'n', password: 'another one' }))
  store.persist()

  assert.equal(open(file, cipher()).state.Data.connections[0].password, 'another one')
})

test('without encryption available passwords are kept as they were rather than lost', () => {
  const dir = folder()
  const file = join(dir, 'vuex.json')

  legacyFile(file)
  writeFileSync(join(dir, 'vuex.json.123'), 'kept')

  const store = open(file, cipher({ isAvailable: () => false }))

  store.persist()

  assert.equal(savedConnections(file)[0].password, PASSWORD)
  assert.equal(open(file, cipher({ isAvailable: () => false })).state.Data.connections[0].password, PASSWORD)
  assert.ok(existsSync(join(dir, 'vuex.json.123')))
})

test('a password that does not decrypt back is saved as it is, not corrupted', () => {
  const file = join(folder(), 'vuex.json')
  const messages = []
  const store = open(file, cipher({ decrypt: () => 'something else' }), message => messages.push(message))

  store.commit('ADD_CONNECTION', normalizeConnection({ uuid: 'b', name: 'n', password: PASSWORD }))
  store.persist()

  assert.equal(savedConnections(file)[0].password, PASSWORD)
  assert.match(messages.join('\n'), /Could not encrypt a password/)
})

test('a password that can not be decrypted is left empty but kept in the file', () => {
  const file = join(folder(), 'vuex.json')
  const messages = []

  const writer = open(file, cipher())

  writer.commit('ADD_CONNECTION', normalizeConnection({ uuid: 'c', name: 'c', password: PASSWORD }))
  writer.persist()

  const blob = savedConnections(file).find(c => c.uuid === 'c').passwordEncrypted

  // Read by somebody who can't decrypt (another Windows account, say)
  const reader = open(file, cipher({ decrypt: () => { throw new Error('wrong account') } }), message => messages.push(message))

  assert.equal(reader.state.Data.connections.find(c => c.uuid === 'c').password, '')
  assert.match(messages.join('\n'), /Could not decrypt the saved password of 'c'/)

  // Saving again doesn't throw the encrypted password away
  reader.persist()

  assert.equal(savedConnections(file).find(c => c.uuid === 'c').passwordEncrypted, blob)
})

test('typing a new password over one that could not be decrypted wins', () => {
  const file = join(folder(), 'vuex.json')
  const writer = open(file, cipher())

  writer.commit('ADD_CONNECTION', normalizeConnection({ uuid: 'c', name: 'c', password: PASSWORD }))
  writer.persist()

  const reader = open(file, cipher({ decrypt: () => { throw new Error('wrong account') } }))

  reader.commit('UPDATE_CONNECTION', { ...reader.state.Data.connections[0], password: 'typed again' })
  reader.persist()

  // Back with a working cipher the new password is the one that comes out
  assert.equal(open(file, cipher()).state.Data.connections[0].password, 'typed again')
})

test('pending changes are written when asked to flush, and not otherwise', () => {
  const file = join(folder(), 'vuex.json')
  const store = open(file, cipher())

  store.flush()

  assert.ok(!existsSync(file))

  store.commit('ADD_CONNECTION', normalizeConnection({ uuid: 'b', name: 'n' }))
  store.flush()

  assert.equal(savedConnections(file).length, 1)
})
