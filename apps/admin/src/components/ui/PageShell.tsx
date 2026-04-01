import type { ReactNode } from 'react'

interface PageShellProps {
  title: string
  action?: ReactNode
  children: ReactNode
}

export function PageShell({ title, action, children }: PageShellProps) {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-gray-900">{title}</h1>
        {action && <div className="flex gap-2">{action}</div>}
      </div>
      {children}
    </div>
  )
}
