import { createRouter, createWebHashHistory } from 'vue-router'
import DefaultLayout from '../components/layout/Default.vue'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    // Home
    {
      path: '/',
      name: 'home',
      component: DefaultLayout,
      children: [
        {
          path: '',
          name: 'Home',
          component: () => import('../views/index.vue'),
        },
        {
          path: 'tenant/:tenantId/wiki',
          name: 'Wiki',
          component: () => import('../views/wiki/index.vue'),
        },
        {
          path: 'tenant/:tenantId/wiki/:pageId',
          name: 'WikiPage',
          component: () => import('../views/wiki/page.vue'),
        },
        {
          path: 'tenant/:tenantId/chat',
          name: 'Chat',
          component: () => import('../views/chat/index.vue'),
        },
      ],
    },

    // 404 (not found)
    {
      path: '/:pathMatch(.*)*',
      name: '404',
      component: () => import('../views/404.vue'),
    },
  ],
})

const isAuthenticated = (): boolean => {
  // The real `jwt` cookie is HttpOnly and invisible to document.cookie.
  // The backend sets the non-HttpOnly `jwt_present` marker alongside it
  // for exactly this check (plain `jwt` kept as fallback for tests/tools).
  return document.cookie
    .split(';')
    .some(
      (item) =>
        item.trim().startsWith('jwt_present=') ||
        item.trim().startsWith('jwt='),
    )
}

const redirectToLogin = () => {
  const redirect = encodeURIComponent(window.location.href)
  window.location.href = `/login.html?redirectUrl=${redirect}`
}

/**
 * Navigation guard
 */
router.beforeEach((to, from, next) => {
  // Check authentication for protected routes
  if (!isAuthenticated()) {
    redirectToLogin()
    return
  }
  // Allow navigation to protected routes if authenticated
  next()
})

/**
 * Navigate to a route
 */
export const goto = (data: { name?: string; url?: string }) => {
  if (data.name) {
    router.push({ name: data.name })
  } else {
    router.push({ path: data.url })
  }
}

/**
 * Get the actual url
 */
export const getFullPath = (): string => {
  return router.currentRoute.value.fullPath
}

/**
 * Get the actual route
 */
export const getRoute = (): string => {
  return router.currentRoute.value.name?.toString() ?? ''
}

export default router
