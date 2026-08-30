import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vitest/config'
import Icons from 'unplugin-icons/vite'

export default defineConfig({
  /*
   * `Icons` is needed because modules under test import `~icons/*`
   * (e.g. src/utils/wikiIcons.ts). Without it those imports fail to resolve
   * and the whole spec file errors out before a single test runs.
   *
   * The cast bridges two Vite copies: unplugin-icons is typed against the
   * root `vite` (7.3.0) while `vitest/config` resolves its own nested one
   * (7.3.6), and the two describe the plugin context differently
   * (rollup vs rolldown). Same plugin shape at runtime — only tsc sees a
   * conflict. Remove the cast once both resolve to one Vite version.
   */
  plugins: [Icons() as Plugin],
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
