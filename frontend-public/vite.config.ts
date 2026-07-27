import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

/**
 * Build config for the public documentation site.
 *
 * Where the output goes matters: the backend serves `./static` behind
 * `authOrRedirectToLogin` and `./public` to everyone (see the framework's
 * defineServer). The authenticated SPA therefore builds into `static/app`,
 * and this one builds into `public/docs` so it is reachable without a login.
 *
 * `public/` is the serving root, not part of the URL — the bundle deployed to
 * `<backend>/public/docs/` answers at `/docs/`, which is what `base` says. The
 * build output mirrors the deployed directory layout so CI can copy
 * `dist/public/*` into the container's `public/` verbatim.
 *
 * Hash routing (see src/router.ts) is the other half of that: static file
 * serving has no SPA fallback, so a deep link like /docs/page/<id> would 404.
 * The authenticated app solves it the same way.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const DEV_SERVER = env.VITE_DEV_API_URL || 'http://localhost:3000'

  return {
    base: '/docs/',
    build: {
      outDir: 'dist/public/docs',
      emptyOutDir: true,
    },
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5174,
      proxy: {
        '/api/v1': {
          target: DEV_SERVER,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'happy-dom',
    },
  }
})
