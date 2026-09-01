import { defineStore } from 'pinia'
import { hasAuthCookie } from '@/utils/authCookie'
import { getTeamsAuthToken, isTeamsHost } from '@/utils/teamsSession'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    isLoading: false,
  }),

  getters: {
    /**
     * Check if the user has a login session.
     * The real `jwt` cookie is HttpOnly (invisible to JS); the backend sets
     * the non-HttpOnly `jwt_present` marker alongside it for this check.
     * In a Teams tab there is no cookie at all — the session is the in-memory
     * bearer token established before the app mounted.
     */
    hasExistingToken(): boolean {
      return isTeamsHost() ? getTeamsAuthToken() !== null : hasAuthCookie()
    },

    /**
     * Whether signing out is something this environment can do.
     *
     * In a Teams tab it is not: the identity comes from the Teams host, so
     * dropping our session would only be followed by an immediate, silent
     * sign-in with the same account. Offering the action would be a button that
     * appears to do nothing.
     */
    canLogout(): boolean {
      return !isTeamsHost()
    },
  },

  actions: {
    /**
     * Logout: the `jwt` cookie is HttpOnly, so only the server can clear
     * it. /logout.html calls POST /user/logout (revokes the session and
     * clears both cookies) and then offers the way back to the login.
     */
    logout() {
      if (isTeamsHost()) return
      window.location.href = '/logout.html'
    },
  },
})
