import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronRightIcon } from '@/components/icons/NavIcons'
import { settingsApi } from '@/api/settings'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'

const navCards = [
  { to: '/settings/identity', title: 'Identity Providers', description: 'Manage SSO and external identity provider configuration.' },
  { to: '/settings/users', title: 'Users', description: 'Review access, roles, and user lifecycle actions.' },
  { to: '/settings/audit', title: 'Audit Log', description: 'Inspect tenant-level configuration and access events.' },
]

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['tenant-settings'], queryFn: () => settingsApi.getTenant() })
  const [orgName, setOrgName] = useState('')
  const [productMode, setProductMode] = useState<'standalone-saas' | 'standalone-enterprise' | 'integrated'>('standalone-saas')
  const [hostingMode, setHostingMode] = useState('')
  const [modelAccessMode, setModelAccessMode] = useState('')
  const [outputVisibilityPolicy, setOutputVisibilityPolicy] = useState('')
  const [onboardingRequired, setOnboardingRequired] = useState(false)

  useEffect(() => {
    if (!data) return
    setOrgName(data.orgName)
    setProductMode(data.productMode)
    setHostingMode(data.hostingMode)
    setModelAccessMode(data.modelAccessMode)
    setOutputVisibilityPolicy(data.outputVisibilityPolicy)
    setOnboardingRequired(data.onboardingRequired)
  }, [data])

  const mutation = useMutation({
    mutationFn: () => settingsApi.updateTenant({ orgName, productMode, hostingMode, modelAccessMode, outputVisibilityPolicy, onboardingRequired }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tenant-settings'] }),
  })

  if (isLoading) {
    return <PageShell title="Tenant Settings"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  return (
    <PageShell title="Tenant Settings">
      <Card>
        <form onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
          <div className="space-y-4 px-5 py-5">
            <div><label className="mb-1.5 block text-xs font-medium text-gray-500">Org Name</label><input value={orgName} onChange={(event) => setOrgName(event.target.value)} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" /></div>
            <div><label className="mb-1.5 block text-xs font-medium text-gray-500">Product Mode</label><select value={productMode} onChange={(event) => setProductMode(event.target.value as 'standalone-saas' | 'standalone-enterprise' | 'integrated')} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"><option value="standalone-saas">standalone-saas</option><option value="standalone-enterprise">standalone-enterprise</option><option value="integrated">integrated</option></select></div>
            <div><label className="mb-1.5 block text-xs font-medium text-gray-500">Hosting Mode</label><input value={hostingMode} onChange={(event) => setHostingMode(event.target.value)} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" /></div>
            <div><label className="mb-1.5 block text-xs font-medium text-gray-500">Model Access Mode</label><input value={modelAccessMode} onChange={(event) => setModelAccessMode(event.target.value)} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" /></div>
            <div><label className="mb-1.5 block text-xs font-medium text-gray-500">Output Visibility Policy</label><input value={outputVisibilityPolicy} onChange={(event) => setOutputVisibilityPolicy(event.target.value)} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" /></div>
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={onboardingRequired} onChange={(event) => setOnboardingRequired(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500" />Onboarding Required</label>
          </div>
          <div className="flex items-center justify-end border-t border-gray-100 px-5 py-4">
            <Button type="submit" variant="primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving...' : 'Save Settings'}</Button>
          </div>
        </form>
      </Card>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {navCards.map((card) => (
          <Link key={card.to} to={card.to} className="block">
            <Card className="h-full transition-colors hover:border-gray-200 hover:bg-gray-25">
              <div className="flex items-start justify-between px-5 py-5">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">{card.title}</h2>
                  <p className="mt-2 text-sm text-gray-500">{card.description}</p>
                </div>
                <span className="text-gray-400"><ChevronRightIcon /></span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </PageShell>
  )
}
