import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { authApi } from '@/api/auth'
import { useAuth } from '@/lib/auth'

/**
 * Auth callback landing page.
 *
 * The SSO callback now sets an HttpOnly `__Host-abb_session` cookie and
 * redirects here with a clean URL — no `?token=`, no `?email=`. This page
 * fetches the current identity via `/v1/auth/me` and stores the user.
 *
 * See `docs/reviews/security-auth-and-sso.md` H1.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate()
  const setUser = useAuth((state) => state.setUser)
  const setUnauthenticated = useAuth((state) => state.setUnauthenticated)
  const setOnboardingRequired = useAuth((state) => state.setOnboardingRequired)
  const handledRef = useRef(false)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  useEffect(() => {
    if (handledRef.current) return
    handledRef.current = true

    const params = new URLSearchParams(window.location.search)
    const queryError = params.get('error')
    if (queryError) {
      setErrorCode(queryError)
      setUnauthenticated()
      return
    }

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
        setOnboardingRequired(false)
        void navigate('/dashboard', { replace: true })
      } catch {
        setErrorCode('session_fetch_failed')
        setUnauthenticated()
      }
    })()
  }, [navigate, setOnboardingRequired, setUnauthenticated, setUser])

  if (errorCode) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
        <Card className="w-full max-w-sm p-8 text-center shadow-sm">
          <div className="space-y-4">
            <div className="space-y-1">
              <h1 className="text-xl font-semibold text-gray-900">Sign-in failed</h1>
              <p className="text-sm text-gray-500">{describeError(errorCode)}</p>
            </div>
            <Link to="/login" className="text-sm font-medium text-accent-600 hover:text-accent-700">
              Back to login
            </Link>
          </div>
        </Card>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <p className="text-sm text-gray-500">Completing sign-in...</p>
    </main>
  )
}

function describeError(code: string): string {
  switch (code) {
    case 'no_tenant':
      return 'Your identity is not yet attached to a tenant. Ask your admin to complete account setup.'
    case 'invalid_token':
      return 'The identity provider returned an invalid token.'
    case 'invalid_state':
    case 'missing_state':
      return 'Login state was lost. Please retry sign-in.'
    case 'missing_code':
      return 'The identity provider did not return an authorization code.'
    case 'token_exchange_failed':
      return 'Could not exchange the authorization code with the identity provider.'
    case 'integration_pending':
      return 'SSO integration has not been completed yet.'
    case 'session_fetch_failed':
      return 'We received your sign-in but could not load your profile.'
    default:
      return `Sign-in error (${code}).`
  }
}
