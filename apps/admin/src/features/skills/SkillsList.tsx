import { Link } from 'react-router-dom'
import type { SkillSummary } from '@support-agent/contracts'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { useSkills } from './use-skills'

const columns: Column<SkillSummary>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (skill) => (
      <Link to={`/skills/${skill.id}`} className="font-medium text-gray-900 hover:underline">
        {skill.name}
      </Link>
    ),
  },
  {
    key: 'role',
    header: 'Role',
    render: (skill) => (
      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${skill.role === 'SYSTEM' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}>
        {skill.role === 'SYSTEM' ? 'System' : 'Complementary'}
      </span>
    ),
  },
  {
    key: 'source',
    header: 'Source',
    render: (skill) => (
      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${skill.source === 'BUILTIN' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
        {skill.source === 'BUILTIN' ? 'Builtin' : 'User'}
      </span>
    ),
  },
  {
    key: 'description',
    header: 'Description',
    className: 'max-w-[32rem] whitespace-normal',
    render: (skill) => (
      <div className="space-y-1">
        <p className="text-gray-700">{skill.description}</p>
        {skill.bodyPreview ? <p className="text-xs text-gray-500">{skill.bodyPreview}</p> : null}
      </div>
    ),
  },
]

export default function SkillsList() {
  const { data, isLoading } = useSkills()

  return (
    <PageShell title="Skills">
      <Card>
        <CardHeader title="Skill Library" subtitle={`${data?.length ?? 0} total`} />
        <DataTable
          columns={columns}
          rows={data ?? []}
          keyExtractor={(skill) => skill.id}
          emptyMessage="No skills found"
          isLoading={isLoading}
        />
      </Card>
    </PageShell>
  )
}
