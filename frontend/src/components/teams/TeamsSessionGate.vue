<script setup lang="ts">
/**
 * What a Teams tab shows while it has no session yet.
 *
 * Three states, all of them reached before the app itself can do anything:
 * signing in, the invitation-code step on a gated instance, and a sign-in that
 * failed. Rendered instead of the router view, so no component below can start
 * firing API calls without a token.
 */
import { submitTeamsInvitationCode, teamsState } from '@/utils/teamsSession'

const { t } = useI18n()

const code = ref('')
const submitting = ref(false)
const error = ref('')

const submit = async () => {
  if (!code.value.trim()) {
    error.value = t('Teams.invitationCodeMissing')
    return
  }

  submitting.value = true
  error.value = ''
  try {
    await submitTeamsInvitationCode(code.value.trim())
  } catch {
    // The server distinguishes a wrong code (retryable) from an unusable
    // pending registration by status; either way the user's next step is the
    // same — try again, or reload the tab — so one message covers it.
    error.value = t('Teams.invitationCodeRejected')
  } finally {
    submitting.value = false
  }
}

const reload = () => window.location.reload()
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center p-6">
    <!-- signing in -->
    <section
      v-if="
        teamsState.status === 'authenticating' || teamsState.status === 'idle'
      "
      class="text-center"
    >
      <ProgressSpinner style="width: 2.5rem; height: 2.5rem" />
      <p class="mt-4 text-sm text-surface-600 dark:text-surface-400">
        {{ t('Teams.signingIn') }}
      </p>
    </section>

    <!-- invitation code required -->
    <section
      v-else-if="teamsState.status === 'invitation_code_required'"
      class="w-full max-w-md rounded-lg border border-surface-200 p-6 dark:border-surface-700"
    >
      <h1 class="mb-2 text-xl font-semibold">
        {{ t('Teams.invitationCodeTitle') }}
      </h1>
      <p class="mb-4 text-sm text-surface-600 dark:text-surface-400">
        {{ t('Teams.invitationCodeIntro', { email: teamsState.email }) }}
      </p>

      <form @submit.prevent="submit">
        <label
          class="mb-1 block text-sm font-medium"
          for="teams-invitation-code"
        >
          {{ t('Teams.invitationCodeLabel') }}
        </label>
        <InputText
          id="teams-invitation-code"
          v-model="code"
          class="w-full"
          :placeholder="t('Teams.invitationCodePlaceholder')"
          :disabled="submitting"
          autocomplete="off"
        />
        <p v-if="error" class="mt-2 text-sm text-red-600 dark:text-red-400">
          {{ error }}
        </p>
        <Button
          class="mt-4 w-full"
          type="submit"
          :loading="submitting"
          :label="t('Teams.invitationCodeSubmit')"
        />
      </form>
    </section>

    <!-- sign-in failed -->
    <section
      v-else
      class="w-full max-w-md rounded-lg border border-red-200 p-6 text-center dark:border-red-900"
    >
      <h1 class="mb-2 text-xl font-semibold">{{ t('Teams.signInFailed') }}</h1>
      <p class="text-sm text-surface-600 dark:text-surface-400">
        {{ t('Teams.signInFailedHint') }}
      </p>
      <Button
        class="mt-4"
        severity="secondary"
        :label="t('Teams.retry')"
        @click="reload"
      />
    </section>
  </main>
</template>
