<template>
  <div>
    <!-- trigger: shows the current icon, or a dashed placeholder when unset -->
    <button
      type="button"
      class="flex h-9 w-9 items-center justify-center rounded-md border text-surface-500 transition-colors hover:bg-surface-100 dark:hover:bg-surface-800"
      :class="
        resolved.kind === 'none'
          ? 'border-dashed border-surface-300 dark:border-surface-700'
          : 'border-surface-200 dark:border-surface-700'
      "
      :title="$t('UserTenants.pageTypes.pickIcon')"
      :aria-label="$t('UserTenants.pageTypes.pickIcon')"
      @click="toggle"
    >
      <component
        :is="resolved.component"
        v-if="resolved.kind === 'component'"
        class="h-5 w-5"
      />
      <span v-else-if="resolved.kind === 'emoji'" class="text-lg leading-none">
        {{ resolved.value }}
      </span>
      <IconPlus v-else class="h-4 w-4" />
    </button>

    <Popover ref="popoverRef">
      <div class="w-72 space-y-3">
        <!--
          Emoji field first: it is the escape hatch for anything the bundled
          allowlist below does not cover, and needs no search.
        -->
        <div class="space-y-1">
          <label
            class="text-xs font-medium text-surface-500 dark:text-surface-400"
          >
            {{ $t('UserTenants.pageTypes.emoji') }}
          </label>
          <InputText
            v-model="emojiDraft"
            class="w-full"
            :placeholder="$t('UserTenants.pageTypes.emojiPlaceholder')"
            @keydown.enter.prevent="applyEmoji"
            @blur="applyEmoji"
          />
          <span
            v-if="emojiInvalid"
            class="text-xs text-red-500 dark:text-red-400"
          >
            {{ $t('UserTenants.pageTypes.emojiInvalid') }}
          </span>
        </div>

        <div class="space-y-1">
          <label
            class="text-xs font-medium text-surface-500 dark:text-surface-400"
          >
            {{ $t('UserTenants.pageTypes.icon') }}
          </label>
          <InputText
            v-model="search"
            class="w-full"
            :placeholder="$t('UserTenants.pageTypes.iconSearch')"
          />
        </div>

        <div class="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto">
          <button
            v-for="name in filteredIcons"
            :key="name"
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded transition-colors"
            :class="
              name === modelValue
                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-200'
                : 'text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800'
            "
            :title="name"
            @click="select(name)"
          >
            <component :is="WIKI_ICONS[name]" class="h-4.5 w-4.5" />
          </button>
        </div>
        <p
          v-if="filteredIcons.length === 0"
          class="text-xs text-surface-400 dark:text-surface-500"
        >
          {{ $t('UserTenants.pageTypes.iconNoMatch') }}
        </p>

        <div
          class="flex justify-end border-t border-surface-200 pt-2 dark:border-surface-800"
        >
          <SecondaryButton
            :label="$t('UserTenants.pageTypes.clearIcon')"
            size="small"
            :disabled="!modelValue"
            @click="select(undefined)"
          />
        </div>
      </div>
    </Popover>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import IconPlus from '~icons/mdi/plus'
import {
  WIKI_ICONS,
  WIKI_ICON_NAMES,
  isEmojiIcon,
  resolveWikiIcon,
} from '@/utils/wikiIcons'

const props = defineProps<{ modelValue?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>()

const popoverRef = ref<{ toggle: (event: Event) => void } | null>(null)
const search = ref('')

const toggle = (event: Event) => popoverRef.value?.toggle(event)

const resolved = computed(() => resolveWikiIcon(props.modelValue))

const filteredIcons = computed(() => {
  const query = search.value.trim().toLowerCase()
  return query
    ? WIKI_ICON_NAMES.filter((name) => name.includes(query))
    : WIKI_ICON_NAMES
})

const select = (name: string | undefined) => {
  emit('update:modelValue', name)
}

/**
 * Emoji draft is kept separate from the model so a half-typed value never
 * lands in the config: it is committed on Enter or blur, and only when the
 * input really is an emoji. Clearing the field clears the icon.
 */
const emojiDraft = ref('')
const emojiInvalid = ref(false)

watch(
  () => props.modelValue,
  (value) => {
    emojiDraft.value = value && isEmojiIcon(value) ? value : ''
    emojiInvalid.value = false
  },
  { immediate: true },
)

const applyEmoji = () => {
  const draft = emojiDraft.value.trim()
  if (!draft) {
    emojiInvalid.value = false
    // Only clear when the current icon actually was an emoji — an emptied field
    // must not wipe an icon that was picked from the grid.
    if (props.modelValue && isEmojiIcon(props.modelValue)) select(undefined)
    return
  }
  if (!isEmojiIcon(draft)) {
    emojiInvalid.value = true
    return
  }
  emojiInvalid.value = false
  select(draft)
}
</script>
