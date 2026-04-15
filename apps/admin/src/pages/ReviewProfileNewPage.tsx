import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { reviewProfilesApi } from '@/api/review-profiles'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'

const workflowTypeOptions = ['triage', 'build', 'merge'] as const

export default function ReviewProfileNewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [maxRounds, setMaxRounds] = useState(1)
  const [mandatoryHumanApproval, setMandatoryHumanApproval] = useState(false)
  const [continueAfterPassing, setContinueAfterPassing] = useState(false)
  const [allowedWorkflowTypes, setAllowedWorkflowTypes] = useState<string[]>([])
  const [promptSetRef, setPromptSetRef] = useState('')
  const [active, setActive] = useState(true)
  const mutation = useMutation({
    mutationFn: () => reviewProfilesApi.create({
      name,
      maxRounds,
      mandatoryHumanApproval,
      continueAfterPassing,
      allowedWorkflowTypes,
      promptSetRef: promptSetRef.trim() || null,
      active,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['review-profiles'] })
      void navigate('/review-profiles')
    },
  })
  function toggleWorkflowType(workflowType: string) {
    setAllowedWorkflowTypes((current) => (
      current.includes(workflowType)
        ? current.filter((item) => item !== workflowType)
        : [...current, workflowType]
    ))
  }

  return (
    <PageShell title="New Review Profile">
      <Link to="/review-profiles" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">
        &larr; Back to Review Profiles
      </Link>
      <Card>
        <form onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
          <div className="space-y-4 px-5 py-5">
            <div><label htmlFor="review-profile-name" className="mb-1.5 block text-xs font-medium text-gray-500">Name</label><input id="review-profile-name" value={name} onChange={(event) => { setName(event.target.value); }} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" /></div>
            <div><label htmlFor="review-profile-max-rounds" className="mb-1.5 block text-xs font-medium text-gray-500">Max Rounds</label><input id="review-profile-max-rounds" type="number" min="1" value={maxRounds} onChange={(event) => { setMaxRounds(Number(event.target.value) || 1); }} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" /></div>
            <div>
              <div className="mb-1.5 block text-xs font-medium text-gray-500">Allowed Workflow Types</div>
              <div className="flex flex-col gap-2">
                {workflowTypeOptions.map((workflowType) => (
                  <label key={workflowType} htmlFor={`review-profile-workflow-${workflowType}`} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      id={`review-profile-workflow-${workflowType}`}
                      type="checkbox"
                      checked={allowedWorkflowTypes.includes(workflowType)}
                      onChange={() => { toggleWorkflowType(workflowType) }}
                      className="h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500"
                    />
                    {workflowType}
                  </label>
                ))}
              </div>
            </div>
            <div><label htmlFor="review-profile-prompt-set-ref" className="mb-1.5 block text-xs font-medium text-gray-500">Prompt Set Ref</label><input id="review-profile-prompt-set-ref" value={promptSetRef} onChange={(event) => { setPromptSetRef(event.target.value); }} className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500" /></div>
            <label htmlFor="review-profile-mandatory-human-approval" className="flex items-center gap-2 text-sm text-gray-700"><input id="review-profile-mandatory-human-approval" type="checkbox" checked={mandatoryHumanApproval} onChange={(event) => { setMandatoryHumanApproval(event.target.checked); }} className="h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500" />Mandatory Human Approval</label>
            <label htmlFor="review-profile-continue-after-passing" className="flex items-center gap-2 text-sm text-gray-700"><input id="review-profile-continue-after-passing" type="checkbox" checked={continueAfterPassing} onChange={(event) => { setContinueAfterPassing(event.target.checked); }} className="h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500" />Continue After Passing</label>
            <label htmlFor="review-profile-active" className="flex items-center gap-2 text-sm text-gray-700"><input id="review-profile-active" type="checkbox" checked={active} onChange={(event) => { setActive(event.target.checked); }} className="h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500" />Active</label>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => navigate('/review-profiles')}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>{mutation.isPending ? 'Creating...' : 'Create Profile'}</Button>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
