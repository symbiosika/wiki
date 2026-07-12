# Project

A vue SPA without SSR.

## styling

Tailwind CSS v4 is used. The global styles are in `src/assets/base.css`.
All standard components are styled with PrimeVue's "Volt" theme in the component itself.

## dark mode

Dark mode is supported. The global styles are in `src/assets/base.css`.

## components library

All standard components are used by "Volt" powered by PrimeVue.
Volt is an open source UI component library implemented with the Unstyled PrimeVue components. Volt follows the Code Ownership model.
Look at the [PrimeVue documentation](https://volt.primevue.org/overview) for more information.

Each missing "Volt" component has to be installed by `npx volt-vue add <component-name>`.

All volt components are auto-imported in `src/components.d.ts`. This is done by unplugin-vue-components from /src/volt.

## auto-imports for methods, hooks, etc.

All auto-imports are in `src/auto-imports.d.ts`. This is done by unplugin-auto-import.

## stores

All stores are in `src/stores.d.ts`.

## i18n

I18n is supported. The global locales are in `src/locales/<lang-code>/<component-name>.json`.
The local files are segmented by component.

## icons

Never use PrimeVue icons via CSS or font-awesome icons by CSS!

Icons are used by unplugin-icons.
example: `import IconAccessibility from '~icons/carbon/accessibility`

> https://github.com/unplugin/unplugin-icons
