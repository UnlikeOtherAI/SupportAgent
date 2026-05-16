import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { authApi } from '@/api/auth'
import { useAuth } from '@/lib/auth'

/**
 * AuthGuard.
 *
 * Identity is held in an HttpOnly cookie set by the SSO callback. On first
 * paint we don't know if the cookie is present and valid, so the guard fires
 * a single `/v1/auth/me` request. Once `status` flips, it either renders the
 * authenticated subtree or redirects to `/login`.
 */
export function AuthGuard() {
  const status = useAuth((s) => s.status)
  const setUser = useAuth((s) => s.setUser)
  const setUnauthenticated = useAuth((s) => s.setUnauthenticated)

  useEffect(() => {
    if (status !== 'unknown') return
    void (async () => {
      try {
        const me = await authApi.me()
        setUser({
          userId: me.userId,
          tenantId: me.tenantId,
          displayName: me.displayName,
          email: me.email,
          avatarUrl: me.avatarUrl,
          role: me.role,
        })
      } catch {
        setUnauthenticated()
      }
    })()
  }, [setUnauthenticated, setUser, status])

  if (status === 'unknown') {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-gray-400">
        Loading...
      </div>
    )
  }
  if (status === 'unauthenticated') return <Navigate to="/login" replace />
  return <Outlet />
}
