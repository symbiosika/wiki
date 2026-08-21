<template>
  <div class="mx-auto max-w-4xl px-4 py-5 sm:p-6">
    <ManageHeader
      :back-title="$t('UserTeams.backTitle')"
      back-route-name="Teams"
    >
      <template #header>
        <span>{{ teamName }}</span>
        <button
          type="button"
          class="ml-2 rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800"
          :title="$t('UserTeams.editName')"
          @click="openEditNameDialog"
        >
          <IconPencil class="h-4 w-4" />
        </button>
      </template>
      <template #actions>
        <Button
          :label="$t('UserTeams.inviteMember')"
          size="small"
          @click="inviteDialog = true"
        >
          <template #icon><IconAccountPlus /></template>
        </Button>
        <SecondaryButton
          :label="$t('UserTeams.deleteTeam')"
          size="small"
          @click="openDeleteDialog"
        >
          <template #icon><IconTrash /></template>
        </SecondaryButton>
      </template>
    </ManageHeader>

    <!-- Team settings -->
    <div
      class="mb-6 rounded-lg border border-surface-200 p-4 dark:border-surface-700"
    >
      <h3 class="mb-3 text-sm font-medium">
        {{ $t('UserTeams.settingsTitle') }}
      </h3>
      <label
        class="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300"
        :class="{ 'cursor-not-allowed opacity-60': !isCurrentUserAdmin }"
      >
        <Checkbox
          v-model="addNewUsersByDefault"
          binary
          :disabled="!isCurrentUserAdmin || savingSettings"
          @change="confirmUpdateAddNewUsersByDefault"
        />
        {{ $t('UserTeams.addNewUsersByDefault') }}
      </label>
      <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">
        {{ $t('UserTeams.addNewUsersByDefaultHint') }}
      </p>
    </div>

    <DataTable v-if="members.length > 0" :value="members">
      <Column field="userEmail" :header="$t('UserTeams.memberEmail')" />
      <Column field="role" :header="$t('UserTeams.memberRole')">
        <template #body="{ data }">
          <div class="flex items-center gap-1.5">
            <span>{{ $t(`UserTeams.roles.${data.role}`, data.role) }}</span>
            <button
              v-if="data.userId !== app.state.user?.id"
              type="button"
              class="rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800"
              :title="$t('UserTeams.changeRole')"
              @click="openChangeRoleDialog(data)"
            >
              <IconPencil class="h-4 w-4" />
            </button>
          </div>
        </template>
      </Column>
      <Column :header="$t('UserTeams.knowledgeAccess')" style="width: 200px">
        <template #body="{ data }">
          <SelectButton
            :model-value="data.knowledgeAccess"
            :options="knowledgeAccessOptions"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            :disabled="
              !isCurrentUserAdmin ||
              data.userId === app.state.user?.id ||
              savingAccessFor === data.userId
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
          <div
            v-if="data.userId !== app.state.user?.id"
            class="flex justify-end"
          >
            <button
              type="button"
              class="rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-red-500 dark:hover:bg-surface-800"
              :title="$t('UserTeams.removeMember')"
              @click="openRemoveDialog(data)"
            >
              <IconTrash class="h-4 w-4" />
            </button>
          </div>
        </template>
      </Column>
    </DataTable>

    <!-- Invite dialog -->
    <Dialog
      v-model:visible="inviteDialog"
      modal
      :header="$t('UserTeams.inviteTitle')"
      class="w-[480px] max-w-[90vw]"
      @hide="resetInviteForm"
    >
      <div class="flex flex-col gap-4">
        <div>
          <label for="team-invite-email" class="mb-2 block text-sm font-medium">
            {{ $t('UserTeams.memberEmail') }}
          </label>
          <InputText
            id="team-invite-email"
            v-model="inviteEmail"
            class="w-full"
            :placeholder="$t('UserTeams.emailPlaceholder')"
            @keyup.enter="searchUser"
            @change="foundUser = null"
          />
        </div>

        <Message v-if="foundUser" severity="secondary">
          {{ foundUser.firstname }} {{ foundUser.surname }} ({{
            foundUser.email
          }})
        </Message>

        <div v-if="foundUser">
          <label for="team-invite-role" class="mb-2 block text-sm font-medium">
            {{ $t('UserTeams.memberRole') }}
          </label>
          <Select
            id="team-invite-role"
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
          v-if="!foundUser"
          :label="$t('UserTeams.search')"
          size="small"
          :disabled="!inviteEmail.trim()"
          @click="searchUser"
        />
        <Button
          v-else
          :label="$t('UserTeams.invite')"
          size="small"
          :disabled="!selectedRole"
          @click="confirmInvite"
        />
      </template>
    </Dialog>

    <!-- Edit name dialog -->
    <Dialog
      v-model:visible="editNameDialog"
      modal
      :header="$t('UserTeams.editName')"
      class="w-[420px] max-w-[90vw]"
    >
      <InputText
        v-model="editedName"
        class="w-full"
        :placeholder="$t('UserTeams.editNamePlaceholder')"
        @keyup.enter="confirmUpdateName"
      />
      <template #footer>
        <SecondaryButton
          :label="$t('Common.cancel')"
          size="small"
          @click="editNameDialog = false"
        />
        <Button
          :label="$t('UserTeams.updateName')"
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
      :header="$t('UserTeams.changeRoleTitle')"
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
import type {
  FoundUser,
  KnowledgeAccessLevel,
  TeamMember,
} from '@/types/usermanagement'

const { t } = useI18n()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const confirm = useConfirm()
const app = useApp()
const wiki = useWiki()

const teamId = computed(() => String(route.params.teamId))
const teamName = ref('')
const members = ref<TeamMember[]>([])

const addNewUsersByDefault = ref(false)
const savingSettings = ref(false)

// Only team admins may change team settings (the backend enforces this too).
const isCurrentUserAdmin = computed(() =>
  members.value.some(
    (member) => member.userId === app.state.user?.id && member.role === 'admin',
  ),
)

/**
 * Toast detail for a failed request.
 *
 * The team endpoints answer a user who is not an admin of the team with 403.
 * That is a permission problem, not a broken request, so it gets its own
 * message instead of the generic "failed to …".
 */
const errorDetail = (err: unknown, fallbackKey: string) =>
  err instanceof FetcherError && err.status === 403
    ? t('UserTeams.errors.notTeamAdmin')
    : t(fallbackKey)

const inviteDialog = ref(false)
const inviteEmail = ref('')
const foundUser = ref<FoundUser | null>(null)
const selectedRole = ref('member')

const editNameDialog = ref(false)
const editedName = ref('')

const changeRoleDialog = ref(false)
const memberToChangeRole = ref<TeamMember | null>(null)
const selectedRoleToChange = ref('')

const roleOptions = [
  { label: t('UserTeams.roles.member'), value: 'member' },
  { label: t('UserTeams.roles.admin'), value: 'admin' },
]

const knowledgeAccessOptions = [
  { label: t('UserTeams.access.read'), value: 'read' },
  { label: t('UserTeams.access.readWrite'), value: 'write' },
]

// userId of the member whose access is currently being saved (disables its switch)
const savingAccessFor = ref<string | null>(null)

onMounted(async () => {
  await app.waitForInit()
  await app.getTeams()
  await loadTeamData()
})

const loadTeamData = async () => {
  try {
    const team = app.state.teams.find((entry) => entry.id === teamId.value)
    if (!team) {
      router.push({
        name: 'Teams',
        params: { tenantId: route.params.tenantId },
      })
      return
    }
    teamName.value = team.name
    members.value = (await app.getTeamMembers(teamId.value)) || []
    const details = await app.getTeam(teamId.value)
    addNewUsersByDefault.value = details?.addNewUsersByDefault ?? false
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTeams.errors.loadFailed'),
      life: 3000,
    })
  }
}

// ----- delete team ------------------------------------------------------------

const openDeleteDialog = () => {
  confirm.require({
    message: t('UserTeams.deleteConfirm'),
    header: t('UserTeams.deleteTitle'),
    rejectProps: { label: t('Common.cancel') },
    acceptProps: { label: t('Common.delete'), severity: 'danger' },
    accept: async () => {
      try {
        await app.deleteTeam(teamId.value)
        wiki.loadTree(String(route.params.tenantId))
        toast.add({
          severity: 'success',
          summary: t('Common.success'),
          detail: t('UserTeams.deleteSuccess'),
          life: 3000,
        })
        router.push({
          name: 'Teams',
          params: { tenantId: route.params.tenantId },
        })
      } catch (err) {
        toast.add({
          severity: 'error',
          summary: t('Common.error'),
          detail: errorDetail(err, 'UserTeams.errors.deleteFailed'),
          life: 3000,
        })
      }
    },
  })
}

// ----- members ----------------------------------------------------------------

const openRemoveDialog = (member: TeamMember) => {
  confirm.require({
    message: t('UserTeams.removeMemberConfirm', { email: member.userEmail }),
    header: t('UserTeams.removeMemberTitle'),
    rejectProps: { label: t('Common.cancel') },
    acceptProps: { label: t('UserTeams.removeMember'), severity: 'danger' },
    accept: async () => {
      try {
        await app.removeTeamMember(teamId.value, member.userId)
        await loadTeamData()
        toast.add({
          severity: 'success',
          summary: t('Common.success'),
          detail: t('UserTeams.removeMemberSuccess'),
          life: 3000,
        })
      } catch (err) {
        toast.add({
          severity: 'error',
          summary: t('Common.error'),
          detail: errorDetail(err, 'UserTeams.errors.removeMemberFailed'),
          life: 3000,
        })
      }
    },
  })
}

const openChangeRoleDialog = (member: TeamMember) => {
  memberToChangeRole.value = member
  selectedRoleToChange.value = member.role
  changeRoleDialog.value = true
}

const confirmChangeRole = async () => {
  if (!memberToChangeRole.value || !selectedRoleToChange.value) return
  try {
    await app.updateTeamMemberRole(
      teamId.value,
      memberToChangeRole.value.userId,
      selectedRoleToChange.value,
    )
    await loadTeamData()
    changeRoleDialog.value = false
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTeams.changeRoleSuccess'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: errorDetail(err, 'UserTeams.errors.changeRoleFailed'),
      life: 3000,
    })
  }
}

// ----- knowledge access -------------------------------------------------------

const changeKnowledgeAccess = async (
  member: TeamMember,
  value: KnowledgeAccessLevel,
) => {
  if (member.knowledgeAccess === value) return
  const previous = member.knowledgeAccess
  member.knowledgeAccess = value // optimistic update
  savingAccessFor.value = member.userId
  try {
    await app.updateTeamMemberKnowledgeAccess(
      teamId.value,
      member.userId,
      value,
    )
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTeams.accessSuccess'),
      life: 3000,
    })
  } catch (err) {
    member.knowledgeAccess = previous // revert on failure
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: errorDetail(err, 'UserTeams.errors.updateAccessFailed'),
      life: 3000,
    })
  } finally {
    savingAccessFor.value = null
  }
}

// ----- invite -----------------------------------------------------------------

const resetInviteForm = () => {
  inviteEmail.value = ''
  foundUser.value = null
  selectedRole.value = 'member'
}

const searchUser = async () => {
  if (!inviteEmail.value.trim()) return
  try {
    foundUser.value = await app.searchUserInTenantByEmail(
      inviteEmail.value.trim(),
    )
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTeams.errors.userNotFound'),
      life: 3000,
    })
  }
}

const confirmInvite = async () => {
  if (!foundUser.value || !selectedRole.value) return
  try {
    await app.addTeamMember(
      teamId.value,
      foundUser.value.id,
      selectedRole.value,
    )
    await loadTeamData()
    inviteDialog.value = false
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTeams.inviteSuccess'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: errorDetail(err, 'UserTeams.errors.inviteFailed'),
      life: 3000,
    })
  }
}

// ----- settings ---------------------------------------------------------------

const confirmUpdateAddNewUsersByDefault = async () => {
  savingSettings.value = true
  try {
    await app.updateTeam(teamId.value, {
      name: teamName.value,
      addNewUsersByDefault: addNewUsersByDefault.value,
    })
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTeams.updateSuccess'),
      life: 3000,
    })
  } catch (err) {
    // revert the optimistic toggle on failure
    addNewUsersByDefault.value = !addNewUsersByDefault.value
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: errorDetail(err, 'UserTeams.errors.updateSettingsFailed'),
      life: 3000,
    })
  } finally {
    savingSettings.value = false
  }
}

// ----- name -------------------------------------------------------------------

const openEditNameDialog = () => {
  editedName.value = teamName.value
  editNameDialog.value = true
}

const confirmUpdateName = async () => {
  if (!editedName.value.trim()) return
  try {
    await app.updateTeamName(teamId.value, editedName.value.trim())
    teamName.value = editedName.value.trim()
    editNameDialog.value = false
    wiki.loadTree(String(route.params.tenantId))
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTeams.updateSuccess'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: errorDetail(err, 'UserTeams.errors.updateNameFailed'),
      life: 3000,
    })
  }
}
</script>
