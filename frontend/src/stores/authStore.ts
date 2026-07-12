import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    isLoading: false,
  }),

  getters: {
    /**
     * Check if user has an existing JWT token in cookies
     */
    hasExistingToken(): boolean {
      const cookies = document.cookie.split(';')
      const jwtCookie = cookies.find((cookie) =>
        cookie.trim().startsWith('jwt='),
      )

      if (jwtCookie) {
        const token = jwtCookie.split('=')[1]
        return !!token
      }
      return false
    },
  },

  actions: {
    /**
     * Logout
     */
    logout() {
      // Delete cookie
      document.cookie =
        'jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; secure; samesite=strict'
      // Redirect to Login page
      window.location.href = '/login.html'
    },
  },
})
