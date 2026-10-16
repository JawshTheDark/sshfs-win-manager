<template>
  <Window :title="title">
    <div class="wrap">
      <Tabs>
        <Tab label="BASIC" active>
          <div class="form-item">
            <label>Name</label>
            <input type="text" autofocus placeholder="eg. My development server 1" v-model="conn.name">
          </div>

          <h1 class="section-title">Connection</h1>
          <div class="form-row">
            <div class="form-item">
              <label>IP/Host</label>
              <input type="text" placeholder="eg. 127.0.0.1 or my.domain.com" v-model="conn.host">
            </div>
            <div class="form-item" style="flex: 0 0 80px">
              <label>Port</label>
              <input type="text" placeholder="eg. 22" v-model.number="conn.port">
            </div>
          </div>
          <div class="form-item">
            <label>User</label>
            <input type="text" placeholder="eg. root" v-model="conn.user">
          </div>
          <div class="form-item">
            <label>Authentication method</label>
            <select v-model="conn.authType" @change="authTypeChange">
              <option value="password">Password</option>
              <option value="password-ask">Password (ask on connect)</option>
              <option value="key-file">Private Key (file)</option>
              <option value="key-default">SSH key, no password (default keys)</option>
            </select>
          </div>
          <div v-show="conn.authType === 'password'" class="form-item">
            <label>Password</label>
            <input type="password" v-model="conn.password">
          </div>
          <div v-show="conn.authType === 'key-file'" class="form-row">
            <div class="form-item">
              <label>Key File</label>
              <input type="text" placeholder="eg. C:\Users\me\.ssh\id_ed25519" v-model="conn.keyFile">
            </div>
            <div class="form-item" style="flex: 0">
              <button class="btn icon-btn" style="margin-top: 23px" v-tooltip="'Select private key'" @click="selectPrivateKey">
                <Icon icon="openFolder"/>
              </button>
            </div>
          </div>
          <div v-show="conn.authType === 'key-default'" class="form-item">
            <p class="auth-hint">
              Logs in without a password, using the keys in your <code>.ssh</code> folder
              (<code>id_ed25519</code>, <code>id_rsa</code>, ...) or an SSH agent. The matching public
              key has to be authorized on the server. Keys protected by a passphrase are not supported.
            </p>
          </div>

          <h1 class="section-title">Remote</h1>
          <div class="form-item">
            <label>Path</label>
            <input type="text" placeholder="eg. /home/john" v-model="conn.folder">
          </div>

          <h1 class="section-title">Local</h1>
          <div class="form-item">
            <label>Drive letter</label>
            <select v-model="conn.mountPoint">
              <option value="auto">Auto</option>
              <option v-for="drive in drives" :value="drive + ':'" :key="drive">{{drive}}:</option>
            </select>
          </div>
        </Tab>
        <Tab label="ADVANCED" class="advanced-tab">
          <div class="form-item">
            <SwitchLabel label="Connect on Startup" v-model="conn.advanced.connectOnStartup"/>
            <SwitchLabel label="Try to Reconnect on Connection Loss" v-model="conn.advanced.reconnect"/>
          </div>

          <div class="form-item">
            <SwitchLabel label="Verify the Server's Host Key (recommended)" v-model="conn.advanced.verifyHostKey"/>

            <p v-if="conn.advanced.verifyHostKey && trustedKeys.length > 0" class="host-key">
              Trusted key: {{trustedKeys[0].name}}<br>
              <span class="fingerprint">{{trustedKeys[0].fingerprint}}</span>
              <button class="btn forget" @click="forgetHostKey">Forget</button>
            </p>
            <p v-else-if="conn.advanced.verifyHostKey" class="host-key">
              The server's key will be shown for you to confirm the first time you connect.
            </p>
            <p v-else class="host-key warning">
              Without this, a fake server can pose as yours and capture what you send it.
            </p>
          </div>

          <div class="form-item">
            <SwitchLabel label="Custom Command Line params" v-model="conn.advanced.customCmdlOptionsEnabled"/>

            <CustomCmdlOptions v-model="conn.advanced.customCmdlOptions"/>
          </div>
        </Tab>
      </Tabs>

      <div class="footer">
        <button class="btn" @click="cancel">Cancel</button>
        <button class="btn default" @click="save">Save</button>
      </div>
    </div>
  </Window>
</template>

<script>
import Window from '@/components/Window/index.vue'
import Tabs from '@/components/Tabs/Tabs.vue'
import Tab from '@/components/Tabs/Tab.vue'
import SwitchLabel from '@/components/SwitchLabel.vue'
import CustomCmdlOptions from './CustomCmdlOptions.vue'
import Icon from '../Icon.vue'

function emptyConnection (home) {
  return {
    uuid: crypto.randomUUID(),
    name: '',
    host: '',
    port: 22,
    user: '',
    folder: '/',
    authType: 'password',
    password: '',
    keyFile: home + '\\.ssh\\id_ed25519',
    key: '',
    mountPoint: 'auto',
    advanced: {
      customCmdlOptionsEnabled: false,
      customCmdlOptions: [],
      connectOnStartup: false,
      reconnect: false,
      verifyHostKey: true
    }
  }
}

export default {
  name: 'add-edit-connection-window',

  components: {
    Window,
    Tabs,
    Tab,
    SwitchLabel,
    CustomCmdlOptions,
    Icon
  },

  methods: {
    cancel () {
      window.api.window.close()
    },

    async save () {
      this.conn.advanced.customCmdlOptions =
        this.conn.advanced.customCmdlOptions.filter(a => a.name !== '')

      if (this.isEditingMode) {
        await this.$store.dispatch('UPDATE_CONNECTION', this.conn)
      } else {
        await this.$store.dispatch('ADD_CONNECTION', this.conn)
      }

      window.api.window.close()
    },

    authTypeChange () {
      this.conn.password = ''
      this.conn.keyFile = this.home + '\\.ssh\\id_ed25519'
    },

    async selectPrivateKey () {
      const file = await window.api.dialog.selectPrivateKey()

      if (file) {
        this.conn.keyFile = file
      }
    },

    async loadTrustedKeys () {
      this.trustedKeys = this.conn.host ? await window.api.hostKeys.get(this.conn.host, this.conn.port) : []
    },

    async forgetHostKey () {
      await window.api.hostKeys.forget(this.conn.host, this.conn.port)

      await this.loadTrustedKeys()
    }
  },

  data () {
    return {
      isEditingMode: false,

      title: 'Add Connection',
      drives: 'DEFGHIJKLMNOPQRSTUVWXYZ',

      home: '',
      trustedKeys: [],

      conn: emptyConnection('')
    }
  },

  async mounted () {
    this.home = (await window.api.app.info()).home

    if (this.$route.name === 'edit-connection') {
      const saved = this.$store.state.Data.connections.find(a => a.uuid === this.$route.params.uuid)

      if (!saved) {
        window.api.window.close()

        return
      }

      this.isEditingMode = true

      this.title = 'Edit Connection'

      // Edited as a copy, so cancelling leaves the connection as it was
      this.conn = JSON.parse(JSON.stringify(saved))

      await this.loadTrustedKeys()
    } else {
      this.conn = emptyConnection(this.home)
    }
  }
}
</script>

<style lang="less" scoped>
.wrap  {
  .advanced-tab {
    overflow: auto;
    height: 610px;
    width: 100%;
    padding-right: 5px;
  }

  .footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 15px;
    text-align: right;
  }

  .auth-hint,
  .host-key {
    font-size: 10pt;
    line-height: 1.5;
    color: fade(contrast(@main-color), 50%);
    margin-top: 6px;

    code {
      font-family: 'Consolas', 'Courier New', Courier, monospace;
    }

    .fingerprint {
      font-family: 'Consolas', 'Courier New', Courier, monospace;
      font-size: 9pt;
      word-break: break-all;
      user-select: text;
    }

    .forget {
      display: block;
      min-width: 0;
      padding: 2px 12px;
      line-height: 18px;
      margin: 5px 0 0;
    }

    &.warning {
      color: @danger-color;
    }
  }
}
</style>
