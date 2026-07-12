import { defineStore } from 'pinia'
import { hasAuthCookie } from '@/utils/authCookie'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    isLoading: false,
  }),

  getters: {
    /**
     * Check if the user has a login session.
     * The real `jwt` cookie is HttpOnly (invisible to JS); the backend sets
     * the non-HttpOnly `jwt_present` marker alongside it for this check.
     */
    hasExistingToken(): boolean {
      return hasAuthCookie()
    },
  },

  actions: {
    /**
     * Logout: the `jwt` cookie is HttpOnly, so only the server can clear
     * it. /logout.html calls POST /user/logout (revokes the session and
     * clears both cookies) and then offers the way back to the login.
     */
    logout() {
      window.location.href = '/logout.html'
    },
  },
})
