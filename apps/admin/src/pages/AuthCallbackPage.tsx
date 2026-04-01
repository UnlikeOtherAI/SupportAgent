import { useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { useAuth } from '@/lib/auth'

export default function AuthCallbackPage() {
  const navigate = useNavigate()
  const setAuth = useAuth((state) => state.setAuth)
  const setOnboardingRequired = useAuth((state) => state.setOnboardingRequired)
  const handledRef = useRef(false)

  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')
  const userId = params.get('userId')
  const displayName = params.get('displayName')
  const email = params.get('email')
  const avatarUrl = params.get('avatarUrl')
  const role = params.get('role')
  const onboardingRequired = params.get('onboardingRequired')

  useEffect(() => {
    if (!token || handledRef.current) {
      return
    }

    handledRef.current = true
    setAuth(token, {
      userId: userId ?? '',
      displayName: displayName ?? '',
      email: email ?? '',
      avatarUrl,
      role: role ?? '',
    })

    if (onboardingRequired === 'true') {
      setOnboardingRequired(true)
      void navigate('/setup', { replace: true })
      return
    }

    setOnboardingRequired(false)
    void navigate('/dashboard', { replace: true })
  }, [
    avatarUrl,
    displayName,
    email,
    navigate,
    onboardingRequired,
    role,
    setAuth,
    setOnboardingRequired,
    token,
    userId,
  ])

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
        <Card className="w-full max-w-sm p-8 text-center shadow-sm">
          <div className="space-y-4">
            <div className="space-y-1">
              <h1 className="text-xl font-semibold text-gray-900">Invalid callback</h1>
              <p className="text-sm text-gray-500">The sign-in response is missing a token.</p>
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
