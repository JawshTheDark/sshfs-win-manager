import neostandard from 'neostandard'
import pluginVue from 'eslint-plugin-vue'

export default [
  { ignores: ['out/**', 'release/**', 'node_modules/**'] },

  ...neostandard({ ts: false }),

  ...pluginVue.configs['flat/recommended'],

  {
    rules: {
      // The existing components are written in the style of this project
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/attributes-order': 'off',
      'vue/require-default-prop': 'off',
      'vue/mustache-interpolation-spacing': 'off',
      'vue/no-v-html': 'off',
      'vue/block-order': 'off',
      'vue/order-in-components': 'off',
      'vue/component-definition-name-casing': 'off',
      'vue/attribute-hyphenation': 'off',
      'vue/html-closing-bracket-spacing': 'off',
      'vue/no-required-prop-with-default': 'off'
    }
  },

  {
    files: ['src/renderer/**/*.{js,vue}'],
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', crypto: 'readonly' }
    }
  },

  {
    files: ['src/main/**/*.js', 'src/preload/**/*.js', 'electron.vite.config.js', 'test/**/*.js'],
    languageOptions: {
      globals: { __dirname: 'readonly' }
    }
  }
]
