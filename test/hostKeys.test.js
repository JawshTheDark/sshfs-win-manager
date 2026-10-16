import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import HostKeyStore, { describeKey, fingerprint, hostPattern, parseKnownHosts } from '../src/main/sshfs/hostKeys.js'

// GitHub's published ED25519 host key; the fingerprint is what `ssh-keygen -lf` prints for it
const GITHUB_KEY = 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'
const GITHUB_FINGERPRINT = 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU'

function newStore () {
  const dir = mkdtempSync(join(tmpdir(), 'hostkeys test-'))

  return new HostKeyStore({ file: join(dir, 'known_hosts'), getSshBinary: () => 'ssh.exe' })
}

function rsaBlob (bits) {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: bits })
  const { n, e } = publicKey.export({ format: 'jwk' })

  const field = buffer => {
    // SSH mpints are signed: a leading zero keeps a high bit from reading as a sign
    const value = buffer[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buffer]) : buffer
    const length = Buffer.alloc(4)

    length.writeUInt32BE(value.length)

    return Buffer.concat([length, value])
  }

  return Buffer.concat([field(Buffer.from('ssh-rsa')), field(Buffer.from(e, 'base64url')), field(Buffer.from(n, 'base64url'))]).toString('base64')
}

test('fingerprint matches what ssh-keygen prints', () => {
  assert.equal(fingerprint(GITHUB_KEY), GITHUB_FINGERPRINT)
})

test('describeKey names the key and gives the RSA size', () => {
  assert.equal(describeKey('ssh-ed25519', GITHUB_KEY).name, 'ED25519')
  assert.equal(describeKey('ssh-rsa', rsaBlob(2048)).name, 'RSA 2048 bit')
  assert.equal(describeKey('ssh-rsa', rsaBlob(3072)).name, 'RSA 3072 bit')
})

test('hosts are written the way known_hosts expects', () => {
  assert.equal(hostPattern('Example.COM', 22), 'example.com')
  assert.equal(hostPattern('example.com', 2222), '[example.com]:2222')
  assert.equal(hostPattern('example.com', '2222'), '[example.com]:2222')
})

test('parseKnownHosts reads entries and skips what it can not use', () => {
  const entries = parseKnownHosts([
    '# a comment',
    '',
    `github.com,140.82.0.1 ssh-ed25519 ${GITHUB_KEY} some comment`,
    `|1|c2FsdA==|aGFzaA== ssh-ed25519 ${GITHUB_KEY}`,
    `@revoked old.example.com ssh-ed25519 ${GITHUB_KEY}`,
    'broken line'
  ].join('\r\n'))

  assert.equal(entries.length, 1)
  assert.deepEqual(entries[0].patterns, ['github.com', '140.82.0.1'])
  assert.equal(entries[0].fingerprint, GITHUB_FINGERPRINT)
})

test('trusting a host, finding it again and forgetting it', () => {
  const store = newStore()

  assert.deepEqual(store.lookup('example.com', 22), [])

  store.trust('Example.com', 22, { type: 'ssh-ed25519', key: GITHUB_KEY })

  assert.equal(store.lookup('example.com', 22)[0].fingerprint, GITHUB_FINGERPRINT)
  // Another port is another server
  assert.deepEqual(store.lookup('example.com', 2222), [])

  store.forget('example.com', 22)

  assert.deepEqual(store.lookup('example.com', 22), [])
})

test('trusting a new key replaces the old one and leaves other hosts alone', () => {
  const store = newStore()
  const other = describeKey('ssh-rsa', rsaBlob(2048))

  store.trust('a.example.com', 22, { type: 'ssh-ed25519', key: GITHUB_KEY })
  store.trust('b.example.com', 2222, other)
  store.trust('a.example.com', 22, other)

  assert.equal(store.lookup('a.example.com', 22).length, 1)
  assert.equal(store.lookup('a.example.com', 22)[0].type, 'ssh-rsa')
  assert.equal(store.lookup('b.example.com', 2222).length, 1)
  assert.equal(readFileSync(store.file, 'utf8').split('\n').filter(Boolean).length, 2)
})

test('a missing or empty known_hosts file simply has no keys', () => {
  const store = newStore()

  assert.deepEqual(store.read(), [])

  writeFileSync(store.file, '')

  assert.deepEqual(store.read(), [])
})
