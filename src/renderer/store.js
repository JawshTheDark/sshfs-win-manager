import { reactive } from 'vue'

import { createInitialState, mutations } from '../shared/state.js'

// A read-only mirror of the state the main process owns. Changes are requested with
// dispatch(), and arrive back as mutations that are applied to the mirror.
const state = reactive(createInitialState())

async function dispatch (type, payload) {
  await window.api.store.commit(type, JSON.parse(JSON.stringify(payload === undefined ? null : payload)))
}

export const store = { state, dispatch }

export async function setupStore () {
  const queued = []

  let snapshotRev = null

  // Mutations that happen while the snapshot is being fetched are applied afterwards
  window.api.store.onMutation(message => {
    if (snapshotRev === null) {
      queued.push(message)
    } else {
      apply(message)
    }
  })

  const snapshot = await window.api.store.get()

  Object.assign(state, snapshot.state)

  snapshotRev = snapshot.rev

  queued.forEach(apply)

  function apply ({ rev, type, payload }) {
    if (rev > snapshotRev) {
      snapshotRev = rev

      mutations[type](state, payload)
    }
  }
}

export default {
  install (app) {
    app.config.globalProperties.$store = store
  }
}
