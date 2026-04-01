import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      {icon && <div className="text-gray-300 [&>svg]:h-10 [&>svg]:w-10">{icon}</div>}
      <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      {description && <p className="max-w-sm text-sm text-gray-400">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
