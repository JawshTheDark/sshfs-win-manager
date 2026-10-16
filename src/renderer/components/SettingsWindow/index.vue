<template>
  <Window title="Settings">
    <div class="wrap">
      <div class="form-item">
        <label>SSHFS Binary</label>
        <input type="text" autofocus placeholder="eg. C:\Program Files\SSHFS-Win\bin\sshfs-win.exe" v-model="data.sshfsBinary">
      </div>

      <div class="form-item">
        <label>Process Timeout</label>
        <input type="text" autofocus placeholder="Time in seconds" v-model.number="data.processTrackTimeout" style="width: 100px; text-align: right;">
      </div>

      <div class="form-item" style="margin: 10px 0">
        <SwitchLabel label="Startup with Windows" v-model="data.startupWithOS"/>
        <SwitchLabel label="Display system tray message on close" v-model="data.displayTrayMessageOnClose"/>
        <SwitchLabel label="Show debug panel" v-model="data.showDebugPanel"/>
      </div>

      <div class="footer">
        <button class="btn" @click="cancel">Cancel</button>
        <button class="btn default" @click="save">OK</button>
      </div>
    </div>
  </Window>
</template>

<script>
import Window from '@/components/Window/index.vue'
import SwitchLabel from '@/components/SwitchLabel.vue'

export default {
  name: 'settings-window',

  components: {
    Window,
    SwitchLabel
  },

  methods: {
    cancel () {
      window.api.window.close()
    },

    async save () {
      await this.$store.dispatch('UPDATE_SETTINGS', this.data)
      await window.api.app.setOpenAtLogin(this.data.startupWithOS)

      window.api.window.close()
    }
  },

  data () {
    return {
      // Edited here, and only applied on OK
      data: { ...this.$store.state.Settings.settings }
    }
  },

  async mounted () {
    const info = await window.api.app.info()

    // What Windows has is what counts (only once installed, a development run never registers itself)
    if (info.isPackaged) {
      this.data.startupWithOS = info.openAtLogin
    }
  }
}
</script>

<style lang="less" scoped>
.wrap {
  padding: 15px 20px;

  .footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 15px;
    text-align: right;
  }
}
</style>
