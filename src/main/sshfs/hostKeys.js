import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { sshPathOption } from './ProcessHandlerWin.js'

const SCAN_TIMEOUT = 20000

const KEY_TYPE_NAMES = {
  'ssh-ed25519': 'ED25519',
  'ssh-rsa': 'RSA',
  'ssh-dss': 'DSA',
  'ecdsa-sha2-nistp256': 'ECDSA (P-256)',
  'ecdsa-sha2-nistp384': 'ECDSA (P-384)',
  'ecdsa-sha2-nistp521': 'ECDSA (P-521)',
  'sk-ssh-ed25519@openssh.com': 'ED25519 (security key)',
  'sk-ecdsa-sha2-nistp256@openssh.com': 'ECDSA (security key)'
}

// How a host is written in a known_hosts file
export function hostPattern (host, port) {
  host = host.trim().toLowerCase()

  return Number(port) === 22 ? host : `[${host}]:${port}`
}

// The same "SHA256:..." that ssh and ssh-keygen display
export function fingerprint (base64Key) {
  const hash = createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest('base64')

  return 'SHA256:' + hash.replace(/=+$/, '')
}

// Reads the length-prefixed fields of an SSH public key blob
function readBlobFields (base64Key) {
  const blob = Buffer.from(base64Key, 'base64')
  const fields = []

  for (let offset = 0; offset + 4 <= blob.length;) {
    const length = blob.readUInt32BE(offset)

    offset += 4

    if (offset + length > blob.length) {
      break
    }

    fields.push(blob.subarray(offset, offset + length))

    offset += length
  }

  return fields
}

export function describeKey (type, base64Key) {
  let name = KEY_TYPE_NAMES[type] || type

  if (type === 'ssh-rsa') {
    // Fields: type, exponent, modulus
    const modulus = readBlobFields(base64Key)[2]

    if (modulus) {
      const significant = modulus[0] === 0 ? modulus.subarray(1) : modulus

      name += ` ${(significant.length - 1) * 8 + (32 - Math.clz32(significant[0]))} bit`
    }
  }

  return {
    type,
    key: base64Key,
    name,
    fingerprint: fingerprint(base64Key)
  }
}

// Lines look like: host[,host...] keytype base64key [comment]
export function parseKnownHosts (text) {
  const entries = []

  text.split(/\r?\n/).forEach(line => {
    line = line.trim()

    // Comments, blank lines, and the @cert-authority / @revoked markers and hashed host
    // names (which this app never writes) are of no use here
    if (!line || line.startsWith('#') || line.startsWith('@') || line.startsWith('|')) {
      return
    }

    const [patterns, type, key] = line.split(/\s+/)

    if (patterns && type && key && /^[A-Za-z0-9+/]+=*$/.test(key)) {
      entries.push({ patterns: patterns.split(','), ...describeKey(type, key) })
    }
  })

  return entries
}

export default class HostKeyStore {
  // file: the known_hosts file the app maintains (separate from the user's own one)
  // getSshBinary: () => path of the ssh.exe that SSHFS-Win ships with
  constructor ({ file, getSshBinary, log = console.log }) {
    this.file = file
    this.getSshBinary = getSshBinary
    this.log = log
  }

  read () {
    try {
      return parseKnownHosts(readFileSync(this.file, 'utf8'))
    } catch (error) {
      return []
    }
  }

  // The keys that are trusted for this host
  lookup (host, port) {
    const pattern = hostPattern(host, port)

    return this.read().filter(entry => entry.patterns.includes(pattern))
  }

  // Trusts this key for the host, replacing whatever was trusted for it before
  trust (host, port, { type, key }) {
    const pattern = hostPattern(host, port)

    const kept = existsSync(this.file)
      ? readFileSync(this.file, 'utf8').split(/\r?\n/).filter(line => {
        const [patterns] = line.trim().split(/\s+/)

        return line.trim() && patterns !== pattern
      })
      : []

    kept.push(`${pattern} ${type} ${key}`)

    mkdirSync(dirname(this.file), { recursive: true })

    writeFileSync(`${this.file}.tmp`, kept.join('\n') + '\n', 'utf8')
    renameSync(`${this.file}.tmp`, this.file)
  }

  forget (host, port) {
    const pattern = hostPattern(host, port)

    if (existsSync(this.file)) {
      const kept = readFileSync(this.file, 'utf8').split(/\r?\n/).filter(line => line.trim() && line.trim().split(/\s+/)[0] !== pattern)

      writeFileSync(this.file, kept.length ? kept.join('\n') + '\n' : '', 'utf8')
    }
  }

  // Connects just far enough to learn which key the server presents. Nothing is sent to
  // the server beyond the SSH handshake, and nothing is trusted yet.
  scan (host, port, user, algorithms = []) {
    const workDir = mkdtempSync(join(tmpdir(), 'sshfs-win-manager-'))
    const scratchFile = join(workDir, 'known_hosts')

    const cleanup = () => {
      try {
        rmSync(workDir, { recursive: true, force: true })
      } catch (e) {
        // Left in the temp folder, no harm done
      }
    }

    const args = [
      '-p', String(port),
      '-oBatchMode=yes',
      '-oConnectTimeout=10',
      '-oLogLevel=ERROR',
      '-oStrictHostKeyChecking=accept-new',
      sshPathOption('UserKnownHostsFile', scratchFile),
      '-oGlobalKnownHostsFile=/dev/null',
      '-oHashKnownHosts=no',
      '-oCheckHostIP=no',
      '-oUpdateHostKeys=no',
      '-oPreferredAuthentications=none',
      '-oNumberOfPasswordPrompts=0',
      '-l', user || 'root'
    ]

    if (algorithms.length > 0) {
      args.push(`-oHostKeyAlgorithms=${algorithms.join(',')}`)
    }

    args.push(host, 'exit')

    return new Promise((resolve, reject) => {
      const ssh = this.getSshBinary()

      let stderr = ''
      let finished = false

      const finish = (callback, value) => {
        if (!finished) {
          finished = true

          clearTimeout(timer)
          cleanup()

          callback(value)
        }
      }

      const timer = setTimeout(() => {
        child.kill()

        finish(reject, new Error('Timed out while fetching the host key'))
      }, SCAN_TIMEOUT)

      let child

      try {
        child = spawn(ssh, args, { env: { PATH: dirname(ssh) }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      } catch (error) {
        finish(reject, new Error(`Could not start ssh to fetch the host key: ${error.message}`))
        return
      }

      child.on('error', error => finish(reject, new Error(`Could not start ssh to fetch the host key: ${error.message}`)))

      child.stderr.on('data', data => {
        stderr += data.toString()
      })

      child.on('close', () => {
        // The key is stored before authentication begins, so the (failed) login that
        // follows doesn't matter
        let scanned = []

        try {
          scanned = parseKnownHosts(readFileSync(scratchFile, 'utf8'))
        } catch (e) {
          // Nothing was recorded
        }

        if (scanned.length > 0) {
          finish(resolve, scanned[0])
        } else {
          const reason = stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop()

          this.log('host key scan failed:', stderr.trim())

          finish(reject, new Error(reason ? reason.replace(/^ssh: /, '') : 'The server did not present a host key'))
        }
      })
    })
  }
}
