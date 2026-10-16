<template>
  <Window :title="isChanged ? 'Host key changed' : 'Verify host key'">
    <div class="wrap" :class="{ 'is-changed': isChanged }">
      <template v-if="isChanged">
        <h1 class="warning-title">Warning: the host key has changed</h1>
        <p>
          The server <strong>{{target}}</strong> is not presenting the key that was trusted for it before.
          This can happen when the server was reinstalled or its keys were regenerated, but it is also what
          someone intercepting the connection would look like.
        </p>

        <div class="key">
          <div class="key-label">Trusted so far ({{request.trustedKeyName}})</div>
          <div class="fingerprint">{{request.trustedFingerprint}}</div>
        </div>
        <div class="key">
          <div class="key-label">Presented now ({{request.keyName}})</div>
          <div class="fingerprint">{{request.fingerprint}}</div>
        </div>

        <p class="hint">Only continue if you know why the key changed.</p>
      </template>

      <template v-else>
        <h1 class="section-title">Trust this server?</h1>
        <p>
          <strong>{{target}}</strong> hasn't been connected to before, so its identity can't be
          checked yet. Compare this fingerprint with the one your server reports; if they match,
          you can be sure that you are talking to the right machine.
        </p>

        <div class="key">
          <div class="key-label">{{request.keyName}} key fingerprint</div>
          <div class="fingerprint">{{request.fingerprint}}</div>
        </div>

        <p class="hint">On the server, <code>ssh-keygen -lf /etc/ssh/ssh_host_{{keyFileName}}_key.pub</code> shows it.</p>
      </template>

      <div class="footer">
        <button class="btn" :class="{ default: isChanged }" @click="cancel">Cancel</button>
        <button class="btn" :class="{ default: !isChanged, danger: isChanged }" @click="trust">{{isChanged ? 'Trust new key' : 'Trust and connect'}}</button>
      </div>
    </div>
  </Window>
</template>

<script>
import Window from '@/components/Window/index.vue'

export default {
  name: 'host-key-prompt-window',

  components: {
    Window
  },

  computed: {
    isChanged () {
      return this.request.status === 'changed'
    },

    target () {
      return this.request.port === 22 ? this.request.host : `${this.request.host}:${this.request.port}`
    },

    keyFileName () {
      return (this.request.keyName || '').split(' ')[0].toLowerCase() || 'ed25519'
    }
  },

  methods: {
    async cancel () {
      await window.api.prompt.answer(this.$route.params.id, false)

      window.api.window.close()
    },

    async trust () {
      await window.api.prompt.answer(this.$route.params.id, true)

      window.api.window.close()
    }
  },

  data () {
    return {
      request: { status: 'unknown', host: '', port: 22, keyName: '', fingerprint: '', trustedKeyName: '', trustedFingerprint: '' }
    }
  },

  async mounted () {
    this.request = (await window.api.prompt.get(this.$route.params.id)) || this.request
  }
}
</script>

<style lang="less" scoped>
.wrap {
  padding: 15px 20px;
  color: contrast(@main-color);

  h1 {
    margin-bottom: 10px;

    &.warning-title {
      font-size: 15pt;
      font-weight: normal;
      color: @danger-color;
    }
  }

  p {
    font-size: 10pt;
    line-height: 1.5;
    color: fade(contrast(@main-color), 80%);
    margin-bottom: 12px;

    &.hint {
      color: fade(contrast(@main-color), 50%);
    }
  }

  code {
    font-family: 'Consolas', 'Courier New', Courier, monospace;
    font-size: 9pt;
    user-select: text;
  }

  .key {
    margin-bottom: 12px;

    .key-label {
      font-size: 9pt;
      text-transform: uppercase;
      color: fade(contrast(@main-color), 50%);
      margin-bottom: 4px;
    }

    .fingerprint {
      font-family: 'Consolas', 'Courier New', Courier, monospace;
      font-size: 10pt;
      padding: 8px 10px;
      background: fade(contrast(@main-color), 5%);
      border: 1px solid fade(contrast(@main-color), 5%);
      word-break: break-all;
      user-select: text;
    }
  }

  &.is-changed .key:last-of-type .fingerprint {
    border-color: @danger-color;
  }

  .footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 15px;
    text-align: right;
  }

  button.danger {
    background: @danger-color;
    color: contrast(@danger-color);

    &:hover {
      background: lighten(@danger-color, 10%);
    }
  }
}
</style>
