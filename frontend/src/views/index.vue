<template>
  <h1>Users Tenants</h1>
  <div v-if="state.user">
    <h2>User: {{ state.user.email }}</h2>
  </div>
  <div v-else>
    <h2>No user found</h2>
  </div>
  <div v-if="state.tenants">
    <h2>Tenants:</h2>
    <ul>
      <li v-for="tenant in state.tenants" :key="tenant.id">
        {{ tenant.name }}
        <button @click="gotoChat(tenant.id)">Go to chat</button>
      </li>
    </ul>
  </div>
  <div v-else>
    <h2>No tenants found</h2>
  </div>
</template>

<script setup lang="ts">
const app = useApp()
const router = useRouter()
const { state } = app

const gotoChat = (tenantId: string) => {
  router.push(`/tenant/${tenantId}/chat`)
}
</script>
