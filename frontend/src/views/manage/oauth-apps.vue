<template>
  <div class="mx-auto max-w-4xl px-4 py-5 sm:p-6">
    <ManageHeader :title="$t('OAuthApps.title')">
      <template #actions>
        <Button :label="$t('OAuthApps.add')" size="small" @click="openCreate">
          <template #icon><IconPlus /></template>
        </Button>
      </template>
    </ManageHeader>

    <ManageTabs />

    <p class="mb-4 text-sm text-surface-500 dark:text-surface-400">
      {{ $t('OAuthApps.intro') }}
    </p>

    <!-- list -->
    <DataTable
      v-if="!store.loading && store.clients.length > 0"
      :value="store.clients"
      class="cursor-pointer"
      @row-click="openEdit"
    >
      <Column :header="$t('OAuthApps.name')">
        <template #body="{ data }">
          <div class="flex items-center gap-2">
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              :class="
                data.disabledAt
                  ? 'bg-surface-300 dark:bg-surface-600'
                  : 'bg-emerald-500'
              "
              :title="
                data.disabledAt
                  ? $t('OAuthApps.statusDisabled')
                  : $t('OAuthApps.statusActive')
              "
            />
            <span class="font-medium text-surface-900 dark:text-surface-0">
              {{ data.clientName }}
            </span>
          </div>
        </template>
      </Column>
      <Column :header="$t('OAuthApps.clientId')">
        <template #body="{ data }">
          <code
            class="text-xs text-surface-600 dark:text-surface-300"
            :title="data.clientId"
          >
            {{ data.clientId }}
          </code>
        </template>
      </Column>
      <Column :header="$t('OAuthApps.type')">
        <template #body="{ data }">
          <span class="text-sm text-surface-600 dark:text-surface-300">
            {{
              data.clientType === 'confidential'
                ? $t('OAuthApps.typeConfidential')
                : $t('OAuthApps.typePublic')
            }}
          </span>
        </template>
      </Column>
      <Column :header="$t('OAuthApps.scopes')">
        <template #body="{ data }">
          <span
            class="block max-w-64 truncate text-xs text-surface-500 dark:text-surface-400"
            :title="(data.scopes ?? []).join(' ')"
          >
            {{ (data.scopes ?? []).join(' ') || '—' }}
          </span>
        </template>
      </Column>
    </DataTable>

    <div
      v-else-if="!store.loading"
      class="rounded-lg border border-dashed border-surface-300 px-6 py-10 text-center dark:border-surface-600"
    >
      <p class="text-sm text-surface-500 dark:text-surface-400">
        {{ $t('OAuthApps.empty') }}
      </p>
      <Button
        :label="$t('OAuthApps.add')"
        size="small"
        class="mt-3"
        @click="openCreate"
      />
    </div>

    <!-- create / edit dialog -->
    <Dialog
      v-model:visible="dialog"
      modal
      :header="editing ? $t('OAuthApps.editTitle') : $t('OAuthApps.createTitle')"
      class="w-[640px] max-w-[94vw]"
    >
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('OAuthApps.name') }}
          </label>
          <InputText
            v-model="form.clientName"
            class="w-full"
            :placeholder="$t('OAuthApps.namePlaceholder')"
            autofocus
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('OAuthApps.redirectUris') }}
          </label>
          <Textarea
            v-model="redirectUrisInput"
            class="w-full font-mono text-xs"
            rows="3"
            :placeholder="$t('OAuthApps.redirectUrisPlaceholder')"
          />
          <span class="text-xs text-surface-400 dark:text-surface-500">
            {{ $t('OAuthApps.redirectUrisHint') }}
          </span>
        </div>

        <div v-if="!editing" class="flex flex-col gap-1">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('OAuthApps.type') }}
          </label>
          <Select
            v-model="form.clientType"
            :options="typeOptions"
            option-label="label"
            option-value="value"
            class="w-full"
          />
          <span class="text-xs text-surface-400 dark:text-surface-500">
            {{ $t('OAuthApps.typeHint') }}
          </span>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('OAuthApps.scopes') }}
          </label>
          <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <label
              v-for="scope in knownScopes"
              :key="scope"
              class="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300"
            >
              <Checkbox v-model="form.scopes" :value="scope" />
              <code class="text-xs">{{ scope }}</code>
            </label>
          </div>
        </div>

        <label
          v-if="editing"
          class="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300"
        >
          <Checkbox v-model="form.disabled" binary />
          {{ $t('OAuthApps.disabledLabel') }}
        </label>

        <!-- one-time secret display -->
        <div
          v-if="newSecret"
          class="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950"
        >
          <span class="text-sm font-medium text-amber-800 dark:text-amber-200">
            {{ $t('OAuthApps.secretTitle') }}
          </span>
          <span class="text-xs text-amber-700 dark:text-amber-300">
            {{ $t('OAuthApps.secretHint') }}
          </span>
          <div class="flex items-center gap-2">
            <code
              class="grow overflow-x-auto rounded bg-white px-2 py-1 text-xs dark:bg-surface-900"
            >
              {{ newSecret }}
            </code>
            <SecondaryButton
              :label="$t('Common.copy')"
              size="small"
              @click="copySecret"
            />
          </div>
        </div>

        <!-- rotate secret (saved confidential clients only) -->
        <div
          v-if="editing && editingClient?.clientType === 'confidential'"
          class="flex items-center justify-between rounded-lg border border-surface-200 p-3 dark:border-surface-700"
        >
          <span class="text-sm text-surface-700 dark:text-surface-300">
            {{ $t('OAuthApps.rotateSecretLabel') }}
          </span>
          <SecondaryButton
            :label="$t('OAuthApps.rotateSecret')"
            size="small"
            :disabled="saving"
            @click="rotateSecret"
          />
        </div>
      </div>

      <template #footer>
        <SecondaryButton
          v-if="editing"
          :label="$t('Common.delete')"
          size="small"
          severity="danger"
          class="mr-auto"
          @click="confirmDelete"
        />
        <SecondaryButton
          :label="$t('Common.cancel')"
          size="small"
          @click="dialog = false"
        />
        <Button
          :label="editing ? $t('Common.save') : $t('Common.create')"
          size="small"
          :disabled="!canSave || saving"
          @click="save"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import IconPlus from '~icons/mdi/plus'
import ManageHeader from '@/components/manage/ManageHeader.vue'
import ManageTabs from '@/components/manage/ManageTabs.vue'
import { useOAuthClients } from '@/stores/oauthClients'
import { FetcherError } from '@/utils/fetcher'
import type { OAuthClient } from '@/types/oauthClients'

const route = useRoute()
const { t } = useI18n()
const toast = useToast()
const confirm = useConfirm()
const store = useOAuthClients()

const tenantId = computed(() => String(route.params.tenantId))

watch(
  tenantId,
  (id) => {
    if (id) store.loadClients(id)
  },
  { immediate: true },
)

// Scopes that make sense for wiki clients (MCP chat apps, integrations).
const knownScopes = [
  'openid',
  'profile',
  'email',
  'knowledge:read',
  'knowledge:write',
  'knowledge-manage:read',
  'knowledge-manage:write',
  'user:read',
]

const typeOptions = computed(() => [
  { label: t('OAuthApps.typePublic'), value: 'public' },
  { label: t('OAuthApps.typeConfidential'), value: 'confidential' },
])

// ----- create / edit --------------------------------------------------------

const dialog = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const editing = computed(() => editingId.value !== null)
const editingClient = computed<OAuthClient | undefined>(() =>
  store.clients.find((c) => c.id === editingId.value),
)
const newSecret = ref<string | null>(null)

const emptyForm = () => ({
  clientName: '',
  clientType: 'public' as 'public' | 'confidential',
  scopes: [
    'openid',
    'profile',
    'email',
    'knowledge:read',
    'knowledge:write',
  ] as string[],
  disabled: false,
})
const form = ref(emptyForm())
const redirectUrisInput = ref('')

const parsedRedirectUris = computed(() =>
  redirectUrisInput.value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean),
)

const canSave = computed(
  () =>
    form.value.clientName.trim().length > 0 &&
    parsedRedirectUris.value.length > 0,
)

const openCreate = () => {
  editingId.value = null
  form.value = emptyForm()
  redirectUrisInput.value = ''
  newSecret.value = null
  dialog.value = true
}

const openEdit = (event: { data: OAuthClient }) => {
  const c = event.data
  editingId.value = c.id
  form.value = {
    clientName: c.clientName,
    clientType: c.clientType,
    scopes: [...(c.scopes ?? [])],
    disabled: !!c.disabledAt,
  }
  redirectUrisInput.value = (c.redirectUris ?? []).join('\n')
  newSecret.value = null
  dialog.value = true
}

const showError = (error: unknown, fallback: string) => {
  const detail =
    error instanceof FetcherError && error.body ? error.body : fallback
  toast.add({ severity: 'error', summary: t('Common.error'), detail, life: 6000 })
}

const save = async () => {
  if (!canSave.value) return
  saving.value = true
  try {
    if (editingId.value) {
      await store.updateClient(tenantId.value, editingId.value, {
        clientName: form.value.clientName.trim(),
        redirectUris: parsedRedirectUris.value,
        scopes: form.value.scopes,
        disabled: form.value.disabled,
      })
      dialog.value = false
    } else {
      const created = await store.createClient(tenantId.value, {
        clientName: form.value.clientName.trim(),
        redirectUris: parsedRedirectUris.value,
        scopes: form.value.scopes,
        clientType: form.value.clientType,
      })
      if (created.clientSecret) {
        // keep the dialog open so the admin can copy the one-time secret
        newSecret.value = created.clientSecret
        editingId.value =
          store.clients.find((c) => c.clientId === created.clientId)?.id ?? null
      } else {
        dialog.value = false
      }
    }
    toast.add({ severity: 'success', summary: t('Common.success'), life: 3000 })
  } catch (error) {
    showError(error, t('OAuthApps.saveError'))
  } finally {
    saving.value = false
  }
}

const rotateSecret = async () => {
  if (!editingId.value) return
  saving.value = true
  try {
    newSecret.value = await store.rotateSecret(tenantId.value, editingId.value)
  } catch (error) {
    showError(error, t('OAuthApps.rotateError'))
  } finally {
    saving.value = false
  }
}

const copySecret = async () => {
  if (!newSecret.value) return
  await navigator.clipboard.writeText(newSecret.value)
  toast.add({ severity: 'success', summary: t('Common.copied'), life: 2000 })
}

const confirmDelete = () => {
  if (!editingId.value) return
  const id = editingId.value
  confirm.require({
    message: t('OAuthApps.deleteConfirm'),
    header: t('OAuthApps.deleteTitle'),
    rejectProps: {
      label: t('Common.cancel'),
      severity: 'secondary',
      outlined: true,
    },
    acceptProps: { label: t('Common.delete'), severity: 'danger' },
    accept: async () => {
      try {
        await store.deleteClient(tenantId.value, id)
        dialog.value = false
        toast.add({
          severity: 'success',
          summary: t('Common.success'),
          life: 3000,
        })
      } catch (error) {
        showError(error, t('OAuthApps.deleteError'))
      }
    },
  })
}
</script>
