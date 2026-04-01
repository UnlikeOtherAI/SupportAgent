import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { settingsApi, type AuditEvent } from '@/api/settings'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { Pagination } from '@/components/ui/Pagination'

export default function SettingsAuditPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['audit-events', page],
    queryFn: () => settingsApi.listAuditEvents({ page, limit: 25 }),
  })
  const columns: Column<AuditEvent>[] = [
    { key: 'timestamp', header: 'Timestamp', render: (event) => <span className="font-mono text-xs text-gray-500">{event.timestamp}</span> },
    { key: 'actor', header: 'Actor', render: (event) => <span className="font-medium text-gray-900">{event.actor}</span> },
    { key: 'action', header: 'Action', render: (event) => <span>{event.action}</span> },
    { key: 'resourceType', header: 'Resource Type', render: (event) => <span className="font-mono text-xs text-gray-500">{event.resourceType}</span> },
    { key: 'resourceId', header: 'Resource ID', render: (event) => <span className="block max-w-48 truncate font-mono text-xs text-gray-500">{event.resourceId}</span> },
    {
      key: 'outcome',
      header: 'Outcome',
      render: (event) => <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${event.outcome === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{event.outcome}</span>,
    },
  ]

  if (isLoading) {
    return <PageShell title="Audit Log"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  const events = data?.data ?? []
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit ?? 25)))

  return (
    <PageShell title="Audit Log">
      <Link to="/settings" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Settings</Link>
      <Card>
        <CardHeader title="Recent Events" subtitle={`${data?.total ?? 0} total`} />
        <DataTable columns={columns} rows={events} keyExtractor={(event) => event.id} emptyMessage="No audit events found" />
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </Card>
    </PageShell>
  )
}
