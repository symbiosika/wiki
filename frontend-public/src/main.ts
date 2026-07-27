import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { initTheme } from './theme'

// Before mount, so the first paint is already in the right appearance instead
// of flashing light and correcting itself.
initTheme()

createApp(App).use(router).mount('#app')
