import assert from 'node:assert/strict'
import { test } from 'node:test'

import ProcessHandlerWin, { sshPathOption } from '../src/main/sshfs/ProcessHandlerWin.js'

const handler = new ProcessHandlerWin({ getSettings: () => ({ sshfsBinary: 'C:\\sshfs-win.exe', processTrackTimeout: 15 }) })

function connection (over = {}) {
  return {
    uuid: 'x',
    name: 'My server',
    host: 'example.com',
    port: 22,
    user: 'me',
    folder: '/home/me',
    authType: 'password',
    password: 'secret',
    keyFile: 'C:\\Users\\me\\.ssh\\id_ed25519',
    ...over,
    advanced: { customCmdlOptionsEnabled: false, customCmdlOptions: [], reconnect: false, ...over.advanced }
  }
}

const build = (conn, options) => handler.buildArgs(conn, 'E:', options)

test('the sshfs-win.exe wrapper is swapped for sshfs.exe', () => {
  assert.equal(handler.getBinary(), 'C:\\sshfs.exe')
})

test('password logins pass the password on stdin, never on the command line', () => {
  const args = build(connection())

  assert.ok(args.includes('-opassword_stdin'))
  assert.ok(args.includes('-oPreferredAuthentications=password'))
  assert.ok(!args.join(' ').includes('secret'))
  assert.ok(!args.includes('-oBatchMode=yes'))
})

test('key logins never wait for a passphrase or a password', () => {
  for (const authType of ['key-file', 'key-default']) {
    const args = build(connection({ authType }))

    assert.ok(args.includes('-oBatchMode=yes'), authType)
    assert.ok(args.includes('-oPreferredAuthentications=publickey'), authType)
    assert.ok(!args.includes('-opassword_stdin'), authType)
  }
})

test('a key file is the only key offered, quoted as ssh needs for paths with spaces', () => {
  const args = build(connection({ authType: 'key-file', keyFile: 'C:\\Users\\Jo Smith\\.ssh\\id_ed25519' }))

  assert.ok(args.includes('-oIdentitiesOnly=yes'))
  assert.ok(args.includes('-oIdentityFile="C:/Users/Jo Smith/.ssh/id_ed25519"'))
})

test('default keys leave the choice of key to ssh', () => {
  const args = build(connection({ authType: 'key-default' }))

  assert.ok(!args.some(arg => arg.startsWith('-oIdentityFile')))
  assert.ok(!args.includes('-oIdentitiesOnly=yes'))
})

test('with a known_hosts file the host key is checked strictly against it', () => {
  const args = build(connection(), { knownHostsFile: 'C:\\Users\\Jo Smith\\AppData\\known_hosts' })

  assert.ok(args.includes('-oStrictHostKeyChecking=yes'))
  assert.ok(args.includes('-oUserKnownHostsFile="C:/Users/Jo Smith/AppData/known_hosts"'))
  assert.ok(!args.includes('-oStrictHostKeyChecking=no'))
  assert.ok(!args.includes('-oUserKnownHostsFile=/dev/null'))
})

test('without one nothing is verified, as before', () => {
  const args = build(connection())

  assert.ok(args.includes('-oStrictHostKeyChecking=no'))
  assert.ok(args.includes('-oUserKnownHostsFile=/dev/null'))
})

test('connections time out and dead links are noticed', () => {
  const args = build(connection())

  assert.ok(args.some(arg => /^-oConnectTimeout=\d+$/.test(arg)))
  assert.ok(args.includes('-oServerAliveInterval=15'))
  assert.ok(args.includes('-oServerAliveCountMax=3'))
})

test('options the user sets replace the built-in ones, whatever their case', () => {
  const args = build(connection({
    advanced: {
      customCmdlOptionsEnabled: true,
      customCmdlOptions: [{ name: 'serveraliveinterval', value: '60' }, { name: 'reconnect', value: '' }]
    }
  }))

  assert.ok(!args.includes('-oServerAliveInterval=15'))
  assert.ok(args.includes('-oserveraliveinterval=60'))
  assert.ok(args.includes('-oreconnect'))
  // The defaults are off in this mode
  assert.ok(!args.includes('-oidmap=user'))
})

test('a comma in the connection name does not split the volume name option', () => {
  const args = build(connection({ name: 'Home, NAS' }))

  assert.ok(args.includes('-ovolname=Home  NAS'))
})

test('paths are written for the Cygwin ssh', () => {
  assert.equal(sshPathOption('UserKnownHostsFile', 'C:\\a b\\c'), '-oUserKnownHostsFile="C:/a b/c"')
})
