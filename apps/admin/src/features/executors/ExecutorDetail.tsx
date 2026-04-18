import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { SkillSummary } from '@support-agent/contracts'
import { parseExecutorYaml } from '@support-agent/executors-runtime'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'
import { useSkills } from '@/features/skills/use-skills'
import { SkillPicker } from './SkillPicker'
import { useCloneExecutor, useExecutorDetail, useUpdateExecutor } from './use-executors'
import { YamlEditor } from './YamlEditor'

const advisoryClassName = 'rounded-[var(--radius-sm)] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800'
const inputClassName =
  'w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500'
const labelClassName = 'mb-1.5 block text-xs font-medium text-gray-500'

export default function ExecutorDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const detailQuery = useExecutorDetail(id)
  const builtinQuery = useExecutorDetail(detailQuery.data?.source === 'USER' ? detailQuery.data.clonedFrom?.id : undefined)
  const { data: skills } = useSkills()
  const cloneMutation = useCloneExecutor()
  const updateMutation = useUpdateExecutor(id)
  const [yaml, setYaml] = useState('')
  const [cloneKey, setCloneKey] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)

  const detail = detailQuery.data
  const isBehindBuiltin = !!detail && detail.source === 'USER' && detail.clonedFrom && builtinQuery.data && builtinQuery.data.contentHash !== detail.contentHash

  useEffect(() => {
    if (!detail) {
      return
    }

    setYaml(detail.yaml)
    setCloneKey(detail.source === 'BUILTIN' ? `${detail.key}-copy` : '')
    setServerError(null)
  }, [detail])

  let parsedStages: Array<{ id: string; after: string[]; system_skill: string; complementary: string[] }> = []
  try {
    parsedStages = parseExecutorYaml(yaml, { sourceName: detail?.key ?? 'executor.yaml' }).stages
  } catch {
    parsedStages = []
  }

  async function handleClone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail) {
      return
    }

    setServerError(null)
    try {
      const cloned = await cloneMutation.mutateAsync({
        clonedFromExecutorId: detail.id,
        key: cloneKey.trim(),
      })
      await navigate(`/executors/${cloned.id}`)
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Unable to clone executor')
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail || detail.source !== 'USER') {
      return
    }

    setServerError(null)
    try {
      await updateMutation.mutateAsync({ yaml })
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Unable to save executor')
    }
  }

  if (detailQuery.isLoading) {
    return <PageShell title="Executor"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!detail) {
    return <PageShell title="Executor"><p className="text-sm text-gray-400">Not found</p></PageShell>
  }

  return (
    <PageShell
      title={detail.key}
      fullWidth
      action={detail.source === 'USER' ? <Button variant="primary" form="executor-detail-form" type="submit" disabled={updateMutation.isPending}>Save</Button> : undefined}
    >
      <Link to="/executors" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">
        &larr; Back to Executors
      </Link>

      {isBehindBuiltin ? (
        <div className="mb-4">
          <div className={advisoryClassName}>
            Your clone is behind the builtin. The builtin has been updated since you cloned it.
          </div>
        </div>
      ) : null}

      {detail.source === 'BUILTIN' ? (
        <Card className="mb-4">
          <CardHeader title="Clone builtin" subtitle="Create a tenant-owned copy before editing." />
          <form className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-end" onSubmit={handleClone}>
            <div className="flex-1">
              <label htmlFor="executor-clone-key" className={labelClassName}>Clone key</label>
              <input id="executor-clone-key" className={inputClassName} value={cloneKey} onChange={(event) => { setCloneKey(event.target.value) }} required />
            </div>
            <Button variant="primary" type="submit" disabled={cloneMutation.isPending}>
              {cloneMutation.isPending ? 'Cloning...' : 'Clone Executor'}
            </Button>
          </form>
        </Card>
      ) : null}

      <form id="executor-detail-form" onSubmit={handleSave} className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(24rem,0.9fr)]">
        <Card>
          <CardHeader title="Executor YAML" subtitle={detail.description} />
          <div className="px-5 py-5">
            <YamlEditor value={yaml} onChange={setYaml} serverError={serverError} />
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Parsed Stages" subtitle={parsedStages.length > 0 ? `${parsedStages.length} stage(s)` : 'Unavailable'} />
            <div className="space-y-3 px-5 py-5">
              {parsedStages.length > 0 ? parsedStages.map((stage) => (
                <div key={stage.id} className="rounded-[var(--radius-sm)] border border-gray-200 p-4">
                  <div className="text-sm font-semibold text-gray-900">{stage.id}</div>
                  <div className="mt-2 text-xs text-gray-500">after: {stage.after.length > 0 ? stage.after.join(', ') : 'none'}</div>
                  <div className="mt-1 text-xs text-gray-500">system: {stage.system_skill}</div>
                  <div className="mt-1 text-xs text-gray-500">complementary: {stage.complementary.length > 0 ? stage.complementary.join(', ') : 'none'}</div>
                </div>
              )) : (
                <p className="text-sm text-gray-500">Parsed stage details appear once the YAML validates.</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Skill Picker" subtitle="Update stage bindings with role-aware controls." />
            <div className="px-5 py-5">
              <SkillPicker
                availableSkills={(skills ?? []) as SkillSummary[]}
                value={yaml}
                onChange={setYaml}
                disabled={detail.source !== 'USER'}
              />
            </div>
          </Card>
        </div>
      </form>
    </PageShell>
  )
}
