import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { reviewProfilesApi } from '@/api/review-profiles'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'

function serializeWorkflowTypes(value: string[]) {
  return value.join(', ')
}

function parseWorkflowTypes(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

export default function ReviewProfileEditPage() {
  const { id: rawId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['review-profile', rawId],
    queryFn: async () => {
      if (!rawId) throw new Error('No profile ID')
      return reviewProfilesApi.get(rawId)
    },
    enabled: !!rawId,
  })
  const [draft, setDraft] = useState<{
    name: string
    maxRounds: number
    mandatoryHumanApproval: boolean
    continueAfterPassing: boolean
    allowedWorkflowTypes: string
    promptSetRef: string
    active: boolean
  } | null>(null)

  // Always call useMutation unconditionally — before any conditionals
  const id = rawId ?? data?.id ?? ''
  const form = draft ?? (data ? {
    name: data.name,
    maxRounds: data.maxRounds,
    mandatoryHumanApproval: data.mandatoryHumanApproval,
    continueAfterPassing: data.continueAfterPassing,
    allowedWorkflowTypes: serializeWorkflowTypes(data.allowedWorkflowTypes),
    promptSetRef: data.promptSetRef ?? '',
    active: data.active,
  } : null)
  const mutation = useMutation({
    mutationFn: () => {
      if (!rawId) throw new Error('No profile ID')
      if (!form) throw new Error('Review profile not loaded')
      return reviewProfilesApi.update(rawId, {
        name: form.name,
        maxRounds: form.maxRounds,
        mandatoryHumanApproval: form.mandatoryHumanApproval,
        continueAfterPassing: form.continueAfterPassing,
        allowedWorkflowTypes: parseWorkflowTypes(form.allowedWorkflowTypes),
        promptSetRef: form.promptSetRef.trim() || null,
        active: form.active,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['review-profiles'] })
      void queryClient.invalidateQueries({ queryKey: ['review-profile', rawId] })
      void navigate(`/review-profiles/${rawId}`)
    },
  })

  if (isLoading) {
    return <PageShell title="Edit Review Profile"><p className="text-sm text-gray-400">Loading...</p></PageShell>
  }

  if (!data) {
    return <PageShell title="Edit Review Profile"><p className="text-sm text-gray-400">Not found</p></PageShell>
  }

  return (
    <PageShell title={`Edit ${data.name}`}>
      <Link to={`/review-profiles/${id}`} className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">
        &larr; Back to Review Profile
      </Link>
      <Card>
        <form onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
          <div className="space-y-4 px-5 py-5">
            <div><label htmlFor="review-profile-name" className="mb-1.5 block text-xs font-medium text-gray-500">Name</label><input id="review-profile-name" value={form?.name ?? ''} onChange={(event) => { if (form) setDraft({ ...form, name: event.target.value }); }} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" /></div>
            <div><label htmlFor="review-profile-max-rounds" className="mb-1.5 block text-xs font-medium text-gray-500">Max Rounds</label><input id="review-profile-max-rounds" type="number" min="1" value={form?.maxRounds ?? 1} onChange={(event) => { if (form) setDraft({ ...form, maxRounds: Number(event.target.value) || 1 }); }} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" /></div>
            <div><label htmlFor="review-profile-workflow-types" className="mb-1.5 block text-xs font-medium text-gray-500">Allowed Workflow Types</label><input id="review-profile-workflow-types" value={form?.allowedWorkflowTypes ?? ''} onChange={(event) => { if (form) setDraft({ ...form, allowedWorkflowTypes: event.target.value }); }} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" /></div>
            <div><label htmlFor="review-profile-prompt-set-ref" className="mb-1.5 block text-xs font-medium text-gray-500">Prompt Set Ref</label><input id="review-profile-prompt-set-ref" value={form?.promptSetRef ?? ''} onChange={(event) => { if (form) setDraft({ ...form, promptSetRef: event.target.value }); }} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" /></div>
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form?.mandatoryHumanApproval ?? false} onChange={(event) => { if (form) setDraft({ ...form, mandatoryHumanApproval: event.target.checked }); }} className="h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500" />Mandatory Human Approval</label>
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form?.continueAfterPassing ?? false} onChange={(event) => { if (form) setDraft({ ...form, continueAfterPassing: event.target.checked }); }} className="h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500" />Continue After Passing</label>
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form?.active ?? false} onChange={(event) => { if (form) setDraft({ ...form, active: event.target.checked }); }} className="h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500" />Active</label>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => navigate(`/review-profiles/${id}`)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving...' : 'Save Changes'}</Button>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
