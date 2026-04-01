/**
 * API Client — single source of truth for all network requests.
 *
 * Every API module imports `api` from here.
 * Bearer token injection, error normalization, and base URL
 * resolution all live in this one file.
 */
import { useAuth } from './auth'

const BASE_URL = import.meta.env.VITE_API_URL as string | undefined ?? ''

export interface ApiError {
  status: number
  message: string
  errorCode: string | null
  body: unknown
}

function createApiError(status: number, body: Record<string, unknown>): ApiError {
  return {
    status,
    message: typeof body.message === 'string' ? body.message : `Request failed (${String(status)})`,
    errorCode: typeof body.errorCode === 'string' ? body.errorCode : null,
    body,
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuth.getState().token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...init?.headers as Record<string, string> | undefined,
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers })

  if (res.status === 401) {
    useAuth.getState().clearAuth()
    window.location.href = '/login'
    throw createApiError(401, { message: 'Session expired' })
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    throw createApiError(res.status, body)
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
