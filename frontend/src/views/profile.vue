<template>
  <div class="mx-auto max-w-2xl px-4 py-5 sm:p-6">
    <ManageHeader
      :title="$t('Profile.title')"
      :back-title="$t('Profile.backTitle')"
      back-route-name="Wiki"
    />

    <!-- Personal information -->
    <section class="mb-8">
      <h2
        class="mb-4 text-lg font-semibold text-surface-900 dark:text-surface-0"
      >
        {{ $t('Profile.personalInfo') }}
      </h2>

      <!-- avatar + upload -->
      <div class="mb-6 flex items-center gap-4">
        <span
          class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full text-xl font-semibold"
          :class="
            hasImage ? 'bg-transparent' : 'bg-primary text-primary-contrast'
          "
        >
          <img
            v-if="hasImage"
            :src="imageUrl"
            :alt="$t('Profile.picture')"
            class="h-full w-full object-cover"
          />
          <template v-else>{{ initials }}</template>
        </span>
        <div>
          <SecondaryButton
            :label="$t('Profile.changePicture')"
            size="small"
            :loading="uploadingImage"
            @click="fileInput?.click()"
          >
            <template #icon><IconCamera /></template>
          </SecondaryButton>
          <p class="mt-1 text-xs text-surface-500 dark:text-surface-400">
            {{ $t('Profile.uploadHint') }}
          </p>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          class="hidden"
          @change="onFileSelected"
        />
      </div>

      <!-- name fields -->
      <div class="flex flex-col gap-4">
        <div>
          <label
            for="profile-firstname"
            class="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-200"
          >
            {{ $t('Profile.firstname') }}
          </label>
          <InputText
            id="profile-firstname"
            v-model="firstname"
            class="w-full"
            :placeholder="$t('Profile.firstnamePlaceholder')"
          />
        </div>
        <div>
          <label
            for="profile-surname"
            class="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-200"
          >
            {{ $t('Profile.surname') }}
          </label>
          <InputText
            id="profile-surname"
            v-model="surname"
            class="w-full"
            :placeholder="$t('Profile.surnamePlaceholder')"
          />
        </div>
        <div>
          <label
            for="profile-email"
            class="mb-2 block text-sm font-medium text-surface-700 dark:text-surface-200"
          >
            {{ $t('Profile.email') }}
          </label>
          <InputText
            id="profile-email"
            :model-value="app.state.user?.email ?? ''"
            class="w-full"
            disabled
          />
        </div>
        <div>
          <Button
            :label="$t('Profile.save')"
            size="small"
            :loading="saving"
            :disabled="!isDirty"
            @click="saveProfile"
          />
        </div>
      </div>
    </section>

    <!-- Appearance / theme -->
    <section>
      <h2
        class="mb-1 text-lg font-semibold text-surface-900 dark:text-surface-0"
      >
        {{ $t('Profile.appearance') }}
      </h2>
      <p class="mb-4 text-sm text-surface-500 dark:text-surface-400">
        {{ $t('Profile.appearanceHint') }}
      </p>

      <div
        class="inline-flex rounded-lg border border-surface-200 p-1 dark:border-surface-700"
      >
        <button
          v-for="option in themeOptions"
          :key="option.value"
          type="button"
          class="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors"
          :class="
            theme.preference === option.value
              ? 'bg-primary text-primary-contrast'
              : 'text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800'
          "
          @click="theme.setPreference(option.value)"
        >
          <component :is="option.icon" class="h-4 w-4" />
          {{ option.label }}
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast'
import { useTheme } from '@/stores/theme'
import IconCamera from '~icons/mdi/camera-outline'
import IconMonitor from '~icons/mdi/monitor'
import IconWhiteBalanceSunny from '~icons/mdi/white-balance-sunny'
import IconMoonWaningCrescent from '~icons/mdi/moon-waning-crescent'
import type { ThemePreference } from '@/utils/theme'

const { t } = useI18n()
const toast = useToast()
const app = useApp()
const theme = useTheme()

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const firstname = ref('')
const surname = ref('')
const saving = ref(false)
const uploadingImage = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
// bumped after an upload so the browser refetches the (same-URL) image
const imageVersion = ref(0)

const themeOptions: {
  value: ThemePreference
  label: string
  icon: unknown
}[] = [
  { value: 'system', label: t('Profile.theme.system'), icon: IconMonitor },
  {
    value: 'light',
    label: t('Profile.theme.light'),
    icon: IconWhiteBalanceSunny,
  },
  {
    value: 'dark',
    label: t('Profile.theme.dark'),
    icon: IconMoonWaningCrescent,
  },
]

const syncFromUser = () => {
  firstname.value = app.state.user?.firstname ?? ''
  surname.value = app.state.user?.surname ?? ''
}

onMounted(async () => {
  await app.waitForInit()
  syncFromUser()
})

const initials = computed(() => {
  const user = app.state.user
  const first = user?.firstname?.[0] ?? user?.email?.[0] ?? '?'
  const last = user?.surname?.[0] ?? ''
  return (first + last).toUpperCase()
})

const hasImage = computed(() => Boolean(app.state.user?.profileImageName))
const imageUrl = computed(
  () => `/api/v1/user/profile-image?v=${imageVersion.value}`,
)

const isDirty = computed(
  () =>
    firstname.value.trim() !== (app.state.user?.firstname ?? '') ||
    surname.value.trim() !== (app.state.user?.surname ?? ''),
)

const saveProfile = async () => {
  saving.value = true
  try {
    await app.updateMyProfile({
      firstname: firstname.value.trim(),
      surname: surname.value.trim(),
    })
    syncFromUser()
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('Profile.saveSuccess'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Profile.errors.saveFailed'),
      life: 3000,
    })
  } finally {
    saving.value = false
  }
}

const onFileSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // reset so selecting the same file again re-triggers change
  input.value = ''
  if (!file) return

  if (file.size > MAX_IMAGE_BYTES) {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Profile.errors.imageTooLarge'),
      life: 3000,
    })
    return
  }

  uploadingImage.value = true
  try {
    await app.uploadProfileImage(file)
    imageVersion.value += 1
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('Profile.imageSuccess'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Profile.errors.imageFailed'),
      life: 3000,
    })
  } finally {
    uploadingImage.value = false
  }
}
</script>
