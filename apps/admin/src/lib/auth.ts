/**
 * Auth — single source of truth for authentication state.
 *
 * Every component reads auth through `useAuth()`.
 * Every mutation writes through `setAuth()` / `clearAuth()`.
 * The bearer token is injected into requests by `api-client.ts`.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthUser {
  userId: string
  displayName: string
  email: string
  avatarUrl: string | null
  role: string
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  onboardingRequired: boolean

  setAuth: (token: string, user: AuthUser) => void
  setOnboardingRequired: (required: boolean) => void
  clearAuth: () => void
  isAuthenticated: () => boolean
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      onboardingRequired: false,

      setAuth: (token, user) => set({ token, user }),
      setOnboardingRequired: (required) => set({ onboardingRequired: required }),
      clearAuth: () => set({ token: null, user: null, onboardingRequired: false }),
      isAuthenticated: () => get().token !== null,
    }),
    { name: 'abb-auth' },
  ),
)
