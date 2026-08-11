<template>
  <div class="mx-auto max-w-4xl px-4 py-5 sm:p-6">
    <ManageHeader
      :back-title="$t('UserTenants.backTitle')"
      back-route-name="Tenants"
    >
      <template #header>
        <span>{{ tenantName }}</span>
        <button
          type="button"
          class="ml-2 rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800"
          :title="$t('UserTenants.editName')"
          @click="openEditNameDialog"
        >
          <IconPencil class="h-4 w-4" />
        </button>
      </template>
      <template #actions>
        <Button
          :label="$t('UserTenants.inviteMember')"
          size="small"
          @click="inviteDialog = true"
        >
          <template #icon><IconAccountPlus /></template>
        </Button>
        <SecondaryButton
          v-if="app.state.tenants.length > 1"
          :label="$t('UserTenants.deleteTenant')"
          size="small"
          @click="openDeleteDialog"
        >
          <template #icon><IconTrash /></template>
        </SecondaryButton>
      </template>
    </ManageHeader>

    <DataTable v-if="members.length > 0" :value="members">
      <Column field="userEmail" :header="$t('UserTenants.memberEmail')" />
      <Column field="role" :header="$t('UserTenants.memberRole')">
        <template #body="{ data }">
          <div class="flex items-center gap-1.5">
            <span>{{ $t(`UserTenants.roles.${data.role}`, data.role) }}</span>
            <button
              v-if="data.id !== app.state.user?.id"
              type="button"
              class="rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800"
              :title="$t('UserTenants.changeRole')"
              @click="openChangeRoleDialog(data)"
            >
              <IconPencil class="h-4 w-4" />
            </button>
          </div>
        </template>
      </Column>
      <Column :header="$t('UserTenants.knowledgeAccess')" style="width: 200px">
        <template #body="{ data }">
          <SelectButton
            :model-value="data.knowledgeAccess"
            :options="knowledgeAccessOptions"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            :disabled="
              data.id === app.state.user?.id || savingAccessFor === data.id
            "
            @update:model-value="
              (value: KnowledgeAccessLevel) =>
                value && changeKnowledgeAccess(data, value)
            "
          />
        </template>
      </Column>
      <Column header="" style="width: 80px">
        <template #body="{ data }">
          <div v-if="data.id !== app.state.user?.id" class="flex justify-end">
            <button
              type="button"
              class="rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-red-500 dark:hover:bg-surface-800"
              :title="$t('UserTenants.removeMember')"
              @click="openRemoveDialog(data)"
            >
              <IconTrash class="h-4 w-4" />
            </button>
          </div>
        </template>
      </Column>
    </DataTable>

    <!-- organisation logo -->
    <section class="mt-8">
      <h2
        class="mb-1 text-lg font-semibold text-surface-900 dark:text-surface-0"
      >
        {{ $t('UserTenants.logo.title') }}
      </h2>
      <p class="mb-4 text-sm text-surface-500 dark:text-surface-400">
        {{ $t('UserTenants.logo.hint') }}
      </p>

      <div class="flex items-center gap-4">
        <span
          class="flex h-16 w-32 shrink-0 items-center justify-center border border-surface-200 bg-surface-50 p-1 dark:border-surface-700 dark:bg-surface-800"
        >
          <img
            v-if="logoSrc"
            :src="logoSrc"
            :alt="$t('UserTenants.logo.title')"
            class="max-h-full max-w-full object-contain"
          />
          <IconImage v-else class="h-6 w-6 text-surface-300" />
        </span>
        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <SecondaryButton
              :label="$t('UserTenants.logo.change')"
              size="small"
              :loading="uploadingLogo"
              @click="logoInput?.click()"
            >
              <template #icon><IconImage /></template>
            </SecondaryButton>
            <SecondaryButton
              v-if="logoUrl"
              :label="$t('Common.delete')"
              size="small"
              severity="danger"
              :disabled="uploadingLogo"
              @click="removeLogo"
            >
              <template #icon><IconTrash /></template>
            </SecondaryButton>
          </div>
          <p class="text-xs text-surface-500 dark:text-surface-400">
            {{ $t('UserTenants.logo.uploadHint') }}
          </p>
        </div>
        <input
          ref="logoInput"
          type="file"
          accept="image/*"
          class="hidden"
          @change="onLogoSelected"
        />
      </div>

      <ImageCropperDialog
        v-model:visible="logoCropperVisible"
        :file="pendingLogo"
        :aspect-ratio="2"
        :max-output="600"
        fit="contain"
        :title="$t('UserTenants.logo.cropTitle')"
        @cropped="onLogoCropped"
      />
    </section>

    <!-- Branding / colors (admins & owners only) -->
    <section
      v-if="isAdmin"
      class="mt-8 rounded-lg border border-surface-200 p-4 dark:border-surface-700"
    >
      <h2 class="text-lg font-semibold">
        {{ $t('UserTenants.branding.title') }}
      </h2>
      <p class="mt-1 mb-4 text-sm text-surface-500">
        {{ $t('UserTenants.branding.description') }}
      </p>

      <div class="flex flex-col gap-5">
        <!-- primary -->
        <div class="flex flex-col gap-2">
          <label class="flex items-center gap-2 text-sm font-medium">
            <input
              v-model="branding.primaryEnabled"
              type="checkbox"
              class="accent-primary"
            />
            {{ $t('UserTenants.branding.primary') }}
          </label>
          <div class="flex items-center gap-3 pl-6">
            <input
              v-model="branding.primary"
              type="color"
              :disabled="!branding.primaryEnabled"
              class="h-9 w-12 cursor-pointer rounded border border-surface-300 disabled:opacity-40 dark:border-surface-600"
            />
            <InputText
              v-model="branding.primary"
              :disabled="!branding.primaryEnabled"
              class="w-32 font-mono"
              placeholder="#204393"
            />
          </div>
          <p class="pl-6 text-xs text-surface-400">
            {{ $t('UserTenants.branding.primaryHint') }}
          </p>
        </div>

        <!-- secondary -->
        <div class="flex flex-col gap-2">
          <label class="flex items-center gap-2 text-sm font-medium">
            <input
              v-model="branding.secondaryEnabled"
              type="checkbox"
              class="accent-primary"
            />
            {{ $t('UserTenants.branding.secondary') }}
          </label>
          <div class="flex items-center gap-3 pl-6">
            <input
              v-model="branding.secondary"
              type="color"
              :disabled="!branding.secondaryEnabled"
              class="h-9 w-12 cursor-pointer rounded border border-surface-300 disabled:opacity-40 dark:border-surface-600"
            />
            <InputText
              v-model="branding.secondary"
              :disabled="!branding.secondaryEnabled"
              class="w-32 font-mono"
              placeholder="#71717a"
            />
          </div>
          <p class="pl-6 text-xs text-surface-400">
            {{ $t('UserTenants.branding.secondaryHint') }}
          </p>
        </div>
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-2">
        <Button
          :label="$t('UserTenants.branding.save')"
          size="small"
          :loading="savingBranding"
          @click="saveBranding"
        />
        <SecondaryButton
          :label="$t('UserTenants.branding.reset')"
          size="small"
          :disabled="savingBranding"
          @click="resetBranding"
        />
      </div>
    </section>

    <!-- Invite dialog -->
    <Dialog
      v-model:visible="inviteDialog"
      modal
      :header="$t('UserTenants.inviteTitle')"
      class="w-[480px] max-w-[90vw]"
      @hide="resetInviteForm"
    >
      <div class="flex flex-col gap-4">
        <div>
          <label for="invite-email" class="mb-2 block text-sm font-medium">
            {{ $t('UserTenants.memberEmail') }}
          </label>
          <InputText
            id="invite-email"
            v-model="inviteEmail"
            class="w-full"
            :placeholder="$t('UserTenants.emailPlaceholder')"
            @keyup.enter="searchUser"
            @change="resetFoundUser"
          />
        </div>

        <Message v-if="foundUser" severity="secondary">
          {{ foundUser.firstname }} {{ foundUser.surname }} ({{
            foundUser.email
          }})
        </Message>

        <Message v-if="userNotFound" severity="info">
          {{ $t('UserTenants.userNotFoundInfo') }}
        </Message>

        <div v-if="foundUser">
          <label for="invite-role" class="mb-2 block text-sm font-medium">
            {{ $t('UserTenants.memberRole') }}
          </label>
          <Select
            id="invite-role"
            v-model="selectedRole"
            :options="roleOptions"
            option-label="label"
            option-value="value"
            class="w-full"
          />
        </div>
      </div>
      <template #footer>
        <SecondaryButton
          :label="$t('Common.cancel')"
          size="small"
          @click="inviteDialog = false"
        />
        <Button
          v-if="!foundUser && !userNotFound"
          :label="$t('UserTenants.search')"
          size="small"
          :disabled="!inviteEmail.trim()"
          @click="searchUser"
        />
        <Button
          v-if="userNotFound"
          :label="$t('UserTenants.inviteToApp')"
          size="small"
          @click="confirmInvite(inviteEmail)"
        />
        <Button
          v-if="foundUser"
          :label="$t('UserTenants.invite')"
          size="small"
          :disabled="!selectedRole"
          @click="confirmInvite(foundUser.email)"
        />
      </template>
    </Dialog>

    <!-- Edit name dialog -->
    <Dialog
      v-model:visible="editNameDialog"
      modal
      :header="$t('UserTenants.editName')"
      class="w-[420px] max-w-[90vw]"
    >
      <InputText
        v-model="editedName"
        class="w-full"
        :placeholder="$t('UserTenants.editNamePlaceholder')"
        @keyup.enter="confirmUpdateName"
      />
      <template #footer>
        <SecondaryButton
          :label="$t('Common.cancel')"
          size="small"
          @click="editNameDialog = false"
        />
        <Button
          :label="$t('UserTenants.updateName')"
          size="small"
          :disabled="!editedName.trim()"
          @click="confirmUpdateName"
        />
      </template>
    </Dialog>

    <!-- Change role dialog -->
    <Dialog
      v-model:visible="changeRoleDialog"
      modal
      :header="$t('UserTenants.changeRoleTitle')"
      class="w-[420px] max-w-[90vw]"
    >
      <div class="flex flex-col gap-4">
        <Message v-if="memberToChangeRole" severity="secondary">
          {{ memberToChangeRole.userEmail }}
        </Message>
        <Select
          v-model="selectedRoleToChange"
          :options="roleOptions"
          option-label="label"
          option-value="value"
          class="w-full"
        />
      </div>
      <template #footer>
        <SecondaryButton
          :label="$t('Common.cancel')"
          size="small"
          @click="changeRoleDialog = false"
        />
        <Button
          :label="$t('Common.confirm')"
          size="small"
          :disabled="!selectedRoleToChange"
          @click="confirmChangeRole"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { useAuthenticatedImage } from '@/composables/useAuthenticatedImage'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import IconPencil from '~icons/mdi/pencil'
import IconAccountPlus from '~icons/mdi/account-plus'
import IconTrash from '~icons/mdi/trash-can-outline'
import IconImage from '~icons/mdi/image-outline'
import type {
  FoundUser,
  KnowledgeAccessLevel,
  TenantMember,
} from '@/types/usermanagement'
import { isValidHexColor } from '@/utils/brandColor'

const { t } = useI18n()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const confirm = useConfirm()
const app = useApp()

const tenantId = computed(() => String(route.params.id))
const tenantName = ref('')
const members = ref<TenantMember[]>([])

// ----- logo ------------------------------------------------------------------

const MAX_LOGO_BYTES = 5 * 1024 * 1024
const logoInput = ref<HTMLInputElement | null>(null)
const pendingLogo = ref<File | null>(null)
const logoCropperVisible = ref(false)
const uploadingLogo = ref(false)
const logoUrl = computed(() => app.tenantLogoUrl(tenantId.value))
// see useAuthenticatedImage: a bearer session cannot authenticate an <img src>
const logoSrc = useAuthenticatedImage(() => logoUrl.value)

const inviteDialog = ref(false)
const inviteEmail = ref('')
const foundUser = ref<FoundUser | null>(null)
const userNotFound = ref(false)
const selectedRole = ref('member')

const editNameDialog = ref(false)
const editedName = ref('')

const changeRoleDialog = ref(false)
const memberToChangeRole = ref<TenantMember | null>(null)
const selectedRoleToChange = ref('')

const roleOptions = [
  { label: t('UserTenants.roles.member'), value: 'member' },
  { label: t('UserTenants.roles.admin'), value: 'admin' },
]

const knowledgeAccessOptions = [
  { label: t('UserTenants.access.read'), value: 'read' },
  { label: t('UserTenants.access.readWrite'), value: 'write' },
]

// user id of the member whose access is currently being saved (disables its switch)
const savingAccessFor = ref<string | null>(null)

// ----- branding colours ------------------------------------------------------

const DEFAULT_PRIMARY = '#204393'
const DEFAULT_SECONDARY = '#71717a'

const branding = reactive({
  primaryEnabled: false,
  primary: DEFAULT_PRIMARY,
  secondaryEnabled: false,
  secondary: DEFAULT_SECONDARY,
})
const savingBranding = ref(false)

/** Only tenant admins/owners may edit branding (backend enforces this too). */
const isAdmin = computed(() => {
  const me = members.value.find((m) => m.id === app.state.user?.id)
  return me?.role === 'admin' || me?.role === 'owner'
})

onMounted(async () => {
  await app.waitForInit()
  await loadTenantData()
  await loadBranding()
  app.loadTenantLogoInfo(tenantId.value)
})

// ----- logo ------------------------------------------------------------------

const onLogoSelected = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // let the same file re-trigger change
  if (!file) return
  if (file.size > MAX_LOGO_BYTES) {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.logo.errors.tooLarge'),
      life: 3000,
    })
    return
  }
  pendingLogo.value = file
  logoCropperVisible.value = true
}

const onLogoCropped = async (file: File) => {
  uploadingLogo.value = true
  try {
    await app.uploadTenantLogo(tenantId.value, file)
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTenants.logo.success'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.logo.errors.uploadFailed'),
      life: 3000,
    })
  } finally {
    uploadingLogo.value = false
    pendingLogo.value = null
  }
}

const removeLogo = () => {
  confirm.require({
    header: t('UserTenants.logo.deleteTitle'),
    message: t('UserTenants.logo.deleteConfirm'),
    rejectProps: { label: t('Common.cancel') },
    acceptProps: { label: t('Common.delete'), severity: 'danger' },
    accept: async () => {
      try {
        await app.deleteTenantLogo(tenantId.value)
        toast.add({
          severity: 'success',
          summary: t('Common.success'),
          detail: t('UserTenants.logo.deleteSuccess'),
          life: 3000,
        })
      } catch {
        toast.add({
          severity: 'error',
          summary: t('Common.error'),
          detail: t('UserTenants.logo.errors.deleteFailed'),
          life: 3000,
        })
      }
    },
  })
}

const loadTenantData = async () => {
  try {
    const tenant = app.state.tenants.find((o) => o.id === tenantId.value)
    if (!tenant) {
      router.push({
        name: 'Tenants',
        params: { tenantId: route.params.tenantId },
      })
      return
    }
    tenantName.value = tenant.name
    members.value = await app.getTenantMembers(tenantId.value)
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.errors.loadFailed'),
      life: 3000,
    })
  }
}

const loadBranding = async () => {
  try {
    const colors = await app.getBranding(tenantId.value)
    if (colors.primary) {
      branding.primaryEnabled = true
      branding.primary = colors.primary
    }
    if (colors.secondary) {
      branding.secondaryEnabled = true
      branding.secondary = colors.secondary
    }
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.errors.brandingLoadFailed'),
      life: 3000,
    })
  }
}

const saveBranding = async () => {
  if (branding.primaryEnabled && !isValidHexColor(branding.primary)) {
    toast.add({
      severity: 'warn',
      summary: t('Common.error'),
      detail: t('UserTenants.branding.invalidColor'),
      life: 3000,
    })
    return
  }
  if (branding.secondaryEnabled && !isValidHexColor(branding.secondary)) {
    toast.add({
      severity: 'warn',
      summary: t('Common.error'),
      detail: t('UserTenants.branding.invalidColor'),
      life: 3000,
    })
    return
  }
  savingBranding.value = true
  try {
    await app.saveBranding(tenantId.value, {
      primary: branding.primaryEnabled ? branding.primary : null,
      secondary: branding.secondaryEnabled ? branding.secondary : null,
    })
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTenants.branding.saved'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.errors.brandingSaveFailed'),
      life: 3000,
    })
  } finally {
    savingBranding.value = false
  }
}

const resetBranding = async () => {
  savingBranding.value = true
  try {
    await app.saveBranding(tenantId.value, { primary: null, secondary: null })
    branding.primaryEnabled = false
    branding.secondaryEnabled = false
    branding.primary = DEFAULT_PRIMARY
    branding.secondary = DEFAULT_SECONDARY
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTenants.branding.resetDone'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.errors.brandingSaveFailed'),
      life: 3000,
    })
  } finally {
    savingBranding.value = false
  }
}

// ----- delete tenant ---------------------------------------------------------

const openDeleteDialog = () => {
  confirm.require({
    message: t('UserTenants.deleteConfirm'),
    header: t('UserTenants.deleteTitle'),
    rejectProps: { label: t('Common.cancel') },
    acceptProps: { label: t('Common.delete'), severity: 'danger' },
    accept: async () => {
      try {
        await app.deleteTenant(tenantId.value)
        toast.add({
          severity: 'success',
          summary: t('Common.success'),
          detail: t('UserTenants.deleteSuccess'),
          life: 3000,
        })
        const next =
          String(route.params.tenantId) === tenantId.value
            ? app.state.tenants[0]?.id
            : String(route.params.tenantId)
        if (next) {
          router.push({ name: 'Tenants', params: { tenantId: next } })
        } else {
          router.push({ name: 'Home' })
        }
      } catch {
        toast.add({
          severity: 'error',
          summary: t('Common.error'),
          detail: t('UserTenants.errors.deleteFailed'),
          life: 3000,
        })
      }
    },
  })
}

// ----- members ---------------------------------------------------------------

const openRemoveDialog = (member: TenantMember) => {
  confirm.require({
    message: t('UserTenants.removeMemberConfirm', { email: member.userEmail }),
    header: t('UserTenants.removeMemberTitle'),
    rejectProps: { label: t('Common.cancel') },
    acceptProps: { label: t('UserTenants.removeMember'), severity: 'danger' },
    accept: async () => {
      try {
        await app.removeTenantMember(tenantId.value, member.id)
        await loadTenantData()
        toast.add({
          severity: 'success',
          summary: t('Common.success'),
          detail: t('UserTenants.removeMemberSuccess'),
          life: 3000,
        })
      } catch {
        toast.add({
          severity: 'error',
          summary: t('Common.error'),
          detail: t('UserTenants.errors.removeMemberFailed'),
          life: 3000,
        })
      }
    },
  })
}

const openChangeRoleDialog = (member: TenantMember) => {
  memberToChangeRole.value = member
  selectedRoleToChange.value = member.role
  changeRoleDialog.value = true
}

const confirmChangeRole = async () => {
  if (!memberToChangeRole.value || !selectedRoleToChange.value) return
  try {
    await app.updateTenantMemberRole(
      tenantId.value,
      memberToChangeRole.value.id,
      selectedRoleToChange.value,
    )
    await loadTenantData()
    changeRoleDialog.value = false
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTenants.changeRoleSuccess'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.errors.changeRoleFailed'),
      life: 3000,
    })
  }
}

// ----- knowledge access ------------------------------------------------------

const changeKnowledgeAccess = async (
  member: TenantMember,
  value: KnowledgeAccessLevel,
) => {
  if (member.knowledgeAccess === value) return
  const previous = member.knowledgeAccess
  member.knowledgeAccess = value // optimistic update
  savingAccessFor.value = member.id
  try {
    await app.updateTenantMemberKnowledgeAccess(
      tenantId.value,
      member.id,
      value,
    )
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTenants.accessSuccess'),
      life: 3000,
    })
  } catch {
    member.knowledgeAccess = previous // revert on failure
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.errors.updateAccessFailed'),
      life: 3000,
    })
  } finally {
    savingAccessFor.value = null
  }
}

// ----- invite ---------------------------------------------------------------

const resetInviteForm = () => {
  inviteEmail.value = ''
  foundUser.value = null
  userNotFound.value = false
  selectedRole.value = 'member'
}

const resetFoundUser = () => {
  foundUser.value = null
  userNotFound.value = false
  selectedRole.value = 'member'
}

const searchUser = async () => {
  if (!inviteEmail.value.trim()) return
  try {
    foundUser.value = await app.searchUserByEmail(inviteEmail.value.trim())
    userNotFound.value = false
  } catch {
    foundUser.value = null
    userNotFound.value = true
  }
}

const confirmInvite = async (email: string) => {
  try {
    await app.inviteTenantMember(tenantId.value, email, selectedRole.value)
    await loadTenantData()
    inviteDialog.value = false
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTenants.inviteSuccess'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.errors.inviteFailed'),
      life: 3000,
    })
  }
}

// ----- name -----------------------------------------------------------------

const openEditNameDialog = () => {
  editedName.value = tenantName.value
  editNameDialog.value = true
}

const confirmUpdateName = async () => {
  if (!editedName.value.trim()) return
  try {
    await app.updateTenantName(tenantId.value, editedName.value.trim())
    tenantName.value = editedName.value.trim()
    editNameDialog.value = false
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTenants.updateSuccess'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.errors.updateNameFailed'),
      life: 3000,
    })
  }
}
</script>
