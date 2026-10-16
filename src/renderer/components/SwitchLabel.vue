<template>
  <label class="switch-label">{{label}}
    <button type="button" role="switch" class="toggle" :class="{ checked: modelValue }" :aria-checked="modelValue" @click.prevent="$emit('update:modelValue', !modelValue)">
      <span class="state">{{modelValue ? 'on' : 'off'}}</span>
      <span class="knob"></span>
    </button>
  </label>
</template>

<script>
export default {
  name: 'SwitchLabel',

  emits: ['update:modelValue'],

  props: {
    label: {
      type: String,
      required: true,
      default: ''
    },
    modelValue: {
      type: Boolean,
      required: false,
      default: false
    }
  }
}
</script>

<style lang="less" scoped>
@toggle-width: 50px;
@toggle-height: 22px;
@knob-margin: 3px;

.switch-label {
  display: block;
  margin-top: 5px;

  .toggle {
    position: relative;
    float: right;
    clear: both;
    margin-top: -4px;
    width: @toggle-width;
    height: @toggle-height;
    border: none;
    border-radius: @toggle-height;
    background: rgba(255, 255, 255, 0.1);
    color: contrast(@main-color);
    font-size: 8pt;
    outline: none;
    cursor: pointer;
    transition: background-color 200ms;

    .state {
      position: absolute;
      top: 0;
      right: 9px;
      line-height: @toggle-height;
    }

    .knob {
      position: absolute;
      top: @knob-margin;
      left: @knob-margin;
      width: @toggle-height - 2 * @knob-margin;
      height: @toggle-height - 2 * @knob-margin;
      border-radius: 100%;
      background: #fff;
      transition: transform 200ms;
    }

    &.checked {
      background: @primary-color;

      .state {
        right: auto;
        left: 9px;
      }

      .knob {
        transform: translateX(@toggle-width - @toggle-height);
      }
    }
  }
}
</style>
