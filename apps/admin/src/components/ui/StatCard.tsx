import type { ReactNode } from 'react'

interface StatCardProps {
  label: string
  value: string | number
  icon: ReactNode
  iconColor: 'teal' | 'blue' | 'amber' | 'red'
  delta?: { value: string; direction: 'up' | 'down' }
  deltaLabel?: string
}

const iconBg: Record<string, string> = {
  teal:  'bg-accent-50 text-accent-600',
  blue:  'bg-signal-blue-50 text-signal-blue-500',
  amber: 'bg-signal-amber-50 text-signal-amber-500',
  red:   'bg-signal-red-50 text-signal-red-500',
}

export function StatCard({ label, value, icon, iconColor, delta, deltaLabel }: StatCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-gray-100 bg-white px-5 py-[18px]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
        <div className={`flex h-[30px] w-[30px] items-center justify-center rounded-[var(--radius-sm)] [&>svg]:h-4 [&>svg]:w-4 ${iconBg[iconColor]}`}>
          {icon}
        </div>
      </div>
      <span className="text-[28px] font-bold tracking-tight text-gray-900 tabular-nums">{value}</span>
      {delta && (
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <span
            className={`rounded-[3px] px-[5px] py-px font-mono text-[11px] font-semibold ${
              delta.direction === 'up'
                ? 'bg-accent-50 text-accent-600'
                : 'bg-signal-red-50 text-signal-red-500'
            }`}
          >
            {delta.value}
          </span>
          {deltaLabel}
        </div>
      )}
    </div>
  )
}
