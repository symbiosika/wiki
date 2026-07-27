import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { initTheme } from './theme'
import { loadSidebarWidth } from './sidebarWidth'

// Before mount, so the first paint is already in the right appearance instead
// of flashing light and correcting itself.
initTheme()
loadSidebarWidth()

createApp(App).use(router).mount('#app')
