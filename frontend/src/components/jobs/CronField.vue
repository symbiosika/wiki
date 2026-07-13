<template>
  <div class="flex flex-col gap-1.5">
    <label class="text-sm text-surface-700 dark:text-surface-300">
      {{ $t('Jobs.urlImport.cron') }}
    </label>
    <InputText
      v-model="model"
      class="w-full font-mono"
      placeholder="0 6 * * *"
      spellcheck="false"
    />
    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="preset in presets"
        :key="preset.value"
        type="button"
        class="rounded-full border px-2.5 py-1 text-xs transition-colors"
        :class="
          model.trim() === preset.value
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-surface-200 text-surface-600 hover:border-primary hover:text-primary dark:border-surface-700 dark:text-surface-300'
        "
        @click="model = preset.value"
      >
        {{ preset.label }}
      </button>
    </div>
    <p class="text-xs text-surface-400 dark:text-surface-500">
      {{ $t('Jobs.urlImport.cronHint') }}
    </p>
  </div>
</template>

<script setup lang="ts">
const model = defineModel<string>({ required: true })
const { t } = useI18n()

const presets = computed(() => [
  { label: t('Jobs.urlImport.presets.hourly'), value: '0 * * * *' },
  { label: t('Jobs.urlImport.presets.every6h'), value: '0 */6 * * *' },
  { label: t('Jobs.urlImport.presets.daily'), value: '0 6 * * *' },
  { label: t('Jobs.urlImport.presets.weekly'), value: '0 6 * * 1' },
])
</script>
