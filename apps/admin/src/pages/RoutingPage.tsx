import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon } from '@/components/icons/NavIcons'
import { routingApi, type RoutingRule } from '@/api/routing'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { Pagination } from '@/components/ui/Pagination'

const columns: Column<RoutingRule>[] = [
  {
    key: 'priority',
    header: 'Priority',
    render: (rule) => <span className="font-mono font-semibold text-gray-900">{rule.priority}</span>,
  },
  {
    key: 'connectorCondition',
    header: 'Connector Condition',
    render: (rule) => rule.connectorCondition ?? 'Any',
  },
  {
    key: 'workflowTypeCondition',
    header: 'Workflow Type',
    render: (rule) => rule.workflowTypeCondition ?? 'Any',
  },
  {
    key: 'scenarioCondition',
    header: 'Scenario',
    render: (rule) => rule.scenarioCondition ?? 'Any',
  },
  {
    key: 'destinationName',
    header: 'Destination',
    render: (rule) => <span className="font-medium text-gray-900">{rule.destinationName}</span>,
  },
  {
    key: 'enabled',
    header: 'Enabled',
    render: (rule) => (
      <span className="inline-flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${rule.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
          aria-hidden="true"
        />
        <span>{rule.enabled ? 'Active' : 'Disabled'}</span>
      </span>
    ),
  },
  {
    key: 'actions',
    header: 'Actions',
    className: 'text-right',
    render: (rule) => (
      <Link to={`/routing/rules/${rule.id}`} className="font-medium text-gray-700 hover:text-gray-900 hover:underline">
        View
      </Link>
    ),
  },
]

export default function RoutingPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['routing-rules', page],
    queryFn: () => routingApi.listRules({ page }),
  })

  if (isLoading) {
    return <PageShell title="Routing Rules"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  const rules = data?.data ?? []
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit ?? 20)))

  return (
    <PageShell
      title="Routing Rules"
      action={
        <>
          <Link to="/routing/destinations">
            <Button variant="secondary">Destinations</Button>
          </Link>
          <Link to="/routing/rules/new">
            <Button variant="primary" icon={<PlusIcon />}>New Rule</Button>
          </Link>
        </>
      }
    >
      <Card>
        <CardHeader title="All Rules" subtitle={`${data?.total ?? 0} total`} />
        <DataTable columns={columns} rows={rules} keyExtractor={(rule) => rule.id} emptyMessage="No routing rules found" />
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
