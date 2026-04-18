import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'
import { useCloneSkill, useSkillDetail, useUpdateSkill } from './use-skills'

const inputClassName =
  'w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500'
const labelClassName = 'mb-1.5 block text-xs font-medium text-gray-500'
const advisoryClassName = 'rounded-[var(--radius-sm)] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800'

export default function SkillDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const detailQuery = useSkillDetail(id)
  const cloneMutation = useCloneSkill()
  const updateMutation = useUpdateSkill(id)
  const [cloneName, setCloneName] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState('')
  const [outputSchemaText, setOutputSchemaText] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const detail = detailQuery.data
  const builtinQuery = useSkillDetail(detail?.source === 'USER' ? detail.clonedFrom?.id : undefined)
  const isBehindBuiltin = !!detail && detail.source === 'USER' && detail.clonedFrom && builtinQuery.data && builtinQuery.data.contentHash !== detail.contentHash

  useEffect(() => {
    if (!detail) {
      return
    }

    setName(detail.name)
    setDescription(detail.description)
    setBody(detail.body)
    setOutputSchemaText(detail.outputSchema ? JSON.stringify(detail.outputSchema, null, 2) : '')
    setCloneName(detail.source === 'BUILTIN' ? `${detail.name}-copy` : '')
    setFormError(null)
  }, [detail])

  const parsedOutputSchema = useMemo(() => {
    if (!outputSchemaText.trim()) {
      return { value: null as Record<string, unknown> | null, error: null as string | null }
    }

    try {
      const parsed = JSON.parse(outputSchemaText) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { value: null, error: 'Output schema must be a JSON object.' }
      }

      return { value: parsed as Record<string, unknown>, error: null }
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : 'Invalid JSON',
      }
    }
  }, [outputSchemaText])

  async function handleClone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail) {
      return
    }

    setFormError(null)
    try {
      const cloned = await cloneMutation.mutateAsync({
        clonedFromSkillId: detail.id,
        name: cloneName.trim(),
      })
      await navigate(`/skills/${cloned.id}`)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to clone skill')
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail || detail.source !== 'USER') {
      return
    }

    if (detail.role === 'SYSTEM' && parsedOutputSchema.error) {
      setFormError(parsedOutputSchema.error)
      return
    }

    setFormError(null)
    try {
      await updateMutation.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        body,
        outputSchema: detail.role === 'SYSTEM' ? parsedOutputSchema.value : null,
      })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to save skill')
    }
  }

  if (detailQuery.isLoading) {
    return <PageShell title="Skill"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!detail) {
    return <PageShell title="Skill"><p className="text-sm text-gray-400">Not found</p></PageShell>
  }

  return (
    <PageShell
      title={detail.name}
      action={detail.source === 'USER' ? <Button variant="primary" form="skill-detail-form" type="submit" disabled={updateMutation.isPending}>Save</Button> : undefined}
    >
      <Link to="/skills" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">
        &larr; Back to Skills
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
              <label htmlFor="skill-clone-name" className={labelClassName}>Clone name</label>
              <input id="skill-clone-name" className={inputClassName} value={cloneName} onChange={(event) => { setCloneName(event.target.value) }} required />
            </div>
            <Button variant="primary" type="submit" disabled={cloneMutation.isPending}>
              {cloneMutation.isPending ? 'Cloning...' : 'Clone Skill'}
            </Button>
          </form>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Skill Detail" subtitle={`${detail.role === 'SYSTEM' ? 'System' : 'Complementary'} · ${detail.source === 'BUILTIN' ? 'Builtin' : 'User'}`} />
        <form id="skill-detail-form" onSubmit={handleSave}>
          <div className="grid gap-4 px-5 py-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="skill-name" className={labelClassName}>Name</label>
                {detail.source === 'USER' ? (
                  <input id="skill-name" className={inputClassName} value={name} onChange={(event) => { setName(event.target.value) }} />
                ) : (
                  <div className="rounded-[var(--radius-sm)] border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">{detail.name}</div>
                )}
              </div>
              <div>
                <label className={labelClassName}>Cloned From</label>
                <div className="rounded-[var(--radius-sm)] border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {detail.clonedFrom ? detail.clonedFrom.label : 'Original builtin'}
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="skill-description" className={labelClassName}>Description</label>
              {detail.source === 'USER' ? (
                <textarea id="skill-description" className={`${inputClassName} min-h-24`} value={description} onChange={(event) => { setDescription(event.target.value) }} />
              ) : (
                <div className="rounded-[var(--radius-sm)] border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">{detail.description}</div>
              )}
            </div>

            <div>
              <label htmlFor="skill-body" className={labelClassName}>Markdown Body</label>
              {detail.source === 'USER' ? (
                <textarea id="skill-body" className={`${inputClassName} min-h-80 font-mono`} value={body} onChange={(event) => { setBody(event.target.value) }} spellCheck={false} />
              ) : (
                <pre className="overflow-x-auto rounded-[var(--radius-sm)] border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-6 whitespace-pre-wrap text-gray-700">{detail.body}</pre>
              )}
            </div>

            {detail.role === 'SYSTEM' ? (
              <details className="rounded-[var(--radius-sm)] border border-gray-200">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-800">Output schema</summary>
                <div className="border-t border-gray-200 px-4 py-3">
                  {detail.source === 'USER' ? (
                    <textarea className={`${inputClassName} min-h-64 font-mono`} value={outputSchemaText} onChange={(event) => { setOutputSchemaText(event.target.value) }} spellCheck={false} />
                  ) : (
                    <pre className="overflow-x-auto text-sm leading-6 whitespace-pre-wrap text-gray-700">{JSON.stringify(detail.outputSchema, null, 2)}</pre>
                  )}
                  {parsedOutputSchema.error ? <p className="mt-2 text-sm text-red-600">{parsedOutputSchema.error}</p> : null}
                </div>
              </details>
            ) : null}

            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
