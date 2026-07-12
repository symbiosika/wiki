<template>
  <div class="mx-auto max-w-4xl px-4 py-5 sm:p-6">
    <ManageHeader :title="$t('UserTenants.title')">
      <template #actions>
        <Button
          :label="$t('UserTenants.createButton')"
          size="small"
          @click="openCreateDialog"
        >
          <template #icon><IconPlus /></template>
        </Button>
      </template>
    </ManageHeader>

    <ManageTabs />

    <!-- Open invitations -->
    <div v-if="app.state.tenantInvitations.length > 0" class="mb-6">
      <h3 class="mb-2 font-bold text-surface-900 dark:text-surface-0">
        {{ $t('UserTenants.invitations.openInvitations') }}
      </h3>
      <InvitationsList @changed="reload" />
    </div>

    <DataTable
      v-if="!isLoading"
      :value="app.state.tenants"
      class="cursor-pointer"
      @row-click="navigateToTenant"
    >
      <Column field="name" :header="$t('UserTenants.name')">
        <template #body="{ data }">
          <span class="flex items-center gap-2">
            {{ data.name }}
            <Badge
              v-if="data.id === app.state.selectedTenant"
              :value="$t('UserTenants.active')"
              size="small"
            />
          </span>
        </template>
      </Column>
      <Column header="" style="width: 220px">
        <template #body="{ data }">
          <div class="flex justify-end gap-2">
            <SecondaryButton
              v-if="data.id !== app.state.selectedTenant"
              :label="$t('Common.select')"
              size="small"
              @click.stop="openChangeDialog(data)"
            />
            <SecondaryButton
              :label="$t('UserTenants.leaveButton')"
              size="small"
              @click.stop="openLeaveDialog(data)"
            />
          </div>
        </template>
      </Column>
    </DataTable>

    <!-- Create dialog -->
    <Dialog
      v-model:visible="createDialog"
      modal
      :header="$t('UserTenants.createTitle')"
      class="w-[420px] max-w-[90vw]"
    >
      <InputText
        v-model="newOrgName"
        class="w-full"
        :placeholder="$t('UserTenants.namePlaceholder')"
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
          :disabled="!newOrgName.trim()"
          :loading="isSettingUp"
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
const app = useApp()
const router = useRouter()
const route = useRoute()

const isLoading = ref(true)
const isSettingUp = ref(false)
const newOrgName = ref('')
const createDialog = ref(false)

const reload = async () => {
  isLoading.value = true
  try {
    await app.getTenants()
    await app.getTenantInvitations()
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.errors.loadFailed'),
      life: 3000,
    })
  } finally {
    isLoading.value = false
  }
}

onMounted(reload)

const navigateToTenant = (event: { data: { id: string } }) => {
  router.push({
    name: 'TenantDetails',
    params: { tenantId: route.params.tenantId, id: event.data.id },
  })
}

const openCreateDialog = () => {
  newOrgName.value = ''
  createDialog.value = true
}

const confirmCreate = async () => {
  if (!newOrgName.value.trim()) return
  isSettingUp.value = true
  try {
    if (app.state.tenants.length === 0) {
      await app.setupTenant(newOrgName.value.trim())
    } else {
      await app.createTenant(newOrgName.value.trim())
    }
    createDialog.value = false
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTenants.setupSuccess'),
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.errors.setupFailed'),
      life: 3000,
    })
  } finally {
    isSettingUp.value = false
  }
}

const openChangeDialog = (org: { id: string; name: string }) => {
  confirm.require({
    message: t('UserTenants.changeConfirm'),
    header: t('UserTenants.changeTitle'),
    rejectProps: { label: t('Common.cancel') },
    acceptProps: { label: t('Common.select') },
    accept: async () => {
      await app.setSelectedTenant(org.id)
      // move the whole app (sidebar, wiki tree) to the new organisation
      router.push({ name: 'Tenants', params: { tenantId: org.id } })
    },
  })
}

const openLeaveDialog = (org: { id: string; name: string }) => {
  confirm.require({
    message: t('UserTenants.leaveConfirm'),
    header: t('UserTenants.leaveTitle'),
    rejectProps: { label: t('Common.cancel') },
    acceptProps: { label: t('UserTenants.leaveButton'), severity: 'danger' },
    accept: async () => {
      try {
        await app.leaveTenant(org.id)
        toast.add({
          severity: 'success',
          summary: t('Common.success'),
          detail: t('UserTenants.leaveSuccess'),
          life: 3000,
        })
        if (String(route.params.tenantId) === org.id) {
          const next = app.state.tenants[0]?.id
          if (next) {
            router.push({ name: 'Tenants', params: { tenantId: next } })
          } else {
            router.push({ name: 'Home' })
          }
        }
      } catch {
        toast.add({
          severity: 'error',
          summary: t('Common.error'),
          detail: t('UserTenants.errors.leaveFailed'),
          life: 3000,
        })
      }
    },
  })
}
</script>
