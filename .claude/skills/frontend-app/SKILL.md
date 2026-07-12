---
name: frontend-app
description: >
  Use when editing or creating files in frontend/src/.
  Use when the user asks to create a Vue component, add a page/view, style something with Tailwind,
  use PrimeVue/Volt components, add icons, use the Fetcher, work with Pinia stores, or set up i18n.
  Use when the user asks about auto-imports, ConfirmDialog, or dark mode.
---

# Frontend App

Vue 3 SPA (Composition API, no SSR). Built with Vite, Tailwind CSS v4, PrimeVue/Volt.

## Tech Stack

- Vue 3.5 (Composition API only)
- Vue Router 4 (hash mode)
- Pinia 3 (state management)
- PrimeVue 4 + Volt (unstyled components)
- Tailwind CSS v4
- Vue I18n 11
- Valibot (validation)
- unplugin-auto-import + unplugin-vue-components

## Commands

- `bun run dev` - Dev server
- `bun run build` - Type check + production build
- Path alias: `@` → `./src`

## Auto-Imports

Most imports are handled automatically. Do NOT manually import these:

**Auto-imported (via unplugin-auto-import):**
- All `vue` APIs: `ref`, `computed`, `watch`, `onMounted`, etc.
- All `vue-router` APIs: `useRoute`, `useRouter`
- All `vue-i18n` APIs: `useI18n`
- All stores: `useUser`, `useSettingsStore`, etc.
- All utils: `fetcher`, date formatters, etc.

**Auto-imported (via unplugin-vue-components):**
- All Volt components from `src/volt/`
- All components from `src/components/`

**Must be imported explicitly:**
- Icons: `import IconName from '~icons/collection/icon-name'`
- PrimeVue composables: `useConfirm`, `useToast`

## API Communication

Always use the Fetcher from `src/utils/fetcher.ts`:

```typescript
// Methods: get, post, put, patch, delete, getBlob, postFormData
const data = await fetcher.get<Type>('/api/v1/tenant/${tenantId}/endpoint');
const result = await fetcher.post<ResponseType>('/api/v1/endpoint', body);
```

- Uses relative URLs (no base URL)
- No auth headers needed (JWT cookie handled by browser)
- Generic `<T>` return types
- `returnAsText` option for text responses
- Throws on error with response text

## Component Pattern

```vue
<script setup lang="ts">
// Icons must be imported explicitly
import IconPlus from '~icons/line-md/plus';

// PrimeVue composables must be imported
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';

// These are auto-imported - NO import needed:
// ref, computed, onMounted, useRoute, useRouter, useI18n
// fetcher, useUser, useSettingsStore

const { t } = useI18n();
const userStore = useUser();
const toast = useToast();

const data = ref<Type[]>([]);
const isLoading = ref(false);

const tenantId = computed(() => userStore.state.selectedTenant);

async function fetchData() {
  isLoading.value = true;
  try {
    const result = await fetcher.get<{ success: boolean; data: Type[] }>(
      `/api/v1/tenant/${tenantId.value}/items`
    );
    data.value = result.data;
  } catch (error) {
    toast.add({ severity: 'error', summary: t('Common.error'), life: 3000 });
  } finally {
    isLoading.value = false;
  }
}

onMounted(fetchData);
</script>

<template>
  <div class="p-4">
    <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-0">
      {{ $t('Items.title') }}
    </h1>
    <DataTable :value="data" :loading="isLoading">
      <!-- columns -->
    </DataTable>
  </div>
</template>
```

## Store Pattern (Pinia)

Composition API style with `defineStore`:

```typescript
export const useMyStore = defineStore('my-store', () => {
  const state = ref<MyState>({ items: [], loading: false });
  const toast = useToast();
  const { t } = useI18n();
  const userStore = useUser();

  const isLoading = computed(() => state.value.loading);

  async function fetchItems() {
    state.value.loading = true;
    try {
      const tenantId = userStore.state.selectedTenant;
      const result = await fetcher.get<{ data: Item[] }>(
        `/api/v1/tenant/${tenantId}/items`
      );
      state.value.items = result.data;
    } catch (error) {
      toast.add({ severity: 'error', summary: t('Common.error'), life: 3000 });
    } finally {
      state.value.loading = false;
    }
  }

  return { state, isLoading, fetchItems };
});
```

## Composable Pattern

```typescript
export function useFeature() {
  const data = ref<Type[]>([]);
  const isLoading = ref(false);
  const toast = useToast();
  const { t } = useI18n();
  const userStore = useUser();

  async function fetchData() {
    const tenantId = userStore.state.selectedTenant;
    isLoading.value = true;
    try {
      const result = await fetcher.get<{ data: Type[] }>(
        `/api/v1/tenant/${tenantId}/items`
      );
      data.value = result.data;
    } catch (error) {
      toast.add({ severity: 'error', summary: t('Common.error'), life: 3000 });
    } finally {
      isLoading.value = false;
    }
  }

  return { data, isLoading, fetchData };
}
```

## Routing

- Hash mode: `createWebHashHistory`
- Layout: Most routes use `DefaultLayout` as parent with `<RouterView />` children
- Auth guard: Routes with `meta: { requiresAuth: true }` redirect to `/login`
- Navigation: `goto({ name? url? })`, `getFullPath()`, `getRoute()`

## Components Library (Volt)

- PrimeVue "Volt" theme - unstyled components with Tailwind styling
- Volt components in `src/volt/` are auto-imported
- Install missing: `npx volt-vue add <component-name>`
- Docs: https://volt.primevue.org/overview
- Pass-through props via `pt` prop for custom styling

## Icons

**Never use PrimeVue icons via CSS or font-awesome by CSS!**

```typescript
import IconAccessibility from '~icons/carbon/accessibility';
import IconPlus from '~icons/line-md/plus';
```

Browse icons: https://icones.js.org/

## Styling

- Tailwind CSS v4 (utility-first)
- Global styles: `src/assets/base.css`
- Dark mode: system preference via `dark:` variants
- Color system: `surface-0..950`, `primary-50..950`
- CSS variables for PrimeVue theming in `base.css`

## i18n

- Locales: `src/locales/<lang-code>/<ComponentName>.json`
- Supported: `en`, `de`
- Detection: localStorage → browser language → `en`
- Usage: `{{ $t('ComponentName.key') }}` or `t('ComponentName.key')`
- Switch: `setLocale('de')`

## Confirm Dialog

**Never** include `<ConfirmDialog>` in template - it's global in `App.vue`.

```typescript
const confirm = useConfirm();
confirm.require({
  message: 'Are you sure?',
  header: 'Confirmation',
  rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
  acceptProps: { label: 'Confirm' },
  accept: () => { /* action */ },
  reject: () => { /* cancel */ },
});
```

## Toast

**Never** include `<Toast>` in template - it's global in `App.vue`.

```typescript
const toast = useToast();
toast.add({ severity: 'success', summary: t('Common.success'), life: 3000 });
toast.add({ severity: 'error', summary: t('Common.error'), detail: message, life: 5000 });
```

Severities: `info`, `success`, `warn`, `error`, `secondary`, `contrast`

## Naming Conventions

- Components: PascalCase (`WelcomeTile.vue`)
- Composables: `use` prefix (`useCompetitors.ts`)
- Stores: camelCase (`user.ts`, `authStore.ts`)
- Views: kebab-case (`index.vue`, `change-pwd.vue`)
- Types: camelCase (`competitors.ts`)
- Locale files: PascalCase (`Dashboard.json`, `Common.json`)

## Tenant Context

Most API calls require tenant ID from user store:
```typescript
const userStore = useUser();
const tenantId = computed(() => userStore.state.selectedTenant);
// API: `/api/v1/tenant/${tenantId.value}/...`
```

## Dev Proxy

Vite proxies `/api/v1`, `/login.html`, `/magic-login-verify.html`, `/favicon.png` to `VITE_DEV_API_URL`.
