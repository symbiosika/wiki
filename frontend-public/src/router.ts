import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

/**
 * Hash routing, like the authenticated app.
 *
 * The backend serves this bundle as plain static files with no SPA fallback,
 * so a history-mode deep link such as /docs/page/<id> would 404 on reload.
 * Hash routes keep every URL shareable without needing a server-side rewrite.
 *
 * The tenant is part of the route because the public API is multi-tenant
 * (/api/v1/public/wiki/:tenantId/...). A deployment that serves exactly one
 * organisation can front this with a nicer URL later; that is a routing
 * concern and does not touch how visibility is decided.
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'start',
    component: () => import('./views/StartView.vue'),
  },
  {
    path: '/:tenantId',
    component: () => import('./views/DocsLayout.vue'),
    children: [
      {
        path: '',
        name: 'home',
        component: () => import('./views/HomeView.vue'),
      },
      {
        path: 'page/:pageId',
        name: 'page',
        component: () => import('./views/PageView.vue'),
      },
      {
        path: 'search',
        name: 'search',
        component: () => import('./views/SearchView.vue'),
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export default createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: (to, from) => {
    // keep the scroll position when only the query changes (search typing)
    if (to.path === from.path) return
    return { top: 0 }
  },
})
