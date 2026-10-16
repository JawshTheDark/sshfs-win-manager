<template>
  <Window :title="`Password for ${request.user}@${request.host}`">
    <div class="wrap">
      <div class="form-item">
        <label>Password</label>
        <input type="password" ref="password" v-model="password" @keydown.enter="ok" @keydown.esc="cancel">
      </div>

      <div class="footer">
        <button class="btn" @click="cancel">Cancel</button>
        <button class="btn default" @click="ok">OK</button>
      </div>
    </div>
  </Window>
</template>

<script>
import Window from '@/components/Window/index.vue'

export default {
  name: 'password-prompt-window',

  components: {
    Window
  },

  methods: {
    async cancel () {
      await window.api.prompt.answer(this.$route.params.id, null)

      window.api.window.close()
    },

    async ok () {
      await window.api.prompt.answer(this.$route.params.id, this.password)

      window.api.window.close()
    }
  },

  data () {
    return {
      password: '',
      request: { user: '', host: '' }
    }
  },

  async mounted () {
    this.$refs.password.focus()

    this.request = (await window.api.prompt.get(this.$route.params.id)) || this.request
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
