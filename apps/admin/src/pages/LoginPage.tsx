import { useQuery } from '@tanstack/react-query'
import { BoltIcon, ProvidersIcon } from '@/components/icons/NavIcons'
import { Card } from '@/components/ui/Card'
import { authApi } from '@/api/auth'

export default function LoginPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: authApi.getProviders,
  })

  const providers = data?.providers.filter((provider) => provider.enabled) ?? []

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
          </div>

          <p className="text-center text-xs text-gray-400">SSO authentication required</p>
        </div>
      </Card>
    </main>
  )
}
