type BadgeVariant = 'running' | 'succeeded' | 'failed' | 'queued'

interface BadgeProps {
  variant: BadgeVariant
  children: string
}

const styles: Record<BadgeVariant, { bg: string; text: string; dot: string; pulse: boolean }> = {
  running:   { bg: 'bg-signal-blue-50',  text: 'text-signal-blue-500',  dot: 'bg-signal-blue-500',  pulse: true },
  succeeded: { bg: 'bg-accent-50',       text: 'text-accent-600',       dot: 'bg-accent-500',       pulse: false },
  failed:    { bg: 'bg-signal-red-50',   text: 'text-signal-red-500',   dot: 'bg-signal-red-500',   pulse: false },
  queued:    { bg: 'bg-gray-100',        text: 'text-gray-500',         dot: 'bg-gray-400',         pulse: false },
}

export function Badge({ variant, children }: BadgeProps) {
  const s = styles[variant]
  return (
    <span className={`inline-flex items-center gap-[5px] rounded-full px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot} ${s.pulse ? 'animate-status-pulse' : ''}`} />
      {children}
    </span>
  )
}
