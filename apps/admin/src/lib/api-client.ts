/**
 * API Client — single source of truth for all network requests.
 *
 * Authentication is delivered via the HttpOnly `__Host-abb_session` cookie
 * set by the SSO callback. Every request includes `credentials: 'include'`
 * so the browser attaches the cookie even on cross-origin admin → API calls.
 * No bearer token is held in JS memory or `localStorage`.
 *
 * See `docs/reviews/security-auth-and-sso.md` H1 and L-2.
 */
import { useAuth } from './auth'

const BASE_URL = import.meta.env.VITE_API_URL as string | undefined ?? ''

export interface ApiError {
  status: number
  message: string
  errorCode: string | null
  body: unknown
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...init?.headers as Record<string, string> | undefined,
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (res.status === 401) {
    useAuth.getState().clearAuth()
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
    throw new Error('Session expired')
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    throw Object.assign(new Error(typeof body.message === 'string' ? body.message : `Request failed (${res.status})`), { status: res.status, body })
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
