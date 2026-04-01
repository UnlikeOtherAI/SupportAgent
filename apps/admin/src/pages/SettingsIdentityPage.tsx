import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { settingsApi, type IdentityProviderConfig } from '@/api/settings'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'

type ProviderDraft = Pick<IdentityProviderConfig, 'label' | 'protocol' | 'issuerUrl' | 'clientId' | 'enabled'>

const emptyDraft: ProviderDraft = { label: '', protocol: 'oidc', issuerUrl: '', clientId: '', enabled: true }

export default function SettingsIdentityPage() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProviderDraft>(emptyDraft)
  const { data, isLoading } = useQuery({ queryKey: ['identity-providers'], queryFn: () => settingsApi.listIdentityProviders() })
  const saveMutation = useMutation({
    mutationFn: () => editingId ? settingsApi.updateIdentityProvider(editingId, draft) : settingsApi.createIdentityProvider(draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['identity-providers'] })
      setShowForm(false)
      setEditingId(null)
      setDraft(emptyDraft)
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteIdentityProvider(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['identity-providers'] }),
  })

  const columns: Column<IdentityProviderConfig>[] = [
    { key: 'label', header: 'Label', render: (provider) => <span className="font-medium text-gray-900">{provider.label}</span> },
    { key: 'protocol', header: 'Protocol', render: (provider) => <span className="font-mono text-xs text-gray-500">{provider.protocol}</span> },
    { key: 'issuerUrl', header: 'Issuer URL', render: (provider) => <span className="block max-w-72 truncate font-mono text-xs text-gray-500">{provider.issuerUrl}</span> },
    { key: 'clientId', header: 'Client ID', render: (provider) => <span className="font-mono text-xs text-gray-500">{provider.clientId}</span> },
    {
      key: 'enabled',
      header: 'Enabled',
      render: (provider) => <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${provider.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{provider.enabled ? 'Enabled' : 'Disabled'}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (provider) => (
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => { setEditingId(provider.id); setDraft({ label: provider.label, protocol: provider.protocol, issuerUrl: provider.issuerUrl, clientId: provider.clientId, enabled: provider.enabled }); setShowForm(true) }}>Edit</Button>
          <Button type="button" variant="ghost" className="text-signal-red-500 hover:bg-signal-red-50 hover:text-signal-red-600" onClick={() => deleteMutation.mutate(provider.id)}>Delete</Button>
        </div>
      ),
      className: 'w-1',
    },
  ]

  if (isLoading) {
    return <PageShell title="Identity Providers"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  return (
    <PageShell title="Identity Providers">
      <Link to="/settings" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Settings</Link>
      <Card>
        <CardHeader title="Configured Providers" subtitle={`${data?.providers.length ?? 0} total`} action={<Button type="button" variant="primary" onClick={() => { setEditingId(null); setDraft(emptyDraft); setShowForm((value) => !value) }}>{showForm && !editingId ? 'Close' : 'Add Provider'}</Button>} />
        {showForm && (
          <form onSubmit={(event) => { event.preventDefault(); saveMutation.mutate() }} className="border-b border-gray-100 px-5 py-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div><label className="mb-1.5 block text-xs font-medium text-gray-500">Label</label><input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" /></div>
              <div><label className="mb-1.5 block text-xs font-medium text-gray-500">Protocol</label><select value={draft.protocol} onChange={(event) => setDraft({ ...draft, protocol: event.target.value as IdentityProviderConfig['protocol'] })} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"><option value="oidc">oidc</option><option value="saml">saml</option><option value="oauth-broker">oauth-broker</option></select></div>
              <div><label className="mb-1.5 block text-xs font-medium text-gray-500">Issuer URL</label><input value={draft.issuerUrl} onChange={(event) => setDraft({ ...draft, issuerUrl: event.target.value })} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" /></div>
              <div><label className="mb-1.5 block text-xs font-medium text-gray-500">Client ID</label><input value={draft.clientId} onChange={(event) => setDraft({ ...draft, clientId: event.target.value })} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" /></div>
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} className="h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500" />Enabled</label>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => { setShowForm(false); setEditingId(null); setDraft(emptyDraft) }}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saveMutation.isPending}>{saveMutation.isPending ? 'Saving...' : editingId ? 'Save Changes' : 'Save Provider'}</Button>
            </div>
          </form>
        )}
        <DataTable columns={columns} rows={data?.providers ?? []} keyExtractor={(provider) => provider.id} emptyMessage="No identity providers configured" />
      </Card>
    </PageShell>
  )
}
