<template>
  <div class="mx-auto max-w-2xl px-4 py-5 sm:p-6">
    <ManageHeader
      :title="$t('Profile.title')"
      :back-title="$t('Profile.backTitle')"
      back-route-name="Wiki"
    />

    <!-- Desktop: tabbed navigation. Mobile: everything is stacked below. -->
    <div
      v-if="isDesktop"
      class="mb-8 flex gap-1 overflow-x-auto border-b border-surface-200 dark:border-surface-700"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="shrink-0 border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors"
        :class="
          activeTab === tab.id
            ? 'border-primary text-primary'
            : 'border-transparent text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'
        "
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Personal information -->
    <section v-show="isVisible('profile')" class="mb-10 md:mb-0">
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
            v-if="hasImage && imageSrc"
            :src="imageSrc"
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

      <!-- crop the picture (square) before it is uploaded -->
      <ImageCropperDialog
        v-model:visible="cropperVisible"
        :file="pendingImage"
        :aspect-ratio="1"
        :max-output="512"
        round
        :title="$t('Profile.cropTitle')"
        @cropped="onImageCropped"
      />

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

    <!-- Passkeys -->
    <section
      v-if="passkeys.enabled !== false"
      v-show="isVisible('security')"
      class="mb-10 md:mb-8"
    >
      <div class="mb-1 flex items-center justify-between gap-4">
        <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-0">
          {{ $t('Profile.passkeys.title') }}
        </h2>
        <Button
          v-if="passkeys.supported"
          :label="$t('Profile.passkeys.add')"
          size="small"
          @click="openAddPasskey"
        >
          <template #icon><IconKeyPlus /></template>
        </Button>
      </div>
      <p class="mb-4 text-sm text-surface-500 dark:text-surface-400">
        {{ $t('Profile.passkeys.hint') }}
      </p>

      <!-- browser cannot do WebAuthn at all -->
      <div
        v-if="!passkeys.supported"
        class="rounded-lg border border-surface-200 bg-surface-50 px-4 py-3 text-sm text-surface-600 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300"
      >
        {{ $t('Profile.passkeys.unsupported') }}
      </div>

      <template v-else>
        <!-- list -->
        <ul v-if="passkeys.passkeys.length > 0" class="flex flex-col gap-2">
          <li
            v-for="pk in passkeys.passkeys"
            :key="pk.id"
            class="flex items-center gap-3 rounded-lg border border-surface-200 px-4 py-3 dark:border-surface-700"
          >
            <IconKey
              class="h-5 w-5 shrink-0 text-surface-400"
              aria-hidden="true"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span
                  class="truncate text-sm font-medium text-surface-900 dark:text-surface-0"
                >
                  {{ passkeyLabel(pk) }}
                </span>
                <span
                  v-if="pk.credentialBackedUp"
                  class="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
                >
                  {{ $t('Profile.passkeys.synced') }}
                </span>
              </div>
              <p class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
                {{ $t('Profile.passkeys.added') }}:
                {{ formatDateTime(pk.createdAt) }}
                <template v-if="pk.lastUsedAt">
                  · {{ $t('Profile.passkeys.lastUsed') }}:
                  {{ formatDateTime(pk.lastUsedAt) }}
                </template>
                <template v-else>
                  · {{ $t('Profile.passkeys.neverUsed') }}
                </template>
              </p>
            </div>
            <SecondaryButton
              :label="$t('Common.delete')"
              size="small"
              severity="danger"
              :aria-label="$t('Common.delete')"
              @click="confirmRemove(pk)"
            >
              <template #icon><IconDelete /></template>
            </SecondaryButton>
          </li>
        </ul>

        <!-- empty state -->
        <div
          v-else-if="!passkeys.loading"
          class="rounded-lg border border-dashed border-surface-300 px-6 py-8 text-center dark:border-surface-600"
        >
          <p class="text-sm text-surface-500 dark:text-surface-400">
            {{ $t('Profile.passkeys.empty') }}
          </p>
          <Button
            :label="$t('Profile.passkeys.add')"
            size="small"
            class="mt-3"
            @click="openAddPasskey"
          >
            <template #icon><IconKeyPlus /></template>
          </Button>
        </div>
      </template>
    </section>

    <!-- add-passkey dialog (ask for an optional nickname first) -->
    <Dialog
      v-model:visible="addDialog"
      modal
      :header="$t('Profile.passkeys.addTitle')"
      class="w-[440px] max-w-[94vw]"
    >
      <div class="flex flex-col gap-2">
        <label
          for="passkey-nickname"
          class="text-sm text-surface-700 dark:text-surface-300"
        >
          {{ $t('Profile.passkeys.nickname') }}
        </label>
        <InputText
          id="passkey-nickname"
          v-model="newNickname"
          class="w-full"
          :placeholder="$t('Profile.passkeys.nicknamePlaceholder')"
          :disabled="registering"
          autofocus
          @keydown.enter="submitPasskey"
        />
        <span class="text-xs text-surface-400 dark:text-surface-500">
          {{ $t('Profile.passkeys.nicknameHint') }}
        </span>
      </div>
      <template #footer>
        <SecondaryButton
          :label="$t('Common.cancel')"
          size="small"
          :disabled="registering"
          @click="addDialog = false"
        />
        <Button
          :label="$t('Profile.passkeys.create')"
          size="small"
          :loading="registering"
          @click="submitPasskey"
        />
      </template>
    </Dialog>

    <!-- API tokens -->
    <section v-show="isVisible('security')" class="mb-10 md:mb-0">
      <div class="mb-1 flex items-center justify-between gap-4">
        <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-0">
          {{ $t('Profile.apiTokens.title') }}
        </h2>
        <Button
          :label="$t('Profile.apiTokens.add')"
          size="small"
          @click="openCreateToken"
        >
          <template #icon><IconPlus /></template>
        </Button>
      </div>
      <p class="mb-4 text-sm text-surface-500 dark:text-surface-400">
        {{ $t('Profile.apiTokens.hint') }}
      </p>

      <!-- list -->
      <ul v-if="apiTokens.tokens.length > 0" class="flex flex-col gap-2">
        <li
          v-for="tok in apiTokens.tokens"
          :key="tok.id"
          class="flex items-center gap-3 rounded-lg border border-surface-200 px-4 py-3 dark:border-surface-700"
        >
          <IconKeyChain
            class="h-5 w-5 shrink-0 text-surface-400"
            aria-hidden="true"
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="truncate text-sm font-medium text-surface-900 dark:text-surface-0"
              >
                {{ tok.name }}
              </span>
              <span
                v-if="isExpired(tok)"
                class="shrink-0 rounded bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400"
              >
                {{ $t('Profile.apiTokens.expired') }}
              </span>
            </div>
            <p class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
              {{ tenantName(tok.tenantId) }} ·
              {{ tok.scopes.length }}
              {{ $t('Profile.apiTokens.scopeCount') }} ·
              {{ $t('Profile.apiTokens.added') }}:
              {{ formatDateTime(tok.createdAt) }}
              <template v-if="tok.expiresAt">
                · {{ $t('Profile.apiTokens.expires') }}:
                {{ formatDateTime(tok.expiresAt) }}
              </template>
              <template v-else>
                · {{ $t('Profile.apiTokens.neverExpires') }}
              </template>
              <template v-if="tok.lastUsed">
                · {{ $t('Profile.apiTokens.lastUsed') }}:
                {{ formatDateTime(tok.lastUsed) }}
              </template>
            </p>
            <p
              v-if="tok.scopes.length"
              class="mt-1 truncate font-mono text-[11px] text-surface-400 dark:text-surface-500"
              :title="tok.scopes.join(' ')"
            >
              {{ tok.scopes.join(' ') }}
            </p>
          </div>
          <SecondaryButton
            :label="$t('Profile.apiTokens.revoke')"
            size="small"
            severity="danger"
            :aria-label="$t('Profile.apiTokens.revoke')"
            @click="confirmRevoke(tok)"
          >
            <template #icon><IconDelete /></template>
          </SecondaryButton>
        </li>
      </ul>

      <!-- empty state -->
      <div
        v-else-if="!apiTokens.loading"
        class="rounded-lg border border-dashed border-surface-300 px-6 py-8 text-center dark:border-surface-600"
      >
        <p class="text-sm text-surface-500 dark:text-surface-400">
          {{ $t('Profile.apiTokens.empty') }}
        </p>
        <Button
          :label="$t('Profile.apiTokens.add')"
          size="small"
          class="mt-3"
          @click="openCreateToken"
        >
          <template #icon><IconPlus /></template>
        </Button>
      </div>
    </section>

    <!-- create-token dialog -->
    <Dialog
      v-model:visible="tokenDialog"
      modal
      :header="$t('Profile.apiTokens.addTitle')"
      class="w-[640px] max-w-[94vw]"
    >
      <!-- one-time secret shown after creation -->
      <div v-if="newToken" class="flex flex-col gap-4">
        <div
          class="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950"
        >
          <span class="text-sm font-medium text-amber-800 dark:text-amber-200">
            {{ $t('Profile.apiTokens.secretTitle') }}
          </span>
          <span class="text-xs text-amber-700 dark:text-amber-300">
            {{ $t('Profile.apiTokens.secretHint') }}
          </span>
          <div class="flex items-center gap-2">
            <code
              class="grow overflow-x-auto rounded bg-white px-2 py-1 font-mono text-xs dark:bg-surface-900"
            >
              {{ newToken }}
            </code>
            <SecondaryButton
              :label="$t('Common.copy')"
              size="small"
              @click="copyToken"
            />
          </div>
        </div>
      </div>

      <!-- creation form -->
      <div v-else class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('Common.name') }}
          </label>
          <InputText
            v-model="tokenForm.name"
            class="w-full"
            :placeholder="$t('Profile.apiTokens.namePlaceholder')"
            :disabled="creating"
            autofocus
          />
        </div>

        <div v-if="app.state.tenants.length > 1" class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('Profile.apiTokens.tenant') }}
          </label>
          <Select
            v-model="tokenForm.tenantId"
            :options="app.state.tenants"
            option-label="name"
            option-value="id"
            class="w-full"
            :disabled="creating"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('Profile.apiTokens.expiry') }}
          </label>
          <Select
            v-model="tokenForm.expiresIn"
            :options="expiryOptions"
            option-label="label"
            option-value="value"
            class="w-full"
            :disabled="creating"
          />
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <label class="text-sm text-surface-700 dark:text-surface-300">
              {{ $t('Profile.apiTokens.scopes') }}
              <span class="text-surface-400 dark:text-surface-500">
                ({{ tokenForm.scopes.length }})
              </span>
            </label>
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="text-xs underline disabled:opacity-40"
                style="color: var(--p-primary-500)"
                :disabled="allScopesSelected"
                @click="selectAllScopes"
              >
                {{ $t('Profile.apiTokens.selectAll') }}
              </button>
              <button
                type="button"
                class="text-xs underline disabled:opacity-40"
                style="color: var(--p-primary-500)"
                :disabled="tokenForm.scopes.length === 0"
                @click="clearScopes"
              >
                {{ $t('Common.unselectAll') }}
              </button>
            </div>
          </div>
          <InputText
            v-model="scopeFilter"
            class="w-full"
            :placeholder="$t('Profile.apiTokens.scopeFilter')"
            :disabled="creating"
          />
          <div
            class="max-h-64 overflow-y-auto rounded-lg border border-surface-200 p-2 dark:border-surface-700"
          >
            <div
              v-for="group in filteredScopeGroups"
              :key="group.name"
              class="mb-2 last:mb-0"
            >
              <div class="mb-1 flex items-center justify-between">
                <span
                  class="text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400"
                >
                  {{ group.name }}
                </span>
                <button
                  type="button"
                  class="text-[11px] underline"
                  style="color: var(--p-primary-500)"
                  @click="toggleGroup(group)"
                >
                  {{
                    isGroupFullySelected(group)
                      ? $t('Common.unselectAll')
                      : $t('Profile.apiTokens.selectGroup')
                  }}
                </button>
              </div>
              <div class="grid grid-cols-1 gap-1 sm:grid-cols-2">
                <label
                  v-for="scope in group.scopes"
                  :key="scope"
                  class="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300"
                >
                  <Checkbox
                    v-model="tokenForm.scopes"
                    :value="scope"
                    :disabled="creating"
                  />
                  <code class="text-xs">{{ scope }}</code>
                </label>
              </div>
            </div>
            <p
              v-if="filteredScopeGroups.length === 0"
              class="px-1 py-2 text-xs text-surface-400 dark:text-surface-500"
            >
              {{ $t('Profile.apiTokens.noScopeMatch') }}
            </p>
          </div>
        </div>
      </div>

      <template #footer>
        <template v-if="newToken">
          <Button
            :label="$t('Common.close')"
            size="small"
            @click="tokenDialog = false"
          />
        </template>
        <template v-else>
          <SecondaryButton
            :label="$t('Common.cancel')"
            size="small"
            :disabled="creating"
            @click="tokenDialog = false"
          />
          <Button
            :label="$t('Profile.apiTokens.create')"
            size="small"
            :loading="creating"
            :disabled="!canCreateToken"
            @click="submitToken"
          />
        </template>
      </template>
    </Dialog>

    <!-- Appearance / theme -->
    <section v-show="isVisible('preferences')" class="mb-10 md:mb-8">
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

    <!-- Search -->
    <section v-show="isVisible('preferences')" class="md:mt-0">
      <h2
        class="mb-1 text-lg font-semibold text-surface-900 dark:text-surface-0"
      >
        {{ $t('Profile.search.title') }}
      </h2>
      <p class="mb-4 text-sm text-surface-500 dark:text-surface-400">
        {{ $t('Profile.search.hint') }}
      </p>

      <div class="flex flex-col gap-2">
        <button
          v-for="option in searchModeOptions"
          :key="option.value"
          type="button"
          class="flex items-start gap-3 rounded-lg border p-3 text-left transition-colors"
          :class="
            app.state.searchMode === option.value
              ? 'border-primary bg-primary/5'
              : 'border-surface-200 hover:bg-surface-100 dark:border-surface-700 dark:hover:bg-surface-800'
          "
          @click="selectSearchMode(option.value)"
        >
          <component
            :is="option.icon"
            class="mt-0.5 h-5 w-5 shrink-0"
            :class="
              app.state.searchMode === option.value
                ? 'text-primary'
                : 'text-surface-400'
            "
          />
          <span class="min-w-0 flex-1">
            <span
              class="block text-sm font-medium text-surface-900 dark:text-surface-0"
            >
              {{ option.label }}
            </span>
            <span class="block text-xs text-surface-500 dark:text-surface-400">
              {{ option.description }}
            </span>
          </span>
          <IconCheck
            v-if="app.state.searchMode === option.value"
            class="mt-0.5 h-5 w-5 shrink-0 text-primary"
          />
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useAuthenticatedImage } from '@/composables/useAuthenticatedImage'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { WebAuthnError } from '@simplewebauthn/browser'
import { useTheme } from '@/stores/theme'
import { usePasskeys, type Passkey } from '@/stores/passkeys'
import { useApiTokens, type ApiToken } from '@/stores/apiTokens'
import { FetcherError } from '@/utils/fetcher'
import IconCamera from '~icons/mdi/camera-outline'
import IconPlus from '~icons/mdi/plus'
import IconKeyChain from '~icons/mdi/key-chain-variant'
import IconMonitor from '~icons/mdi/monitor'
import IconWhiteBalanceSunny from '~icons/mdi/white-balance-sunny'
import IconMoonWaningCrescent from '~icons/mdi/moon-waning-crescent'
import IconCheck from '~icons/mdi/check'
import IconAutoFix from '~icons/mdi/auto-fix'
import IconTextSearch from '~icons/mdi/text-box-search-outline'
import IconBrain from '~icons/mdi/brain'
import IconKey from '~icons/mdi/key-variant'
import IconKeyPlus from '~icons/mdi/key-plus'
import IconDelete from '~icons/mdi/delete-outline'
import type { ThemePreference } from '@/utils/theme'
import type { WikiSearchMode } from '@/types/wiki'

const { t } = useI18n()
const toast = useToast()
const confirm = useConfirm()
const app = useApp()
const theme = useTheme()
const passkeys = usePasskeys()
const apiTokens = useApiTokens()

// ----- tabs (desktop) / stacked (mobile) -----------------------------------

type TabId = 'profile' | 'security' | 'preferences'
const activeTab = ref<TabId>('profile')

const tabs = computed<{ id: TabId; label: string }[]>(() => [
  { id: 'profile', label: t('Profile.tabs.profile') },
  { id: 'security', label: t('Profile.tabs.security') },
  { id: 'preferences', label: t('Profile.tabs.preferences') },
])

// Tabs only kick in on md+; on mobile every section is shown stacked.
const isDesktop = ref(false)
let tabMediaQuery: MediaQueryList | null = null
const syncIsDesktop = () => {
  isDesktop.value = tabMediaQuery?.matches ?? false
}

/** A section is visible when stacked (mobile) or when its tab is active. */
const isVisible = (tab: TabId) => !isDesktop.value || activeTab.value === tab

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const firstname = ref('')
const surname = ref('')
const saving = ref(false)
const uploadingImage = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
// picture picked but not yet cropped/uploaded
const pendingImage = ref<File | null>(null)
const cropperVisible = ref(false)
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

const searchModeOptions: {
  value: WikiSearchMode
  label: string
  description: string
  icon: unknown
}[] = [
  {
    value: 'hybrid',
    label: t('Profile.search.hybrid'),
    description: t('Profile.search.hybridHint'),
    icon: IconAutoFix,
  },
  {
    value: 'fulltext',
    label: t('Profile.search.fulltext'),
    description: t('Profile.search.fulltextHint'),
    icon: IconTextSearch,
  },
  {
    value: 'semantic',
    label: t('Profile.search.semantic'),
    description: t('Profile.search.semanticHint'),
    icon: IconBrain,
  },
]

const selectSearchMode = async (mode: WikiSearchMode) => {
  if (mode === app.state.searchMode) return
  try {
    await app.setSearchMode(mode)
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('Profile.search.saveSuccess'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Profile.search.saveFailed'),
      life: 3000,
    })
  }
}

const syncFromUser = () => {
  firstname.value = app.state.user?.firstname ?? ''
  surname.value = app.state.user?.surname ?? ''
}

onMounted(async () => {
  tabMediaQuery = window.matchMedia('(min-width: 768px)')
  syncIsDesktop()
  tabMediaQuery.addEventListener('change', syncIsDesktop)

  await app.waitForInit()
  syncFromUser()
  // best-effort: hides the section on 404 (passkeys disabled for this instance)
  passkeys.load().catch(() => {
    /* a real load failure just leaves the list empty */
  })
  apiTokens.load().catch(() => {
    /* a real load failure just leaves the list empty */
  })
})

onUnmounted(() => {
  tabMediaQuery?.removeEventListener('change', syncIsDesktop)
})

// ----- passkeys ------------------------------------------------------------

const addDialog = ref(false)
const newNickname = ref('')
const registering = ref(false)

/** Full date + time in the viewer's local timezone (UTC-aware). */
const formatDateTime = (value: string | null | undefined) =>
  parseServerDate(value)?.toLocaleString() ?? '-'

const passkeyLabel = (pk: Passkey) =>
  pk.nickname?.trim() || t('Profile.passkeys.unnamed')

const openAddPasskey = () => {
  newNickname.value = ''
  addDialog.value = true
}

/**
 * Turn any failure from the WebAuthn ceremony or the backend into a friendly,
 * localized message. These are exactly the confusing errors passkeys are
 * notorious for, so each known cause gets its own explanation instead of a
 * raw browser exception string.
 */
const describePasskeyError = (
  err: unknown,
): { detail: string; severity: 'error' | 'warn' } => {
  if (err instanceof WebAuthnError) {
    switch (err.code) {
      case 'ERROR_CEREMONY_ABORTED':
        return {
          detail: t('Profile.passkeys.errors.aborted'),
          severity: 'warn',
        }
      case 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED':
        return {
          detail: t('Profile.passkeys.errors.alreadyRegistered'),
          severity: 'warn',
        }
      case 'ERROR_INVALID_DOMAIN':
      case 'ERROR_INVALID_RP_ID':
        return {
          detail: t('Profile.passkeys.errors.domain'),
          severity: 'error',
        }
      case 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT':
      case 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT':
        return {
          detail: t('Profile.passkeys.errors.unsupportedAuthenticator'),
          severity: 'error',
        }
      default:
        return {
          detail: err.message || t('Profile.passkeys.errors.createFailed'),
          severity: 'error',
        }
    }
  }
  // Some browsers surface a bare DOMException on cancel/timeout.
  if (
    err instanceof DOMException &&
    (err.name === 'NotAllowedError' || err.name === 'AbortError')
  ) {
    return { detail: t('Profile.passkeys.errors.aborted'), severity: 'warn' }
  }
  if (err instanceof FetcherError && err.body) {
    if (/email/i.test(err.body) && /verif/i.test(err.body)) {
      return {
        detail: t('Profile.passkeys.errors.emailNotVerified'),
        severity: 'error',
      }
    }
    return { detail: err.body, severity: 'error' }
  }
  return {
    detail: t('Profile.passkeys.errors.createFailed'),
    severity: 'error',
  }
}

const submitPasskey = async () => {
  if (registering.value) return
  registering.value = true
  try {
    await passkeys.register(newNickname.value)
    addDialog.value = false
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('Profile.passkeys.created'),
      life: 3000,
    })
  } catch (err) {
    const { detail, severity } = describePasskeyError(err)
    toast.add({
      severity,
      summary:
        severity === 'warn' ? t('Profile.passkeys.title') : t('Common.error'),
      detail,
      life: severity === 'warn' ? 4000 : 6000,
    })
  } finally {
    registering.value = false
  }
}

const confirmRemove = (pk: Passkey) => {
  confirm.require({
    header: t('Profile.passkeys.deleteTitle'),
    message: t('Profile.passkeys.deleteConfirm', { name: passkeyLabel(pk) }),
    rejectProps: {
      label: t('Common.cancel'),
      severity: 'secondary',
      outlined: true,
    },
    acceptProps: { label: t('Common.delete'), severity: 'danger' },
    accept: async () => {
      try {
        await passkeys.remove(pk.id)
        toast.add({
          severity: 'success',
          summary: t('Common.success'),
          detail: t('Profile.passkeys.deleted'),
          life: 3000,
        })
      } catch (err) {
        toast.add({
          severity: 'error',
          summary: t('Common.error'),
          detail:
            err instanceof FetcherError && err.body
              ? err.body
              : t('Profile.passkeys.errors.deleteFailed'),
          life: 6000,
        })
      }
    },
  })
}

// ----- API tokens ----------------------------------------------------------

const tokenDialog = ref(false)
const creating = ref(false)
const newToken = ref<string | null>(null)
const scopeFilter = ref('')

const emptyTokenForm = () => ({
  name: '',
  tenantId: app.state.selectedTenant || app.state.tenants[0]?.id || '',
  // minutes; 0 = never expires (mapped to `undefined` on submit)
  expiresIn: 0,
  scopes: [] as string[],
})
const tokenForm = ref(emptyTokenForm())

const expiryOptions = computed(() => [
  { label: t('Profile.apiTokens.expiryNever'), value: 0 },
  { label: t('Profile.apiTokens.expiry30d'), value: 30 * 24 * 60 },
  { label: t('Profile.apiTokens.expiry90d'), value: 90 * 24 * 60 },
  { label: t('Profile.apiTokens.expiry1y'), value: 365 * 24 * 60 },
])

interface ScopeGroup {
  name: string
  scopes: string[]
}

/** Group the flat scope list by the part before the first ":" (e.g. "ai", "knowledge"). */
const scopeGroups = computed<ScopeGroup[]>(() => {
  const map = new Map<string, string[]>()
  for (const scope of apiTokens.availableScopes) {
    const group = scope.split(':')[0] || scope
    if (!map.has(group)) map.set(group, [])
    map.get(group)!.push(scope)
  }
  return [...map.entries()]
    .map(([name, scopes]) => ({ name, scopes }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

const filteredScopeGroups = computed<ScopeGroup[]>(() => {
  const q = scopeFilter.value.trim().toLowerCase()
  if (!q) return scopeGroups.value
  return scopeGroups.value
    .map((g) => ({
      name: g.name,
      scopes: g.scopes.filter((s) => s.toLowerCase().includes(q)),
    }))
    .filter((g) => g.scopes.length > 0)
})

const isGroupFullySelected = (group: ScopeGroup) =>
  group.scopes.every((s) => tokenForm.value.scopes.includes(s))

const toggleGroup = (group: ScopeGroup) => {
  if (isGroupFullySelected(group)) {
    tokenForm.value.scopes = tokenForm.value.scopes.filter(
      (s) => !group.scopes.includes(s),
    )
  } else {
    const set = new Set(tokenForm.value.scopes)
    group.scopes.forEach((s) => set.add(s))
    tokenForm.value.scopes = [...set]
  }
}

const clearScopes = () => {
  tokenForm.value.scopes = []
}

const allScopesSelected = computed(
  () =>
    apiTokens.availableScopes.length > 0 &&
    tokenForm.value.scopes.length === apiTokens.availableScopes.length,
)

const selectAllScopes = () => {
  tokenForm.value.scopes = [...apiTokens.availableScopes]
}

const canCreateToken = computed(
  () =>
    tokenForm.value.name.trim().length > 0 &&
    tokenForm.value.tenantId.length > 0 &&
    tokenForm.value.scopes.length > 0,
)

const tenantName = (id: string) =>
  app.state.tenants.find((tnt) => tnt.id === id)?.name ?? id

const isExpired = (tok: ApiToken) =>
  !!tok.expiresAt &&
  (parseServerDate(tok.expiresAt)?.getTime() ?? Infinity) < Date.now()

const openCreateToken = () => {
  tokenForm.value = emptyTokenForm()
  scopeFilter.value = ''
  newToken.value = null
  apiTokens.loadScopes().catch(() => {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Profile.apiTokens.errors.scopesFailed'),
      life: 5000,
    })
  })
  tokenDialog.value = true
}

const submitToken = async () => {
  if (!canCreateToken.value || creating.value) return
  creating.value = true
  try {
    newToken.value = await apiTokens.create({
      name: tokenForm.value.name.trim(),
      tenantId: tokenForm.value.tenantId,
      scopes: tokenForm.value.scopes,
      expiresIn: tokenForm.value.expiresIn || undefined,
    })
    // dialog stays open to show the one-time secret
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail:
        err instanceof FetcherError && err.body
          ? err.body
          : t('Profile.apiTokens.errors.createFailed'),
      life: 6000,
    })
  } finally {
    creating.value = false
  }
}

const copyToken = async () => {
  if (!newToken.value) return
  await navigator.clipboard.writeText(newToken.value)
  toast.add({ severity: 'success', summary: t('Common.copied'), life: 2000 })
}

const confirmRevoke = (tok: ApiToken) => {
  confirm.require({
    header: t('Profile.apiTokens.revokeTitle'),
    message: t('Profile.apiTokens.revokeConfirm', { name: tok.name }),
    rejectProps: {
      label: t('Common.cancel'),
      severity: 'secondary',
      outlined: true,
    },
    acceptProps: { label: t('Profile.apiTokens.revoke'), severity: 'danger' },
    accept: async () => {
      try {
        await apiTokens.revoke(tok.id)
        toast.add({
          severity: 'success',
          summary: t('Common.success'),
          detail: t('Profile.apiTokens.revoked'),
          life: 3000,
        })
      } catch (err) {
        toast.add({
          severity: 'error',
          summary: t('Common.error'),
          detail:
            err instanceof FetcherError && err.body
              ? err.body
              : t('Profile.apiTokens.errors.revokeFailed'),
          life: 6000,
        })
      }
    },
  })
}

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
// see useAuthenticatedImage: a bearer session cannot authenticate an <img src>
const imageSrc = useAuthenticatedImage(() =>
  hasImage.value ? imageUrl.value : null,
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

  // hand the picked file to the cropper; upload happens once it emits `cropped`
  pendingImage.value = file
  cropperVisible.value = true
}

const onImageCropped = async (file: File) => {
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
    pendingImage.value = null
  }
}
</script>
