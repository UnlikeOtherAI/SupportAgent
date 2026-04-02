import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { BoltIcon, ProvidersIcon } from '@/components/icons/NavIcons'
import { Card } from '@/components/ui/Card'
import { authApi } from '@/api/auth'
import { useAuth } from '@/lib/auth'

export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuth((s) => s.setAuth)
  const [devLoading, setDevLoading] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: authApi.getProviders,
  })

  const providers = data?.providers.filter((provider) => provider.enabled) ?? []
  const showDevLogin = import.meta.env.DEV && !isLoading && providers.length === 0

  async function handleDevLogin() {
    setDevLoading(true)
    try {
      const res = await authApi.devLogin()
      setAuth(res.token, {
        userId: res.userId,
        displayName: res.displayName,
        email: res.email,
        avatarUrl: res.avatarUrl,
        role: res.role,
      })
      void navigate('/dashboard', { replace: true })
    } finally {
      setDevLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <Card className="w-full max-w-sm p-8 shadow-sm">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-accent-500">
                <BoltIcon width={18} height={18} stroke="#fff" />
              </div>
              <span className="text-lg font-semibold tracking-tight text-gray-900">AppBuildBox</span>
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold text-gray-900">Sign in to your account</h1>
            </div>
          </div>

          <div className="space-y-3">
            {isLoading ? (
              <p className="text-center text-sm text-gray-400">Loading providers...</p>
            ) : providers.length === 0 ? (
              <p className="text-center text-sm text-gray-500">No identity providers configured</p>
            ) : (
              providers.map((provider) => (
                <button
                  key={provider.key}
                  type="button"
                  onClick={() => {
                    window.location.href = provider.startUrl
                  }}
                  className="flex w-full items-center justify-center gap-3 rounded-[var(--radius-sm)] border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50"
                >
                  {provider.iconUrl ? (
                    <img src={provider.iconUrl} alt="" className="h-5 w-5 rounded-sm object-contain" />
                  ) : (
                    <ProvidersIcon className="h-5 w-5 text-gray-400" />
                  )}
                  <span>{provider.buttonText}</span>
                </button>
              ))
            )}

            {showDevLogin && (
              <>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-dashed border-gray-200" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-2 text-[11px] font-medium uppercase tracking-widest text-gray-400">
                      Dev only
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={devLoading}
                  onClick={() => void handleDevLogin()}
                  className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-gray-300 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
                >
                  {devLoading ? 'Signing in...' : 'Dev Login'}
                </button>
              </>
            )}
          </div>

          <p className="text-center text-xs text-gray-400">SSO authentication required</p>
        </div>
      </Card>
    </main>
  )
}
