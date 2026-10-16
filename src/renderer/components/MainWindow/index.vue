<template>
  <Window title="SSHFS-Win Manager" closeAction="hide">
    <div class="wrap">
      <div class="left">
        <div class="connection-list" :class="{'has-debug-panel': appSettings.showDebugPanel}">
          <div v-if="!hasConnections" class="no-data">
            <h1>No servers added yet</h1>
            <p>Try clicking at 'Add Server' in the panel aside</p>
          </div>

          <VueDraggable v-model="sortedConnections" handle=".grip" chosen-class="highlight-item" drag-class="hide-dragging-item" :animation="200">
            <ConnectionItem v-for="conn in connections" :key="conn.uuid" :conn="conn" :mode="listMode" @connect="connect" @disconnect="disconnect" @open="openLocal" @edit="editConnection" @delete="deleteConnection" @clone="cloneConnection"/>
          </VueDraggable>
        </div>

        <div v-show="appSettings.showDebugPanel" class="debug-panel">
          <div class="title">DEBUG OUTPUT</div>
          <div class="debug-actions">
            <button v-tooltip="'Clear debug output'" @click="clearDebugOutput">
              <Icon icon="unavailable"/>
            </button>
            <button v-tooltip="'Copy debug output to clipboard'" @click="copyDebugOutput">
              <Icon icon="duplicate"/>
            </button>
          </div>
          <textarea v-model="debugOutput" readonly ref="debugOutput"></textarea>
        </div>
      </div>

      <div class="right">
        <button class="btn" :disabled="listMode !== 'none'" @click="addNewConnection">
          <Icon icon="plus"/>
          Add Connection
        </button>

        <div class="sep"></div>

        <button class="btn" :class="{ 'active': isEditModeEnabled }" :disabled="!hasConnections" @click="toggleEditMode">
          <Icon icon="pen"/>
          Edit mode
        </button>
        <button class="btn" :class="{ 'active': isDeleteModeEnabled }" :disabled="!hasConnections" @click="toggleDeleteMode">
          <Icon icon="trashCan"/>
          Delete mode
        </button>

        <div class="bottom-actions">
          <button v-if="isDev" class="btn" @click="clearState">
            <Icon icon="unavailable"/>
            Clear saved state
          </button>
          <button class="btn" @click="settings">
            <Icon icon="settings"/>
            Settings
          </button>
          <button class="btn" @click="about">
            <Icon icon="help"/>
            About
          </button>
        </div>
      </div>
    </div>
  </Window>
</template>

<script>
import { VueDraggable } from 'vue-draggable-plus'

import { mutations } from '../../../shared/state.js'

import Window from '@/components/Window/index.vue'
import Icon from '@/components/Icon.vue'
import ConnectionItem from './ConnectionItem.vue'

const DEBUG_OUTPUT_LIMIT = 100000

export default {
  name: 'main-window',

  components: {
    VueDraggable,

    Window,
    Icon,

    ConnectionItem
  },

  methods: {
    toggleDeleteMode () {
      this.listMode = this.listMode === 'delete' ? 'none' : 'delete'
    },

    toggleEditMode () {
      this.listMode = this.listMode === 'edit' ? 'none' : 'edit'
    },

    connect (conn) {
      window.api.connection.connect(conn.uuid)
    },

    disconnect (conn) {
      window.api.connection.disconnect(conn.uuid)
    },

    openLocal (conn) {
      window.api.connection.openFolder(conn.uuid)
    },

    addNewConnection () {
      window.api.window.open('add-connection')
    },

    editConnection (conn) {
      window.api.window.open('edit-connection', conn.uuid)
    },

    cloneConnection (conn) {
      const connCopy = JSON.parse(JSON.stringify(conn))

      const randName = Math.random().toString(30).substr(-4)

      connCopy.uuid = crypto.randomUUID()
      connCopy.name += ` (copy-${randName})`

      this.$store.dispatch('ADD_CONNECTION', connCopy)
    },

    async deleteConnection (conn) {
      await this.$store.dispatch('DELETE_CONNECTION', { uuid: conn.uuid })

      if (this.connections.length === 0) {
        this.listMode = 'none'
      }
    },

    settings () {
      window.api.window.open('settings')
    },

    about () {
      window.api.window.open('about')
    },

    clearState () {
      this.$store.dispatch('CLEAR_CONNECTIONS')
      this.$store.dispatch('RESET_SETTINGS')
    },

    clearDebugOutput () {
      this.debugOutput = ''
    },

    copyDebugOutput () {
      window.api.app.copyText(this.debugOutput)
    },

    appendDebugOutput (line) {
      // The per-request lines of sshfs's own log ("[00012] READ"), far too many to be of use here
      if (!this.appSettings.showDebugPanel || /\[?\d{5}\]?/.test(line)) {
        return
      }

      this.debugOutput += '\n' + line.trim()

      // sshfs is very chatty in debug mode, and an ever-growing textarea freezes the window
      if (this.debugOutput.length > DEBUG_OUTPUT_LIMIT * 1.5) {
        this.debugOutput = this.debugOutput.slice(-DEBUG_OUTPUT_LIMIT)
      }

      this.$nextTick().then(() => {
        const output = this.$refs.debugOutput

        if (output) {
          output.scrollTop = output.scrollHeight
        }
      })
    }
  },

  computed: {
    hasConnections () {
      return this.connections.length > 0
    },

    isEditModeEnabled () {
      return this.listMode === 'edit'
    },

    isDeleteModeEnabled () {
      return this.listMode === 'delete'
    },

    isDev () {
      return import.meta.env.DEV
    },

    connections () {
      return this.$store.state.Data.connections
    },

    // What the draggable list reads and writes: dropping an item saves the new order
    sortedConnections: {
      get () {
        return this.connections
      },

      set (list) {
        const uuids = list.map(conn => conn.uuid)

        // Applied right away too, or the list would jump back until the main process answers
        mutations.REORDER_CONNECTIONS(this.$store.state, uuids)

        this.$store.dispatch('REORDER_CONNECTIONS', uuids)
      }
    },

    appSettings () {
      return this.$store.state.Settings.settings
    }
  },

  data () {
    return {
      listMode: 'none',
      debugOutput: ''
    }
  },

  mounted () {
    window.api.onDebugLog(line => this.appendDebugOutput(line))
  }
}
</script>

<style lang="less" scoped>
.wrap {
  padding: 0;
  display: flex;

  .left {
    @debug-panel-height: 200px;

    flex: 1;
    height: calc(100vh - 32px);
    position: relative;

    .connection-list {
      height: 100%;
      overflow: auto;

      &.has-debug-panel {
        height: calc(100% - @debug-panel-height);
      }

      .no-data {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        color: fade(contrast(@main-color), 20%);
      }
    }

    .debug-panel {
      position: relative;
      height: @debug-panel-height;
      border-top: 1px solid lighten(@main-color, 1%);

      .title {
        font-size: 10pt;
        color: fade(contrast(@main-color), 30%);
        padding: 10px;
      }

      .debug-actions {
        position: absolute;
        top: 7px;
        right: 10px;

        button {
          margin-left: 3px;
          width: 25px;
          height: 25px;
          border: none;
          border-radius: 100%;
          padding: 4px;
          background: fade(contrast(@main-color), 5%);
          cursor: pointer;
          outline: none;

          &:hover {
            background: @primary-color;
          }

          &:active {
            background: darken(@primary-color, 5%);
          }

          svg {
            fill: contrast(@main-color);
          }
        }
      }

      textarea {
        width: 100%;
        height: calc(100% - 38px);
        background: transparent;
        border: none;
        font-family: 'Consolas', 'Courier New', Courier, monospace;
        padding: 10px;
        color: #2FFF54;
        outline: none;
        resize: none;
      }
    }
  }

  .right {
    position: relative;
    width: 200px;
    background: lighten(@main-color, 3%);
    padding: 15px;

    .bottom-actions {
      position: absolute;
      bottom: 12px;
      left: 15px;
      right: 15px;
    }

    button {
      width: 100%;
    }

    .sep {
      width: 100%;
      border-bottom: 1px solid fade(contrast(@main-color), 5%);
      margin-bottom: 5px;
    }
  }
}

.hide-dragging-item {
  opacity: 0;
}
.highlight-item {
  border: 1px solid @primary-color;
}
</style>
