import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
import Icons from 'unplugin-icons/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const DEV_SERVER = env.VITE_DEV_API_URL || 'http://localhost:3000'
  const HOST = 'frontend.localhost'
  const PORT = 5173

  return {
    base: '/static/app/',
    build: {
      outDir: 'dist/static/app',
    },
    plugins: [
      {
        name: 'log-localhost-host',
        configureServer(server) {
          // Hook into printUrls so the fake-domain line appears alongside
          // Vite's own URLs — a console.log from the post-start hook gets
          // wiped by Vite's clearScreen before printUrls() runs.
          const printUrls = server.printUrls.bind(server)
          server.printUrls = () => {
            printUrls()
            const base = server.config.base
            console.log(
              `  \x1b[32m➜\x1b[0m  \x1b[1mHost\x1b[0m:    \x1b[36mhttp://${HOST}:${PORT}${base}\x1b[0m`,
            )
          }
        },
      },
      vue(),
      vueDevTools(),
      tailwindcss(),
      Icons(),
      AutoImport({
        dts: 'src/auto-imports.d.ts',
        imports: ['vue', 'vue-router', 'vue-i18n'],
        dirs: ['./src/stores', './src/volt', './src/types', './src/utils'],
      }),
      Components({
        dts: 'src/components.d.ts',
        dirs: ['./src/volt', './src/components'],
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },

    server: {
      port: PORT,
      allowedHosts: ['localhost', HOST],
      proxy: {
        '/api/v1': {
          target: DEV_SERVER,
          changeOrigin: true,
          ws: true,
        },
        '/login.html': {
          target: DEV_SERVER,
          changeOrigin: true,
        },
        '/magic-login-verify.html': {
          target: DEV_SERVER,
          changeOrigin: true,
        },
        '/password-login.html': {
          target: DEV_SERVER,
          changeOrigin: true,
        },
        '/verify-email.html': {
          target: DEV_SERVER,
          changeOrigin: true,
        },
        '/reset-password.html': {
          target: DEV_SERVER,
          changeOrigin: true,
        },
        '/favicon.png': {
          target: DEV_SERVER,
          changeOrigin: true,
        },
        '/styles.css': {
          target: DEV_SERVER,
          changeOrigin: true,
        },
      },
    },
  }
})
