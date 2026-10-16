import { execFile, spawn } from 'node:child_process'
import { existsSync as fileExistsSync, stat } from 'node:fs'
import { dirname, join } from 'node:path'

const DRIVE_LETTERS = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('')

const DEFAULT_START_TIMEOUT = 15
const MIN_START_TIMEOUT = 5
const COMMAND_TIMEOUT = 10000
const PROBE_TIMEOUT = 3000
const DEBUG_OUTPUT_LIMIT = 4096
const EXIT_GRACE_PERIOD = 300

export const HOST_KEY_REJECTED = 'HOST_KEY_REJECTED'

// Drive letters handed out to connections that are still starting up or running.
// Without this, connections started at the same time (eg. "Connect on startup")
// are all given the same "first available" letter.
const reservedDriveLetters = new Set()

function run (file, args, timeout = COMMAND_TIMEOUT) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true }, (err, stdout) => {
      if (err) {
        reject(err)
      } else {
        resolve(stdout.toString())
      }
    })
  })
}

function lastLine (text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop() || ''
}

// Resolves with null if the path answers, otherwise with the error (code 'TIMEOUT' if it
// did not answer in time). Never waits longer than PROBE_TIMEOUT, as a stalled network
// share would otherwise block the caller indefinitely.
function probePath (path) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ code: 'TIMEOUT' }), PROBE_TIMEOUT)

    stat(path, err => {
      clearTimeout(timer)
      resolve(err || null)
    })
  })
}

// ssh.exe is a Cygwin program, which understands Windows paths written with forward
// slashes. Quoted, as ssh splits option values at whitespace.
export function sshPathOption (name, windowsPath) {
  return `-o${name}="${windowsPath.replace(/\\/g, '/')}"`
}

export default class ProcessHandlerWin {
  // getSettings: () => the current application settings
  constructor ({ getSettings, log = console.log }) {
    this.getSettings = getSettings
    this.log = log
  }

  getBinary () {
    // The wrapper script SSHFS-Win ships with isn't what we want to run
    return this.getSettings().sshfsBinary.replace(/sshfs-win\.exe$/, 'sshfs.exe')
  }

  getStartTimeout () {
    const seconds = Number(this.getSettings().processTrackTimeout)

    return Number.isFinite(seconds) && seconds > 0
      ? Math.max(MIN_START_TIMEOUT, seconds)
      : DEFAULT_START_TIMEOUT
  }

  // options.knownHostsFile: file holding the trusted host keys. Without it host keys are
  // not verified at all (the user turned verification off for that connection).
  async create (conn, options = {}) {
    const binary = this.getBinary()

    if (!fileExistsSync(binary)) {
      throw new Error(`SSHFS binary not found at "${binary}". Check your settings`)
    }

    let mountPoint = conn.mountPoint
    let reservedLetter = null

    if (mountPoint === 'auto') {
      mountPoint = await this.allocateDriveLetter(conn.preferredMountPoint)
      reservedLetter = mountPoint.substr(0, 1)

      conn.preferredMountPoint = mountPoint
    }

    const release = () => {
      if (reservedLetter) {
        reservedDriveLetters.delete(reservedLetter)
      }
    }

    try {
      return await this.start(conn, binary, mountPoint, this.buildArgs(conn, mountPoint, options), release)
    } catch (error) {
      release()

      throw error
    }
  }

  buildArgs (conn, mountPoint, { knownHostsFile = null } = {}) {
    const connectTimeout = Math.max(5, Math.floor(this.getStartTimeout() * 2 / 3))

    const hostKeyArgs = knownHostsFile
      ? [
          '-oStrictHostKeyChecking=yes',
          sshPathOption('UserKnownHostsFile', knownHostsFile),
          '-oGlobalKnownHostsFile=/dev/null',
          '-oCheckHostIP=no',
          '-oHashKnownHosts=no',
          '-oUpdateHostKeys=no'
        ]
      : [
          '-oStrictHostKeyChecking=no',
          '-oUserKnownHostsFile=/dev/null'
        ]

    let cmdArgs = [
      `${conn.user}@${conn.host}:${conn.folder}`,
      mountPoint,
      `-p${conn.port}`,
      `-ovolname=${conn.name.replace(/,/g, ' ').substr(0, 32)}`,
      '-odebug',
      '-ologlevel=debug1',
      ...hostKeyArgs,
      // Fail instead of hanging when the host is unreachable or stops answering
      `-oConnectTimeout=${connectTimeout}`,
      '-oServerAliveInterval=15',
      '-oServerAliveCountMax=3'
    ]

    if (conn.advanced.customCmdlOptionsEnabled) {
      const optionalArgs = []

      conn.advanced.customCmdlOptions.forEach(arg => {
        const name = arg.name.toLowerCase()

        // Options set by the user replace the built-in ones
        cmdArgs = cmdArgs.filter(a => !(a.startsWith('-o') && a.substr(2, name.length).toLowerCase() === name))

        if (arg.value !== '') {
          optionalArgs.push(`-o${arg.name}=${arg.value}`)
        } else {
          optionalArgs.push(`-o${arg.name}`)
        }
      })

      cmdArgs = [
        ...cmdArgs,
        ...optionalArgs
      ]
    } else {
      cmdArgs = [
        ...cmdArgs,
        ...[
          '-oidmap=user',
          '-ouid=-1',
          '-ogid=-1',
          '-oumask=000',
          '-ocreate_umask=000',
          '-omax_readahead=1GB',
          '-oallow_other',
          '-olarge_read',
          '-okernel_cache',
          '-ofollow_symlinks'
        ]
      ]
    }

    if (conn.advanced.reconnect && !conn.advanced.customCmdlOptionsEnabled) {
      cmdArgs.push('-oreconnect')
    }

    if (conn.authType === 'password' || conn.authType === 'password-ask') {
      cmdArgs.push('-oPreferredAuthentications=password')
      cmdArgs.push('-opassword_stdin')
    }

    if (conn.authType === 'key-file') {
      cmdArgs.push('-oPreferredAuthentications=publickey')
      cmdArgs.push('-oIdentitiesOnly=yes')
      cmdArgs.push(sshPathOption('IdentityFile', conn.keyFile))
    }

    if (conn.authType === 'key-default') {
      cmdArgs.push('-oPreferredAuthentications=publickey')
    }

    if (conn.authType === 'key-file' || conn.authType === 'key-default') {
      // Nobody is there to type a passphrase or a password, so never ask for one
      cmdArgs.push('-oBatchMode=yes')
    }

    return cmdArgs
  }

  // Resolves with the sshfs process once the mount is up. Always settles: it either
  // resolves, rejects with the reason sshfs gave, or gives up after the start timeout.
  start (conn, binary, mountPoint, cmdArgs, release) {
    return new Promise((resolve, reject) => {
      const log = this.log
      const startTimeout = this.getStartTimeout()

      let settled = false
      let timer = null
      let exitTimer = null
      let exitCode = null
      let debugOutput = ''
      let lastDebugMessage = ''

      const finish = (callback, value) => {
        if (!settled) {
          settled = true

          clearTimeout(timer)

          callback(value)
        }
      }

      log('-'.repeat(80))
      log('date:', new Date().toISOString())
      log('conn:', `{${conn.uuid}}`, `(${conn.name})`)
      log('conntype:', conn.authType)
      log('cmd:', `"${binary}" ${cmdArgs.join(' ')}`)

      const env = {
        PATH: dirname(binary)
      }

      if (process.env.SSH_AUTH_SOCK) {
        env.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK
      }

      let child

      try {
        child = spawn(binary, cmdArgs, { env, windowsHide: true })
      } catch (error) {
        reject(new Error(`Could not start SSHFS: ${error.message}`))
        return
      }

      child.on('error', error => {
        log(`{${conn.uuid}} error:`, error.message)

        finish(reject, new Error(`Could not start SSHFS: ${error.message}`))
      })

      // Writing to sshfs after it quit would otherwise raise an unhandled EPIPE
      child.stdin.on('error', () => {})

      if (conn.authType === 'password' || conn.authType === 'password-ask') {
        child.stdin.write((conn.password || '') + '\n')
      }

      child.stdout.on('data', data => {
        log(`{${conn.uuid}} stdout:`, data.toString())
      })

      child.stderr.on('data', data => {
        data = data.toString().trim()

        log(`{${conn.uuid}} stderr:`, data)

        if (settled) {
          return
        }

        debugOutput = (debugOutput + '\n' + data).substr(-DEBUG_OUTPUT_LIMIT)
        lastDebugMessage = lastLine(data) || lastDebugMessage

        if (/service sshfs has been started/i.test(debugOutput)) {
          finish(resolve, child)
        }
      })

      let gone = false

      const onGone = () => {
        clearTimeout(exitTimer)

        if (!gone) {
          gone = true

          log(`{${conn.uuid}}`, 'exit:', exitCode)

          release()

          finish(reject, this.describeFailure(conn, debugOutput, lastDebugMessage, exitCode))
        }
      }

      // 'close' only fires once every stdio pipe is closed, which does not happen while
      // a leftover ssh.exe still holds them. 'exit' fires reliably, but possibly before
      // the last output was read, so give the pipes a moment to drain.
      child.on('exit', code => {
        exitCode = code

        release()

        exitTimer = setTimeout(onGone, EXIT_GRACE_PERIOD)
      })

      child.on('close', code => {
        exitCode = code

        onGone()
      })

      timer = setTimeout(() => {
        // The "started" message is not always seen (eg. different sshfs-win versions),
        // so before giving up check whether the drive actually showed up
        this.isMounted(mountPoint).then(mounted => {
          if (settled) {
            return
          }

          if (mounted) {
            child.trackedWithoutStartMessage = true

            finish(resolve, child)
          } else {
            const reason = lastDebugMessage ? ` Last message: ${lastDebugMessage}` : ''

            finish(reject, new Error(`Timed out after ${startTimeout}s waiting for the connection.${reason}`))

            this.terminate(child.pid)
          }
        })
      }, startTimeout * 1000)
    })
  }

  describeFailure (conn, debugOutput, lastDebugMessage, exitCode) {
    if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|no matching host key type/i.test(debugOutput)) {
      const error = new Error('The server\'s host key does not match the one that was trusted')

      error.code = HOST_KEY_REJECTED

      return error
    }

    if (debugOutput.includes('no such identity')) {
      return new Error('Private key not found: ' + conn.keyFile)
    }

    if (debugOutput.includes('mount point in use')) {
      return new Error('Mount point in use')
    }

    if (debugOutput.includes('Permission denied')) {
      if (conn.authType === 'key-file') {
        return new Error('The server rejected the private key. Check the user name, and that its public key is authorized on the server. Keys protected by a passphrase are not supported')
      }

      if (conn.authType === 'key-default') {
        return new Error('The server rejected the default keys in your .ssh folder. Check the user name, and that a public key is authorized on the server. Keys protected by a passphrase are not supported')
      }

      return new Error('Invalid user name or password')
    }

    // sshfs itself only ever ends with "read: Connection reset by peer", the actual
    // reason (refused, timed out, unknown host...) is ssh's own message before that
    const reason = debugOutput.split(/\r?\n/).map(line => line.trim()).filter(line => {
      return !/^(debug\d|read: Connection reset by peer)/.test(line) &&
        /^ssh: |timed out|refused|unreachable|resolve|banner|closed by|reset by/i.test(line)
    }).pop()

    if (reason) {
      return new Error(reason.replace(/^ssh: /, ''))
    }

    return new Error(lastDebugMessage || `SSHFS exited unexpectedly (exit code ${exitCode})`)
  }

  isMounted (mountPoint) {
    // "X:" alone means "the current directory on X", so it needs the trailing slash
    return probePath(/^[a-z]:$/i.test(mountPoint) ? mountPoint + '\\' : mountPoint).then(error => error === null)
  }

  terminate (pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
      return Promise.resolve()
    }

    return run(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F']).catch(() => {
      try {
        process.kill(pid)
      } catch (e) {
        // Already gone
      }
    })
  }

  exists (pid) {
    try {
      // Signal 0 only checks that the process can be signalled, it does not kill it
      process.kill(pid, 0)

      return true
    } catch (error) {
      return error.code === 'EPERM'
    }
  }

  async allocateDriveLetter (preferredMountPoint = null) {
    const usedDriveLetters = await this.getUsedDriveLetters()
    const availableDriveLetters = DRIVE_LETTERS.filter(i => !usedDriveLetters.has(i) && !reservedDriveLetters.has(i))

    if (availableDriveLetters.length === 0) {
      throw new Error('No free drive letters available')
    }

    const preferredLetter = preferredMountPoint ? preferredMountPoint.substr(0, 1).toUpperCase() : null
    const letter = availableDriveLetters.includes(preferredLetter) ? preferredLetter : availableDriveLetters[0]

    // Synchronous with the check above, so concurrent connections cannot pick the same letter
    reservedDriveLetters.add(letter)

    return letter + ':'
  }

  getUsedDriveLetters () {
    const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

    // WMIC, which this used to rely on, is no longer installed on current Windows 11 builds
    return run(powershell, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[System.IO.DriveInfo]::GetDrives() | ForEach-Object { $_.Name.Substring(0, 1) }'
    ]).then(stdout => {
      const letters = stdout.split(/\r?\n/).map(i => i.trim().toUpperCase()).filter(i => /^[A-Z]$/.test(i))

      if (letters.length === 0) {
        throw new Error('No drives listed')
      }

      return new Set(letters)
    }).catch(() => this.probeUsedDriveLetters())
  }

  // Fallback when PowerShell is unavailable. Only a definite "no such drive" counts as
  // free, so a drive that errors or does not answer in time is assumed to be in use.
  probeUsedDriveLetters () {
    return Promise.all(DRIVE_LETTERS.map(letter => probePath(`${letter}:\\`).then(error => {
      return error && error.code === 'ENOENT' ? null : letter
    }))).then(letters => new Set(letters.filter(Boolean)))
  }
}
