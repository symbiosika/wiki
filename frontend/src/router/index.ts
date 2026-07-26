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
          path: 'tenant/:tenantId/idea-boards',
          name: 'IdeaBoards',
          component: () => import('../views/idea-boards/index.vue'),
        },
        {
          path: 'tenant/:tenantId/idea-boards/:boardId',
          name: 'IdeaBoard',
          component: () => import('../views/idea-boards/board.vue'),
        },
        {
          path: 'tenant/:tenantId/manage/organisations',
          name: 'Tenants',
          component: () => import('../views/manage/organisations.vue'),
        },
        {
          path: 'tenant/:tenantId/manage/organisations/:id',
          name: 'TenantDetails',
          component: () => import('../views/manage/organisation-details.vue'),
        },
        {
          path: 'tenant/:tenantId/manage/teams',
          name: 'Teams',
          component: () => import('../views/manage/teams.vue'),
        },
        {
          path: 'tenant/:tenantId/manage/teams/:teamId',
          name: 'TeamDetails',
          component: () => import('../views/manage/team-details.vue'),
        },
        {
          path: 'tenant/:tenantId/manage/chat-agent',
          name: 'ChatAgent',
          component: () => import('../views/manage/chat-agent.vue'),
        },
        {
          path: 'tenant/:tenantId/manage/document-tags',
          name: 'DocumentTags',
          component: () => import('../views/manage/document-tags.vue'),
        },
        {
          path: 'tenant/:tenantId/manage/post-processing-agents',
          name: 'PostProcessingAgents',
          component: () => import('../views/manage/post-processing-agents.vue'),
        },
        {
          path: 'tenant/:tenantId/manage/oauth-apps',
          name: 'OAuthApps',
          component: () => import('../views/manage/oauth-apps.vue'),
        },
        {
          path: 'tenant/:tenantId/chat',
          name: 'Chat',
          component: () => import('../views/chat/index.vue'),
        },
        {
          path: 'tenant/:tenantId/profile',
          name: 'Profile',
          component: () => import('../views/profile.vue'),
        },
        {
          path: 'tenant/:tenantId/notifications',
          name: 'Notifications',
          component: () => import('../views/notifications/index.vue'),
        },
        {
          path: 'tenant/:tenantId/jobs',
          name: 'Jobs',
          component: () => import('../views/jobs/index.vue'),
        },
        {
          path: 'tenant/:tenantId/jobs/url-import/:jobId',
          name: 'UrlImportJob',
          component: () => import('../views/jobs/url-import-job.vue'),
        },
        {
          path: 'tenant/:tenantId/ai-tests',
          name: 'AiTests',
          component: () => import('../views/ai-tests/index.vue'),
        },
        {
          path: 'tenant/:tenantId/ai-tests/:suiteId',
          name: 'AiTestSuite',
          component: () => import('../views/ai-tests/suite-detail.vue'),
        },
        {
          path: 'tenant/:tenantId/ai-tests/:suiteId/runs/:runId',
          name: 'AiTestRun',
          component: () => import('../views/ai-tests/run-detail.vue'),
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
