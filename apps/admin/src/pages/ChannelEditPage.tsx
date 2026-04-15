import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { channelsApi, type CommunicationChannel } from '@/api/channels'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'

const allowedActionOptions = ['triage', 'summarize', 'request-pr']

function parseCommaSeparatedList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

interface ChannelFormState {
  name: string
  platform: CommunicationChannel['platform']
  linkedWorkspace: string
  linkedScope: string
  allowedActions: string[]
  notificationSubscriptions: string
}

function createFormState(channel: CommunicationChannel): ChannelFormState {
  return {
    name: channel.name,
    platform: channel.platform,
    linkedWorkspace: channel.linkedWorkspace ?? '',
    linkedScope: channel.linkedScope ?? '',
    allowedActions: channel.allowedActions,
    notificationSubscriptions: channel.notificationSubscriptions.join(', '),
  }
}

export default function ChannelEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<ChannelFormState | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['channel', id],
    queryFn: async () => {
      if (!id) throw new Error('Channel id is required')
      return channelsApi.get(id)
    },
    enabled: !!id,
  })
  const mutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Channel id is required')
      if (!data) throw new Error('Channel data is required')

      const form = draft ?? createFormState(data)
      return channelsApi.update(id, {
        name: form.name.trim(),
        platform: form.platform,
        linkedWorkspace: form.linkedWorkspace.trim() || null,
        linkedScope: form.linkedScope.trim() || null,
        allowedActions: form.allowedActions,
        notificationSubscriptions: parseCommaSeparatedList(form.notificationSubscriptions),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['channels'] })
      void queryClient.invalidateQueries({ queryKey: ['channel', id] })
      void navigate(`/channels/${id}`)
    },
  })

  if (isLoading) {
    return (
      <PageShell title="Edit Channel">
        <p className="text-sm text-gray-400">Loading...</p>
      </PageShell>
    )
  }

  if (!data) {
    return (
      <PageShell title="Edit Channel">
        <p className="text-sm text-gray-400">Not found</p>
      </PageShell>
    )
  }

  const form = draft ?? createFormState(data)
  function toggleAllowedAction(action: string) {
    setDraft({
      ...form,
      allowedActions: form.allowedActions.includes(action)
        ? form.allowedActions.filter((item) => item !== action)
        : [...form.allowedActions, action],
    })
  }

  return (
    <PageShell title="Edit Channel">
      <Link to={`/channels/${id}`} className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">
        &larr; Back to Channel
      </Link>
      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate()
          }}
        >
          <div className="grid grid-cols-1 gap-4 px-5 py-5 md:grid-cols-2">
            <div>
              <label htmlFor="channel-name" className="mb-1.5 block text-xs font-medium text-gray-500">Name</label>
              <input
                id="channel-name"
                value={form.name}
                onChange={(event) => {
                  setDraft({ ...form, name: event.target.value })
                }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <div>
              <label htmlFor="channel-platform" className="mb-1.5 block text-xs font-medium text-gray-500">Platform</label>
              <select
                id="channel-platform"
                value={form.platform}
                onChange={(event) => {
                  setDraft({ ...form, platform: event.target.value as CommunicationChannel['platform'] })
                }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              >
                <option value="slack">Slack</option>
                <option value="teams">Teams</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </div>
            <div>
              <label htmlFor="channel-linked-workspace" className="mb-1.5 block text-xs font-medium text-gray-500">Linked Workspace</label>
              <input
                id="channel-linked-workspace"
                value={form.linkedWorkspace}
                onChange={(event) => {
                  setDraft({ ...form, linkedWorkspace: event.target.value })
                }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <div>
              <label htmlFor="channel-linked-scope" className="mb-1.5 block text-xs font-medium text-gray-500">Linked Scope</label>
              <input
                id="channel-linked-scope"
                value={form.linkedScope}
                onChange={(event) => {
                  setDraft({ ...form, linkedScope: event.target.value })
                }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <div>
              <div className="mb-1.5 block text-xs font-medium text-gray-500">Allowed Actions</div>
              <div className="flex flex-col gap-2">
                {allowedActionOptions.map((action) => (
                  <label key={action} htmlFor={`channel-action-${action}`} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      id={`channel-action-${action}`}
                      type="checkbox"
                      checked={form.allowedActions.includes(action)}
                      onChange={() => { toggleAllowedAction(action) }}
                      className="h-4 w-4 rounded border-gray-300 text-accent-500 focus:ring-accent-500"
                    />
                    {action}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="channel-notification-subscriptions" className="mb-1.5 block text-xs font-medium text-gray-500">Notification Subscriptions</label>
              <input
                id="channel-notification-subscriptions"
                value={form.notificationSubscriptions}
                onChange={(event) => {
                  setDraft({ ...form, notificationSubscriptions: event.target.value })
                }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                void navigate(`/channels/${id}`)
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending || !form.name.trim()}>
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
