import { Link } from 'react-router-dom'
import type { ExecutorSummary } from '@support-agent/contracts'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { useExecutors } from './use-executors'

const columns: Column<ExecutorSummary>[] = [
  {
    key: 'key',
    header: 'Key',
    render: (executor) => (
      <Link to={`/executors/${executor.id}`} className="font-medium text-gray-900 hover:underline">
        {executor.key}
      </Link>
    ),
  },
  {
    key: 'description',
    header: 'Display Name',
    className: 'max-w-[32rem] whitespace-normal',
    render: (executor) => <span>{executor.description}</span>,
  },
  {
    key: 'source',
    header: 'Source',
    render: (executor) => (
      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${executor.source === 'BUILTIN' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
        {executor.source === 'BUILTIN' ? 'Builtin' : 'User'}
      </span>
    ),
  },
]

export default function ExecutorsList() {
  const { data, isLoading } = useExecutors()

  return (
    <PageShell title="Executors">
      <Card>
        <CardHeader title="Executor Library" subtitle={`${data?.length ?? 0} total`} />
        <DataTable
          columns={columns}
          rows={data ?? []}
          keyExtractor={(executor) => executor.id}
          emptyMessage="No executors found"
          isLoading={isLoading}
        />
      </Card>
    </PageShell>
  )
}
