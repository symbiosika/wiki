import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

/**
 * Hash routing, like the authenticated app.
 *
 * The backend serves this bundle as plain static files with no SPA fallback,
 * so a history-mode deep link such as /docs/page/<id> would 404 on reload.
 * Hash routes keep every URL shareable without a server-side rewrite.
 *
 * Organisations appear as a readable slug derived from their name
 * (`#/acme-gmbh/…`), resolved to a tenant id through the public API. Pages keep
 * their id: titles are neither unique nor stable, so a title-based page slug
 * would break links on every rename.
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'start',
    component: () => import('./views/StartView.vue'),
  },
  {
    path: '/:slug',
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
