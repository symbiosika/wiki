<template>
  <div class="mx-auto max-w-4xl p-6">
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

    <DataTable v-if="members.length > 0" :value="members">
      <Column field="userEmail" :header="$t('UserTeams.memberEmail')" />
      <Column field="role" :header="$t('UserTeams.memberRole')">
        <template #body="{ data }">
          {{ $t(`UserTeams.roles.${data.role}`, data.role) }}
        </template>
      </Column>
      <Column header="" style="width: 240px">
        <template #body="{ data }">
          <div
            v-if="data.userId !== app.state.user?.id"
            class="flex justify-end gap-2"
          >
            <SecondaryButton
              :label="$t('UserTeams.changeRole')"
              size="small"
              @click="openChangeRoleDialog(data)"
            />
            <SecondaryButton
              :label="$t('UserTeams.removeMember')"
              size="small"
              @click="openRemoveDialog(data)"
            />
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
          {{ foundUser.firstname }} {{ foundUser.surname }}
          ({{ foundUser.email }})
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
import type { FoundUser, TeamMember } from '@/types/usermanagement'

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

onMounted(async () => {
  await app.waitForInit()
  await app.getTeams()
  await loadTeamData()
})

const loadTeamData = async () => {
  try {
    const team = app.state.teams.find((entry) => entry.id === teamId.value)
    if (!team) {
      router.push({ name: 'Teams', params: { tenantId: route.params.tenantId } })
      return
    }
    teamName.value = team.name
    members.value = (await app.getTeamMembers(teamId.value)) || []
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
      } catch {
        toast.add({
          severity: 'error',
          summary: t('Common.error'),
          detail: t('UserTeams.errors.deleteFailed'),
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
      } catch {
        toast.add({
          severity: 'error',
          summary: t('Common.error'),
          detail: t('UserTeams.errors.removeMemberFailed'),
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
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTeams.errors.changeRoleFailed'),
      life: 3000,
    })
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
    await app.addTeamMember(teamId.value, foundUser.value.id, selectedRole.value)
    await loadTeamData()
    inviteDialog.value = false
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTeams.inviteSuccess'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTeams.errors.inviteFailed'),
      life: 3000,
    })
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
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTeams.errors.updateNameFailed'),
      life: 3000,
    })
  }
}
</script>
