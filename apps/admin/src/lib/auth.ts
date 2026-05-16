/**
 * Auth — single source of truth for the admin app's identity state.
 *
 * The bearer JWT is no longer held by JavaScript. The API delivers it as an
 * HttpOnly `__Host-abb_session` cookie at the SSO callback, and the browser
 * replays it on every same-origin request. The store therefore only tracks
 * the *user identity* fetched from `/v1/auth/me`.
 *
 * See `docs/reviews/security-auth-and-sso.md` H1 and `security-secrets-and-data.md` L-3.
 */
import { create } from 'zustand'

export interface AuthUser {
  userId: string
  tenantId: string
  displayName: string
  email: string
  avatarUrl: string | null
  role: string
}

export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated'

interface AuthState {
  status: AuthStatus
  user: AuthUser | null
  onboardingRequired: boolean

  setUser: (user: AuthUser) => void
  setUnauthenticated: () => void
  setOnboardingRequired: (required: boolean) => void
  clearAuth: () => void
  isAuthenticated: () => boolean
}

export const useAuth = create<AuthState>()((set, get) => ({
  status: 'unknown',
  user: null,
  onboardingRequired: false,

  setUser: (user) => set({ status: 'authenticated', user }),
  setUnauthenticated: () => set({ status: 'unauthenticated', user: null, onboardingRequired: false }),
  setOnboardingRequired: (required) => set({ onboardingRequired: required }),
  clearAuth: () => set({ status: 'unauthenticated', user: null, onboardingRequired: false }),
  isAuthenticated: () => get().status === 'authenticated',
}))
