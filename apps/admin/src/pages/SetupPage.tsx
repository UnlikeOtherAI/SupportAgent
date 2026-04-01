import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { settingsApi } from '@/api/settings'
import { useAuth } from '@/lib/auth'

export default function SetupPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const clearAuth = useAuth((state) => state.clearAuth)
  const setOnboardingRequired = useAuth((state) => state.setOnboardingRequired)
  const [orgName, setOrgName] = useState('')

  const mutation = useMutation({
    mutationFn: () => settingsApi.updateTenant({ orgName: orgName.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenant-settings'] })
      setOnboardingRequired(false)
      void navigate('/dashboard', { replace: true })
    },
  })

  const errorMessage =
    mutation.error &&
    typeof mutation.error === 'object' &&
    'message' in mutation.error &&
    typeof mutation.error.message === 'string'
      ? mutation.error.message
      : null

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <Card className="w-full max-w-sm shadow-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate()
          }}
        >
          <div className="space-y-5 px-8 py-8">
            <div className="space-y-1 text-center">
              <h1 className="text-2xl font-semibold text-gray-900">Welcome to AppBuildBox</h1>
              <p className="text-sm text-gray-500">Complete initial setup to get started</p>
            </div>

            <div>
              <label htmlFor="orgName" className="mb-1.5 block text-xs font-medium text-gray-500">
                Organization name
              </label>
              <input
                id="orgName"
                type="text"
                value={orgName}
                onChange={(event) => {
                  setOrgName(event.target.value)
                }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
                placeholder="Acme Inc."
                autoComplete="organization"
                required
              />
              {errorMessage ? <p className="mt-1 text-xs text-signal-red-500">{errorMessage}</p> : null}
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-gray-100 px-8 py-5">
            <Button
              type="submit"
              variant="primary"
              className="w-full justify-center"
              disabled={mutation.isPending || orgName.trim().length === 0}
            >
              {mutation.isPending ? 'Completing Setup...' : 'Complete Setup'}
            </Button>
            <Link
              to="/login"
              onClick={() => {
                clearAuth()
              }}
              className="text-center text-sm text-gray-500 transition-colors hover:text-gray-700"
            >
              Back to login
            </Link>
          </div>
        </form>
      </Card>
    </main>
  )
}
