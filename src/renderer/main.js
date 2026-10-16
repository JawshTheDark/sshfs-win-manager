import { createApp } from 'vue'
import FloatingVue from 'floating-vue'
import 'floating-vue/dist/style.css'

import App from './App.vue'
import router from './router'
import storePlugin, { setupStore } from './store.js'

// Every window starts from the current state
await setupStore()

createApp(App)
  .use(router)
  .use(storePlugin)
  .use(FloatingVue)
  .mount('#app')
