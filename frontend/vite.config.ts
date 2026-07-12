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

  return {
    base: '/static/app/',
    build: {
      outDir: 'dist/static/app',
    },
    plugins: [
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
      proxy: {
        '/api/v1': {
          target: env.VITE_DEV_API_URL,
          changeOrigin: true,
        },
        '/login.html': {
          target: env.VITE_DEV_API_URL,
          changeOrigin: true,
        },
        '/magic-login-verify.html': {
          target: env.VITE_DEV_API_URL,
          changeOrigin: true,
        },
        '/favicon.svg': {
          target: env.VITE_DEV_API_URL,
          changeOrigin: true,
        },
      },
    },
  }
})
