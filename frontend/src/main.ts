import './assets/base.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { i18n } from './i18n'
import App from './App.vue'
import router from './router'

import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import Tooltip from 'primevue/tooltip'
import KeyFilter from 'primevue/keyfilter'
import Column from 'primevue/column'
import ProgressSpinner from 'primevue/progressspinner'

import { registerToastServiceGlobal } from './stores/toast'
import { bootstrapTeamsSession, isTeamsHost } from './utils/teamsSession'

const app = createApp(App)

app.directive('tooltip', Tooltip)
app.directive('keyfilter', KeyFilter)

// manual imports of some primevue components which are not provided by Volt
app.component('Column', Column)
app.component('ProgressSpinner', ProgressSpinner)

app.use(PrimeVue, {
  unstyled: true,
  pt: {
    directives: {
      tooltip: {
        root: {
          class: `hidden w-fit pointer-events-none absolute max-w-48 group drop-shadow-lg animate-fade-in
                            data-[p-position=top]:py-1 data-[p-position=bottom]:py-1
                            data-[p-position=left]:px-1 data-[p-position=right]:px-1
                    `,
        },
        arrow: {
          class: `absolute w-0 h-0 border-transparent border-solid border-[.25rem]
                            group-data-[p-position=top]:border-y-surface-700 group-data-[p-position=top]:-ml-1 group-data-[p-position=top]:border-b-0
                            group-data-[p-position=bottom]:border-y-surface-700 group-data-[p-position=bottom]:-ml-1 group-data-[p-position=bottom]:border-t-0
                            group-data-[p-position=left]:border-l-surface-700 group-data-[p-position=left]:-mt-1 group-data-[p-position=left]:border-r-0
                            group-data-[p-position=right]:border-r-surface-700 group-data-[p-position=right]:-mt-1 group-data-[p-position=right]:border-l-0
                    `,
        },
        text: {
          class:
            'break-words whitespace-pre-line bg-surface-700 text-surface-0 px-3 py-2 rounded',
        },
      },
    },
  },
})
app.use(i18n)
app.use(createPinia())
app.use(router)
app.use(ToastService)
app.use(ConfirmationService)

// Initialize toast service for use outside components
registerToastServiceGlobal(app.config.globalProperties.$toast)

/**
 * In a Teams tab the session is established before the app mounts.
 *
 * It has to happen here rather than in a component: the router guard and the
 * very first API calls need a token, and neither can wait for a component
 * lifecycle. The promise is never rejected — `bootstrapTeamsSession` reports
 * failure through its state object, which App.vue renders (sign-in error, or the
 * invitation-code step on a gated instance).
 */
const start = async () => {
  if (isTeamsHost()) {
    await bootstrapTeamsSession()
  }
  app.mount('#app')
}

void start()
