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
          {{ $t(`UserTenants.roles.${data.role}`, data.role) }}
        </template>
      </Column>
      <Column header="" style="width: 240px">
        <template #body="{ data }">
          <div v-if="data.id !== app.state.user?.id" class="flex justify-end gap-2">
            <SecondaryButton
              :label="$t('UserTenants.changeRole')"
              size="small"
              @click="openChangeRoleDialog(data)"
            />
            <SecondaryButton
              :label="$t('UserTenants.removeMember')"
              size="small"
              @click="openRemoveDialog(data)"
            />
          </div>
        </template>
      </Column>
    </DataTable>

    <!-- Chat agent configuration -->
    <section class="mt-8 border-t border-surface-200 pt-6 dark:border-surface-800">
      <h2 class="text-base font-semibold text-surface-900 dark:text-surface-0">
        {{ $t('Chat.config.title') }}
      </h2>
      <div class="mt-3 flex flex-col gap-1">
        <label
          for="chat-system-prompt"
          class="text-sm font-medium text-surface-700 dark:text-surface-300"
        >
          {{ $t('Chat.config.systemPrompt') }}
        </label>
        <Textarea
          id="chat-system-prompt"
          v-model="systemPrompt"
          class="w-full"
          rows="8"
          :maxlength="MAX_SYSTEM_PROMPT_CHARS"
          :placeholder="$t('Chat.config.placeholder')"
          :disabled="chatConfig.loading"
        />
        <div class="flex items-center justify-between">
          <span class="text-xs text-surface-400 dark:text-surface-500">
            {{ $t('Chat.config.systemPromptHint') }}
          </span>
          <span class="shrink-0 pl-3 text-xs text-surface-400 dark:text-surface-500">
            {{
              $t('Chat.config.charCount', {
                count: systemPrompt.length,
                max: MAX_SYSTEM_PROMPT_CHARS,
              })
            }}
          </span>
        </div>
      </div>
      <div class="mt-3 flex justify-end">
        <Button
          :label="$t('Chat.config.save')"
          size="small"
          :loading="chatConfig.saving"
          :disabled="chatConfig.loading || systemPrompt === savedSystemPrompt"
          @click="saveSystemPrompt"
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
          {{ foundUser.firstname }} {{ foundUser.surname }}
          ({{ foundUser.email }})
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
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import IconPencil from '~icons/mdi/pencil'
import IconAccountPlus from '~icons/mdi/account-plus'
import IconTrash from '~icons/mdi/trash-can-outline'
import type { FoundUser, TenantMember } from '@/types/usermanagement'
import { useChatConfig, MAX_SYSTEM_PROMPT_CHARS } from '@/stores/chatConfig'

const { t } = useI18n()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const confirm = useConfirm()
const app = useApp()
const chatConfig = useChatConfig()

const tenantId = computed(() => String(route.params.id))
const tenantName = ref('')
const members = ref<TenantMember[]>([])

const systemPrompt = ref('')
const savedSystemPrompt = ref('')

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

onMounted(async () => {
  await app.waitForInit()
  await loadTenantData()
})

const loadTenantData = async () => {
  try {
    const tenant = app.state.tenants.find((o) => o.id === tenantId.value)
    if (!tenant) {
      router.push({ name: 'Tenants', params: { tenantId: route.params.tenantId } })
      return
    }
    tenantName.value = tenant.name
    members.value = await app.getTenantMembers(tenantId.value)
    await loadChatConfig()
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.errors.loadFailed'),
      life: 3000,
    })
  }
}

// ----- chat agent config -----------------------------------------------------

const loadChatConfig = async () => {
  try {
    const config = await chatConfig.loadConfig(tenantId.value)
    systemPrompt.value = config.systemPrompt
    savedSystemPrompt.value = config.systemPrompt
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Chat.config.loadError'),
      life: 3000,
    })
  }
}

const saveSystemPrompt = async () => {
  try {
    const config = await chatConfig.saveConfig(tenantId.value, {
      systemPrompt: systemPrompt.value,
    })
    systemPrompt.value = config.systemPrompt
    savedSystemPrompt.value = config.systemPrompt
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('Chat.config.saved'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('Chat.config.saveError'),
      life: 3000,
    })
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
