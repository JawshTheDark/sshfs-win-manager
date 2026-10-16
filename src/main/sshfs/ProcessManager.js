import { EventEmitter } from 'node:events'

// Safety net on top of the handler's own timeout, so a connection can never stay
// "connecting" forever whatever goes wrong underneath
const HARD_TIMEOUT_MARGIN = 30

const WATCH_INTERVAL = 5000

// Events:
//   created ({ conn, process })       an sshfs process is up
//   tracked-alternative (conn)        ...and was only recognised by its mount point showing up
//   terminated (pid)                  we stopped it
//   not-found (pid)                   it went away by itself
export default class ProcessManager extends EventEmitter {
  constructor (processHandler) {
    super()

    this.processHandler = processHandler
    this.processList = []
    this.processWatchList = {}
  }

  create (conn, options) {
    return new Promise((resolve, reject) => {
      let abandoned = false

      const guard = setTimeout(() => {
        abandoned = true

        reject(new Error('Timed out while connecting'))
      }, (this.processHandler.getStartTimeout() + HARD_TIMEOUT_MARGIN) * 1000)

      this.processHandler.create(conn, options).then(process => {
        clearTimeout(guard)

        if (abandoned) {
          // Already reported as failed, so don't leave it running untracked
          this.processHandler.terminate(process.pid)

          return
        }

        this.processList.push(process.pid)

        this.emit('created', {
          conn,
          process
        })

        this.watch(process.pid, process)

        if (process.trackedWithoutStartMessage) {
          this.emit('tracked-alternative', conn)
        }

        resolve(process.pid)
      }).catch(error => {
        clearTimeout(guard)

        reject(error)
      })
    })
  }

  terminate (pid) {
    // Stop watching first, so the process exiting is not reported as a lost connection
    this.unwatch(pid)

    this.processList = this.processList.filter(a => a !== pid)

    return this.processHandler.terminate(pid).catch(() => {}).then(() => {
      this.emit('terminated', pid)
    })
  }

  terminateAll () {
    return Promise.all(this.processList.slice().map(pid => this.terminate(pid)))
  }

  watch (pid, process = null) {
    this.unwatch(pid)

    this.processWatchList[pid] = setInterval(() => {
      if (!this.exists(pid)) {
        this.lost(pid)
      }
    }, WATCH_INTERVAL)

    if (process) {
      // Notices the process dying right away rather than at the next check
      process.once('exit', () => this.lost(pid))
    }
  }

  unwatch (pid) {
    clearInterval(this.processWatchList[pid])

    delete this.processWatchList[pid]
  }

  lost (pid) {
    if (this.processWatchList[pid] === undefined) {
      return
    }

    this.unwatch(pid)

    this.processList = this.processList.filter(a => a !== pid)

    this.emit('not-found', pid)
  }

  exists (pid) {
    return this.processHandler.exists(pid)
  }
}
