<template>
  <div class="grid gap-3">
    <div
      v-for="invitation in app.state.tenantInvitations"
      :key="invitation.id"
      class="rounded-lg border border-surface-200 bg-surface-0 p-4 dark:border-surface-700 dark:bg-surface-900"
    >
      <div
        class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h3 class="font-semibold text-surface-900 dark:text-surface-0">
            {{ invitation.tenantName }}
          </h3>
          <p class="text-sm text-surface-500 dark:text-surface-400">
            {{ $t('UserTenants.invitations.role') }}:
            {{ $t(`UserTenants.roles.${invitation.role}`) }}
          </p>
        </div>
        <div class="flex gap-2">
          <Button
            :label="$t('UserTenants.invitations.accept')"
            size="small"
            :loading="busy"
            @click="accept(invitation)"
          />
          <SecondaryButton
            :label="$t('UserTenants.invitations.decline')"
            size="small"
            :loading="busy"
            @click="decline(invitation)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast'
import type { TenantInvitation } from '@/types/usermanagement'

const emit = defineEmits<{ changed: [] }>()

const app = useApp()
const toast = useToast()
const { t } = useI18n()

const busy = ref(false)

const accept = async (invitation: TenantInvitation) => {
  busy.value = true
  try {
    await app.acceptInvitation(invitation.tenantId, invitation.id)
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTenants.invitations.success.accepted'),
      life: 3000,
    })
    emit('changed')
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.invitations.errors.acceptFailed'),
      life: 3000,
    })
  } finally {
    busy.value = false
  }
}

const decline = async (invitation: TenantInvitation) => {
  busy.value = true
  try {
    await app.declineInvitation(invitation.tenantId, invitation.id)
    toast.add({
      severity: 'success',
      summary: t('Common.success'),
      detail: t('UserTenants.invitations.success.declined'),
      life: 3000,
    })
    emit('changed')
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.error'),
      detail: t('UserTenants.invitations.errors.declineFailed'),
      life: 3000,
    })
  } finally {
    busy.value = false
  }
}
</script>
