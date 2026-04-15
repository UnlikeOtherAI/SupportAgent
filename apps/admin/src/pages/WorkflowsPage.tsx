import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { scenariosApi, type WorkflowScenario } from '@/api/scenarios'
import { PlusIcon } from '@/components/icons/NavIcons'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { Pagination } from '@/components/ui/Pagination'

const columns: Column<WorkflowScenario>[] = [
  {
    key: 'displayName',
    header: 'Workflow',
    render: (workflow) => (
      <Link to={`/workflows/${workflow.id}/designer`} className="font-medium text-gray-900 hover:underline">
        {workflow.displayName}
      </Link>
    ),
  },
  {
    key: 'key',
    header: 'Key',
    render: (workflow) => <span className="font-mono text-xs text-gray-500">{workflow.key}</span>,
  },
  {
    key: 'canvas',
    header: 'Canvas',
    render: (workflow) => (
      <span className="text-gray-600">
        {workflow.designerGraph.nodes.length} blocks / {workflow.designerGraph.connections.length} links
      </span>
    ),
  },
  {
    key: 'enabled',
    header: 'Status',
    render: (workflow) => (
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${workflow.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
        />
        <span>{workflow.enabled ? 'Active' : 'Disabled'}</span>
      </span>
    ),
  },
]

export default function WorkflowsPage() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ['workflows', page],
    queryFn: () => scenariosApi.list({ page }),
    placeholderData: keepPreviousData,
  })

  const workflows = data?.items ?? []
  const totalPages = Math.ceil((data?.total ?? 0) / (data?.limit ?? 20))

  return (
    <PageShell
      action={
        <Link to="/workflows/new/designer">
          <Button icon={<PlusIcon />} variant="primary">
            Create Workflow
          </Button>
        </Link>
      }
      title="Workflows"
    >
      <Card>
        <CardHeader
          subtitle="Saved trigger-action-output canvases"
          title={`${data?.total ?? 0} workflows`}
        />
        <DataTable
          columns={columns}
          emptyMessage="No workflows found"
          isLoading={isLoading}
          keyExtractor={(workflow) => workflow.id}
          rows={workflows}
        />
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            <span className="text-xs text-gray-400">
              Page {page} of {totalPages}
            </span>
            <Pagination onPageChange={setPage} page={page} totalPages={totalPages} />
          </div>
        )}
      </Card>
    </PageShell>
  )
}
