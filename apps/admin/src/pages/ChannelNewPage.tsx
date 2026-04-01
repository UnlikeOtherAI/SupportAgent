import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { channelsApi, type CommunicationChannel } from '@/api/channels'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'

function parseCommaSeparatedList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

export default function ChannelNewPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<CommunicationChannel['platform']>('slack')
  const [linkedWorkspace, setLinkedWorkspace] = useState('')
  const [linkedScope, setLinkedScope] = useState('')
  const [allowedActions, setAllowedActions] = useState('')
  const [notificationSubscriptions, setNotificationSubscriptions] = useState('')
  const mutation = useMutation({
    mutationFn: () => channelsApi.create({
      name: name.trim(),
      platform,
      linkedWorkspace: linkedWorkspace.trim() || null,
      linkedScope: linkedScope.trim() || null,
      allowedActions: parseCommaSeparatedList(allowedActions),
      notificationSubscriptions: parseCommaSeparatedList(notificationSubscriptions),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['channels'] })
      void navigate('/channels')
    },
  })

  return (
    <PageShell title="New Channel">
      <Link to="/channels" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">
        &larr; Back to Channels
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
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <div>
              <label htmlFor="channel-platform" className="mb-1.5 block text-xs font-medium text-gray-500">Platform</label>
              <select
                id="channel-platform"
                value={platform}
                onChange={(event) => {
                  setPlatform(event.target.value as CommunicationChannel['platform'])
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
                value={linkedWorkspace}
                onChange={(event) => {
                  setLinkedWorkspace(event.target.value)
                }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <div>
              <label htmlFor="channel-linked-scope" className="mb-1.5 block text-xs font-medium text-gray-500">Linked Scope</label>
              <input
                id="channel-linked-scope"
                value={linkedScope}
                onChange={(event) => {
                  setLinkedScope(event.target.value)
                }}
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <div>
              <label htmlFor="channel-allowed-actions" className="mb-1.5 block text-xs font-medium text-gray-500">Allowed Actions</label>
              <input
                id="channel-allowed-actions"
                value={allowedActions}
                onChange={(event) => {
                  setAllowedActions(event.target.value)
                }}
                placeholder="triage, summarize, request-pr"
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
            <div>
              <label htmlFor="channel-notification-subscriptions" className="mb-1.5 block text-xs font-medium text-gray-500">Notification Subscriptions</label>
              <input
                id="channel-notification-subscriptions"
                value={notificationSubscriptions}
                onChange={(event) => {
                  setNotificationSubscriptions(event.target.value)
                }}
                placeholder="critical-alerts, run-updates"
                className="w-full rounded-[var(--radius-sm)] border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                void navigate('/channels')
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending || !name.trim()}>
              {mutation.isPending ? 'Creating...' : 'Create Channel'}
            </Button>
          </div>
        </form>
      </Card>
    </PageShell>
  )
}
