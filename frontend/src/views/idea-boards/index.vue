<template>
  <div class="mx-auto max-w-4xl px-4 py-5 sm:p-6">
    <div class="mb-4 flex items-center justify-between gap-2">
      <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-0">
        {{ $t('IdeaBoards.title') }}
      </h1>
      <Button size="small" :label="$t('IdeaBoards.addBoard')" @click="openCreate">
        <template #icon><IconPlus /></template>
      </Button>
    </div>

    <p class="mb-6 text-sm text-surface-500 dark:text-surface-400">
      {{ $t('IdeaBoards.intro') }}
    </p>

    <DataTable
      v-if="!store.loading && store.boards.length > 0"
      :value="store.boards"
      class="cursor-pointer"
      @row-click="openBoard"
    >
      <Column :header="$t('Common.name')">
        <template #body="{ data }">
          <span class="font-medium text-surface-900 dark:text-surface-0">
            {{ data.title }}
          </span>
          <p
            v-if="data.description"
            class="text-xs text-surface-400 dark:text-surface-500"
          >
            {{ data.description }}
          </p>
        </template>
      </Column>
      <Column :header="$t('IdeaBoards.visibility')">
        <template #body="{ data }">
          <span class="text-xs text-surface-600 dark:text-surface-300">
            {{ visibilityLabel(data) }}
          </span>
        </template>
      </Column>
      <Column :header="$t('Common.updated')">
        <template #body="{ data }">
          <span class="text-xs text-surface-600 dark:text-surface-300">
            {{ formatDateTime(data.updatedAt) }}
          </span>
        </template>
      </Column>
    </DataTable>

    <p
      v-else-if="!store.loading"
      class="text-sm text-surface-500 dark:text-surface-400"
    >
      {{ $t('IdeaBoards.noBoards') }}
    </p>

    <!-- create -->
    <Dialog
      v-model:visible="createVisible"
      modal
      :header="$t('IdeaBoards.addBoard')"
      class="w-full max-w-md"
    >
      <div class="space-y-3">
        <div>
          <label
            class="mb-1 block text-sm text-surface-600 dark:text-surface-300"
          >
            {{ $t('Common.name') }}
          </label>
          <InputText v-model="newTitle" class="w-full" autofocus />
        </div>
        <div>
          <label
            class="mb-1 block text-sm text-surface-600 dark:text-surface-300"
          >
            {{ $t('Common.description') }}
          </label>
          <Textarea v-model="newDescription" rows="2" class="w-full" />
        </div>
        <div>
          <label
            class="mb-1 block text-sm text-surface-600 dark:text-surface-300"
          >
            {{ $t('IdeaBoards.visibility') }}
          </label>
          <Select
            v-model="newScope"
            :options="scopeOptions"
            option-label="label"
            option-value="value"
            class="w-full"
          />
        </div>
      </div>
      <template #footer>
        <SecondaryButton
          :label="$t('Common.cancel')"
          @click="createVisible = false"
        />
        <Button
          :label="$t('Common.create')"
          :disabled="!newTitle.trim() || creating"
          @click="create"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast'
import IconPlus from '~icons/mdi/plus'
import { formatDateTime } from '@/utils/date'
import type { IdeaBoard } from '@/types/ideaBoards'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const store = useIdeaBoards()

const tenantId = computed(() => String(route.params.tenantId))

const createVisible = ref(false)
const creating = ref(false)
const newTitle = ref('')
const newDescription = ref('')
const newScope = ref<'personal' | 'organisation'>('organisation')

const scopeOptions = computed(() => [
  { value: 'organisation', label: t('IdeaBoards.scopeOrganisation') },
  { value: 'personal', label: t('IdeaBoards.scopePersonal') },
])

onMounted(() => store.loadBoards(tenantId.value))

const visibilityLabel = (board: IdeaBoard) => {
  if (board.tenantWide) return t('IdeaBoards.scopeOrganisation')
  if (board.teamId) return t('IdeaBoards.scopeTeam')
  return t('IdeaBoards.scopePersonal')
}

const openCreate = () => {
  newTitle.value = ''
  newDescription.value = ''
  newScope.value = 'organisation'
  createVisible.value = true
}

const create = async () => {
  creating.value = true
  try {
    const board = await store.createBoard(tenantId.value, {
      title: newTitle.value.trim(),
      description: newDescription.value.trim() || null,
      tenantWide: newScope.value === 'organisation',
    })
    createVisible.value = false
    router.push({
      name: 'IdeaBoard',
      params: { tenantId: tenantId.value, boardId: board.id },
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('IdeaBoards.createError'),
      life: 4000,
    })
  } finally {
    creating.value = false
  }
}

const openBoard = (event: { data: IdeaBoard }) => {
  router.push({
    name: 'IdeaBoard',
    params: { tenantId: tenantId.value, boardId: event.data.id },
  })
}
</script>
