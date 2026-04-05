import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { settingsApi, type User } from '@/api/settings'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { Pagination } from '@/components/ui/Pagination'

const roleStyles: Record<User['role'], string> = {
  admin: 'bg-accent-50 text-accent-600',
  operator: 'bg-signal-blue-50 text-signal-blue-500',
  viewer: 'bg-gray-100 text-gray-500',
}

export default function SettingsUsersPage() {
  const [page, setPage] = useState(1)
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => settingsApi.listUsers() })
  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: User['role'] }) => settingsApi.updateUserRole(id, role),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
  })
  const deactivateMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deactivateUser(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
  })

  const pageSize = data?.limit ?? 25
  const allUsers = data?.data ?? []
  const totalPages = Math.max(1, Math.ceil(allUsers.length / pageSize))
  const users = allUsers.slice((page - 1) * pageSize, page * pageSize)
  const columns: Column<User>[] = [
    { key: 'name', header: 'Name', render: (user) => <span className="font-medium text-gray-900">{user.displayName}</span> },
    { key: 'email', header: 'Email', render: (user) => <span>{user.email}</span> },
    { key: 'role', header: 'Role', render: (user) => <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${roleStyles[user.role]}`}>{user.role}</span> },
    { key: 'lastLogin', header: 'Last Login', render: (user) => <span className="font-mono text-xs text-gray-500">{user.lastLogin ?? 'Never'}</span> },
    {
      key: 'actions',
      header: 'Actions',
      render: (user) => (
        <div className="flex items-center gap-2">
          <select value={user.role} onChange={(event) => { roleMutation.mutate({ id: user.id, role: event.target.value as User['role'] }); }} className="rounded-[var(--radius-sm)] border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500">
            <option value="admin">admin</option>
            <option value="operator">operator</option>
            <option value="viewer">viewer</option>
          </select>
          <Button type="button" variant="ghost" className="text-signal-red-500 hover:bg-signal-red-50 hover:text-signal-red-600" onClick={() => { deactivateMutation.mutate(user.id); }}>Deactivate</Button>
        </div>
      ),
    },
  ]

  return (
    <PageShell title="Users">
      <Link to="/settings" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-700">&larr; Back to Settings</Link>
      <Card>
        <CardHeader title="Tenant Users" subtitle={`${allUsers.length} loaded`} />
        <DataTable columns={columns} rows={users} keyExtractor={(user) => user.id} emptyMessage="No users found" isLoading={isLoading} />
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </Card>
    </PageShell>
  )
}
