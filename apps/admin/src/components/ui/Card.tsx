import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`overflow-hidden rounded-[var(--radius-lg)] border border-gray-100 bg-white ${className}`}>
      {children}
    </div>
  )
}

interface CardHeaderProps {
  title: string
  subtitle?: string
  action?: ReactNode
}

export function CardHeader({ title, subtitle, action }: CardHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
      <div className="flex items-center gap-4">
        <h2 className="text-sm font-semibold text-gray-900">
          {title}
          {subtitle && <span className="ml-2 font-normal text-gray-400">{subtitle}</span>}
        </h2>
      </div>
      {action}
    </div>
  )
}
