<template>
  <div v-show="tabs.isActive(label)" class="tab">
      <slot></slot>
  </div>
</template>

<script>
export default {
  name: 'Tab',

  inject: ['tabs'],

  props: {
    active: {
      required: false,
      type: Boolean,
      default: false
    },
    label: {
      required: true,
      type: String
    }
  },

  mounted () {
    this.tabs.register(this.label, this.active)
  },

  beforeUnmount () {
    this.tabs.unregister(this.label)
  }
}
</script>

<style lang="less" scoped>
.tab {
  padding-top: 15px;
}
</style>