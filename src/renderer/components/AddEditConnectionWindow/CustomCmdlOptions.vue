<template>
  <div class="custom-cmdl-list">
    <div v-for="(param, index) in modelValue" :key="param.uuid || index" class="list-item">
      <div class="row param">
        <div class="name">
          <select v-model="param.name" @change="paramNameChange(param)">
            <option v-for="option in options" :key="option.name" :value="option.name" :selected="param.name === option.name">{{option.name}}</option>
          </select>
        </div>
        <div class="value" v-show="getOption(param.name).type !== 'bool'">
          <input type="text" placeholder="Param value" v-model="param.value" :disabled="getOption(param.name).type === 'bool'">
        </div>
        <div class="remove">
          <button @click="removeParam(param)">
            <Icon icon="trashCan"/>
          </button>
        </div>
      </div>

      <div class="row description" v-show="getOption(param.name).name !== ''">
        <Icon icon="info" size="20px"/> {{getOption(param.name).description}}
      </div>
    </div>

    <h1 v-if="modelValue.length === 0" class="no-data">No params added yet</h1>

    <button @click="addParam" class="btn add-param" :disabled="hasEmptyParam">
      <Icon icon="plus"/> Add param
    </button>
  </div>
</template>

<script>
import Icon from '@/components/Icon.vue'

import SshfsParamsList from '@/SshfsParamsList.js'

export default {
  name: 'CustomCmdlOptions',

  components: {
    Icon
  },

  emits: ['update:modelValue'],

  props: {
    modelValue: {
      type: Array,
      required: false,
      default: () => []
    }
  },

  methods: {
    addParam () {
      if (!this.hasEmptyParam) {
        this.$emit('update:modelValue', [
          ...this.modelValue,
          {
            uuid: crypto.randomUUID(),
            name: '',
            value: ''
          }
        ])
      }
    },

    removeParam (param) {
      this.$emit('update:modelValue', this.modelValue.filter(a => a !== param))
    },

    getOption (name) {
      let option = this.options.find(a => a.name === name)

      if (!option) {
        option = {
          name: '',
          type: 'string',
          description: '(Select an option)'
        }
      }

      return option
    },

    paramNameChange (param) {
      param.value = ''
    }
  },

  computed: {
    hasEmptyParam () {
      return this.modelValue.find(a => a.name === '')
    }
  },

  data () {
    return {
      options: [...SshfsParamsList].sort((a, b) => a.name > b.name ? 1 : (a.name < b.name ? -1 : 0))
    }
  }
}
</script>

<style lang="less" scoped>
.custom-cmdl-list {
  .row {
    display: flex;
    width: 100%;

    > div {
      flex: 1;
    }
  }

  .list-item {
    border-bottom: 1px dashed fade(contrast(@main-color), 5%);
    padding: 5px 0;

    .param {
      select,
      input,
      button {
        height: 35px;
        width: 100%;
      }
  
      select {
        padding: 0 10px;
      }
  
      .value {
        margin-left: 10px;
      }
  
      .remove {
        flex: 0 0 35px;
        margin-left: 10px;
  
        button {
          border: none;
          border-radius: 50px;
          background: fade(contrast(@main-color), 3%);
          fill: @danger-color;
          outline: none;
          cursor: pointer;
  
          &:hover {
            background: fade(contrast(@main-color), 8%);
          }
  
          svg {
            width: 23px;
          }
        }
      }
    }

    .description {
      font-size: 10pt;
      color: fade(@primary-color, 70%);
      margin-top: 5px;

      svg {
        fill: fade(@primary-color, 80%);
        margin-right: 5px;
      }
    }
  }

  .add-param {
    margin-top: 5px;
  }

  .no-data {
    font-size: 15pt;
    color: fade(contrast(@main-color), 20%);
    margin: 9px 0;
  }
}
</style>
