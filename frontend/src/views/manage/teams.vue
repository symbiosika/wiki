<template>
  <div class="mx-auto max-w-4xl px-4 py-5 sm:p-6">
    <ManageHeader :title="$t('UserTeams.title')">
      <template #actions>
        <Button
          :label="$t('UserTeams.addTeam')"
          size="small"
          @click="openCreateDialog"
        >
          <template #icon><IconPlus /></template>
        </Button>
      </template>
    </ManageHeader>

    <ManageTabs />

    <DataTable
      v-if="!isLoading && app.state.teams.length > 0"
      :value="app.state.teams"
      class="cursor-pointer"
      @row-click="navigateToTeam"
    >
      <Column field="name" :header="$t('UserTeams.name')" />
      <Column header="" style="width: 140px">
        <template #body="{ data }">
          <div class="flex justify-end">
            <SecondaryButton
              :label="$t('UserTeams.leaveButton')"
              size="small"
              @click.stop="openLeaveDialog(data)"
            />
          </div>
        </template>
      </Column>
    </DataTable>

    <p
      v-else-if="!isLoading"
      class="text-sm text-surface-500 dark:text-surface-400"
    >
      {{ $t('UserTeams.noTeams') }}
    </p>

    <!-- Create dialog -->
    <Dialog
      v-model:visible="createDialog"
      modal
      :header="$t('UserTeams.createTitle')"
      class="w-[420px] max-w-[90vw]"
    >
      <InputText
        v-model="newTeamName"
        class="w-full"
        :placeholder="$t('UserTeams.namePlaceholder')"
        autofocus
        @keyup.enter="confirmCreate"
      />
      <template #footer>
        <SecondaryButton
          :label="$t('Common.cancel')"
          size="small"
          @click="createDialog = false"
        />
        <Button
          :label="$t('Common.create')"
          size="small"
          :disabled="!newTeamName.trim()"
          @click="confirmCreate"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import IconPlus from '~icons/mdi/plus'

const { t } = useI18n()
const toast = useToast()
const confirm = useConfirm()
const router = useRouter()
const route = useRoute()
const app = useApp()
const wiki = useWiki()

const isLoading = ref(true)
const createDialog = ref(false)
const newTeamName = ref('')

onMounted(async () => {
  try {
    await app.waitForInit()
    await app.getTeams()
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTeams.errors.fetchFailed'),
      life: 3000,
    })
  } finally {
    isLoading.value = false
  }
})

const navigateToTeam = (event: { data: { id: string } }) => {
  router.push({
    name: 'TeamDetails',
    params: { tenantId: route.params.tenantId, teamId: event.data.id },
  })
}

const openCreateDialog = () => {
  newTeamName.value = ''
  createDialog.value = true
}

const confirmCreate = async () => {
  if (!newTeamName.value.trim()) return
  try {
    await app.createTeam(newTeamName.value.trim())
    createDialog.value = false
    // the sidebar shows one section per team – refresh it
    wiki.loadTree(String(route.params.tenantId))
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTeams.createSuccess'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTeams.errors.createFailed'),
      life: 3000,
    })
  }
}

const openLeaveDialog = (team: { id: string; name: string }) => {
  confirm.require({
    message: t('UserTeams.leaveConfirm'),
    header: t('UserTeams.leaveTitle'),
    rejectProps: { label: t('Common.cancel') },
    acceptProps: { label: t('UserTeams.leaveButton'), severity: 'danger' },
    accept: async () => {
      try {
        await app.leaveTeam(team.id)
        wiki.loadTree(String(route.params.tenantId))
        toast.add({
          severity: 'success',
          summary: t('Common.success'),
          detail: t('UserTeams.leaveSuccess'),
          life: 3000,
        })
      } catch {
        toast.add({
          severity: 'error',
          summary: t('Common.error'),
          detail: t('UserTeams.errors.leaveFailed'),
          life: 3000,
        })
      }
    },
  })
}
</script>
