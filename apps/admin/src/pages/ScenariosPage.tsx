import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { scenariosApi, type WorkflowScenario } from '@/api/scenarios'
import { PlusIcon } from '@/components/icons/NavIcons'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { Pagination } from '@/components/ui/Pagination'
import { TypePill } from '@/components/ui/TypePill'

const columns: Column<WorkflowScenario>[] = [
  {
    key: 'displayName',
    header: 'Display Name',
    render: (scenario) => (
      <Link to={`/scenarios/${scenario.id}`} className="font-medium text-gray-900 hover:underline">
        {scenario.displayName}
      </Link>
    ),
  },
  {
    key: 'key',
    header: 'Key',
    render: (scenario) => <span className="font-mono text-xs text-gray-500">{scenario.key}</span>,
  },
  {
    key: 'workflowType',
    header: 'Workflow Type',
    render: (scenario) => <TypePill type={scenario.workflowType} />,
  },
  {
    key: 'triggers',
    header: 'Triggers',
    render: (scenario) => <span>{scenario.triggerPolicyCount}</span>,
  },
  {
    key: 'enabled',
    header: 'Enabled',
    render: (scenario) => (
      <span className="inline-flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${scenario.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
          aria-hidden="true"
        />
        <span>{scenario.enabled ? 'Active' : 'Disabled'}</span>
      </span>
    ),
  },
]

export default function ScenariosPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['scenarios', page],
    queryFn: () => scenariosApi.list({ page }),
    placeholderData: keepPreviousData,
  })

  const scenarios = data?.data ?? []
  const totalPages = Math.ceil((data?.total ?? 0) / (data?.limit ?? 20))

  return (
    <PageShell
      title="Workflow Scenarios"
      action={
        <Link to="/scenarios/new">
          <Button variant="primary" icon={<PlusIcon />}>
            New Scenario
          </Button>
        </Link>
      }
    >
      <Card>
        <CardHeader title="All Scenarios" subtitle={`${data?.total ?? 0} total`} />
        <DataTable
          columns={columns}
          rows={scenarios}
          keyExtractor={(scenario) => scenario.id}
          emptyMessage="No scenarios found"
          isLoading={isLoading}
        />
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            <span className="text-xs text-gray-400">
              Page {page} of {totalPages}
            </span>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </Card>
    </PageShell>
  )
}
